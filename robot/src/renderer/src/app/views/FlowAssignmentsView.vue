<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import {
  Search,
  RefreshCw,
  Play,
  Workflow,
  ChevronRight,
  Clock3,
  Activity,
} from "lucide-vue-next";
import { useAgentLinkStore } from "@/app/stores/agent-link.store";
import { useFlowMonitorStore } from "@/app/stores/flow-monitor.store";
import {
  executeAgenteFlowAssignment,
  getAgenteFlowAssignments,
  type AgenteFlowAssignment,
} from "@/app/services/orquestador-trpc";
import RunList from "@/app/components/RunList.vue";
import { formatDate, formatDuration } from "@/app/utils/flow-display";

const route = useRoute();
const link = useAgentLinkStore();
const monitor = useFlowMonitorStore();
const assignments = ref<AgenteFlowAssignment[]>([]);
const loading = ref(false);
const loaded = ref(false);
const search = ref("");
const selectedId = ref("");
const executingId = ref("");
const cancelingId = ref("");
const message = ref("");
const error = ref("");
const activity = computed(() => route.query.view === "activity");
const activityFilter = ref("all");
const filtered = computed(() =>
  assignments.value.filter((item) =>
    item.nombre_flujo
      .toLocaleLowerCase()
      .includes(search.value.trim().toLocaleLowerCase()),
  ),
);
const selected = computed(
  () =>
    filtered.value.find(
      (item) => item.uuid_agente_flujo === selectedId.value,
    ) ||
    filtered.value[0] ||
    null,
);
const selectedRuns = computed(() =>
  selected.value
    ? monitor.runs.filter(
        (run) => run.uuid_agente_flujo === selected.value!.uuid_agente_flujo,
      )
    : [],
);
const activeRuns = computed(() =>
  monitor.runs.filter((run) =>
    ["queued", "running", "cancelling"].includes(run.status),
  ),
);
const visibleRuns = computed(() =>
  activityFilter.value === "active"
    ? activeRuns.value
    : activityFilter.value === "failed"
      ? monitor.runs.filter((run) => run.status === "failed")
      : monitor.runs,
);

async function loadAssignments() {
  if (!link.agente?.uuid_agente || loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    assignments.value = await getAgenteFlowAssignments(link.agente.uuid_agente);
    loaded.value = true;
  } catch (cause) {
    error.value = `No se pudieron cargar los flujos: ${cause instanceof Error ? cause.message : String(cause)}`;
  } finally {
    loading.value = false;
  }
}
async function refresh() {
  await Promise.all([loadAssignments(), monitor.refreshFromServer()]);
}
async function execute(assignment: AgenteFlowAssignment) {
  if (executingId.value || assignment.activo !== 1) return;
  executingId.value = assignment.uuid_agente_flujo;
  message.value = "";
  error.value = "";
  try {
    const response = await executeAgenteFlowAssignment(
      assignment.uuid_agente_flujo,
    );
    if (response.data.execution.queueStatus === "queued") {
      monitor.rememberQueuedRun({
        uuid_flow_run: response.data.uuid_flow_run,
        uuid_agente_flujo: response.data.uuid_agente_flujo,
        uuid_flujo: response.data.uuid_flujo,
        nombre_flujo: assignment.nombre_flujo,
      });
      message.value =
        response.data.execution.dispatch?.reason === "agent-offline"
          ? "Ejecución en cola. Comenzará cuando el agente se conecte."
          : "Ejecución añadida a la cola.";
    } else {
      message.value = "Ejecución iniciada.";
      await monitor.refreshFromServer({ quiet: true });
    }
  } catch (cause) {
    error.value = `No se pudo ejecutar el flujo: ${cause instanceof Error ? cause.message : String(cause)}`;
  } finally {
    executingId.value = "";
  }
}
async function cancel(id: string) {
  if (cancelingId.value) return;
  cancelingId.value = id;
  error.value = "";
  message.value = "";
  try {
    await monitor.cancelRun(id);
    message.value = "Cancelación solicitada.";
  } catch (cause) {
    error.value = `No se pudo cancelar: ${cause instanceof Error ? cause.message : String(cause)}`;
  } finally {
    cancelingId.value = "";
  }
}
onMounted(loadAssignments);
</script>

<template>
  <section class="library-view">
    <header class="workspace-toolbar">
      <div>
        <h1>{{ activity ? "Actividad" : "Flujos" }}</h1>
        <span class="toolbar-subtitle">{{
          activity
            ? "Ejecuciones de este robot"
            : "Tu biblioteca de automatizaciones"
        }}</span>
      </div>
      <button
        class="icon-button"
        title="Actualizar"
        aria-label="Actualizar flujos y actividad"
        :disabled="loading || monitor.loading"
        @click="refresh"
      >
        <RefreshCw
          :size="17"
          :class="{ spinning: loading || monitor.loading }"
        />
      </button>
    </header>
    <div v-if="error" class="notice error" role="alert">{{ error }}</div>
    <div v-if="message" class="notice" role="status">{{ message }}</div>
    <div
      v-if="monitor.pollError || monitor.realtimeError"
      class="notice warning"
      role="status"
    >
      No se pudo actualizar toda la actividad.
      {{ monitor.pollError || monitor.realtimeError }}
      <button class="text-button" @click="refresh">Reintentar</button>
    </div>

    <div v-if="!activity" class="library-columns">
      <aside class="flow-browser" aria-label="Biblioteca de flujos">
        <div class="flow-browser-heading">
          <span>ASIGNADOS</span><span>{{ assignments.length }}</span>
        </div>
        <label class="search-field"
          ><Search :size="16" /><input
            v-model="search"
            type="search"
            placeholder="Buscar flujos"
            aria-label="Buscar flujos"
        /></label>
        <div v-if="loading && !loaded" class="list-placeholder" role="status">
          Cargando biblioteca…
        </div>
        <div v-else-if="!filtered.length" class="list-placeholder">
          {{
            search
              ? "No hay coincidencias."
              : error
                ? "La biblioteca no está disponible."
                : "Aún no tienes flujos asignados."
          }}<button v-if="error" class="text-button" @click="loadAssignments">
            Reintentar
          </button>
        </div>
        <ul v-else class="flow-list">
          <li v-for="item in filtered" :key="item.uuid_agente_flujo">
            <button
              class="flow-list-item"
              :class="{
                selected:
                  selected?.uuid_agente_flujo === item.uuid_agente_flujo,
              }"
              :aria-pressed="
                selected?.uuid_agente_flujo === item.uuid_agente_flujo
              "
              @click="selectedId = item.uuid_agente_flujo"
            >
              <Workflow :size="18" :stroke-width="1.6" /><span
                ><strong>{{ item.nombre_flujo }}</strong
                ><small
                  >{{ item.activo === 1 ? "Disponible" : "Inactivo" }} ·
                  {{ item.cron_expression ? "Programado" : "Manual" }}</small
                ></span
              ><ChevronRight :size="14" />
            </button>
          </li>
        </ul>
        <footer class="browser-footer">
          {{ filtered.length }} {{ filtered.length === 1 ? "flujo" : "flujos"
          }}<span v-if="loading"> · Actualizando…</span>
        </footer>
      </aside>

      <div class="flow-detail" v-if="selected">
        <div class="detail-heading">
          <div class="feature-icon">
            <Workflow :size="26" :stroke-width="1.5" />
          </div>
          <span class="subtle-label">AUTOMATIZACIÓN</span>
          <h2>{{ selected.nombre_flujo }}</h2>
          <p>
            {{
              selected.activo === 1
                ? "Listo para ejecutarse en este equipo."
                : "Este flujo está inactivo. Actívalo desde el orquestador."
            }}
          </p>
          <button
            class="btn-primary"
            :disabled="selected.activo !== 1 || Boolean(executingId)"
            @click="execute(selected)"
          >
            <Play :size="15" />{{
              executingId === selected.uuid_agente_flujo
                ? "Iniciando…"
                : "Ejecutar flujo"
            }}
          </button>
        </div>
        <dl class="flow-properties">
          <div>
            <dt>Programación</dt>
            <dd>{{ selected.cron_expression || "Ejecución manual" }}</dd>
          </div>
          <div>
            <dt>Versión</dt>
            <dd>{{ selected.version_publicada ?? "Sin publicar" }}</dd>
          </div>
          <div>
            <dt>Última actualización</dt>
            <dd>{{ formatDate(selected.updated_at) }}</dd>
          </div>
        </dl>
        <section class="detail-section">
          <div class="section-heading">
            <h3><Clock3 :size="16" />Ejecuciones recientes</h3>
            <span>{{ selectedRuns.length }}</span>
          </div>
          <RunList
            v-if="selectedRuns.length"
            :runs="selectedRuns.slice(0, 8)"
            :canceling-id="cancelingId"
            @cancel="cancel"
          />
          <div v-else class="inline-empty">
            <Activity :size="23" :stroke-width="1.5" /><strong
              >Aún no hay ejecuciones</strong
            >
            <p>Al ejecutar este flujo, podrás seguir su actividad aquí.</p>
          </div>
        </section>
        <details class="technical-details">
          <summary>Información técnica</summary>
          <dl class="technical-properties">
            <div>
              <dt>ID del flujo</dt>
              <dd>{{ selected.uuid_flujo }}</dd>
            </div>
            <div>
              <dt>ID de asignación</dt>
              <dd>{{ selected.uuid_agente_flujo }}</dd>
            </div>
            <div>
              <dt>Publicación</dt>
              <dd>{{ selected.estado_publicacion }}</dd>
            </div>
          </dl>
        </details>
      </div>
      <div v-else class="empty-state">
        <Workflow :size="36" :stroke-width="1.3" />
        <h2>
          {{
            loading
              ? "Preparando tu biblioteca"
              : search
                ? "No encontramos ese flujo"
                : "Tu biblioteca comienza aquí"
          }}
        </h2>
        <p>
          {{
            search
              ? "Prueba con otro nombre."
              : "Los flujos asignados a este agente aparecerán aquí."
          }}
        </p>
      </div>
    </div>

    <div v-else class="activity-content">
      <div class="activity-heading">
        <div>
          <span class="subtle-label">EN ESTE EQUIPO</span>
          <h2>Historial de ejecuciones</h2>
          <p>Consulta el estado de tus automatizaciones.</p>
        </div>
        <span class="sync-caption">{{
          monitor.lastSyncedAt
            ? `Actualizado ${formatDate(monitor.lastSyncedAt)}`
            : "Esperando sincronización"
        }}</span>
      </div>
      <div class="activity-summary">
        <span
          ><strong>{{ monitor.summary.running }}</strong> en ejecución</span
        ><span
          ><strong>{{ monitor.summary.queued }}</strong> en cola</span
        ><span
          ><strong>{{ monitor.summary.success }}</strong> completadas</span
        ><span
          ><strong>{{ monitor.summary.failed }}</strong> con error</span
        >
      </div>
      <div class="section-heading activity-controls">
        <div class="segmented-control" aria-label="Filtrar ejecuciones">
          <button
            :class="{ active: activityFilter === 'all' }"
            :aria-pressed="activityFilter === 'all'"
            @click="activityFilter = 'all'"
          >
            Todas</button
          ><button
            :class="{ active: activityFilter === 'active' }"
            :aria-pressed="activityFilter === 'active'"
            @click="activityFilter = 'active'"
          >
            En curso</button
          ><button
            :class="{ active: activityFilter === 'failed' }"
            :aria-pressed="activityFilter === 'failed'"
            @click="activityFilter = 'failed'"
          >
            Con error
          </button>
        </div>
        <span v-if="monitor.summary.avgDurationMs !== null" class="sync-caption"
          >Promedio {{ formatDuration(monitor.summary.avgDurationMs) }}</span
        >
      </div>
      <RunList
        v-if="visibleRuns.length"
        :runs="visibleRuns"
        :canceling-id="cancelingId"
        @cancel="cancel"
      />
      <div v-else class="inline-empty">
        <Activity :size="30" :stroke-width="1.4" /><strong>{{
          monitor.loading
            ? "Cargando actividad…"
            : "No hay ejecuciones en esta vista"
        }}</strong>
        <p>La actividad se actualizará automáticamente.</p>
      </div>
      <p class="activity-footnote">
        {{ monitor.runs.length }} ejecuciones en el historial reciente.
      </p>
    </div>
  </section>
</template>
