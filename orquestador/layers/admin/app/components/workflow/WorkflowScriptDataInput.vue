<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { AlertTriangle, Braces, Link2 } from "lucide-vue-next";
import type { FlowValue, WorkflowNode } from "@rpa/contracts";
import {
  dataReferences,
  describeReference,
  isReferencePath,
  referencePath,
  referenceExampleValue,
  type ReferenceExample,
} from "../../utils/workflow-references";

const props = defineProps<{
  modelValue: FlowValue;
  nodeId: string;
  nodes: WorkflowNode[];
  availableNodeIds: string[];
  variables: string[];
  example?: ReferenceExample;
  exampleLoading?: boolean;
  exampleError?: string;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: FlowValue];
  invalid: [value: boolean];
  "request-example": [];
}>();
const variablesId = useId();
const manual = ref("{}");
const lastReference = ref("input");
const jsonError = ref("");
const path = computed(() => referencePath(props.modelValue));
const isReference = ref(path.value !== undefined);
watch(
  () => props.modelValue,
  (value) => {
    const reference = referencePath(value);
    isReference.value = reference !== undefined;
    if (reference !== undefined) lastReference.value = reference;
    else
      manual.value =
        typeof value === "string" ? value : JSON.stringify(value, null, 2);
    jsonError.value = "";
  },
  { immediate: true, deep: true },
);

const sources = computed(() =>
  dataReferences(props.modelValue).map((path) =>
    describeReference(path, props.nodes, props.nodeId, props.availableNodeIds),
  ),
);
const warning = computed(
  () => sources.value.find((source) => source.warning)?.warning,
);
const sourceLabel = computed(() =>
  jsonError.value
    ? "JSON incompleto"
    : isReference.value
      ? sources.value[0]?.label
      : sources.value.length
        ? "JSON con referencias del flujo"
        : "JSON manual",
);
const source = computed(() => {
  const [root, id] = (path.value ?? "").split(".");
  if (root === "nodeOutputs" && id) return `node:${id}`;
  return ["input", "vars", "last", "json"].includes(root!) ? root! : "advanced";
});
const sourceNode = computed(() =>
  source.value.startsWith("node:")
    ? props.nodes.find((node) => node.id === source.value.slice(5))
    : undefined,
);
const scriptSource = computed(
  () =>
    sourceNode.value?.type === "rpa.action" &&
    sourceNode.value.parameters.actionId === "script.typescript.run",
);
const base = computed(() =>
  source.value.startsWith("node:")
    ? `nodeOutputs.${source.value.slice(5)}`
    : source.value,
);
const outputKind = computed(() =>
  scriptSource.value &&
  (path.value === `${base.value}.result` ||
    path.value?.startsWith(`${base.value}.result.`))
    ? "result"
    : "all",
);
const field = computed(() => {
  const prefix = `${base.value}${outputKind.value === "result" ? ".result" : ""}`;
  return path.value?.slice(prefix.length).replace(/^\./, "") ?? "";
});
const sourceOptions = computed(() =>
  props.nodes.filter(
    (node) => node.id !== props.nodeId && node.type !== "rpa.end",
  ),
);
const canUseNode = (node: WorkflowNode) =>
  props.availableNodeIds.includes(node.id) &&
  !node.disabled &&
  isReferencePath(node.id) &&
  !node.id.includes(".");
const invalidReference = computed(
  () =>
    isReference.value &&
    (!isReferencePath(path.value ?? "") ||
      !["input", "vars", "last", "json", "nodeOutputs"].includes(
        (path.value ?? "").split(".")[0]!,
      )),
);
watch(
  [invalidReference, jsonError],
  () => emit("invalid", invalidReference.value || !!jsonError.value),
  { immediate: true },
);

function chooseMode(reference: boolean) {
  if (reference === isReference.value) return;
  isReference.value = reference;
  jsonError.value = "";
  if (reference) emit("update:modelValue", { $ref: lastReference.value });
  else updateJson(manual.value);
}
function updateJson(value: string) {
  manual.value = value;
  try {
    const parsed = JSON.parse(value) as FlowValue;
    // The action parses text as JSON; keep JSON string literals encoded.
    emit("update:modelValue", typeof parsed === "string" ? value : parsed);
    jsonError.value = "";
  } catch {
    jsonError.value = "Escribe JSON válido antes de aplicar los cambios.";
  }
}
function setPath(value: string) {
  emit("update:modelValue", { $ref: value });
}
function chooseSource(value: string) {
  if (value === "advanced") {
    advanced.value = true;
    return;
  }
  advanced.value = false;
  if (value.startsWith("node:")) {
    const node = props.nodes.find((node) => node.id === value.slice(5));
    const suffix =
      node?.type === "rpa.action" &&
      node.parameters.actionId === "script.typescript.run"
        ? ".result"
        : "";
    setPath(`nodeOutputs.${value.slice(5)}${suffix}`);
  } else setPath(value);
}
const advanced = ref(false);
function setField(value: string) {
  setPath(
    `${base.value}${outputKind.value === "result" ? ".result" : ""}${value ? `.${value}` : ""}`,
  );
}
const preview = computed(() =>
  props.example
    ? referenceExampleValue(props.modelValue, props.example, props.nodes)
    : undefined,
);
const previewText = computed(() => {
  const text = JSON.stringify(preview.value?.value, null, 2) ?? "";
  return text.length > 8000 ? `${text.slice(0, 8000)}\n… Vista truncada` : text;
});
</script>

<template>
  <section class="wf-script-data" aria-label="Datos que recibe el script">
    <h4>Datos que recibe el script (<code>input</code>)</h4>
    <div class="wf-data-modes" role="group" aria-label="Origen de los datos">
      <button
        type="button"
        :aria-pressed="!isReference"
        @click="chooseMode(false)"
      >
        <Braces :size="14" /> Escribir JSON
      </button>
      <button
        type="button"
        :aria-pressed="isReference"
        @click="chooseMode(true)"
      >
        <Link2 :size="14" /> Usar datos del flujo
      </button>
    </div>
    <template v-if="isReference">
      <label
        >Origen
        <select
          :value="advanced ? 'advanced' : source"
          aria-label="Origen de input"
          @change="chooseSource(($event.target as HTMLSelectElement).value)"
        >
          <option value="input">Entrada inicial del flujo</option>
          <option value="vars">Variables del flujo</option>
          <optgroup label="Resultado de un paso">
            <option
              v-if="source.startsWith('node:') && !sourceNode"
              :value="source"
              disabled
            >
              Referencia sin origen
            </option>
            <option
              v-for="node in sourceOptions"
              :key="node.id"
              :value="`node:${node.id}`"
              :disabled="!canUseNode(node)"
            >
              {{ node.name
              }}{{
                canUseNode(node) ? "" : " (no disponible antes de este paso)"
              }}
            </option>
          </optgroup>
          <optgroup label="Dependen del recorrido">
            <option value="last">Último paso ejecutado (dinámico)</option>
            <option value="json">Datos del recorrido actual</option>
          </optgroup>
          <option value="advanced">Referencia avanzada</option>
        </select>
      </label>
      <template v-if="!advanced && source !== 'advanced'">
        <label v-if="scriptSource"
          >Datos del paso
          <select
            :value="outputKind"
            aria-label="Datos del paso"
            @change="
              setPath(
                base +
                  (($event.target as HTMLSelectElement).value === 'result'
                    ? '.result'
                    : ''),
              )
            "
          >
            <option value="result">Resultado del script (return)</option>
            <option value="all">Salida completa (resultado y logs)</option>
          </select>
        </label>
        <label
          >Campo dentro de los datos (opcional)
          <input
            :value="field"
            :list="source === 'vars' ? variablesId : undefined"
            placeholder="Por ejemplo: cliente.nombre"
            @input="setField(($event.target as HTMLInputElement).value)"
          />
        </label>
        <datalist :id="variablesId">
          <option
            v-for="variable in variables"
            :key="variable"
            :value="variable"
          />
        </datalist>
        <p class="wf-hint">
          Déjalo vacío para recibir todos los datos seleccionados. Para un
          elemento de una lista, usa su índice: <code>pedidos.0</code>.
        </p>
      </template>
      <label v-else
        >Ruta de referencia
        <input
          :value="path"
          placeholder="nodeOutputs.ID.result"
          @input="setPath(($event.target as HTMLInputElement).value)"
        />
      </label>
      <p v-if="source === 'input'" class="wf-hint">
        Son los datos con los que se inicia el flujo. Lo que elijas aquí se
        convierte en <code>input</code> dentro del script.
      </p>
      <p v-if="source === 'last' || source === 'json'" class="wf-hint">
        El valor cambia según el recorrido. Elige un paso por nombre para
        mantener un origen fijo.
      </p>
      <details class="wf-reference-details">
        <summary>Ver referencia técnica</summary>
        <code>{{ path }}</code>
      </details>
    </template>
    <template v-else>
      <label
        >Datos JSON<textarea
          :value="manual"
          rows="5"
          spellcheck="false"
          @input="updateJson(($event.target as HTMLTextAreaElement).value)"
        />
      </label>
      <p class="wf-hint">
        Este valor se pasa al script como <code>input</code>.
      </p>
    </template>
    <p v-if="jsonError || warning" class="wf-data-warning" role="alert">
      <AlertTriangle :size="15" />{{ jsonError || warning }}
    </p>
    <details
      v-if="dataReferences(modelValue).length"
      class="wf-reference-example"
    >
      <summary>Ver ejemplo de ejecución</summary>
      <p class="wf-hint">
        Consulta datos guardados de una ejecución anterior; no ejecuta el
        script.
      </p>
      <button
        type="button"
        class="wf-text-button"
        :disabled="exampleLoading"
        @click="emit('request-example')"
      >
        {{
          exampleLoading
            ? "Cargando…"
            : example
              ? "Actualizar ejemplo"
              : "Cargar último ejemplo"
        }}
      </button>
      <p v-if="exampleError" class="wf-data-warning" role="status">
        {{ exampleError }}
      </p>
      <template v-if="example">
        <p class="wf-hint">
          Ejecución {{ example.runId }} ·
          {{ new Date(example.date).toLocaleString() }}. Son los valores finales
          guardados; pueden corresponder a otra versión del flujo y variar al
          ejecutar.
        </p>
        <p v-if="preview?.unavailable" class="wf-hint">
          {{ preview.unavailable }}
        </p>
        <pre v-else>{{ previewText }}</pre>
      </template>
      <p v-else-if="!exampleError && !exampleLoading" class="wf-hint">
        Todavía no hay datos de ejemplo cargados.
      </p>
    </details>
    <div class="wf-script-input-context" :class="{ 'has-warning': warning }">
      <Link2 :size="15" />
      <p>
        <strong>{{ sourceLabel }}</strong
        ><span
          >Dentro del código, estos datos están disponibles como
          <code>input</code>.</span
        >
      </p>
    </div>
  </section>
</template>

<style scoped>
.wf-script-data {
  display: grid;
  gap: 12px;
  margin: 16px 0;
}
.wf-script-data h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}
.wf-data-modes {
  display: flex;
  gap: 4px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--muted);
}
.wf-data-modes button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  flex: 1;
  min-height: 35px;
  padding: 6px;
  border: 1px solid transparent;
  border-radius: 4px;
  font: inherit;
  font-size: 11px;
  color: var(--muted-foreground);
  background: transparent;
}
.wf-data-modes button[aria-pressed="true"] {
  border-color: var(--border);
  background: var(--background);
  color: var(--foreground);
}
.wf-script-data .wf-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.wf-script-data textarea,
.wf-reference-details code,
.wf-reference-example pre {
  font-family: "SFMono-Regular", Consolas, monospace;
}
.wf-reference-details,
.wf-reference-example {
  font-size: 11px;
}
summary {
  cursor: pointer;
  color: var(--muted-foreground);
}
.wf-reference-details code {
  display: block;
  padding: 8px 0;
  overflow-wrap: anywhere;
}
.wf-reference-example[open] {
  display: grid;
  gap: 8px;
}
.wf-reference-example pre {
  max-height: 220px;
  margin: 0;
  padding: 10px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--muted);
  font-size: 11px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.wf-data-warning {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  color: var(--destructive);
  font-size: 11px;
  line-height: 1.6;
}
.wf-data-warning svg,
.wf-script-input-context > svg {
  flex-shrink: 0;
  margin-top: 2px;
}
.wf-script-input-context {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 0 10px 10px;
  border-left: 2px solid var(--primary);
  font-size: 11px;
}
.wf-script-input-context.has-warning {
  border-color: var(--destructive);
}
.wf-script-input-context p {
  display: grid;
  gap: 4px;
  margin: 0;
  overflow-wrap: anywhere;
}
.wf-script-input-context span {
  color: var(--muted-foreground);
  line-height: 1.6;
}
</style>
