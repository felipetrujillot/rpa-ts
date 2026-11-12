<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { ArrowLeft, RefreshCw, Square, Clock3 } from "lucide-vue-next";
import {
  formatDate,
  formatDuration,
  statusLabel,
} from "@/app/utils/flow-display";
import {
  useFlowMonitorStore,
  type TraceableFlowRun,
} from "@/app/stores/flow-monitor.store";

const route = useRoute();
const monitorStore = useFlowMonitorStore();

const canceling = ref(false);
const cancelStatus = ref("");

const runId = computed(() => String(route.params.runId || ""));

const run = computed<TraceableFlowRun | null>(() => {
  return monitorStore.getRunById(runId.value);
});

const formattedLogs = computed(() => {
  if (!run.value?.logs?.length) {
    return "Sin logs para este run.";
  }

  return run.value.logs
    .map((log) => {
      const timestamp = log.created_at || "";
      const level = String(log.level || "info").toUpperCase();
      return `[${timestamp}] ${level} ${log.message}`;
    })
    .join("\n");
});

const flowDocumentJson = computed(() => {
  const document = run.value?.flow_document;

  if (!document) {
    return "JSON del flujo no disponible para este run.\n\nTip: el backend debe incluir el documento en flow_document/document dentro de la cola o eventos realtime.";
  }

  try {
    return JSON.stringify(document, null, 2);
  } catch {
    return "No se pudo serializar el JSON del flujo.";
  }
});

const runtimeInputJson = computed(() => {
  const runtimeInput = run.value?.runtime_input;

  if (!runtimeInput) {
    return "Sin runtime input asociado a este run.";
  }

  try {
    return JSON.stringify(runtimeInput, null, 2);
  } catch {
    return "No se pudo serializar el runtime input.";
  }
});

const canCancel = computed(() => {
  return Boolean(run.value && ["queued", "running"].includes(run.value.status));
});

const cancelRun = async (): Promise<void> => {
  if (!run.value || !canCancel.value || canceling.value) {
    return;
  }

  canceling.value = true;
  cancelStatus.value = "Cancelando run...";

  try {
    await monitorStore.cancelRun(run.value.uuid_flow_run);
    cancelStatus.value = "Cancelación solicitada.";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cancelStatus.value = `No se pudo cancelar: ${message}`;
  } finally {
    canceling.value = false;
  }
};
</script>

<template>
  <section>
    <header class="workspace-toolbar">
      <RouterLink class="back-link" to="/flows?view=activity"
        ><ArrowLeft :size="16" />Actividad</RouterLink
      ><button
        class="icon-button"
        aria-label="Actualizar ejecución"
        title="Actualizar"
        :disabled="monitorStore.loading"
        @click="monitorStore.refreshFromServer()"
      >
        <RefreshCw :size="17" :class="{ spinning: monitorStore.loading }" />
      </button>
    </header>
    <div
      v-if="monitorStore.pollError || monitorStore.realtimeError"
      class="notice warning"
      role="status"
    >
      {{ monitorStore.pollError || monitorStore.realtimeError }}
    </div>
    <div v-if="run" class="page-content">
      <span class="subtle-label mb-3">DETALLE DE EJECUCIÓN</span>
      <div class="run-title-row">
        <span class="run-status-dot" :class="run.status"></span>
        <h2>{{ run.nombre_flujo || "Ejecución del flujo" }}</h2>
      </div>
      <span class="status-label" :class="run.status">{{
        statusLabel(run.status)
      }}</span>
      <div class="run-actions">
        <button
          v-if="canCancel"
          class="btn-soft danger-text"
          :disabled="canceling"
          @click="cancelRun"
        >
          <Square :size="13" />{{
            canceling ? "Cancelando…" : "Cancelar ejecución"
          }}
        </button>
      </div>
      <p v-if="cancelStatus" class="notice mt-3" role="status">
        {{ cancelStatus }}
      </p>
      <p v-if="run.error_message" class="notice error mt-3" role="alert">
        {{ run.error_message }}
      </p>
      <dl class="flow-properties mt-6">
        <div>
          <dt>Inicio</dt>
          <dd>
            {{ formatDate(run.started_at || run.queued_at || run.created_at) }}
          </dd>
        </div>
        <div>
          <dt>Duración</dt>
          <dd>{{ formatDuration(run.duration_ms) }}</dd>
        </div>
        <div>
          <dt>Finalización</dt>
          <dd>{{ formatDate(run.finished_at) }}</dd>
        </div>
        <div v-if="run.status === 'queued'">
          <dt>Posición en cola</dt>
          <dd>{{ run.queue_position ?? "Por confirmar" }}</dd>
        </div>
      </dl>
      <section class="detail-section">
        <div class="section-heading">
          <h3><Clock3 :size="16" />Registro de ejecución</h3>
          <span
            >{{ run.logs.length }}
            {{ run.logs.length === 1 ? "evento" : "eventos" }}</span
          >
        </div>
        <pre class="log-output">{{ formattedLogs }}</pre>
      </section>
      <details class="technical-details">
        <summary>Información técnica</summary>
        <dl class="technical-properties">
          <div>
            <dt>ID de ejecución</dt>
            <dd>{{ run.uuid_flow_run }}</dd>
          </div>
          <div>
            <dt>ID de asignación</dt>
            <dd>{{ run.uuid_agente_flujo || "—" }}</dd>
          </div>
          <div>
            <dt>ID del flujo</dt>
            <dd>{{ run.uuid_flujo || "—" }}</dd>
          </div>
          <div>
            <dt>Creado</dt>
            <dd>{{ formatDate(run.created_at) }}</dd>
          </div>
          <div>
            <dt>Encolado</dt>
            <dd>{{ formatDate(run.queued_at) }}</dd>
          </div>
          <div>
            <dt>Fuente</dt>
            <dd>{{ run.source }}</dd>
          </div>
        </dl>
        <details class="mt-5">
          <summary>Documento JSON del flujo</summary>
          <pre class="log-output mt-3">{{ flowDocumentJson }}</pre>
        </details>
        <details class="mt-5">
          <summary>Datos de entrada</summary>
          <pre class="log-output mt-3">{{ runtimeInputJson }}</pre>
        </details>
      </details>
      <p class="activity-footnote">
        {{
          monitorStore.lastSyncedAt
            ? `Actualizado ${formatDate(monitorStore.lastSyncedAt)}`
            : "Esperando sincronización"
        }}
      </p>
    </div>
    <div v-else class="empty-state">
      <Clock3 :size="32" :stroke-width="1.4" />
      <h2>
        {{
          monitorStore.loading
            ? "Buscando ejecución…"
            : "Ejecución no disponible"
        }}
      </h2>
      <p>
        Esta ejecución no aparece en el historial reciente. Actualiza la
        actividad para volver a buscarla.
      </p>
      <button
        class="btn-soft"
        :disabled="monitorStore.loading"
        @click="monitorStore.refreshFromServer()"
      >
        Actualizar actividad
      </button>
    </div>
  </section>
</template>
