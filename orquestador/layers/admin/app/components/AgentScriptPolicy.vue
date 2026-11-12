<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ShieldCheck, Search, RefreshCw } from "lucide-vue-next";
import { scriptSdkActionIds } from "@rpa/contracts";
import { actionLabel } from "../utils/workflow-editor";
const props = defineProps<{ uuidAgente: string }>();
const { $trpc } = useNuxtApp();
const { data, status, refresh } = $trpc.agentes.getAgenteScriptPolicy.useQuery({
  uuid_agente: props.uuidAgente,
});
const selected = ref<string[]>([]);
const search = ref("");
const saving = ref(false);
const error = ref("");
const saved = ref(false);
const fingerprint = (ids: string[]) => JSON.stringify([...ids].sort());
const dirty = computed(
  () =>
    fingerprint(selected.value) !==
    fingerprint(data.value?.allowedActions ?? []),
);
watch(
  data,
  (value) => {
    if (value) selected.value = [...value.allowedActions];
  },
  { immediate: true },
);
const actions = computed(() =>
  scriptSdkActionIds
    .filter((id) =>
      `${actionLabel(id)} ${id}`
        .toLocaleLowerCase()
        .includes(search.value.toLocaleLowerCase()),
    )
    .sort(),
);
const allSelected = computed(() =>
  scriptSdkActionIds.every((id) => selected.value.includes(id)),
);
function enableAll() {
  selected.value = [...scriptSdkActionIds];
  saved.value = false;
}
function toggle(id: string, enabled: boolean) {
  selected.value = enabled
    ? [...selected.value, id]
    : selected.value.filter((value) => value !== id);
  saved.value = false;
}
async function save() {
  if (saving.value || !data.value?.canManage) return;
  saving.value = true;
  error.value = "";
  saved.value = false;
  try {
    await $trpc.agentes.updateAgenteScriptPolicy.mutate({
      uuid_agente: props.uuidAgente,
      allowedActions: [...selected.value],
    });
    await refresh();
    saved.value = true;
  } catch (cause) {
    error.value =
      cause instanceof Error
        ? cause.message
        : "No se pudieron guardar los permisos.";
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <section class="agent-panel sdk-policy" aria-labelledby="sdk-policy-title">
    <div class="sdk-policy-heading">
      <ShieldCheck :size="18" />
      <h2 id="sdk-policy-title">Permisos del SDK</h2>
      <span>{{ selected.length }} autorizadas</span>
    </div>
    <p>
      Controla qué acciones pueden ejecutar los scripts TypeScript de este
      robot. Cada script también debe declararlas en su nodo.
    </p>
    <p v-if="status === 'pending'" role="status">Cargando permisos…</p>
    <template v-else-if="status === 'error'">
      <p role="alert">No se pudieron cargar los permisos.</p>
      <Button variant="outline" size="sm" @click="refresh"
        ><RefreshCw :size="14" />Reintentar</Button
      >
    </template>
    <template v-else-if="data">
      <label class="sdk-policy-search"
        ><Search :size="15" /><input
          v-model="search"
          aria-label="Buscar acciones autorizables del SDK"
          placeholder="Buscar acciones…"
      /></label>
      <div v-if="data.canManage" class="sdk-policy-bulk-actions">
        <Button
          variant="outline"
          size="sm"
          :disabled="saving || allSelected"
          @click="enableAll"
          >Habilitar todas</Button
        >
        <Button
          variant="outline"
          size="sm"
          :disabled="saving || !selected.length"
          @click="
            selected = [];
            saved = false;
          "
          >Desmarcar todas</Button
        >
      </div>
      <p v-if="data.canManage && search" class="sdk-policy-note">
        Afecta a todo el catálogo, aunque haya una búsqueda.
      </p>
      <fieldset
        :disabled="saving || !data.canManage"
        class="sdk-policy-options"
      >
        <legend class="sr-only">
          Acciones autorizadas para scripts de este robot
        </legend>
        <label v-for="id in actions" :key="id">
          <input
            type="checkbox"
            :checked="selected.includes(id)"
            @change="toggle(id, ($event.target as HTMLInputElement).checked)"
          />
          <span
            >{{ actionLabel(id) }}<code>{{ id }}</code></span
          >
        </label>
        <p v-if="!actions.length">No hay acciones que coincidan.</p>
      </fieldset>
      <p v-if="!data.canManage">
        Solo los administradores pueden modificar estos permisos.
      </p>
      <template v-else>
        <p v-if="error" role="alert" class="sdk-policy-error">{{ error }}</p>
        <p v-if="saved && !dirty" role="status">Permisos guardados.</p>
        <div class="sdk-policy-buttons">
          <Button size="sm" :disabled="saving || !dirty" @click="save">{{
            saving ? "Guardando…" : "Guardar permisos"
          }}</Button>
        </div>
      </template>
      <p class="sdk-policy-note">
        Los cambios se verifican antes de cada llamada, sin reiniciar el robot.
        Una acción ya iniciada puede terminar; para detener la ejecución usa
        Cancelar. Sin conexión al servidor, las nuevas llamadas se bloquean.
      </p>
    </template>
  </section>
</template>
<style scoped>
.sdk-policy {
  padding: 22px;
}
.sdk-policy-heading {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sdk-policy-heading h2 {
  font-size: 14px;
  font-weight: 600;
}
.sdk-policy-heading > span {
  margin-left: auto;
  font-size: 11px;
  color: var(--muted-foreground);
}
.sdk-policy p {
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted-foreground);
  margin: 12px 0;
}
.sdk-policy-search {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  margin-top: 16px;
}
.sdk-policy-search input {
  width: 100%;
  min-width: 0;
  outline: none;
  background: transparent;
  font-size: 12px;
}
.sdk-policy-options {
  max-height: 280px;
  overflow-y: auto;
  margin: 12px 0;
  border: 0;
  padding: 0 4px;
  min-width: 0;
}
.sdk-policy-options label {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  font-size: 12px;
  cursor: pointer;
  padding: 9px 0;
}
.sdk-policy-options input {
  margin-top: 3px;
  accent-color: var(--primary);
}
.sdk-policy-options code {
  display: block;
  font-size: 10px;
  color: var(--muted-foreground);
  overflow-wrap: anywhere;
}
.sdk-policy-bulk-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.sdk-policy-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.sdk-policy p.sdk-policy-error {
  color: var(--destructive);
}
.sdk-policy p.sdk-policy-note {
  font-size: 11px;
  margin-bottom: 0;
}
</style>
