<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  Check,
  Copy,
  Settings2,
  Trash2,
  X,
  SlidersHorizontal,
  Code2,
} from "lucide-vue-next";
import {
  workflowNodeSchema,
  validateWordTemplate,
  type WordActionId,
  validateExcelTemplate,
  type ExcelActionId,
  nodeTypes,
  type WorkflowNode,
} from "@rpa/contracts";
import {
  actionLabel,
  actionDefinition,
  actionInputDefaults,
  nodeDescription,
} from "../../utils/workflow-editor";
import WorkflowObjectEditor from "./WorkflowObjectEditor.vue";
import WorkflowConditionEditor from "./WorkflowConditionEditor.vue";
import WorkflowValueInput from "./WorkflowValueInput.vue";
import WorkflowScriptDataInput from "./WorkflowScriptDataInput.vue";
import WorkflowScriptPermissions from "./WorkflowScriptPermissions.vue";
import type { ReferenceExample } from "../../utils/workflow-references";
const props = defineProps<{
  node: WorkflowNode;
  names: string[];
  knownActionIds: string[];
  nodes: WorkflowNode[];
  availableNodeIds: string[];
  variables: string[];
  referenceExample?: ReferenceExample;
  exampleLoading?: boolean;
  exampleError?: string;
}>();
const emit = defineEmits<{
  apply: [node: WorkflowNode];
  close: [];
  duplicate: [];
  remove: [];
  pending: [value: boolean];
  "draft-update": [node: WorkflowNode];
  "request-example": [];
}>();
const draft = ref<WorkflowNode>(JSON.parse(JSON.stringify(props.node)));
const tab = ref("parameters");
const error = ref("");
const raw = ref(false);
const rawText = ref("");
const invalidFields = reactive(new Set<string>());
const pending = computed(
  () =>
    JSON.stringify(draft.value) !== JSON.stringify(props.node) ||
    (raw.value &&
      rawText.value !== JSON.stringify(props.node.parameters, null, 2)) ||
    invalidFields.size > 0,
);
watch(
  () => props.node,
  (node) => {
    draft.value = JSON.parse(JSON.stringify(node));
    error.value = "";
    raw.value = false;
    invalidFields.clear();
  },
  { immediate: true },
);
watch(pending, (value) => emit("pending", value));
watch(() => JSON.stringify(draft.value), (value) => emit("draft-update", JSON.parse(value) as WorkflowNode), { immediate: true });
const descriptor = computed(() =>
  nodeTypes.find((n) => n.type === props.node.type)!,
);
function invalid(key: string, value: boolean) {
  value ? invalidFields.add(key) : invalidFields.delete(key);
  emit("pending", pending.value);
}
function apply() {
  if (invalidFields.size) {
    error.value = "Corrige los valores inválidos antes de aplicar.";
    return false;
  }
  try {
    const candidate = {
      ...draft.value,
      name: draft.value.name.trim(),
      ...(raw.value ? { parameters: JSON.parse(rawText.value) } : {}),
    };
    if (
      candidate.name !== props.node.name &&
      props.names.includes(candidate.name)
    )
      throw new Error("Ya existe un nodo con este nombre.");
    const result = workflowNodeSchema.safeParse(candidate);
    if (!result.success)
      throw new Error(
        result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(" · "),
      );
    if (result.data.type === "rpa.action" && result.data.parameters.actionId.startsWith("excel."))
      validateExcelTemplate(result.data.parameters.actionId as ExcelActionId, result.data.parameters.input);
    if (result.data.type === "rpa.action" && result.data.parameters.actionId.startsWith("word."))
      validateWordTemplate(result.data.parameters.actionId as WordActionId, result.data.parameters.input);
    emit("apply", result.data);
    error.value = "";
    emit("pending", false);
    return true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    return false;
  }
}
function resetActionInput() {
  if (draft.value.type !== "rpa.action") return;
  draft.value.parameters.input = actionInputDefaults(
    draft.value.parameters.actionId,
  );
  invalidFields.delete("input");
  invalidFields.delete("script-data");
  invalidFields.delete("script-permissions");
}
function suggestFields() {
  if (draft.value.type === "rpa.action") {
    draft.value.parameters.input = {
      ...actionInputDefaults(draft.value.parameters.actionId),
      ...draft.value.parameters.input,
    };
  }
}
function toggleRaw() {
  if (!raw.value) {
    if (invalidFields.size) {
      error.value = "Corrige los campos antes de cambiar al editor JSON.";
      return;
    }
    rawText.value = JSON.stringify(draft.value.parameters, null, 2);
    raw.value = true;
  } else if (apply()) raw.value = false;
}
defineExpose({
  apply,
  get pending() {
    return pending.value;
  },
});
</script>
<template>
  <aside class="wf-panel wf-inspector" aria-label="Configuración del nodo">
    <div class="wf-panel-header">
      <div>
        <span class="wf-eyebrow">CONFIGURAR PASO</span>
        <h3>{{ descriptor.displayName }}</h3>
      </div>
      <button
        type="button"
        class="wf-icon-button"
        aria-label="Cerrar configuración"
        @click="emit('close')"
      >
        <X :size="18" />
      </button>
    </div>
    <div class="wf-inspector-scroll">
      <label class="wf-name-label"
        >Nombre del paso<input
          v-model="draft.name"
          maxlength="200"
          placeholder="Nombre único"
      /></label>
      <p class="wf-muted">{{ nodeDescription[node.type] }}</p>
      <div class="wf-tabs" role="tablist" aria-label="Configuración">
        <button
          type="button"
          role="tab"
          :aria-selected="tab === 'parameters'"
          :class="{ active: tab === 'parameters' }"
          @click="tab = 'parameters'"
        >
          <SlidersHorizontal :size="14" /> Parámetros</button
        ><button
          type="button"
          role="tab"
          :aria-selected="tab === 'settings'"
          :class="{ active: tab === 'settings' }"
          @click="tab = 'settings'"
        >
          <Settings2 :size="14" /> Ajustes
        </button>
      </div>
      <div v-if="tab === 'parameters'" class="wf-fields">
        <button
          v-if="
            !['rpa.manualTrigger', 'rpa.end', 'rpa.noOp'].includes(node.type)
          "
          type="button"
          class="wf-text-button wf-raw-toggle"
          @click="toggleRaw"
        >
          <Code2 :size="14" />
          {{ raw ? "Usar formulario" : "Editar parámetros JSON" }}
        </button>
        <label v-if="raw"
          >Parámetros JSON<textarea
            v-model="rawText"
            rows="16"
            spellcheck="false"
            class="wf-code"
          />
        </label>
        <template v-else-if="draft.type === 'rpa.action'">
          <label
            >Acción<select
              v-model="draft.parameters.actionId"
              @change="resetActionInput"
            >
              <option
                v-if="!knownActionIds.includes(draft.parameters.actionId)"
                :value="draft.parameters.actionId"
              >
                {{ draft.parameters.actionId }} (importada)
              </option>
              <option v-for="id in knownActionIds" :key="id" :value="id">
                {{ actionLabel(id) }}
              </option>
            </select></label
          >
          <code class="wf-action-id">{{ draft.parameters.actionId }}</code>
          <div
            v-if="actionDefinition(draft.parameters.actionId)"
            class="wf-hint"
          >
            <p>
              {{ actionDefinition(draft.parameters.actionId)?.description }}
            </p>
            <p
              v-if="
                'scope' in
                (actionDefinition(draft.parameters.actionId)?.defaults ?? {})
              "
            >
              <code>scope: window</code> requiere <code>pid</code> y
              <code>windowId</code>. <code>scope: desktop</code> actúa sobre el
              escritorio o la aplicación activa e ignora esos IDs. Usa
              coordenadas de la captura del destino, no la posición del cursor
              en puntos.
            </p>
            <p
              v-for="field in draft.parameters.actionId === 'script.typescript.run' ? [] : actionDefinition(draft.parameters.actionId)?.inputFields"
              :key="field.key"
            >
              <code>{{ field.key }}</code
              >: {{ field.label
              }}<span v-if="field.options">
                ({{
                  field.options.map((option) => option.value).join(", ")
                }})</span
              >
            </p>
          </div>
          <WorkflowScriptPermissions
            v-if="draft.parameters.actionId === 'script.typescript.run'"
            :model-value="draft.parameters.input.allowedActions"
            :known-action-ids="knownActionIds"
            @update:model-value="draft.parameters.input.allowedActions = $event"
            @invalid="invalid('script-permissions', $event)"
          />
          <WorkflowScriptDataInput
            v-if="draft.parameters.actionId === 'script.typescript.run'"
            :model-value="draft.parameters.input.data ?? {}"
            :node-id="draft.id"
            :nodes="nodes"
            :available-node-ids="availableNodeIds"
            :variables="variables"
            :example="referenceExample"
            :example-loading="exampleLoading"
            :example-error="exampleError"
            @update:model-value="draft.parameters.input.data = $event"
            @invalid="invalid('script-data', $event)"
            @request-example="emit('request-example')"
          />
          <WorkflowObjectEditor
            :key="draft.id"
            v-model="draft.parameters.input"
            :label="draft.parameters.actionId === 'script.typescript.run' ? 'Código y opciones' : 'Datos de entrada'"
            :fields="actionDefinition(draft.parameters.actionId)?.inputFields"
            :recursive="draft.parameters.actionId.startsWith('word.')"
            :hidden-keys="draft.parameters.actionId === 'script.typescript.run' ? ['data', 'allowedActions'] : []"
            :code-keys="
              draft.parameters.actionId === 'script.typescript.run'
                ? ['code']
                : []
            "
            @invalid="invalid('input', $event)"
          />
          <button type="button" class="wf-text-button" @click="suggestFields">
            Agregar campos sugeridos para esta acción
          </button>
          <p
            v-if="draft.parameters.actionId === 'script.typescript.run'"
            class="wf-hint"
          >
            Escribe el código literal en <code>code</code> y pasa los datos
            mediante <code>data</code>. Usa <code>input</code>,
            <code>log(...)</code>, <code>await http.get(url)</code> y
            <code>await rpa.actions.execute(id, datos)</code>. El
            resultado queda en <code>last.result</code> y los logs en
            <code>last.logs</code>. HTTP requiere destinos HTTPS autorizados en
            el robot. El editor señala errores de tipos; el robot transpila el
            código al ejecutarlo.
            Escribe <code>rpa.</code> para explorar el SDK con sus tipos.
          </p>
          <p v-else-if="draft.parameters.actionId.startsWith('word.')" class="wf-hint">
            {{ (actionDefinition(draft.parameters.actionId) as { outputDescription?: string })?.outputDescription }}
            Usa una referencia a <code>nodeOutputs.ID_DEL_NODO.documentId</code> para los pasos posteriores. Los archivos pertenecen al equipo del robot. Activa «Ocultar salida» si el documento contiene datos privados.
          </p>
          <p v-else-if="draft.parameters.actionId.startsWith('excel.')" class="wf-hint">
            {{ (actionDefinition(draft.parameters.actionId) as { outputDescription?: string })?.outputDescription }}
            Guarda el ID del libro en <code>vars.workbookId</code>. Las matrices admiten JSON o referencias como <code>last.values.0.0</code>. Activa «Ocultar salida» si contiene datos privados.
          </p>
          <p v-else-if="draft.parameters.actionId === 'cua.image.click'" class="wf-hint">
            Selecciona la imagen de referencia y el destino. En ventana, usa el PID y el ID devueltos por «Listar ventanas» o «Esperar una ventana o diálogo». El clic se hace en el centro de una coincidencia única. Para acotar la búsqueda, agrega <code>region</code> como JSON: <code>{ "x": 0, "y": 0, "width": 500, "height": 300 }</code>, en píxeles de la captura del destino. El tiempo de búsqueda empieza después de descargar la imagen.
          </p>
          <p v-else class="wf-hint">
            Usa los nombres de entrada de la acción: por ejemplo
            <code>url</code> al abrir una página, o <code>selector</code> y
            <code>text</code> al escribir.
          </p>
        </template>
        <template
          v-else-if="draft.type === 'rpa.if' || draft.type === 'rpa.while'"
        >
          <WorkflowConditionEditor
            v-model="draft.parameters.condition"
            @invalid="invalid('condition', $event)"
          />
          <label v-if="draft.type === 'rpa.while'"
            >Máximo de iteraciones<input
              v-model.number="draft.parameters.maxIterations"
              type="number"
              min="1"
              max="10000"
          /></label>
          <div class="wf-hint">
            {{
              draft.type === "rpa.if"
                ? "La salida superior sigue la rama verdadera y la inferior, la falsa."
                : "Conecta la salida Cuerpo a los pasos que se repiten y el último paso de vuelta a este nodo."
            }}
          </div>
        </template>
        <WorkflowObjectEditor
          v-else-if="draft.type === 'rpa.set'"
          v-model="draft.parameters.values"
          label="Variables que se asignarán"
          @invalid="invalid('values', $event)"
        />
        <template v-else-if="draft.type === 'rpa.forEach'">
          <WorkflowValueInput
            v-model="draft.parameters.items"
            label="Lista de elementos"
            @invalid="invalid('items', $event)"
          />
          <label
            >Variable del elemento<input
              v-model="draft.parameters.itemVar" /></label
          ><label
            >Variable del índice<input v-model="draft.parameters.indexVar"
          /></label>
          <label
            >Máximo de iteraciones<input
              v-model.number="draft.parameters.maxIterations"
              type="number"
              min="1"
              max="10000"
          /></label>
          <p class="wf-hint">
            Conecta el último paso de la rama Elemento de vuelta a este nodo.
            Terminado continúa al acabar la lista.
          </p>
        </template>
        <div v-else class="wf-hint">
          {{
            draft.type === "rpa.manualTrigger"
              ? "Este paso inicia el flujo. Conecta su salida al primer paso de la automatización."
              : draft.type === "rpa.end"
                ? "Este paso termina la rama. No requiere parámetros."
                : "Este paso deja pasar los datos sin modificarlos."
          }}
        </div>
        <p
          v-if="
            !raw &&
            !['rpa.manualTrigger', 'rpa.end', 'rpa.noOp'].includes(node.type)
          "
          class="wf-hint"
        >
          En un campo de tipo Referencia puedes usar <code>input.valor</code>,
          <code>vars.nombre</code> o <code>nodeOutputs.ID_DEL_NODO.result</code>.
        </p>
      </div>
      <div v-else class="wf-fields">
        <label
          >Notas<textarea
            v-model="draft.notes"
            rows="4"
            placeholder="Describe qué hace este paso…"
          />
        </label>
        <label v-if="draft.type !== 'rpa.manualTrigger'" class="wf-check"
          ><input v-model="draft.disabled" type="checkbox" /> Deshabilitar
          paso</label
        >
        <label class="wf-check"
          ><input v-model="draft.sensitiveOutput" type="checkbox" /> Ocultar
          salida y capturas en la evidencia</label
        >
        <label
          >Si ocurre un error<select v-model="draft.onError">
            <option :value="undefined">
              Detener el flujo (predeterminado)
            </option>
            <option value="stopWorkflow">Detener el flujo</option>
            <option value="continueRegularOutput">
              Continuar por la salida normal
            </option>
          </select></label
        >
      </div>
      <p v-if="error" role="alert" class="wf-error wf-inspector-error">
        {{ error }}
      </p>
    </div>
    <div class="wf-inspector-footer">
      <button type="button" class="wf-button wf-button-primary" @click="apply">
        <Check :size="15" /> Aplicar cambios
      </button>
      <div v-if="node.type !== 'rpa.manualTrigger'" class="wf-node-actions">
        <button
          type="button"
          class="wf-text-button"
          @click="apply() && emit('duplicate')"
        >
          <Copy :size="14" /> Duplicar</button
        ><button
          type="button"
          class="wf-text-button wf-danger"
          @click="emit('remove')"
        >
          <Trash2 :size="14" /> Eliminar
        </button>
      </div>
    </div>
  </aside>
</template>
