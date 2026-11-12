<script setup lang="ts">
documentTitle("Detalle de Flujo del Agente");

import {
  ArrowLeft,
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  Clipboard,
  Clock3,
  FileSearch,
  History,
  RefreshCw,
  Square,
  TriangleAlert,
  Workflow,
} from "lucide-vue-next";
import {
  formatRunDate,
  runDuration,
  runStatusLabels,
  runTriggerLabel,
} from "../../../../../utils/run-presentation";
import { describeSchedule } from "~~/shared/schedule";

type AgenteFlowAssignment = {
  uuid_agente_flujo: string;
  uuid_agente: string;
  uuid_flujo: string;
  uuid_flow_version: string | null;
  cron_expression: string | null;
  schedule_timezone: string;
  activo: number;
  created_at: string;
  updated_at: string;
  nombre_flujo: string;
  estado_publicacion: "draft" | "published" | "archived";
  version_publicada: number;
};

type AgenteFlowRun = {
  uuid_flow_run: string;
  uuid_agente: string | null;
  uuid_agente_flujo: string | null;
  uuid_flujo: string;
  uuid_flow_version: string | null;
  nombre_flujo: string;
  trigger_type: string;
  status:
    "queued" | "running" | "cancelling" | "success" | "failed" | "cancelled";
  created_at: string;
  queued_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  queue_position: number | null;
};

const { $trpc } = useNuxtApp();
const route = useRoute();

const uuid_agente = route.params.uuid_agente as string;
const uuid_flujo = route.params.uuid_flujo as string;

const {
  status: agenteStatus,
  data: agenteData,
  refresh: refreshAgente,
} = $trpc.agentes.getAgenteById.useQuery({
  uuid_agente,
});

const {
  status: assignmentsStatus,
  data: assignmentsData,
  refresh: refreshAssignments,
} = $trpc.agentes.getAgenteFlowAssignments.useQuery({
  uuid_agente,
});

const {
  status: runsStatus,
  data: runsData,
  refresh: refreshRuns,
} = $trpc.agentes.getAgenteFlowRuns.useQuery({
  uuid_agente,
  limit: 200,
});

const {
  status: queueStatus,
  data: queueData,
  refresh: refreshQueue,
} = $trpc.agentes.getAgenteFlowQueue.useQuery({
  uuid_agente,
  limit: 200,
});

const isRefreshing = ref(false);
const cancellingRunId = ref<string | null>(null);
const selectedRunId = ref<string | null>(null);

const agente = computed(() => agenteData.value?.[0] ?? null);

const assignments = computed<AgenteFlowAssignment[]>(
  () => (assignmentsData.value ?? []) as AgenteFlowAssignment[],
);

const selectedAssignment = computed<AgenteFlowAssignment | null>(() => {
  const found = assignments.value.find(
    (item) => item.uuid_flujo === uuid_flujo,
  );
  return found ?? null;
});

const flowRuns = computed<AgenteFlowRun[]>(() => {
  const allRuns = (runsData.value ?? []) as AgenteFlowRun[];
  const flowQueue = (queueData.value ?? []) as AgenteFlowRun[];

  const queuePositionByRun = new Map<string, number>();
  for (const queued of flowQueue) {
    if (queued.uuid_flujo === uuid_flujo && queued.queue_position) {
      queuePositionByRun.set(queued.uuid_flow_run, queued.queue_position);
    }
  }

  return allRuns
    .filter((run) => run.uuid_flujo === uuid_flujo)
    .map((run) => ({
      ...run,
      queue_position:
        queuePositionByRun.get(run.uuid_flow_run) ?? run.queue_position,
    }));
});

const {
  search: runSearch,
  status: runState,
  secondary: triggerFilter,
  filtered: filteredRuns,
} = useAdminTable(flowRuns, {
  search: (item) => [item.uuid_flow_run, item.error_message, item.trigger_type],
  status: (item) => item.status,
  secondary: (item) => item.trigger_type,
});
const runStateOptions = [
  { value: "queued", label: "En cola" },
  { value: "running", label: "En ejecución" },
  { value: "cancelling", label: "Cancelando" },
  { value: "success", label: "Completada" },
  { value: "failed", label: "Fallida" },
  { value: "cancelled", label: "Cancelada" },
];
const triggerOptions = computed(() =>
  [...new Set(flowRuns.value.map((item) => item.trigger_type))]
    .sort()
    .map((value) => ({ value, label: runTriggerLabel(value) })),
);
const page = ref(1);
const pageSize = 10;
const pageCount = computed(() =>
  Math.max(1, Math.ceil(filteredRuns.value.length / pageSize)),
);
const pagedRuns = computed(() =>
  filteredRuns.value.slice((page.value - 1) * pageSize, page.value * pageSize),
);
watch([runSearch, runState, triggerFilter], () => {
  page.value = 1;
});
watch(pageCount, (count) => {
  page.value = Math.min(page.value, count);
});
const selectedRun = computed(
  () =>
    pagedRuns.value.find((run) => run.uuid_flow_run === selectedRunId.value) ??
    pagedRuns.value[0] ??
    null,
);
const flowName = computed(
  () =>
    selectedAssignment.value?.nombre_flujo ||
    flowRuns.value[0]?.nombre_flujo ||
    "Detalle del flujo",
);
const publicationLabels: Record<string, string> = {
  published: "Publicado",
  draft: "Borrador",
  archived: "Archivado",
};
const now = ref<number | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  now.value = Date.now();
  timer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});
onBeforeUnmount(() => clearInterval(timer));
const durationLabel = (run: AgenteFlowRun) => runDuration(run, now.value);
const detailPanel = ref<HTMLElement | null>(null);
const copiedRunId = ref<string | null>(null);
const selectRun = async (id: string) => {
  selectedRunId.value = id;
  await nextTick();
  if (window.matchMedia("(max-width: 1100px)").matches) {
    detailPanel.value?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
    detailPanel.value?.focus({ preventScroll: true });
  }
};
const copyRunId = async () => {
  if (!selectedRun.value) return;
  try {
    await navigator.clipboard.writeText(selectedRun.value.uuid_flow_run);
    copiedRunId.value = selectedRun.value.uuid_flow_run;
    await toast("success", "Identificador de ejecución copiado.");
  } catch {
    await toast("error", "No se pudo copiar el identificador.");
  }
};
watch(
  pagedRuns,
  (runs) => {
    if (!runs.some((run) => run.uuid_flow_run === selectedRunId.value))
      selectedRunId.value = runs[0]?.uuid_flow_run ?? null;
  },
  { immediate: true },
);

const canCancel = (status: AgenteFlowRun["status"]) => {
  return status === "queued" || status === "running";
};

const refreshAll = async () => {
  if (isRefreshing.value) {
    return;
  }

  isRefreshing.value = true;
  try {
    await Promise.all([
      refreshAgente(),
      refreshAssignments(),
      refreshRuns(),
      refreshQueue(),
    ]);
  } finally {
    isRefreshing.value = false;
  }
};

const cancelRun = async (uuid_flow_run: string) => {
  if (cancellingRunId.value) {
    return;
  }

  cancellingRunId.value = uuid_flow_run;
  try {
    await $trpc.agentes.cancelAgenteFlowRun.mutate({
      uuid_flow_run,
      uuid_agente,
    });

    await toast(
      "success",
      "Cancelación solicitada; el estado se actualizará al detenerse el robot.",
    );
    await Promise.all([refreshRuns(), refreshQueue()]);
  } catch (error) {
    await toast(
      "error",
      (error as Error).message || "No se pudo cancelar la ejecución.",
    );
  } finally {
    cancellingRunId.value = null;
  }
};
</script>

<template>
  <div class="flow-detail admin-page">
    <NuxtLink :to="`/admin/agentes/${uuid_agente}`" class="flow-back"
      ><ArrowLeft :size="15" />{{
        agente?.nombre || "Volver al agente"
      }}</NuxtLink
    >
    <header class="admin-page-heading flow-heading">
      <div class="flow-identity">
        <span class="flow-avatar"
          ><Workflow :size="28" :stroke-width="1.5"
        /></span>
        <div>
          <div class="flow-title-line">
            <h1>{{ flowName }}</h1>
            <span
              v-if="selectedAssignment"
              class="admin-state"
              :data-state="
                selectedAssignment.activo === 1 ? 'online' : 'offline'
              "
              >{{
                selectedAssignment.activo === 1
                  ? "Asignación activa"
                  : "Asignación inactiva"
              }}</span
            >
          </div>
          <p>
            <Bot :size="14" />{{ agente?.nombre || "Agente"
            }}<span v-if="agente?.hostname">{{ agente.hostname }}</span>
          </p>
        </div>
      </div>
      <div class="admin-page-actions">
        <Button variant="outline" :disabled="isRefreshing" @click="refreshAll"
          ><RefreshCw
            :size="15"
            class="mr-2"
            :class="{ 'animate-spin': isRefreshing }"
          />{{ isRefreshing ? "Actualizando…" : "Actualizar" }}</Button
        ><Button as-child variant="outline"
          ><NuxtLink :to="`/admin/flujos/${uuid_flujo}`"
            >Abrir flujo<ArrowUpRight :size="15" class="ml-2" /></NuxtLink
        ></Button>
      </div>
    </header>

    <div
      v-if="agenteStatus === 'error' || assignmentsStatus === 'error'"
      class="flow-notice"
      role="alert"
    >
      <TriangleAlert :size="19" />
      <p>
        No se pudo consultar la configuración del agente. Usa Actualizar para
        volver a intentarlo.
      </p>
    </div>
    <div
      v-else-if="agenteStatus === 'success' && !agente"
      class="flow-notice"
      role="alert"
    >
      <TriangleAlert :size="19" />
      <p>
        No encontramos este agente. Vuelve al listado para seleccionar otro
        equipo.
      </p>
    </div>
    <div
      v-else-if="assignmentsStatus === 'success' && !selectedAssignment"
      class="flow-notice"
    >
      <TriangleAlert :size="19" />
      <p>
        Este flujo ya no está asignado al agente. Puedes consultar las
        ejecuciones que conserva el historial.
      </p>
    </div>
    <dl v-if="selectedAssignment" class="flow-config-strip">
      <div>
        <dt>Publicación del flujo</dt>
        <dd>
          <span
            class="admin-state"
            :data-state="selectedAssignment.estado_publicacion"
            >{{
              publicationLabels[selectedAssignment.estado_publicacion] ||
              selectedAssignment.estado_publicacion
            }}</span
          >
        </dd>
      </div>
      <div>
        <dt>Versión publicada del flujo</dt>
        <dd>
          {{
            selectedAssignment.version_publicada
              ? `v${selectedAssignment.version_publicada}`
              : "Sin publicar"
          }}
        </dd>
      </div>
      <div>
        <dt><Clock3 :size="14" />Programación del agente</dt>
        <dd>
          <span>{{ describeSchedule(selectedAssignment.cron_expression, selectedAssignment.schedule_timezone) }}</span>
          <small v-if="selectedAssignment.cron_expression"> · {{ selectedAssignment.schedule_timezone }}</small>
        </dd>
      </div>
      <div>
        <dt>Asignación actualizada</dt>
        <dd>{{ formatRunDate(selectedAssignment.updated_at) }}</dd>
      </div>
    </dl>

    <div class="flow-workspace">
      <section
        class="admin-collection flow-history"
        aria-labelledby="history-title"
      >
        <div class="flow-section-heading">
          <div>
            <h2 id="history-title">
              <History :size="18" />Historial de ejecuciones
            </h2>
            <p>Selecciona una ejecución para revisar sus pasos y resultados.</p>
          </div>
          <span class="admin-total">{{ flowRuns.length }}</span>
        </div>
        <AdminTableFilters
          v-model:search="runSearch"
          v-model:status="runState"
          v-model:secondary="triggerFilter"
          placeholder="Buscar ejecución, origen o error"
          :status-options="runStateOptions"
          :secondary-options="triggerOptions"
          secondary-label="Todos los orígenes"
          :count="filteredRuns.length"
          :total="flowRuns.length"
        />
        <div
          v-if="runsStatus === 'pending'"
          class="flow-load-state"
          role="status"
        >
          Cargando ejecuciones…
        </div>
        <div
          v-else-if="runsStatus === 'error'"
          class="admin-error"
          role="alert"
        >
          No se pudo cargar el historial. Usa Actualizar para volver a
          intentarlo.
        </div>
        <template v-else>
          <p
            v-if="queueStatus === 'error'"
            class="flow-queue-warning"
            role="alert"
          >
            El historial está disponible, pero no se pudieron consultar las
            posiciones de la cola.
          </p>
          <Table>
            <TableHeader
              ><TableRow
                ><TableHead>Ejecución</TableHead><TableHead>Estado</TableHead
                ><TableHead>Creada</TableHead><TableHead>Duración</TableHead
                ><TableHead class="text-right"
                  ><span class="sr-only">Ver detalle</span></TableHead
                ></TableRow
              ></TableHeader
            >
            <TableBody>
              <TableRow
                v-for="run in pagedRuns"
                :key="run.uuid_flow_run"
                class="flow-run-row"
                :class="{
                  'is-selected':
                    selectedRun?.uuid_flow_run === run.uuid_flow_run,
                }"
              >
                <TableCell class="flow-run-name-cell"
                  ><button
                    type="button"
                    class="flow-run-name"
                    :title="run.uuid_flow_run"
                    :aria-label="`Ver ejecución ${run.uuid_flow_run}`"
                    :aria-pressed="
                      selectedRun?.uuid_flow_run === run.uuid_flow_run
                    "
                    @click="selectRun(run.uuid_flow_run)"
                  >
                    #{{ run.uuid_flow_run.slice(0, 8) }}</button
                  ><span
                    v-if="run.error_message"
                    class="flow-row-error"
                    :title="run.error_message"
                    >{{ run.error_message }}</span
                  ><span v-else class="flow-row-secondary">{{
                    runTriggerLabel(run.trigger_type)
                  }}</span></TableCell
                >
                <TableCell class="flow-run-state-cell"
                  ><span class="flow-run-state" :data-state="run.status">{{
                    runStatusLabels[run.status] || run.status
                  }}</span
                  ><span
                    v-if="
                      run.status === 'queued' &&
                      queueStatus === 'success' &&
                      run.queue_position
                    "
                    class="flow-row-secondary"
                    >Posición {{ run.queue_position }}</span
                  ></TableCell
                >
                <TableCell class="flow-run-date-cell"
                  ><span class="flow-mobile-label">Creada</span
                  >{{ formatRunDate(run.created_at) }}</TableCell
                >
                <TableCell class="flow-run-duration-cell"
                  ><span class="flow-mobile-label">Duración</span
                  >{{ durationLabel(run) }}</TableCell
                >
                <TableCell class="flow-run-open-cell text-right"
                  ><Button
                    variant="ghost"
                    size="sm"
                    :aria-label="`Abrir detalle de ejecución ${run.uuid_flow_run}`"
                    :aria-pressed="
                      selectedRun?.uuid_flow_run === run.uuid_flow_run
                    "
                    @click="selectRun(run.uuid_flow_run)"
                    >{{
                      selectedRun?.uuid_flow_run === run.uuid_flow_run
                        ? "Viendo"
                        : "Ver"
                    }}<ArrowUpRight :size="14" class="ml-1" /></Button
                ></TableCell>
              </TableRow>
              <TableEmpty v-if="!filteredRuns.length" :colspan="5"
                ><div class="flow-history-empty">
                  <History :size="28" :stroke-width="1.4" /><strong>{{
                    flowRuns.length
                      ? "No hay ejecuciones que coincidan"
                      : "Aún no hay ejecuciones"
                  }}</strong>
                  <p>
                    {{
                      flowRuns.length
                        ? "Prueba otra búsqueda o limpia los filtros."
                        : "Cuando este agente ejecute el flujo, sus resultados aparecerán aquí."
                    }}
                  </p>
                </div></TableEmpty
              >
            </TableBody>
          </Table>
        </template>
        <nav
          v-if="filteredRuns.length > pageSize"
          class="flow-pagination"
          aria-label="Páginas de ejecuciones"
        >
          <p>
            {{ (page - 1) * pageSize + 1 }}–{{
              Math.min(page * pageSize, filteredRuns.length)
            }}
            de {{ filteredRuns.length }}
          </p>
          <div>
            <Button
              variant="outline"
              size="sm"
              :disabled="page === 1"
              aria-label="Ejecuciones anteriores"
              @click="page--"
              >Anterior</Button
            ><Button
              variant="outline"
              size="sm"
              :disabled="page === pageCount"
              aria-label="Ejecuciones siguientes"
              @click="page++"
              >Siguiente</Button
            >
          </div>
        </nav>
        <div class="flow-history-footer">
          <p>
            Se consultan las últimas 200 ejecuciones del agente y se muestran
            las de este flujo.
          </p>
          <details>
            <summary>
              Gestionar cola del agente<ChevronDown :size="14" />
            </summary>
            <div>
              <p>
                Esta acción cancela las ejecuciones pendientes de
                <strong
                  >todos los flujos de
                  {{ agente?.nombre || "este agente" }}</strong
                >. La ejecución en curso continúa y el historial se conserva.
              </p>
              <AgentQueueClearButton
                :uuid-agente="uuid_agente"
                @cleared="refreshAll"
              />
            </div>
          </details>
        </div>
      </section>

      <section
        ref="detailPanel"
        class="flow-inspector"
        tabindex="-1"
        aria-labelledby="execution-title"
      >
        <template v-if="selectedRun && runsStatus === 'success'">
          <div class="flow-section-heading">
            <div>
              <h2 id="execution-title">
                <FileSearch :size="18" />Detalle de ejecución
              </h2>
              <p>Estado, pasos y evidencias de la selección.</p>
            </div>
            <span class="flow-run-state" :data-state="selectedRun.status">{{
              runStatusLabels[selectedRun.status] || selectedRun.status
            }}</span>
          </div>
          <div class="flow-run-overview">
            <div class="flow-run-identifier">
              <span>Identificador de ejecución</span>
              <div>
                <code>{{ selectedRun.uuid_flow_run }}</code
                ><Button
                  variant="ghost"
                  size="icon"
                  aria-label="Copiar identificador de ejecución"
                  @click="copyRunId"
                  ><Check
                    v-if="copiedRunId === selectedRun.uuid_flow_run"
                    :size="16" /><Clipboard v-else :size="16"
                /></Button>
              </div>
            </div>
            <dl class="flow-run-facts">
              <div>
                <dt>Origen</dt>
                <dd>{{ runTriggerLabel(selectedRun.trigger_type) }}</dd>
              </div>
              <div>
                <dt>Duración</dt>
                <dd>{{ durationLabel(selectedRun) }}</dd>
              </div>
              <div>
                <dt>Inicio</dt>
                <dd>
                  {{
                    selectedRun.started_at
                      ? formatRunDate(selectedRun.started_at)
                      : "Sin iniciar"
                  }}
                </dd>
              </div>
              <div>
                <dt>Fin</dt>
                <dd>
                  {{
                    selectedRun.finished_at
                      ? formatRunDate(selectedRun.finished_at)
                      : ["running", "cancelling"].includes(selectedRun.status)
                        ? "En curso"
                        : "Sin registrar"
                  }}
                </dd>
              </div>
              <div
                v-if="
                  selectedRun.status === 'queued' &&
                  selectedRun.queue_position &&
                  queueStatus === 'success'
                "
              >
                <dt>Posición en la cola del agente</dt>
                <dd>{{ selectedRun.queue_position }}</dd>
              </div>
            </dl>
            <div
              v-if="selectedRun.error_message"
              class="flow-execution-error"
              role="status"
            >
              <TriangleAlert :size="17" />
              <div>
                <strong>Error de ejecución</strong>
                <p>{{ selectedRun.error_message }}</p>
              </div>
            </div>
            <div
              v-if="
                canCancel(selectedRun.status) ||
                selectedRun.status === 'cancelling'
              "
              class="flow-cancel-action"
            >
              <p>
                {{
                  selectedRun.status === "queued"
                    ? "Puedes cancelar esta ejecución antes de que comience."
                    : selectedRun.status === "cancelling"
                      ? "Se solicitó la cancelación. Actualiza para consultar el estado del robot."
                      : "La cancelación se confirmará cuando el robot se detenga."
                }}
              </p>
              <Button
                v-if="canCancel(selectedRun.status)"
                variant="outline"
                size="sm"
                class="flow-cancel-button"
                :disabled="cancellingRunId !== null"
                @click="cancelRun(selectedRun.uuid_flow_run)"
                ><Square :size="13" class="mr-1" />{{
                  cancellingRunId === selectedRun.uuid_flow_run
                    ? "Solicitando…"
                    : "Cancelar ejecución"
                }}</Button
              >
            </div>
          </div>
          <RunEvidencePanel
            :key="selectedRun.uuid_flow_run"
            :run-id="selectedRun.uuid_flow_run"
          />
        </template>
        <div v-else class="flow-inspector-empty">
          <FileSearch :size="35" :stroke-width="1.2" />
          <h2 id="execution-title">Detalle de ejecución</h2>
          <p>
            {{
              runsStatus === "pending"
                ? "Cargando el historial del flujo…"
                : "Selecciona una ejecución del historial para revisar sus pasos, resultados y capturas."
            }}
          </p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped src="../../../../../assets/agent-flow-detail.css"></style>
