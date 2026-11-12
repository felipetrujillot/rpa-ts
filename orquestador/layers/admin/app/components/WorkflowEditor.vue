<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import {
  ArrowLeft,
  ChevronRight,
  Workflow,
  Save,
  Upload,
  Download,
  Check,
  Loader2,
  AlertCircle,
  Code2,
  Settings2,
  History,
  Network,
  Rocket,
  RotateCcw,
  LayoutTemplate,
  FileText,
  Images,
} from "lucide-vue-next";
import {
  createWorkflow,
  flowDocumentSchema,
  validateFlowDocument,
  importN8nWorkflow,
  exportN8nWorkflow,
  type FlowDocument,
} from "@rpa/contracts";
import { defaultActionIds } from "../utils/workflow-editor";
import WorkflowPresetPicker from "./workflow/WorkflowPresetPicker.vue";
import WorkflowAgentsGuide from "./workflow/WorkflowAgentsGuide.vue";
import WorkflowAssets from "./workflow/WorkflowAssets.vue";
import {
  createWorkflowPreset,
  type WorkflowPresetId,
  type PresetPlatform,
} from "../utils/workflow-presets";
import type FlowBuilderCanvas from "./FlowBuilderCanvas.vue";
import type { ReferenceExample } from "../utils/workflow-references";
import "../assets/workflow-editor.css";
const props = defineProps<{ uuid?: string }>();
const { $trpc } = useNuxtApp();
const canvas = ref<InstanceType<typeof FlowBuilderCanvas>>();
const fileInput = ref<HTMLInputElement>();
const name = ref(props.uuid ? "" : "Nuevo flujo");
const documentText = ref(
  JSON.stringify(createWorkflow("Nuevo flujo", crypto.randomUUID()), null, 2),
);
const flowId = ref(props.uuid ?? "");
const referenceExample = ref<ReferenceExample>();
const exampleLoading = ref(false);
const exampleError = ref("");
async function loadReferenceExample() {
  if (exampleLoading.value) return;
  if (!flowId.value) {
    exampleError.value = "Todavía no hay ejecuciones. Guarda y ejecuta el flujo para disponer de un ejemplo.";
    return;
  }
  exampleLoading.value = true;
  exampleError.value = "";
  const requestedFlowId = flowId.value;
  try {
    const runs = await $trpc.flows.getFlowRuns.query({ uuid_flujo: requestedFlowId, limit: 20 });
    if (flowId.value !== requestedFlowId) return;
    const run = runs.find(run => ["success", "failed", "cancelled"].includes(run.status) && run.output_json && typeof run.output_json === "object" && "outputs" in run.output_json);
    const outputs = (run?.output_json as { outputs?: { vars?: unknown; nodeOutputs?: unknown } } | undefined)?.outputs;
    if (!run || !outputs) {
      referenceExample.value = undefined;
      exampleError.value = "Todavía no hay datos de ejemplo: las últimas ejecuciones no tienen resultados guardados.";
      return;
    }
    referenceExample.value = {
      runId: run.uuid_flow_run,
      date: String(run.finished_at ?? run.created_at),
      versionId: run.uuid_flow_version,
      context: { input: run.input_json, vars: outputs.vars ?? {}, nodeOutputs: outputs.nodeOutputs ?? {} },
    };
  } catch {
    if (flowId.value === requestedFlowId) exampleError.value = "No se pudo cargar el ejemplo. Puedes volver a intentarlo.";
  } finally { exampleLoading.value = false; }
}
watch(flowId, () => { referenceExample.value = undefined; exampleError.value = ""; });
const currentVersionId = ref("");
const currentVersion = ref(0);
const publishedVersionId = ref("");
const currentState = ref("draft");
const tab = ref("visual");
const showPresets = ref(false);
const jsonDraft = ref("");
const jsonError = ref("");
const inspectorPending = ref(false);
const knownActionIdsText = ref(defaultActionIds.join("\n"));
const knownActionIds = computed(() => [
  ...new Set(
    knownActionIdsText.value
      .split("\n")
      .map((id) => id.trim())
      .filter(Boolean),
  ),
]);
const loading = ref(!!props.uuid),
  saving = ref(false),
  publishing = ref(false);
const busy = computed(() => loading.value || saving.value || publishing.value);
const error = ref("");
const loadFailed = ref(false);
const notice = ref("");
const savedSignature = ref("");
const signature = computed(() =>
  JSON.stringify([name.value, documentText.value, knownActionIds.value]),
);
const dirty = computed(
  () =>
    signature.value !== savedSignature.value ||
    inspectorPending.value ||
    (tab.value === "json" && jsonDraft.value !== documentText.value) ||
    (tab.value === "settings" && settingsDirty.value),
);
const versionList = ref<
  Array<{
    uuid_flow_version: string;
    version_number: number;
    estado: string;
    definition_json?: unknown;
    created_at: string | Date;
  }>
>([]);
const versionsLoading = ref(false);
const maxExecutions = ref(1000),
  variablesText = ref("{}");
const settingsBaseline = ref("");
const settingsDirty = computed(
  () =>
    JSON.stringify([maxExecutions.value, variablesText.value]) !==
    settingsBaseline.value,
);
const isPublished = computed(
  () =>
    !!currentVersionId.value &&
    publishedVersionId.value === currentVersionId.value &&
    !dirty.value,
);
function includeDocumentActions(document: FlowDocument) {
  const ids = document.workflow.nodes
    .filter((n) => n.type === "rpa.action")
    .map((n) => n.parameters.actionId);
  knownActionIdsText.value = [
    ...new Set([...knownActionIds.value, ...ids]),
  ].join("\n");
}
function usePreset(id: WorkflowPresetId, platform: PresetPlatform) {
  if (busy.value) return;
  if (
    dirty.value &&
    !window.confirm(
      "Usar este preset reemplazará los cambios del flujo abierto. ¿Quieres continuar?",
    )
  )
    return;
  const document = createWorkflowPreset(id, platform);
  documentText.value = JSON.stringify(document, null, 2);
  name.value = document.workflow.name;
  includeDocumentActions(document);
  inspectorPending.value = false;
  tab.value = "visual";
  showPresets.value = false;
  error.value = "";
  notice.value = "Preset cargado. Puedes editar los pasos y guardar el flujo.";
}
async function loadFlow() {
  if (!props.uuid) {
    savedSignature.value = signature.value;
    return;
  }
  loading.value = true;
  error.value = "";
  loadFailed.value = false;
  try {
    const flow = await $trpc.flows.getFlow.query({ uuid_flujo: props.uuid });
    const parsed = flowDocumentSchema.parse(flow.latestVersion.definition_json);
    name.value = flow.nombre;
    documentText.value = JSON.stringify(
      { ...parsed, workflow: { ...parsed.workflow, name: flow.nombre } },
      null,
      2,
    );
    includeDocumentActions(parsed);
    flowId.value = flow.uuid_flujo;
    currentVersionId.value = flow.latestVersion.uuid_flow_version;
    currentVersion.value = flow.latestVersion.version_number;
    currentState.value = flow.latestVersion.estado;
    publishedVersionId.value = flow.publishedVersionId ?? "";
    await nextTick();
    savedSignature.value = signature.value;
  } catch (e) {
    error.value = message(e);
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
}
function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
watch(documentText, (text) => {
  try {
    const document = flowDocumentSchema.parse(JSON.parse(text));
    if (document.workflow.name !== name.value.trim())
      name.value = document.workflow.name;
  } catch {
    /* Errors are reported when applying the document. */
  }
});
function applyJson() {
  try {
    const doc = flowDocumentSchema.parse(JSON.parse(jsonDraft.value));
    documentText.value = JSON.stringify(doc, null, 2);
    name.value = doc.workflow.name;
    includeDocumentActions(doc);
    jsonDraft.value = documentText.value;
    jsonError.value = "";
    return true;
  } catch (e) {
    jsonError.value = message(e);
    return false;
  }
}
function applySettings() {
  try {
    const doc = JSON.parse(documentText.value) as FlowDocument;
    doc.workflow.settings.maxNodeExecutions = maxExecutions.value;
    doc.workflow.variables = JSON.parse(variablesText.value);
    const parsed = flowDocumentSchema.parse(doc);
    documentText.value = JSON.stringify(parsed, null, 2);
    settingsBaseline.value = JSON.stringify([
      maxExecutions.value,
      variablesText.value,
    ]);
    error.value = "";
    return true;
  } catch (e) {
    error.value = message(e);
    return false;
  }
}
function prepare() {
  if (tab.value === "visual" && !(canvas.value?.flush() ?? true)) return false;
  if (tab.value === "json" && !applyJson()) return false;
  if (tab.value === "settings" && !applySettings()) return false;
  return true;
}
async function switchTab(value: string) {
  if (value === tab.value || !prepare()) return;
  tab.value = value;
  if (value === "json") jsonDraft.value = documentText.value;
  if (value === "settings") {
    const doc = JSON.parse(documentText.value) as FlowDocument;
    maxExecutions.value = doc.workflow.settings.maxNodeExecutions;
    variablesText.value = JSON.stringify(doc.workflow.variables, null, 2);
    settingsBaseline.value = JSON.stringify([
      maxExecutions.value,
      variablesText.value,
    ]);
  }
  if (value === "versions") await loadVersions();
}
async function loadVersions() {
  if (!flowId.value) return;
  versionsLoading.value = true;
  try {
    versionList.value = await $trpc.flows.getFlowVersions.query({
      uuid_flujo: flowId.value,
    });
  } catch (e) {
    error.value = message(e);
  } finally {
    versionsLoading.value = false;
  }
}
async function persist() {
  if (!name.value.trim()) throw new Error("Escribe un nombre para el flujo.");
  const parsed = JSON.parse(documentText.value) as FlowDocument;
  parsed.workflow.name = name.value.trim();
  const validation = validateFlowDocument(parsed, {
    knownActionIds: new Set(knownActionIds.value),
  });
  if (!validation.ok || !validation.normalized)
    throw new Error(validation.errors.map((e) => e.message).join(" · "));
  if (!dirty.value && currentVersionId.value) return;
  const snapshot = signature.value;
  const result = await $trpc.flows.createDraft.mutate({
    uuid_flujo: flowId.value || undefined,
    nombre: name.value.trim(),
    document: validation.normalized,
    knownActionIds: knownActionIds.value,
  });
  flowId.value = result.data.uuid_flujo;
  currentVersionId.value = result.data.uuid_flow_version;
  currentVersion.value = result.data.version_number;
  currentState.value = "draft";
  savedSignature.value = snapshot;
}
async function save() {
  if (busy.value || !prepare()) return;
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    await persist();
    notice.value = `Versión ${currentVersion.value} guardada`;
    if (!props.uuid) await navigateTo(`/admin/flujos/${flowId.value}`);
  } catch (e) {
    error.value = message(e);
  } finally {
    saving.value = false;
  }
}
async function publish() {
  if (busy.value || !prepare()) return;
  publishing.value = true;
  error.value = "";
  notice.value = "";
  try {
    await persist();
    await $trpc.flows.publishVersion.mutate({
      uuid_flujo: flowId.value,
      uuid_flow_version: currentVersionId.value,
    });
    currentState.value = "published";
    publishedVersionId.value = currentVersionId.value;
    notice.value = `Versión ${currentVersion.value} publicada. Ya está disponible para asignar a un agente.`;
    if (!props.uuid) await navigateTo(`/admin/flujos/${flowId.value}`);
    else if (tab.value === "versions") await loadVersions();
  } catch (e) {
    error.value = message(e);
  } finally {
    publishing.value = false;
  }
}
async function importFile(event: Event) {
  const element = event.target as HTMLInputElement;
  const file = element.files?.[0];
  if (!file) return;
  try {
    if (
      dirty.value &&
      !window.confirm(
        "Importar reemplazará el flujo abierto. ¿Quieres continuar?",
      )
    )
      return;
    const source = JSON.parse(await file.text());
    const result =
      source.kind === "rpa.workflow"
        ? validateFlowDocument(source)
        : importN8nWorkflow(source);
    if (!result.ok || !result.normalized)
      throw new Error(result.errors.map((e) => e.message).join(" · "));
    documentText.value = JSON.stringify(result.normalized, null, 2);
    name.value = result.normalized.workflow.name;
    includeDocumentActions(result.normalized);
    inspectorPending.value = false;
    tab.value = "visual";
    error.value = "";
    notice.value = "Flujo importado. Guarda para crear una versión.";
  } catch (e) {
    error.value = message(e);
  } finally {
    element.value = "";
  }
}
function download(format: "rpa" | "n8n") {
  if (!prepare()) return;
  try {
    const validation = validateFlowDocument(JSON.parse(documentText.value));
    if (!validation.ok || !validation.normalized)
      throw new Error(validation.errors.map((e) => e.message).join(" · "));
    const value =
      format === "n8n"
        ? exportN8nWorkflow(validation.normalized)
        : validation.normalized;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    );
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `${name.value.replace(/[^\p{L}\p{N}_-]/gu, "_") || "flujo"}.${format}.json`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    error.value = message(e);
  }
}
function restore(version: (typeof versionList.value)[number]) {
  if (
    dirty.value &&
    !window.confirm("Hay cambios sin guardar. ¿Quieres cargar esta versión?")
  )
    return;
  try {
    const parsed = flowDocumentSchema.parse(version.definition_json);
    name.value = parsed.workflow.name;
    documentText.value = JSON.stringify(parsed, null, 2);
    includeDocumentActions(parsed);
    tab.value = "visual";
    notice.value = `Versión ${version.version_number} cargada. Guarda los cambios como una nueva versión.`;
  } catch (e) {
    error.value = message(e);
  }
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value && !loadFailed.value) {
    event.preventDefault();
    event.returnValue = "";
  }
}
function keyboard(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    save();
  }
}
onBeforeRouteLeave(
  () =>
    !dirty.value ||
    loading.value ||
    loadFailed.value ||
    window.confirm("Tienes cambios sin guardar. ¿Quieres salir del editor?"),
);
onMounted(() => {
  loadFlow();
  window.addEventListener("beforeunload", beforeUnload);
});
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));
</script>
<template>
  <div class="wf-editor" @keydown="keyboard">
    <header class="wf-header">
      <div class="wf-header-main">
        <NuxtLink
          to="/admin/flujos"
          class="wf-icon-button"
          aria-label="Volver a flujos"
          ><ArrowLeft :size="18"
        /></NuxtLink>
        <div class="wf-flow-identity">
          <div class="wf-breadcrumb">
            <NuxtLink to="/admin/flujos">Flujos</NuxtLink
            ><ChevronRight :size="10" /><span>{{
              uuid ? "Editar automatización" : "Nueva automatización"
            }}</span>
          </div>
          <input
            v-model="name"
            class="wf-flow-name"
            aria-label="Nombre del flujo"
            placeholder="Nombre de tu flujo"
            maxlength="250"
            :disabled="busy || loadFailed || tab === 'json'"
          />
        </div>
        <span v-if="!loading && !loadFailed" class="wf-save-state"
          ><Loader2 v-if="busy" :size="13" class="wf-spin" /><span
            v-else-if="dirty"
            class="wf-status-dot"
          /><Check v-else :size="13" />{{
            busy ? "Guardando…" : dirty ? "Cambios sin guardar" : "Guardado"
          }}</span
        >
      </div>
      <div class="wf-header-actions">
        <button
          type="button"
          class="wf-button"
          :disabled="busy || loadFailed"
          @click="fileInput?.click()"
        >
          <Upload :size="14" /> Importar</button
        ><DropdownMenu
          ><DropdownMenuTrigger as-child
            ><button
              type="button"
              class="wf-button"
              :disabled="busy || loadFailed"
            >
              <Download :size="14" /> Exportar
            </button></DropdownMenuTrigger
          ><DropdownMenuContent align="end"
            ><DropdownMenuItem @select="download('rpa')"
              >Documento RPA (.json)</DropdownMenuItem
            ><DropdownMenuItem @select="download('n8n')"
              >Formato n8n (.json)</DropdownMenuItem
            ></DropdownMenuContent
          ></DropdownMenu
        ><button
          type="button"
          class="wf-button"
          :disabled="busy || loadFailed || isPublished"
          @click="publish"
        >
          <Loader2 v-if="publishing" :size="14" class="wf-spin" /><Rocket
            v-else
            :size="14"
          />{{ isPublished ? "Publicado" : "Publicar" }}</button
        ><button
          type="button"
          class="wf-button wf-button-primary"
          :disabled="busy || loadFailed || (!dirty && !!currentVersionId)"
          @click="save"
        >
          <Loader2 v-if="saving" :size="14" class="wf-spin" /><Save
            v-else
            :size="14"
          />
          Guardar
        </button>
      </div>
    </header>
    <input
      ref="fileInput"
      type="file"
      accept=".json,application/json"
      hidden
      aria-label="Importar documento de flujo"
      @change="importFile"
    />
    <div v-if="error" role="alert" class="wf-top-error">
      <AlertCircle :size="16" />
      <p>{{ error }}</p>
      <button
        v-if="loadFailed"
        type="button"
        class="wf-text-button"
        @click="loadFlow"
      >
        Reintentar
      </button>
    </div>
    <div
      v-if="notice && !error"
      role="status"
      class="wf-top-error"
      style="
        color: var(--primary);
        background: color-mix(in srgb, var(--primary) 6%, var(--card));
      "
    >
      <Check :size="16" />
      <p>{{ notice }}</p>
    </div>
    <div v-if="loading" class="wf-loading">
      <Loader2 :size="22" class="wf-spin" /> Cargando flujo…
    </div>
    <template v-else-if="!loadFailed"
      ><nav class="wf-subheader" aria-label="Vistas del editor">
        <div class="wf-view-tabs">
          <button
            v-for="item in [
              { id: 'visual', title: 'Editor', icon: Network },
              { id: 'json', title: 'JSON', icon: Code2 },
              { id: 'assets', title: 'Imágenes', icon: Images },
              { id: 'agents', title: 'AGENTS.md', icon: FileText },
              { id: 'settings', title: 'Ajustes', icon: Settings2 },
              { id: 'versions', title: 'Versiones', icon: History },
            ]"
            :key="item.id"
            type="button"
            :class="{ active: tab === item.id }"
            :aria-current="tab === item.id ? 'page' : undefined"
            :disabled="busy"
            @click="switchTab(item.id)"
          >
            <component :is="item.icon" :size="14" />{{ item.title }}
          </button>
        </div>
        <div style="display: flex; align-items: center; gap: 10px">
          <button
            v-if="!uuid && tab === 'visual'"
            type="button"
            class="wf-text-button"
            :aria-expanded="showPresets"
            :disabled="busy"
            @click="showPresets = !showPresets"
          >
            <LayoutTemplate :size="14" /> Presets
          </button>
          <span class="wf-version-pill">{{
            currentVersion
              ? `v${currentVersion} · ${currentState === "published" ? "Publicada" : "Borrador"}`
              : "Nuevo borrador"
          }}</span>
        </div>
      </nav>
      <div :inert="busy">
        <WorkflowPresetPicker
          v-if="showPresets && !uuid && tab === 'visual'"
          @select="usePreset"
          @close="showPresets = false"
        />
        <ClientOnly
          ><FlowBuilderCanvas
            v-show="tab === 'visual'"
            ref="canvas"
            v-model="documentText"
            :flow-name="name"
            :known-action-ids="knownActionIds"
            :reference-example="referenceExample"
            :example-loading="exampleLoading"
            :example-error="exampleError"
            @request-example="loadReferenceExample"
            @pending="inspectorPending = $event"
          /><template #fallback
            ><div class="wf-loading">Preparando editor visual…</div></template
          ></ClientOnly
        >
        <div v-if="tab === 'json'" class="wf-json-view">
          <div class="wf-json-toolbar">
            <span>Documento del flujo · RPA v2</span
            ><button type="button" class="wf-button" @click="applyJson">
              <Check :size="14" /> Aplicar JSON
            </button>
          </div>
          <textarea
            v-model="jsonDraft"
            class="wf-code"
            aria-label="Documento JSON del flujo"
            spellcheck="false"
          />
          <p v-if="jsonError" role="alert" class="wf-error wf-json-error">
            {{ jsonError }}
          </p>
        </div>
        <WorkflowAgentsGuide
          v-if="tab === 'agents'"
          :known-action-ids="knownActionIds"
        />
        <WorkflowAssets v-if="tab === 'assets'" />
        <div v-if="tab === 'settings'" class="wf-settings-panel">
          <h3>Ajustes del flujo</h3>
          <p>
            Configura los datos iniciales y los límites de esta automatización.
          </p>
          <label
            >Máximo de ejecuciones de nodos<input
              v-model.number="maxExecutions"
              type="number"
              min="1"
              max="100000" /></label
          ><small>Protege la ejecución frente a bucles sin fin.</small
          ><label
            >Variables iniciales (JSON)<textarea
              v-model="variablesText"
              rows="5"
              class="wf-code"
              spellcheck="false"
            /></label
          ><small
            >Estarán disponibles a través de referencias como
            vars.nombre.</small
          ><label
            >Acciones permitidas<textarea
              v-model="knownActionIdsText"
              rows="8"
              class="wf-code"
              spellcheck="false"
            /></label
          ><small
            >Una acción por línea. Deben estar disponibles en el agente que
            ejecutará el flujo.</small
          >
          <div style="margin-top: 20px">
            <button type="button" class="wf-button" @click="applySettings">
              <Check :size="14" /> Aplicar ajustes
            </button>
          </div>
        </div>
        <div v-if="tab === 'versions'" class="wf-version-list">
          <div class="wf-json-toolbar">
            <span
              >Cada guardado crea una versión. Publica la que quieras ejecutar
              en los agentes.</span
            ><button
              v-if="flowId"
              type="button"
              class="wf-text-button"
              :disabled="versionsLoading"
              @click="loadVersions"
            >
              <RotateCcw :size="13" /> Actualizar
            </button>
          </div>
          <div v-if="versionsLoading" class="wf-loading">
            <Loader2 :size="18" class="wf-spin" /> Cargando versiones…
          </div>
          <p v-else-if="!versionList.length" class="wf-muted">
            Guarda el flujo para crear su primera versión.
          </p>
          <div
            v-for="version in versionList"
            :key="version.uuid_flow_version"
            class="wf-version-row"
          >
            <div>
              <strong
                >Versión {{ version.version_number }}
                <span class="wf-version-pill">{{
                  version.estado === "published"
                    ? "Publicada"
                    : version.estado === "archived"
                      ? "Archivada"
                      : "Borrador"
                }}</span></strong
              ><small>{{
                new Date(version.created_at).toLocaleString("es-CL")
              }}</small>
            </div>
            <button type="button" class="wf-button" @click="restore(version)">
              <History :size="13" /> Cargar en editor
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
