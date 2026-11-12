<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ShieldCheck, Search } from "lucide-vue-next";
import {
  declaredScriptActions,
  scriptSdkActionIds,
  type FlowValue,
} from "@rpa/contracts";
import { actionLabel } from "../../utils/workflow-editor";
const props = defineProps<{
  modelValue?: FlowValue;
  knownActionIds: string[];
}>();
const emit = defineEmits<{
  "update:modelValue": [value: string[]];
  invalid: [value: boolean];
}>();
const search = ref("");
const selection = computed(() => {
  try {
    return { ids: declaredScriptActions(props.modelValue), invalid: false };
  } catch {
    return { ids: [] as string[], invalid: true };
  }
});
watch(
  () => selection.value.invalid,
  (value) => emit("invalid", value),
  { immediate: true },
);
const availableActions = computed(() => [
  ...new Set(
    props.knownActionIds.filter((id) => scriptSdkActionIds.includes(id)),
  ),
]);
const allSelected = computed(
  () =>
    availableActions.value.length > 0 &&
    availableActions.value.every((id) => selection.value.ids.includes(id)),
);
function enableAll() {
  emit("update:modelValue", [
    ...new Set([...selection.value.ids, ...availableActions.value]),
  ]);
}
const actions = computed(() =>
  [...new Set([...availableActions.value, ...selection.value.ids])]
    .filter((id) =>
      `${actionLabel(id)} ${id}`
        .toLocaleLowerCase()
        .includes(search.value.toLocaleLowerCase()),
    )
    .sort(),
);
function toggle(id: string, enabled: boolean) {
  emit(
    "update:modelValue",
    enabled
      ? [...selection.value.ids, id]
      : selection.value.ids.filter((item) => item !== id),
  );
}
</script>
<template>
  <details class="wf-sdk-permissions">
    <summary>
      <ShieldCheck :size="15" /> Permisos del SDK
      <span>{{
        selection.ids.length
          ? `${selection.ids.length} acciones`
          : "Sin acciones"
      }}</span>
    </summary>
    <p>
      Selecciona las acciones que este script puede solicitar. El servidor
      también debe autorizarlas para el robot. Cada llamada queda en el
      historial del paso.
    </p>
    <template v-if="selection.invalid">
      <p role="alert" class="wf-error">
        Los permisos deben ser una lista literal de IDs únicos, sin scripts ni
        comodines.
      </p>
      <button
        type="button"
        class="wf-text-button"
        @click="emit('update:modelValue', [])"
      >
        Restablecer permisos
      </button>
    </template>
    <template v-else>
      <label class="wf-sdk-search"
        ><Search :size="14" /><input
          v-model="search"
          aria-label="Buscar acciones del SDK"
          placeholder="Buscar acciones…"
      /></label>
      <div class="wf-sdk-bulk-actions">
        <button
          type="button"
          class="wf-text-button"
          :disabled="!availableActions.length || allSelected"
          @click="enableAll"
        >
          Habilitar todas
        </button>
        <button
          type="button"
          class="wf-text-button"
          :disabled="!selection.ids.length"
          @click="emit('update:modelValue', [])"
        >
          Desmarcar todas
        </button>
      </div>
      <p v-if="search" class="wf-sdk-bulk-hint">
        Afecta a todo el catálogo, aunque haya una búsqueda.
      </p>
      <div
        class="wf-sdk-action-list"
        role="group"
        aria-label="Acciones permitidas para el SDK"
      >
        <label v-for="id in actions" :key="id" class="wf-check">
          <input
            type="checkbox"
            :checked="selection.ids.includes(id)"
            :disabled="
              !selection.ids.includes(id) && !knownActionIds.includes(id)
            "
            @change="toggle(id, ($event.target as HTMLInputElement).checked)"
          />
          <span
            >{{ actionLabel(id) }}<code>{{ id }}</code
            ><small v-if="!knownActionIds.includes(id)"
              >Acción no disponible en este catálogo</small
            ></span
          >
        </label>
        <p v-if="!actions.length">
          No hay acciones que coincidan con la búsqueda.
        </p>
      </div>
      <details>
        <summary>Autorización en el servidor</summary>
        <p>
          Un administrador autoriza las acciones en
          <strong>Agentes → Equipo y acceso → Permisos del SDK</strong>. Se
          comprueba antes de cada llamada; no necesitas configurar variables de
          entorno ni reiniciar el robot.
        </p>
        <p>
          Una autorización de navegador o escritorio concede al script las
          capacidades de esa acción. El acceso HTTPS de
          <code>http</code> mantiene su política independiente.
        </p>
      </details>
    </template>
  </details>
</template>
<style scoped>
.wf-sdk-permissions {
  margin: 14px 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  padding: 12px 0;
  font-size: 11px;
}
.wf-sdk-permissions > summary {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-weight: 600;
}
.wf-sdk-permissions > summary span {
  margin-left: auto;
  font-weight: 400;
  color: var(--muted-foreground);
}
.wf-sdk-permissions p {
  margin: 10px 0;
  line-height: 1.6;
  color: var(--muted-foreground);
}
.wf-sdk-search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0;
}
.wf-sdk-search input {
  margin: 0 !important;
  min-width: 0;
}
.wf-sdk-bulk-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.wf-sdk-bulk-actions button:disabled {
  opacity: 0.5;
  cursor: default;
}
.wf-sdk-permissions p.wf-sdk-bulk-hint {
  font-size: 10px;
  margin: 6px 0;
}
.wf-sdk-action-list {
  max-height: 240px;
  overflow: auto;
  padding: 4px;
  margin-bottom: 10px;
}
.wf-sdk-action-list label {
  margin: 0 0 10px;
}
.wf-sdk-action-list code,
.wf-sdk-action-list small {
  display: block;
  font-size: 9px;
  color: var(--muted-foreground);
  overflow-wrap: anywhere;
}
</style>
