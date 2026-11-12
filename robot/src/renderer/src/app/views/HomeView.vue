<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { AgentSystemMetrics } from "@rpa/contracts";
import { useAppStore } from "@/app/stores/app.store";
import playwrightDiagnosticFlowDocument from "../../../../../resources/flows/playwright-google-diagnostic.flow.json";

const appStore = useAppStore();

const message = ref("");
const flowRunning = ref(false);
const flowSummary = ref("");
const flowValidationOutput = ref("");
const flowRunOutput = ref("");
const systemMetrics = ref<AgentSystemMetrics | null>(null);
const metricsLoading = ref(true);
const metricsRefreshing = ref(false);
const metricsError = ref("");
let metricsInterval: number | undefined;
let metricsRequestInFlight = false;

const formatBytes = (bytes: number | null) =>
  bytes === null
    ? "No disponible"
    : `${new Intl.NumberFormat("es-CL", {
        maximumFractionDigits: 1,
      }).format(bytes / 1024 ** 3)} GB`;
const formatPercent = (percent: number) =>
  `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(percent)}%`;
const resourceMetrics = computed(() => {
  const metrics = systemMetrics.value;
  const percentage = (used: number, total: number) =>
    total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : null;
  const card = (
    label: string,
    percent: number | null,
    detail: string,
    waitingValue = "No disponible",
  ) => ({
    label,
    percent,
    value: percent === null ? waitingValue : formatPercent(percent),
    detail,
    tone:
      percent !== null && percent >= 90
        ? "bg-rose-600"
        : percent !== null && percent >= 75
          ? "bg-amber-500"
          : "bg-sky-600",
  });

  return [
    card(
      "CPU",
      metrics?.cpu_usage_percent ?? null,
      !metrics
        ? "Uso total del procesador"
        : metrics.cpu_usage_percent === null
          ? "Calculando con la próxima muestra"
          : "Uso total del procesador",
      metricsLoading.value ? "Cargando…" : metrics ? "Midiendo…" : "Sin datos",
    ),
    card(
      "RAM",
      metrics
        ? percentage(metrics.memory_used_bytes, metrics.memory_total_bytes)
        : null,
      metrics
        ? `${formatBytes(metrics.memory_used_bytes)} usados de ${formatBytes(metrics.memory_total_bytes)}`
        : "Memoria usada y total",
      metricsLoading.value ? "Cargando…" : "Sin datos",
    ),
    card(
      "Disco del sistema",
      metrics?.storage_used_bytes != null &&
        metrics.storage_total_bytes != null
        ? percentage(metrics.storage_used_bytes, metrics.storage_total_bytes)
        : null,
      metrics?.storage_total_bytes
        ? `${formatBytes(metrics.storage_used_bytes)} usados · ${formatBytes(metrics.storage_available_bytes)} disponibles de ${formatBytes(metrics.storage_total_bytes)}`
        : "Volumen del sistema",
      metricsLoading.value ? "Cargando…" : "No disponible",
    ),
  ];
});

const refreshSystemMetrics = async () => {
  if (metricsRequestInFlight) return;
  metricsRequestInFlight = true;
  metricsRefreshing.value = true;
  try {
    systemMetrics.value = await window.robot.getSystemMetrics();
    metricsError.value = "";
  } catch (error) {
    metricsError.value = error instanceof Error
      ? error.message
      : "No se pudieron leer las métricas.";
  } finally {
    metricsLoading.value = false;
    metricsRefreshing.value = false;
    metricsRequestInFlight = false;
  }
};

const formatMetricsDate = (iso: string) =>
  new Intl.DateTimeFormat("es-CL", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(iso));

onMounted(() => {
  void refreshSystemMetrics();
  metricsInterval = window.setInterval(() => {
    void refreshSystemMetrics();
  }, 10_000);
});
onUnmounted(() => window.clearInterval(metricsInterval));

const hello = () => {
  message.value = appStore.hello();
};

const runPlaywrightDiagnosticFlow = async () => {
  flowRunning.value = true;
  flowSummary.value = "Validando JSON de flujo...";
  flowValidationOutput.value = "";
  flowRunOutput.value = "";

  try {
    const validation = await window.robot.validateFlow({
      document: playwrightDiagnosticFlowDocument,
    });

    flowValidationOutput.value = JSON.stringify(validation, null, 2);

    if (!validation.ok) {
      flowSummary.value =
        "Validacion fallida. Revisa el detalle para corregir el JSON.";
      return;
    }

    flowSummary.value = "Ejecucion en curso...";

    const runResult = await window.robot.runFlow({
      document: playwrightDiagnosticFlowDocument,
      runtime: {
        input: {
          searchQuery: "site:example.com Example Domain",
          placeholderName: "Juan Perez",
          placeholderPassword: "Password123!",
          placeholderMessage: "Diagnostico de automatizacion Playwright",
          placeholderLookup: "Seattle",
        },
      },
    });

    flowRunOutput.value = JSON.stringify(runResult, null, 2);

    if (runResult.status === "success") {
      flowSummary.value = "Ejecucion completada con exito.";
      return;
    }

    const errorMessage = runResult.error?.message || "Sin detalle de error.";
    flowSummary.value = `Ejecucion fallida: ${errorMessage}`;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    flowSummary.value = `Error al ejecutar diagnostico: ${errorMessage}`;
  } finally {
    flowRunning.value = false;
  }
};
</script>
<template>
  <section class="legacy-page grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
    <article class="glass-panel p-6 md:p-7">
      <p class="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
        Debug
      </p>
      <h2 class="mt-3 text-2xl font-semibold text-slate-900 md:text-3xl">
        Herramientas de depuracion
      </h2>
      <p class="mt-3 text-sm leading-relaxed text-slate-600 md:text-base">
        Ejecuta pruebas rapidas del bridge de Electron y utilidades del driver
        del robot para validar el entorno.
      </p>

      <div class="mt-6 flex flex-wrap gap-3">
        <button class="btn-primary" @click="hello">Probar mensaje IPC</button>
        <button
          class="btn-soft"
          :disabled="flowRunning"
          @click="runPlaywrightDiagnosticFlow"
        >
          {{
            flowRunning
              ? "Ejecutando diagnostico..."
              : "Ejecutar JSON Playwright"
          }}
        </button>
      </div>

      <p class="mt-4 text-xs text-slate-500">
        Flujo de referencia:
        resources/flows/playwright-google-diagnostic.flow.json
      </p>

      <section
        class="mt-8 border-t border-slate-200 pt-6"
        aria-labelledby="resource-metrics-title"
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <h3
              id="resource-metrics-title"
              class="text-base font-semibold text-slate-900"
            >
              Uso de recursos del equipo
            </h3>
            <p class="mt-1 text-xs text-slate-500">
              Actualización automática cada 10 segundos.
            </p>
          </div>
          <button
            class="btn-soft"
            type="button"
            :disabled="metricsRefreshing"
            @click="refreshSystemMetrics"
          >
            {{ metricsRefreshing ? "Actualizando…" : "Actualizar" }}
          </button>
        </div>

        <p
          v-if="metricsError"
          class="mt-3 text-xs text-rose-700"
          role="status"
        >
          No se pudieron actualizar los indicadores: {{ metricsError }}
        </p>

        <div class="mt-4 grid gap-3 md:grid-cols-3">
          <article
            v-for="metric in resourceMetrics"
            :key="metric.label"
            class="rounded-xl border border-slate-200 bg-white p-4"
          >
            <div class="flex items-baseline justify-between gap-2">
              <span class="text-xs font-medium text-slate-600">{{
                metric.label
              }}</span>
              <strong class="text-sm tabular-nums text-slate-900">{{
                metric.value
              }}</strong>
            </div>
            <div
              class="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              :aria-label="`${metric.label}: ${metric.value}`"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="metric.percent ?? undefined"
            >
              <span
                class="block h-full rounded-full transition-[width]"
                :class="metric.tone"
                :style="{ width: `${metric.percent ?? 0}%` }"
              ></span>
            </div>
            <p
              class="mt-2 min-h-9 break-words text-xs leading-relaxed text-slate-500"
            >
              {{ metric.detail }}
            </p>
          </article>
        </div>

        <p class="mt-3 text-xs text-slate-500">
          {{
            systemMetrics
              ? `Última lectura: ${formatMetricsDate(systemMetrics.sampled_at)}`
              : "La lectura aparecerá al consultar el equipo."
          }}
        </p>
      </section>
    </article>

    <aside class="glass-panel p-6 md:p-7">
      <p
        class="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700"
      >
        Salida
      </p>
      <h3 class="mt-2 text-lg font-semibold text-slate-900">
        Respuesta de la app
      </h3>
      <p class="mt-2 text-sm text-slate-500">
        Haz clic en "Probar mensaje IPC" para validar la comunicacion.
      </p>

      <div
        class="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"
      >
        <p v-if="message" v-html="message"></p>
        <p v-else>Aun no hay respuesta.</p>
      </div>

      <div
        class="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-700"
      >
        <p class="font-semibold text-slate-900">Diagnostico Flow</p>
        <p class="mt-1 text-slate-600">
          {{ flowSummary || "Aun no ejecutado." }}
        </p>
      </div>

      <div class="mt-4 grid gap-3">
        <div class="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p
            class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600"
          >
            Validacion
          </p>
          <pre
            class="mt-2 max-h-44 overflow-auto text-[11px] leading-relaxed text-slate-700"
            >{{ flowValidationOutput || "Sin datos." }}</pre>
        </div>

        <div class="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p
            class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600"
          >
            Ejecucion
          </p>
          <pre
            class="mt-2 max-h-52 overflow-auto text-[11px] leading-relaxed text-slate-700"
            >{{ flowRunOutput || "Sin datos." }}</pre>
        </div>
      </div>
    </aside>
  </section>
</template>
