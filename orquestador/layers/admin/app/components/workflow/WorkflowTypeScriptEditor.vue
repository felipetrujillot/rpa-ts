<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Code2, Maximize2, Minimize2, WrapText } from "lucide-vue-next";
import type { editor, IDisposable } from "monaco-editor/editor";

const props = defineProps<{ modelValue: string; label?: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const shell = ref<HTMLDialogElement>();
const host = ref<HTMLDivElement>();
const expanded = ref(false);
const loaded = ref(false);
const loadError = ref(false);
const wordWrap = ref(false);
const problems = ref(0);
const tabFocusShortcut = ref("Ctrl+M");
const position = ref({ lineNumber: 1, column: 1 });
let instance: editor.IStandaloneCodeEditor | undefined;
let model: editor.ITextModel | undefined;
let active = true;
let returnFocus: HTMLElement | null = null;
const disposables: IDisposable[] = [];

watch(
  () => props.modelValue,
  (value) => {
    if (model && model.getValue() !== value) {
      instance?.executeEdits("workflow", [
        { range: model.getFullModelRange(), text: value },
      ]);
    }
  },
);

onMounted(async () => {
  if (/Mac|iPhone|iPad/.test(navigator.platform)) {
    tabFocusShortcut.value = "Ctrl+Shift+M";
  }
  try {
    // Load the editor and language workers only when a TypeScript step is opened.
    const { monaco } = await import("../../utils/script-monaco");
    if (!active || !host.value) return;
    model = monaco.editor.createModel(
      props.modelValue,
      "typescript",
      monaco.Uri.parse(`file:///script-${crypto.randomUUID()}.ts`),
    );
    instance = monaco.editor.create(host.value, {
      model,
      theme: "vs-dark",
      automaticLayout: true,
      ariaLabel: props.label ?? "Código TypeScript",
      fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
      fontSize: 13,
      lineHeight: 21,
      lineNumbers: "on",
      lineNumbersMinChars: 3,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      tabSize: 2,
      insertSpaces: true,
      fixedOverflowWidgets: false,
      padding: { top: 12, bottom: 12 },
      folding: true,
      bracketPairColorization: { enabled: true },
      formatOnPaste: true,
      formatOnType: true,
      suggest: { showWords: false },
      quickSuggestions: true,
      stickyScroll: { enabled: false },
    });
    disposables.push(
      instance.onDidChangeModelContent(() =>
        emit("update:modelValue", instance!.getValue()),
      ),
    );
    disposables.push(
      instance.onDidChangeCursorPosition((event) => {
        position.value = event.position;
      }),
    );
    disposables.push(
      monaco.editor.onDidChangeMarkers((resources) => {
        if (
          model &&
          resources.some((uri) => uri.toString() === model!.uri.toString())
        ) {
          problems.value = monaco.editor
            .getModelMarkers({ resource: model.uri })
            .filter(
              (marker) => marker.severity >= monaco.MarkerSeverity.Warning,
            ).length;
        }
      }),
    );
    loaded.value = true;
  } catch (cause) {
    console.error("No se pudo cargar el editor TypeScript.", cause);
    loadError.value = true;
  }
});

async function toggleExpanded() {
  const dialog = shell.value;
  if (!dialog) return;
  if (expanded.value) {
    dialog.close();
    dialog.show();
    expanded.value = false;
    returnFocus?.focus();
  } else {
    returnFocus = document.activeElement as HTMLElement;
    dialog.close();
    dialog.showModal();
    expanded.value = true;
  }
  await nextTick();
  instance?.layout();
  if (expanded.value) instance?.focus();
}
function cancel(event: Event) {
  event.preventDefault();
  if (expanded.value) void toggleExpanded();
}
function toggleWrap() {
  wordWrap.value = !wordWrap.value;
  instance?.updateOptions({ wordWrap: wordWrap.value ? "on" : "off" });
}
async function format() {
  await instance?.getAction("editor.action.formatDocument")?.run();
  instance?.focus();
}

onBeforeUnmount(() => {
  active = false;
  disposables.forEach((disposable) => disposable.dispose());
  instance?.dispose();
  model?.dispose();
  if (expanded.value) shell.value?.close();
});
</script>

<template>
  <dialog
    ref="shell"
    open
    class="wf-code-editor"
    :class="{ 'is-expanded': expanded }"
    :aria-label="label ?? 'Código TypeScript'"
    @cancel="cancel"
    @keydown.stop
  >
    <header class="wf-code-toolbar">
      <span class="wf-code-filename"><Code2 :size="15" />script.ts</span>
      <div class="wf-code-actions">
        <button
          type="button"
          :disabled="!loaded"
          title="Formatear código (Shift+Alt+F)"
          @click="format"
        >
          Formatear
        </button>
        <button
          type="button"
          :disabled="!loaded"
          :aria-pressed="wordWrap"
          aria-label="Ajustar líneas"
          title="Ajustar líneas"
          @click="toggleWrap"
        >
          <WrapText :size="15" />
        </button>
        <button
          type="button"
          :aria-label="expanded ? 'Reducir editor' : 'Ampliar editor'"
          :title="expanded ? 'Reducir editor (Esc)' : 'Ampliar editor'"
          @click="toggleExpanded"
        >
          <component :is="expanded ? Minimize2 : Maximize2" :size="15" />
        </button>
      </div>
    </header>
    <div ref="host" class="wf-code-host" :class="{ 'is-loading': !loaded }" />
    <textarea
      v-if="!loaded"
      :value="modelValue"
      :aria-label="label ?? 'Código TypeScript'"
      class="wf-code-fallback"
      spellcheck="false"
      @input="
        emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)
      "
    />
    <footer class="wf-code-status" aria-live="polite">
      <span v-if="loadError"
        >Editor no disponible. Puedes seguir editando el texto.</span
      >
      <span v-else-if="!loaded">Cargando editor…</span>
      <span v-else>{{
        problems
          ? `${problems} aviso${problems === 1 ? "" : "s"}`
          : "Sin problemas"
      }}</span>
      <span v-if="loaded"
        >Ln {{ position.lineNumber }}, Col {{ position.column }}</span
      >
      <span>TypeScript</span>
    </footer>
    <p class="wf-code-help">
      Ctrl+Espacio para sugerencias · Tab para indentar · {{ tabFocusShortcut }}
      para salir con Tab
    </p>
  </dialog>
</template>

<style scoped>
.wf-code-editor {
  position: relative;
  inset: auto;
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  max-width: none;
  max-height: none;
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--background);
  color: var(--foreground);
  font-family: inherit;
  font-size: 11px;
}
.wf-code-editor.is-expanded {
  position: fixed;
  inset: 0;
  width: min(1100px, calc(100vw - 32px));
  height: min(800px, calc(100dvh - 32px));
  margin: auto;
}
.wf-code-editor::backdrop {
  background: #18181b80;
}
.wf-code-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px 6px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--muted);
}
.wf-code-filename,
.wf-code-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wf-code-filename {
  font-family: "SFMono-Regular", Consolas, monospace;
}
.wf-code-filename svg {
  color: #3178c6;
}
.wf-code-actions {
  gap: 2px;
}
.wf-code-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  min-height: 30px;
  padding: 4px 7px;
  border: 0;
  border-radius: 4px;
  color: inherit;
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.wf-code-actions button:hover,
.wf-code-actions button[aria-pressed="true"] {
  background: var(--background);
}
.wf-code-actions button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
}
.wf-code-actions button:disabled {
  opacity: 0.45;
  cursor: default;
}
.wf-code-host {
  height: 340px;
  min-width: 0;
}
.wf-code-host.is-loading {
  height: 0;
}
.is-expanded .wf-code-host {
  flex: 1;
  min-height: 0;
}
.wf-code-fallback {
  min-height: 340px;
  width: 100%;
  margin: 0;
  padding: 12px;
  border: 0;
  font-family: monospace;
  font-size: 13px;
  line-height: 21px;
  resize: vertical;
}
.wf-code-status {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 6px 12px;
  padding: 6px 12px;
  border-top: 1px solid var(--border);
  color: var(--muted-foreground);
}
.wf-code-help {
  margin: 0;
  padding: 6px 12px;
  border-top: 1px solid var(--border);
  color: var(--muted-foreground);
  font-size: 10px;
  line-height: 16px;
}
</style>
