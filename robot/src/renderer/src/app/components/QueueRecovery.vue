<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { useFlowMonitorStore } from "@/app/stores/flow-monitor.store";

const monitor = useFlowMonitorStore();
const reviewed = ref(false);
const resuming = ref(false);
const error = ref("");
const now = ref(Date.now());
let timer: number | undefined;
const blockedRunId = computed(() => monitor.executionState?.requires_reconciliation
  ? monitor.executionState.uuid_flow_run : null);
const remaining = computed(() => {
  const expires = Date.parse(monitor.executionState?.lease_expires_at || "");
  return Number.isFinite(expires) ? Math.max(0, Math.ceil((expires + 30_000 - now.value) / 1000)) : null;
});
watch(blockedRunId, () => { reviewed.value = false; error.value = ""; });
onMounted(() => { timer = window.setInterval(() => { now.value = Date.now(); }, 1000); });
onUnmounted(() => window.clearInterval(timer));

async function resume() {
  const runId = blockedRunId.value;
  if (!runId || !reviewed.value || remaining.value !== 0 || resuming.value) return;
  resuming.value = true;
  error.value = "";
  try {
    await monitor.resumeQueueAfterReview(runId);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    resuming.value = false;
  }
}
</script>

<template>
  <section v-if="blockedRunId" class="notice warning queue-recovery" aria-label="Recuperar cola bloqueada">
    <strong role="status">Cola pausada: una ejecución necesita revisión</strong>
    <p>El flujo terminó sin poder confirmar sus efectos. Revisa el resultado para continuar con los siguientes flujos.</p>
    <RouterLink :to="`/flows/run/${blockedRunId}`" class="text-button">Ver ejecución</RouterLink>
    <label class="review-confirmation">
      <input v-model="reviewed" type="checkbox" :disabled="resuming" />
      Comprobé que la ejecución se detuvo y revisé sus efectos.
    </label>
    <p v-if="remaining === null">Actualiza el estado de la cola para comprobar si puede reanudarse.</p>
    <p v-else-if="remaining > 0">Podrás continuar en {{ remaining }} s.</p>
    <button class="btn-primary" :disabled="!reviewed || remaining !== 0 || resuming" @click="resume">
      {{ resuming ? "Reanudando…" : "Reanudar cola" }}
    </button>
    <p>El flujo fallido permanece en el historial y no se vuelve a ejecutar.</p>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.queue-recovery { display: grid; justify-items: start; gap: 8px; padding-block: 16px; }
.queue-recovery p { margin: 0; }
.review-confirmation { display: flex; align-items: center; gap: 8px; }
</style>
