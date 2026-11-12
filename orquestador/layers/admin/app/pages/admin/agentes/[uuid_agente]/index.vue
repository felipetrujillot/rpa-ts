<script setup lang="ts">
documentTitle("Detalle del Agente");

import {
  ArrowLeft,
  ArrowUpRight,
  Bot,
  Camera,
  ChevronDown,
  Clipboard,
  Clock3,
  Cpu,
  Expand,
  Link2,
  ListOrdered,
  Monitor,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  TriangleAlert,
  Unlink,
  Workflow,
  X,
} from "lucide-vue-next";
import type { AgentSystemMetrics } from "@rpa/contracts";
import { createScheduleDraft, describeSchedule, scheduleFromCron, scheduleToCron } from "~~/shared/schedule";

type AssignableFlow = {
  uuid_flujo: string;
  nombre: string;
  estado_publicacion: "draft" | "published" | "archived";
  version_publicada: number;
  updated_at: string;
};

type AgenteFlowAssignment = {
  uuid_agente_flujo: string;
  uuid_agente: string;
  uuid_flujo: string;
  uuid_flow_version: string | null;
  cron_expression: string | null;
  schedule_timezone: string;
  next_scheduled_at: string | null;
  scheduling_error: string | null;
  activo: number;
  created_at: string;
  updated_at: string;
  nombre_flujo: string;
  estado_publicacion: "draft" | "published" | "archived";
  version_publicada: number;
};

type AgenteScreenshot = {
  image_data_url: string;
  captured_at: string;
  received_at: string;
  width: number;
  height: number;
  source: string;
};

const { $trpc } = useNuxtApp();

const route = useRoute();

const uuid_agente = route.params.uuid_agente as string;

const { status, data, refresh } = $trpc.agentes.getAgenteById.useQuery({
  uuid_agente,
});

const {
  status: flowsStatus,
  data: flowsData,
  refresh: refreshFlows,
} = $trpc.agentes.getAssignableFlows.useQuery();

const {
  status: assignmentsStatus,
  data: assignmentsData,
  refresh: refreshAssignments,
} = $trpc.agentes.getAgenteFlowAssignments.useQuery({
  uuid_agente,
});

const {
  status: screenshotStatus,
  data: screenshotData,
  refresh: refreshScreenshot,
} = $trpc.agentes.getAgenteLatestScreenshot.useQuery({
  uuid_agente,
});
const {
  data: systemMetricsData,
  refresh: refreshSystemMetrics,
} = $trpc.agentes.getAgenteSystemMetrics.useQuery({ uuid_agente });

const { data: pluginData, refresh: refreshPlugins } = $trpc.agentes.getAgentePlugins.useQuery({ uuid_agente });
const pluginInventoryClock = ref(Date.now());
const pluginInventory = computed(() => {
  const inventory = pluginData.value;
  return inventory && pluginInventoryClock.value - Date.parse(inventory.sampledAt) <= 30000 ? inventory : null;
});

const {
  status: executionStatus,
  data: executionState,
  refresh: refreshExecutionState,
} = $trpc.agentes.getAgenteExecutionState.useQuery({ uuid_agente });
const {
  status: queueStatus,
  data: queueData,
  refresh: refreshQueue,
} = $trpc.agentes.getAgenteFlowQueue.useQuery({ uuid_agente, limit: 80 });
const queue = computed(() => queueData.value ?? []);
const activeTab = ref("operacion");
const assignmentDialogOpen = ref(false);
const scheduleDialogOpen = ref(false);
const removeAssignmentDialogOpen = ref(false);
const captureDialogOpen = ref(false);
const revokeDialogOpen = ref(false);
const stateLabels: Record<string, string> = {
  pendiente: "Pendiente de vinculación",
  online: "En línea",
  offline: "Sin conexión",
  ejecutando: "Ejecutando",
  desconectado: "Desconectado",
  desvinculado: "Desvinculado",
  revocado: "Acceso revocado",
};
const canPair = computed(() =>
  ["desvinculado", "pendiente", "revocado"].includes(
    agente.value?.estado || "",
  ),
);
const equipment = computed(() => [
  { label: "Host", value: agente.value?.hostname },
  {
    label: "Sistema operativo",
    value: [
      agente.value?.sistema_operativo,
      agente.value?.sistema_operativo_version,
    ]
      .filter(Boolean)
      .join(" "),
  },
  { label: "Arquitectura", value: agente.value?.arquitectura },
  { label: "Procesador", value: agente.value?.cpu },
  { label: "Núcleos", value: agente.value?.cpu_nucleos },
  {
    label: "Memoria total",
    value: agente.value?.memoria_total
      ? `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(agente.value.memoria_total / 1024 ** 3)} GB`
      : null,
  },
  { label: "Versión de Electron", value: agente.value?.version_electron },
]);
const refreshOperation = async () => {
  await Promise.all([refreshQueue(), refreshExecutionState()]);
};
const reviewedExecution = ref(false);
watch(
  () => executionState.value?.uuid_flow_run,
  () => {
    reviewedExecution.value = false;
  },
);
const releasingReservation = ref(false);
const releaseReservation = async () => {
  const runId = executionState.value?.uuid_flow_run;
  if (!runId || !reviewedExecution.value || releasingReservation.value) return;
  releasingReservation.value = true;
  try {
    await $trpc.agentes.releaseAgenteReservation.mutate({
      uuid_agente,
      uuid_flow_run: runId,
      confirmed_stopped_and_reviewed: true,
    });
    reviewedExecution.value = false;
    await refreshOperation();
    await toast("success", "Reserva liberada. La cola puede continuar.");
  } catch (error) {
    await toast("error", (error as Error).message);
  } finally {
    releasingReservation.value = false;
  }
};

const isRefreshing = ref(false);
const isAssigningFlow = ref(false);
const isUpdatingSchedule = ref(false);
const isRemovingAssignment = ref(false);
const isRegeneratingCode = ref(false);
const isRevoking = ref(false);
const revocarAgente = async () => {
  if (isRevoking.value) return;
  isRevoking.value = true;
  try {
    await $trpc.agentes.revocarAgente.mutate({ uuid_agente });
    await refresh();
    revokeDialogOpen.value = false;
    await toast("success", "Acceso del equipo revocado.");
  } catch (error) {
    await toast("error", (error as Error).message);
  } finally {
    isRevoking.value = false;
  }
};
const isRequestingScreenshot = ref(false);
const hasRequestedScreenshotOnOpen = ref(false);
const executingAssignmentId = ref<string | null>(null);

const assignForm = ref({
  uuid_flujo: "",
  schedule: createScheduleDraft(),
});
const assignScheduleValid = ref(true);
const editScheduleValid = ref(true);
const editingAssignment = ref<AgenteFlowAssignment | null>(null);
const scheduleForm = ref(createScheduleDraft());
const assignmentToRemove = ref<AgenteFlowAssignment | null>(null);

const agente = computed(() => data.value?.[0] ?? null);
const assignableFlows = computed<AssignableFlow[]>(
  () => (flowsData.value ?? []) as AssignableFlow[],
);
const assignments = computed<AgenteFlowAssignment[]>(
  () => (assignmentsData.value ?? []) as AgenteFlowAssignment[],
);
const activeAssignmentCount = computed(
  () => assignments.value.filter((item) => item.activo === 1).length,
);
const {
  search: assignmentSearch,
  status: assignmentState,
  filtered: filteredAssignments,
} = useAdminTable(assignments, {
  search: (item) => [item.nombre_flujo, item.uuid_flujo, item.cron_expression, describeSchedule(item.cron_expression)],
  status: (item) => String(item.activo),
});
assignmentState.value = "1";
const assignmentStateOptions = [
  { value: "1", label: "Activa" },
  { value: "0", label: "Inactiva" },
];
const latestScreenshot = computed<AgenteScreenshot | null>(
  () => (screenshotData.value as AgenteScreenshot | null) ?? null,
);
const latestSystemMetrics = computed<AgentSystemMetrics | null>(
  () => (systemMetricsData.value as AgentSystemMetrics | null) ?? null,
);
const formatSystemBytes = (bytes: number | null) => {
  if (bytes === null) return "No disponible";
  return `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(bytes / 1024 ** 3)} GB`;
};
const formatPercent = (percent: number) =>
  `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(percent)}%`;
const systemMetricCards = computed(() => {
  const metrics = latestSystemMetrics.value;
  const usagePercent = (used: number, total: number) =>
    total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : null;
  const card = (
    label: string,
    percent: number | null,
    detail: string,
    unavailableValue = "No disponible",
  ) => ({
    label,
    percent,
    value: percent === null ? unavailableValue : formatPercent(percent),
    detail,
    tone:
      percent !== null && percent >= 90
        ? "is-critical"
        : percent !== null && percent >= 75
          ? "is-warning"
          : "",
  });

  return [
    card(
      "CPU",
      metrics?.cpu_usage_percent ?? null,
      !metrics
        ? "Esperando datos del agente"
        : metrics.cpu_usage_percent === null
          ? "Calculando con la próxima muestra"
          : "Uso total del procesador",
      metrics ? "Midiendo…" : "Sin datos",
    ),
    card(
      "RAM",
      metrics
        ? usagePercent(metrics.memory_used_bytes, metrics.memory_total_bytes)
        : null,
      metrics
        ? `${formatSystemBytes(metrics.memory_used_bytes)} de ${formatSystemBytes(metrics.memory_total_bytes)}`
        : "Esperando datos del agente",
      "Sin datos",
    ),
    card(
      "Disco del sistema",
      metrics?.storage_used_bytes != null &&
        metrics.storage_total_bytes != null
        ? usagePercent(metrics.storage_used_bytes, metrics.storage_total_bytes)
        : null,
      metrics?.storage_total_bytes
        ? `${formatSystemBytes(metrics.storage_available_bytes)} disponibles de ${formatSystemBytes(metrics.storage_total_bytes)}`
        : "El sistema no informó el almacenamiento",
      "No disponible",
    ),
  ];
});

const copyCodigoVinculacion = async () => {
  const codigo = agente.value?.codigo_vinculacion;

  if (!codigo) {
    return toast("warning", "Este agente no tiene código de vinculación");
  }

  try {
    await navigator.clipboard.writeText(codigo);
    await toast("success", "Código copiado al portapapeles");
  } catch {
    await toast("error", "No se pudo copiar el código");
  }
};

const actualizarAgente = async () => {
  if (isRefreshing.value) {
    return;
  }

  isRefreshing.value = true;
  try {
    await Promise.all([
      refresh(),
      refreshFlows(),
      refreshAssignments(),
      refreshScreenshot(),
      refreshSystemMetrics(),
      refreshExecutionState(),
      refreshQueue(),
    ]);
  } finally {
    isRefreshing.value = false;
  }
};

const solicitarScreenshotAgente = async () => {
  if (isRequestingScreenshot.value) {
    return;
  }

  if (agente.value?.estado !== "online") {
    return;
  }

  isRequestingScreenshot.value = true;
  try {
    await $trpc.agentes.requestAgenteScreenshot.mutate({
      uuid_agente,
      source: "admin-agente-detail",
    });

    const retries = [600, 1200, 2000];
    for (const delayMs of retries) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      await refreshScreenshot();
      if (latestScreenshot.value?.image_data_url) {
        break;
      }
    }
  } catch (error) {
    await toast(
      "warning",
      (error as Error).message || "No se pudo solicitar screenshot del agente.",
    );
  } finally {
    isRequestingScreenshot.value = false;
  }
};

// Request captures after hydration so the first client render matches the server.
let systemMetricsTimer: number | null = null;
watch(activeTab, (tab) => {
  if (tab === "equipo") { void refreshSystemMetrics(); void refreshPlugins(); }
});
onBeforeUnmount(() => {
  if (systemMetricsTimer !== null) window.clearInterval(systemMetricsTimer);
});

onMounted(() => {
  systemMetricsTimer = window.setInterval(() => {
    pluginInventoryClock.value = Date.now();
    if (activeTab.value === "equipo") void refreshPlugins();
    if (activeTab.value === "equipo" && ["online", "ejecutando"].includes(agente.value?.estado ?? "")) {
      void refreshSystemMetrics();
    }
  }, 10_000);

  watch(
    () => status.value,
    async (currentStatus) => {
      if (currentStatus !== "success") {
        return;
      }

      if (hasRequestedScreenshotOnOpen.value) {
        return;
      }

      if (agente.value?.estado !== "online") {
        return;
      }

      hasRequestedScreenshotOnOpen.value = true;
      await solicitarScreenshotAgente();
    },
    { immediate: true },
  );
});

const regenerarCodigoVinculacion = async () => {
  if (isRegeneratingCode.value || !agente.value?.uuid_agente) {
    return;
  }

  isRegeneratingCode.value = true;

  try {
    await $trpc.agentes.regenerarCodigoVinculacion.mutate({
      uuid_agente: agente.value.uuid_agente,
    });

    await toast(
      "success",
      "Nuevo código generado. El estado volvió a pendiente.",
    );
    await refresh();
  } catch (error) {
    await toast(
      "error",
      (error as Error).message || "No se pudo regenerar el código.",
    );
  } finally {
    isRegeneratingCode.value = false;
  }
};

const formatDate = (iso: string | null) => {
  if (!iso) {
    return "-";
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const addFlowToAgente = async () => {
  if (isAssigningFlow.value || !assignScheduleValid.value) {
    return;
  }

  if (!assignForm.value.uuid_flujo) {
    await toast("warning", "Debes seleccionar un flujo publicado.");
    return;
  }

  isAssigningFlow.value = true;
  try {
    await $trpc.agentes.assignFlowToAgente.mutate({
      uuid_agente,
      uuid_flujo: assignForm.value.uuid_flujo,
      cron_expression: scheduleToCron(assignForm.value.schedule) || undefined,
      schedule_timezone: assignForm.value.schedule.timezone,
    });

    await toast("success", "Flujo asignado al agente correctamente.");
    assignForm.value = { uuid_flujo: "", schedule: createScheduleDraft() };
    assignmentDialogOpen.value = false;
    await refreshAssignments();
  } catch (error) {
    await toast(
      "error",
      (error as Error).message || "No se pudo asignar el flujo.",
    );
  } finally {
    isAssigningFlow.value = false;
  }
};

const openScheduleEditor = (assignment: AgenteFlowAssignment) => {
  editingAssignment.value = assignment;
  scheduleForm.value = scheduleFromCron(assignment.cron_expression, assignment.schedule_timezone);
  scheduleDialogOpen.value = true;
};

const saveSchedule = async () => {
  if (!editingAssignment.value || isUpdatingSchedule.value || !editScheduleValid.value) return;
  isUpdatingSchedule.value = true;
  try {
    await $trpc.agentes.updateAgenteFlowAssignment.mutate({
      uuid_agente_flujo: editingAssignment.value.uuid_agente_flujo,
      cron_expression: scheduleToCron(scheduleForm.value),
      schedule_timezone: scheduleForm.value.timezone,
    });
    scheduleDialogOpen.value = false;
    editingAssignment.value = null;
    await refreshAssignments();
    await toast("success", "Programación actualizada correctamente.");
  } catch (error) {
    await toast(
      "error",
      (error as Error).message || "No se pudo actualizar la programación.",
    );
  } finally {
    isUpdatingSchedule.value = false;
  }
};

const confirmRemoveAssignment = (assignment: AgenteFlowAssignment) => {
  assignmentToRemove.value = assignment;
  removeAssignmentDialogOpen.value = true;
};

const removeAssignment = async () => {
  if (!assignmentToRemove.value || isRemovingAssignment.value) return;
  isRemovingAssignment.value = true;
  try {
    await $trpc.agentes.removeAgenteFlowAssignment.mutate({
      uuid_agente_flujo: assignmentToRemove.value.uuid_agente_flujo,
    });
    removeAssignmentDialogOpen.value = false;
    assignmentToRemove.value = null;
    await refreshAssignments();
    await toast("success", "Flujo desasignado del agente.");
  } catch (error) {
    await toast(
      "error",
      (error as Error).message || "No se pudo desasignar el flujo.",
    );
  } finally {
    isRemovingAssignment.value = false;
  }
};

const ejecutarAsignacion = async (uuid_agente_flujo: string) => {
  if (executingAssignmentId.value) {
    return;
  }

  executingAssignmentId.value = uuid_agente_flujo;
  try {
    await $trpc.agentes.executeAgenteFlowAssignment.mutate({
      uuid_agente_flujo,
    });

    await toast("success", "Ejecución encolada correctamente para el agente.");
    await refreshOperation();
  } catch (error) {
    await toast(
      "error",
      (error as Error).message || "No se pudo ejecutar la asignación.",
    );
  } finally {
    executingAssignmentId.value = null;
  }
};

const goToFlowRunsDetail = async (uuid_flujo: string) => {
  await navigateTo(`/admin/agentes/${uuid_agente}/flujos/${uuid_flujo}`);
};
</script>

<template>
  <div class="agent-detail admin-page">
    <NuxtLink to="/admin/agentes" class="agent-back"
      ><ArrowLeft :size="15" />Todos los agentes</NuxtLink
    >
    <header class="admin-page-heading agent-heading">
      <div class="agent-identity">
        <span class="agent-avatar"><Bot :size="29" :stroke-width="1.5" /></span>
        <div>
          <div class="agent-title-line">
            <h1>{{ agente?.nombre || "Detalle del agente" }}</h1>
            <span
              v-if="agente"
              class="admin-state"
              :data-state="agente.estado"
              >{{ stateLabels[agente.estado] || agente.estado }}</span
            >
          </div>
          <p>
            {{ agente?.hostname || "Equipo sin vincular"
            }}<span
              v-if="agente?.sistema_operativo"
              class="agent-title-system"
              >{{ agente.sistema_operativo }}</span
            >
          </p>
        </div>
      </div>
      <Button
        variant="outline"
        :disabled="isRefreshing || status === 'pending'"
        @click="actualizarAgente"
        ><RefreshCw
          :size="15"
          class="mr-2"
          :class="{ 'animate-spin': isRefreshing }"
        />{{ isRefreshing ? "Actualizando…" : "Actualizar" }}</Button
      >
    </header>

    <div
      v-if="status === 'pending'"
      class="agent-panel admin-load-state"
      role="status"
    >
      Cargando información del agente…
    </div>
    <div
      v-else-if="status === 'error'"
      class="agent-panel agent-error"
      role="alert"
    >
      <TriangleAlert :size="22" />
      <div>
        <strong>No se pudo cargar el agente</strong>
        <p>Selecciona Actualizar para volver a intentarlo.</p>
      </div>
    </div>
    <div
      v-else-if="status === 'success' && !agente"
      class="agent-panel admin-empty"
    >
      <strong>No encontramos este agente</strong>Vuelve al listado para
      seleccionar otro equipo.
    </div>

    <template v-else-if="agente">
      <dl class="agent-connection-strip">
        <div>
          <dt><Clock3 :size="15" />Última conexión</dt>
          <dd>{{ formatDate(agente.ultimo_ping) }}</dd>
        </div>
        <div>
          <dt><Workflow :size="15" />Flujos asignados</dt>
          <dd>
            {{
              assignmentsStatus === "success"
                ? assignments.length
                : "Sin consultar"
            }}<span v-if="assignmentsStatus === 'success'"
              >{{ activeAssignmentCount }}
              {{ activeAssignmentCount === 1 ? "activo" : "activos" }}</span
            >
          </dd>
        </div>
        <div>
          <dt><ListOrdered :size="15" />En cola</dt>
          <dd>
            {{
              queueStatus === "success"
                ? queue.length === 80
                  ? "80 o más"
                  : queue.length
                : "Sin consultar"
            }}<span v-if="queueStatus === 'success'">{{
              queue.length ? "pendientes de ejecución" : "sin pendientes"
            }}</span>
          </dd>
        </div>
      </dl>

      <section
        v-if="executionState?.requires_reconciliation"
        class="agent-notice agent-notice-warning"
        role="alert"
        aria-labelledby="reconciliation-title"
      >
        <TriangleAlert :size="22" class="shrink-0" />
        <div>
          <h2 id="reconciliation-title">La cola necesita una revisión</h2>
          <p>
            Una ejecución se interrumpió y la cola está bloqueada para evitar
            repetir sus efectos. Comprueba que el robot se detuvo y revisa el
            resultado antes de liberar la reserva.
          </p>
          <details class="agent-run-reference">
            <summary>Ver ejecución afectada</summary>
            <code>{{ executionState.uuid_flow_run }}</code>
          </details>
          <label class="agent-review-check"
            ><input v-model="reviewedExecution" type="checkbox" />Comprobé que
            la ejecución se detuvo y revisé sus efectos.</label
          ><Button
            variant="outline"
            :disabled="!reviewedExecution || releasingReservation"
            @click="releaseReservation"
            >{{
              releasingReservation ? "Liberando…" : "Liberar reserva revisada"
            }}</Button
          >
          <p class="agent-help">
            Disponible después de vencer la reserva y su margen de seguridad.
          </p>
        </div>
      </section>

      <section
        v-if="agente.estado === 'pendiente'"
        class="agent-pair-notice"
        aria-labelledby="pair-notice-title"
      >
        <span class="agent-pair-icon"><Link2 :size="23" /></span>
        <div>
          <h2 id="pair-notice-title">Conecta este equipo para comenzar</h2>
          <p>Ingresa el código de vinculación en el cliente del agente.</p>
        </div>
        <Button variant="outline" @click="activeTab = 'equipo'"
          >Ver código de vinculación<ArrowUpRight :size="15" class="ml-2"
        /></Button>
      </section>

      <Tabs v-model="activeTab" class="agent-tabs">
        <TabsList class="agent-tab-list" aria-label="Secciones del agente"
          ><TabsTrigger class="agent-tab" value="operacion"
            ><Workflow :size="16" />Operación</TabsTrigger
          ><TabsTrigger class="agent-tab" value="equipo"
            ><Monitor :size="16" />Equipo y acceso</TabsTrigger
          ></TabsList
        >
        <TabsContent value="operacion" class="agent-tab-content">
          <div class="agent-operation-grid">
            <section
              class="admin-collection agent-flows"
              aria-labelledby="assigned-title"
            >
              <div class="agent-section-heading">
                <div>
                  <h2 id="assigned-title">
                    Flujos asignados<span class="admin-total">{{
                      assignments.length
                    }}</span>
                  </h2>
                  <p>Ejecuta un flujo o revisa su historial.</p>
                </div>
                <Button size="sm" @click="assignmentDialogOpen = true"
                  ><Plus :size="16" class="mr-1" />Asignar flujo</Button
                >
              </div>
              <AdminTableFilters
                v-model:search="assignmentSearch"
                v-model:status="assignmentState"
                placeholder="Buscar flujo o programación"
                :status-options="assignmentStateOptions"
                :count="filteredAssignments.length"
                :total="assignments.length"
              />
              <div
                v-if="assignmentsStatus === 'pending'"
                class="admin-load-state"
                role="status"
              >
                Cargando flujos asignados…
              </div>
              <div
                v-else-if="assignmentsStatus === 'error'"
                class="admin-error"
                role="alert"
              >
                No se pudieron cargar los flujos. Actualiza el agente para
                volver a intentarlo.
              </div>
              <Table v-else>
                <TableHeader
                  ><TableRow
                    ><TableHead>Flujo</TableHead
                    ><TableHead>Programación</TableHead
                    ><TableHead>Estado</TableHead
                    ><TableHead class="text-right"
                      >Acciones</TableHead
                    ></TableRow
                  ></TableHeader
                >
                <TableBody>
                  <TableRow
                    v-for="item in filteredAssignments"
                    :key="item.uuid_agente_flujo"
                    class="agent-flow-row"
                  >
                    <TableCell class="agent-flow-cell"
                      ><NuxtLink
                        :to="`/admin/agentes/${uuid_agente}/flujos/${item.uuid_flujo}`"
                        class="agent-flow-name"
                        >{{ item.nombre_flujo }}</NuxtLink
                      ><span class="admin-record-id"
                        >Versión
                        {{ item.version_publicada || "sin publicar" }}</span
                      ></TableCell
                    >
                    <TableCell class="agent-schedule-cell"
                      ><span class="agent-schedule"
                        ><Clock3 :size="13" /><span>{{ describeSchedule(item.cron_expression, item.schedule_timezone) }}</span></span>
                        <span v-if="item.cron_expression" class="admin-record-id">{{ item.schedule_timezone }}</span>
                        <span v-if="item.scheduling_error" class="agent-inline-error" role="status">{{ item.scheduling_error }}</span>
                      </TableCell
                    >
                    <TableCell class="agent-state-cell"
                      ><span
                        class="admin-state"
                        :data-state="item.activo === 1 ? 'online' : 'offline'"
                        >{{ item.activo === 1 ? "Activo" : "Inactivo" }}</span
                      ></TableCell
                    >
                    <TableCell class="text-right agent-actions-cell"
                      ><div class="agent-flow-actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          @click="goToFlowRunsDetail(item.uuid_flujo)"
                          >Historial<ArrowUpRight
                            :size="14"
                            class="ml-1" /></Button
                        ><Button
                          variant="outline"
                          size="sm"
                          :disabled="
                            item.activo !== 1 || executingAssignmentId !== null
                          "
                          @click="ejecutarAsignacion(item.uuid_agente_flujo)"
                          ><Play :size="13" class="mr-1" />{{
                            executingAssignmentId === item.uuid_agente_flujo
                              ? "Encolando…"
                              : "Ejecutar"
                          }}</Button
                        ><Button
                          variant="ghost"
                          size="sm"
                          :disabled="isUpdatingSchedule"
                          @click="openScheduleEditor(item)"
                          ><Pencil :size="13" class="mr-1" />Editar</Button
                        ><Button
                          v-if="item.activo === 1"
                          variant="ghost"
                          size="sm"
                          class="agent-unassign-action"
                          :disabled="isRemovingAssignment"
                          @click="confirmRemoveAssignment(item)"
                          ><Unlink :size="13" class="mr-1" />Desasignar</Button
                        >
                      </div></TableCell
                    >
                  </TableRow>
                  <TableEmpty v-if="!filteredAssignments.length" :colspan="4"
                    ><div class="admin-empty">
                      <Workflow
                        :size="26"
                        class="mx-auto mb-3 text-primary"
                        :stroke-width="1.5"
                      /><strong>{{
                        activeAssignmentCount
                          ? "No hay flujos que coincidan"
                          : "Asigna el primer flujo"
                      }}</strong
                      >{{
                        activeAssignmentCount
                          ? "Prueba otra búsqueda o limpia los filtros."
                          : "Selecciona un flujo publicado para que este agente pueda ejecutarlo."
                      }}<Button
                        v-if="!activeAssignmentCount"
                        variant="outline"
                        size="sm"
                        class="mt-5"
                        @click="assignmentDialogOpen = true"
                        ><Plus :size="15" class="mr-1" />Asignar flujo</Button
                      >
                    </div></TableEmpty
                  >
                </TableBody>
              </Table>
            </section>

            <aside
              class="agent-operation-rail"
              aria-label="Supervisión del agente"
            >
              <section class="agent-panel" aria-labelledby="capture-title">
                <div class="agent-section-heading">
                  <div>
                    <h2 id="capture-title">
                      <Monitor :size="17" />Última captura
                    </h2>
                    <p>Una imagen del escritorio del agente.</p>
                  </div>
                </div>
                <button
                  v-if="latestScreenshot?.image_data_url"
                  class="agent-capture-preview"
                  type="button"
                  aria-label="Ampliar captura del agente"
                  @click="captureDialogOpen = true"
                >
                  <img
                    :src="latestScreenshot.image_data_url"
                    :alt="`Última captura de ${agente.nombre}`"
                  /><span><Expand :size="14" />Ampliar captura</span>
                </button>
                <div v-else class="agent-capture-empty">
                  <Monitor :size="32" :stroke-width="1.2" /><strong>{{
                    screenshotStatus === "pending"
                      ? "Cargando captura…"
                      : screenshotStatus === "error"
                        ? "No se pudo cargar la captura"
                        : "Todavía no hay una captura"
                  }}</strong>
                  <p>
                    {{
                      screenshotStatus === "error"
                        ? "Actualiza el agente para volver a intentarlo."
                        : "La captura aparecerá cuando el equipo la envíe."
                    }}
                  </p>
                </div>
                <div class="agent-capture-footer">
                  <p v-if="latestScreenshot">
                    {{ formatDate(latestScreenshot.captured_at) }}
                  </p>
                  <p v-else>Se solicita al abrir si el agente está en línea.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="
                      isRequestingScreenshot || agente.estado !== 'online'
                    "
                    @click="solicitarScreenshotAgente"
                    ><Camera :size="15" class="mr-1" />{{
                      isRequestingScreenshot
                        ? "Solicitando…"
                        : "Solicitar captura"
                    }}</Button
                  >
                  <p v-if="agente.estado !== 'online'" class="agent-help">
                    El agente debe estar en línea para solicitar una nueva
                    captura.
                  </p>
                </div>
              </section>

              <section class="agent-panel" aria-labelledby="queue-title">
                <div class="agent-section-heading">
                  <div>
                    <h2 id="queue-title">
                      <ListOrdered :size="17" />Cola de ejecuciones
                    </h2>
                    <p>Las pendientes esperan su turno.</p>
                  </div>
                </div>
                <div class="agent-queue-body">
                  <p
                    v-if="queueStatus === 'pending'"
                    class="agent-help"
                    role="status"
                  >
                    Consultando cola…
                  </p>
                  <p
                    v-else-if="queueStatus === 'error'"
                    class="agent-inline-error"
                    role="alert"
                  >
                    No se pudo consultar la cola. Actualiza el agente para
                    reintentar.
                  </p>
                  <ol v-else-if="queue.length" class="agent-queue-list">
                    <li
                      v-for="(run, index) in queue.slice(0, 3)"
                      :key="run.uuid_flow_run"
                    >
                      <span>{{ index + 1 }}</span
                      ><NuxtLink
                        :to="`/admin/agentes/${uuid_agente}/flujos/${run.uuid_flujo}`"
                        >{{ run.nombre_flujo }}<ArrowUpRight :size="13"
                      /></NuxtLink>
                    </li>
                  </ol>
                  <p v-else class="agent-queue-empty">
                    <ShieldCheck :size="19" />No hay ejecuciones pendientes.
                  </p>
                  <p v-if="queue.length > 3" class="agent-help mt-3">
                    {{
                      queue.length === 80
                        ? "Se muestran las primeras 3 de 80 o más pendientes."
                        : `Hay ${queue.length - 3} ejecuciones pendientes más.`
                    }}
                  </p>
                  <p
                    v-if="executionStatus === 'error'"
                    class="agent-inline-error mt-3"
                    role="alert"
                  >
                    No se pudo consultar la reserva de ejecución.
                  </p>
                  <details
                    v-else-if="executionState?.uuid_flow_run"
                    class="agent-reservation"
                  >
                    <summary>
                      <span class="agent-reservation-dot"></span
                      >{{
                        executionState.requires_reconciliation
                          ? "Reserva pendiente de revisión"
                          : "Hay una ejecución reservada"
                      }}<ChevronDown :size="14" />
                    </summary>
                    <p>Identificador de ejecución</p>
                    <code>{{ executionState.uuid_flow_run }}</code>
                  </details>
                </div>
                <details class="agent-queue-management">
                  <summary>Gestionar cola<ChevronDown :size="15" /></summary>
                  <div>
                    <p>
                      Cancela las ejecuciones pendientes de este agente. La
                      ejecución en curso continúa y el historial se conserva.
                    </p>
                    <AgentQueueClearButton
                      :uuid-agente="uuid_agente"
                      @cleared="refreshOperation"
                    />
                  </div>
                </details>
              </section>
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="equipo" class="agent-tab-content">
          <div class="agent-equipment-grid">
            <section class="agent-panel" aria-labelledby="equipment-title">
              <div class="agent-section-heading">
                <div>
                  <h2 id="equipment-title">
                    <Cpu :size="18" />Información del equipo
                  </h2>
                  <p>Datos informados por el cliente del agente.</p>
                </div>
              </div>
              <section class="agent-system-metrics" aria-labelledby="plugins-title">
                <h3 id="plugins-title">Plugins del robot</h3>
                <p v-if="!pluginInventory">Estado desconocido: esperando inventario actualizado del robot.</p>
                <dl v-else class="agent-equipment-data">
                  <div v-for="plugin in pluginInventory.plugins" :key="plugin.pluginId">
                    <dt>{{ plugin.pluginId }} · {{ plugin.packageVersion }}</dt>
                    <dd>{{ plugin.available ? 'Disponible' : (plugin.reason || 'No disponible') }} · {{ plugin.platform }}</dd>
                    <dd v-if="plugin.appVersion">Aplicación {{ plugin.appVersion }}</dd>
                    <dd v-if="plugin.state === 'permissions-pending'">Permisos de automatización pendientes de comprobar al ejecutar.</dd>
                    <dd>SDK {{ plugin.sdkVersion }} · {{ plugin.verified ? 'Validado' : 'Validación de escritorio pendiente' }}</dd>
                    <dd>{{ plugin.capabilities.join(', ') }}</dd>
                    <dd>Permisos: {{ plugin.permissions.join(', ') }}</dd>
                  </div>
                  <div><dt>Actualizado</dt><dd>{{ formatDate(pluginInventory.sampledAt) }}</dd></div>
                </dl>
              </section>
              <dl class="agent-equipment-data">
                <div v-for="field in equipment" :key="field.label">
                  <dt>{{ field.label }}</dt>
                  <dd>
                    {{
                      field.value === "" || field.value == null
                        ? "Sin informar"
                        : field.value
                    }}
                  </dd>
                </div>
                <div>
                  <dt>Registrado el</dt>
                  <dd>{{ formatDate(agente.created_at) }}</dd>
                </div>
                <div class="agent-equipment-uuid">
                  <dt>Identificador del agente</dt>
                  <dd>{{ agente.uuid_agente }}</dd>
                </div>
              </dl>
              <section
                class="agent-system-metrics"
                aria-labelledby="system-metrics-title"
              >
                <div class="agent-system-metrics-heading">
                  <div>
                    <h3 id="system-metrics-title">Uso actual de recursos</h3>
                    <p>Lectura del sistema, actualizada cada 10 segundos.</p>
                  </div>
                </div>
                <div class="agent-system-metrics-grid">
                  <article
                    v-for="metric in systemMetricCards"
                    :key="metric.label"
                    class="agent-system-metric"
                  >
                    <div class="agent-system-metric-heading">
                      <span>{{ metric.label }}</span>
                      <strong>{{ metric.value }}</strong>
                    </div>
                    <div
                      class="agent-system-metric-track"
                      role="progressbar"
                      :aria-label="`${metric.label}: ${metric.value}`"
                      aria-valuemin="0"
                      aria-valuemax="100"
                      :aria-valuenow="metric.percent ?? undefined"
                    >
                      <span
                        :class="metric.tone"
                        :style="{ width: `${metric.percent ?? 0}%` }"
                      ></span>
                    </div>
                    <p>{{ metric.detail }}</p>
                  </article>
                </div>
                <p class="agent-system-metrics-updated">
                  {{
                    latestSystemMetrics
                      ? `Última lectura: ${formatDate(latestSystemMetrics.sampled_at)}`
                      : "La lectura aparecerá cuando el agente reporte sus métricas."
                  }}
                </p>
              </section>
            </section>
            <div class="agent-access-column">
              <AgentScriptPolicy :uuid-agente="uuid_agente" />
              <section class="agent-panel" aria-labelledby="access-title">
                <div class="agent-section-heading">
                  <div>
                    <h2 id="access-title">
                      <Link2 :size="18" />Vinculación y acceso
                    </h2>
                    <p>
                      {{
                        canPair
                          ? "Conecta el cliente con la plataforma."
                          : "Este equipo ya está vinculado."
                      }}
                    </p>
                  </div>
                </div>
                <div class="agent-access-body">
                  <template v-if="canPair">
                    <p>
                      Ingresa el código en el cliente del agente. Es de un solo
                      uso y vence a los 15 minutos.
                    </p>
                    <div
                      v-if="
                        agente.estado === 'pendiente' &&
                        agente.codigo_vinculacion
                      "
                      class="agent-pair-code"
                    >
                      <span>Código de vinculación</span>
                      <div>
                        <code>{{ agente.codigo_vinculacion }}</code
                        ><Button
                          variant="ghost"
                          size="icon"
                          aria-label="Copiar código de vinculación"
                          @click="copyCodigoVinculacion"
                          ><Clipboard :size="18"
                        /></Button>
                      </div>
                      <p v-if="agente.codigo_vinculacion_expira">
                        Vence:
                        {{ formatDate(agente.codigo_vinculacion_expira) }}
                      </p>
                    </div>
                    <p v-else class="agent-help">
                      Genera un nuevo código para volver a vincular el equipo.
                      Su estado cambiará a pendiente.
                    </p>
                    <Button
                      variant="outline"
                      :disabled="isRegeneratingCode"
                      @click="regenerarCodigoVinculacion"
                      ><RefreshCw :size="15" class="mr-2" />{{
                        isRegeneratingCode
                          ? "Generando…"
                          : "Generar nuevo código"
                      }}</Button
                    >
                  </template>
                  <div v-else class="agent-linked-status">
                    <ShieldCheck :size="24" />
                    <div>
                      <strong>Equipo vinculado</strong>
                      <p>No necesitas un código para operar este agente.</p>
                    </div>
                  </div>
                </div>
              </section>
              <section
                v-if="!canPair"
                class="agent-panel agent-danger-panel"
                aria-labelledby="revoke-title"
              >
                <div class="agent-access-body">
                  <h2 id="revoke-title">
                    <ShieldOff :size="18" />Revocar acceso
                  </h2>
                  <p>
                    Desconecta el equipo y retira su acceso a la plataforma.
                    Para volver a conectarlo, será necesario vincularlo con un
                    nuevo código.
                  </p>
                  <Button
                    variant="outline"
                    class="agent-danger-button"
                    :disabled="isRevoking"
                    @click="revokeDialogOpen = true"
                    >Revocar acceso del equipo</Button
                  >
                </div>
              </section>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog v-model:open="assignmentDialogOpen"
        ><DialogContent class="agent-dialog"
          ><DialogHeader
            ><DialogTitle>Asignar flujo</DialogTitle
            ><DialogDescription
              >Selecciona un flujo publicado y define cómo ejecutarlo en
              {{ agente.nombre }}.</DialogDescription
            ></DialogHeader
          ><DialogClose class="agent-dialog-close" aria-label="Cerrar"
            ><X :size="18"
          /></DialogClose>
          <form class="agent-assignment-form" @submit.prevent="addFlowToAgente">
            <div>
              <label for="assign-flow">Flujo publicado</label
              ><select
                id="assign-flow"
                v-model="assignForm.uuid_flujo"
                required
                :disabled="flowsStatus !== 'success' || isAssigningFlow"
              >
                <option value="">Selecciona un flujo</option>
                <option
                  v-for="flow in assignableFlows"
                  :key="flow.uuid_flujo"
                  :value="flow.uuid_flujo"
                >
                  {{ flow.nombre }} · v{{ flow.version_publicada }}
                </option>
              </select>
              <p
                v-if="flowsStatus === 'pending'"
                class="agent-help"
                role="status"
              >
                Cargando flujos publicados…
              </p>
              <p
                v-else-if="flowsStatus === 'error'"
                class="agent-inline-error"
                role="alert"
              >
                No se pudieron cargar los flujos. Cierra este formulario y
                actualiza el agente.
              </p>
              <p v-else-if="!assignableFlows.length" class="agent-help">
                No hay flujos disponibles.
                <NuxtLink
                  to="/admin/flujos"
                  @click="assignmentDialogOpen = false"
                  >Publica un flujo</NuxtLink
                >
                para poder asignarlo.
              </p>
            </div>
            <AssignmentScheduleEditor v-model="assignForm.schedule" id-prefix="assign" :disabled="isAssigningFlow" @validity-change="assignScheduleValid = $event" />
            <div class="agent-dialog-actions">
              <Button
                variant="outline"
                type="button"
                :disabled="isAssigningFlow"
                @click="assignmentDialogOpen = false"
                >Cancelar</Button
              ><Button
                type="submit"
                :disabled="
                  isAssigningFlow ||
                  !assignScheduleValid ||
                  !assignForm.uuid_flujo ||
                  flowsStatus !== 'success'
                "
                ><Plus :size="16" class="mr-1" />{{
                  isAssigningFlow ? "Asignando…" : "Asignar flujo"
                }}</Button
              >
            </div>
          </form></DialogContent
      ></Dialog
      >

      <Dialog v-model:open="scheduleDialogOpen"
        ><DialogContent class="agent-dialog"
          ><DialogHeader
            ><DialogTitle>Editar programación</DialogTitle
            ><DialogDescription
              >{{ editingAssignment?.nombre_flujo }} en {{ agente.nombre }}.
              Elige la frecuencia y la hora de ejecución.</DialogDescription
            ></DialogHeader
          ><DialogClose class="agent-dialog-close" aria-label="Cerrar"
            ><X :size="18"
          /></DialogClose>
          <form class="agent-assignment-form" @submit.prevent="saveSchedule">
            <AssignmentScheduleEditor v-model="scheduleForm" id-prefix="edit-schedule" :disabled="isUpdatingSchedule" @validity-change="editScheduleValid = $event" />
            <div class="agent-dialog-actions">
              <Button
                variant="outline"
                type="button"
                :disabled="isUpdatingSchedule"
                @click="scheduleDialogOpen = false"
                >Cancelar</Button
              ><Button type="submit" :disabled="isUpdatingSchedule || !editScheduleValid"
                >{{
                  isUpdatingSchedule ? "Guardando…" : "Guardar cambios"
                }}</Button
              >
            </div>
          </form></DialogContent
        ></Dialog
      >

      <Dialog v-model:open="removeAssignmentDialogOpen"
        ><DialogContent class="agent-dialog"
          ><DialogHeader
            ><DialogTitle>Desasignar flujo</DialogTitle
            ><DialogDescription
              >{{ assignmentToRemove?.nombre_flujo }} dejará de estar disponible
              para {{ agente.nombre }}. Se conservará su historial y podrás
              asignarlo de nuevo más adelante.</DialogDescription
            ></DialogHeader
          ><DialogClose class="agent-dialog-close" aria-label="Cerrar"
            ><X :size="18"
          /></DialogClose>
          <div class="agent-dialog-actions">
            <Button
              variant="outline"
              :disabled="isRemovingAssignment"
              @click="removeAssignmentDialogOpen = false"
              >Cancelar</Button
            ><Button
              variant="destructive"
              :disabled="isRemovingAssignment"
              @click="removeAssignment"
              >{{
                isRemovingAssignment ? "Desasignando…" : "Desasignar flujo"
              }}</Button
            >
          </div></DialogContent
        ></Dialog
      >

      <Dialog v-model:open="captureDialogOpen"
        ><DialogContent class="agent-dialog agent-capture-dialog"
          ><DialogHeader
            ><DialogTitle>Última captura de {{ agente.nombre }}</DialogTitle
            ><DialogDescription
              >{{
                latestScreenshot
                  ? formatDate(latestScreenshot.captured_at)
                  : "Sin captura disponible"
              }}. Es una imagen del escritorio, no una transmisión en
              vivo.</DialogDescription
            ></DialogHeader
          ><DialogClose class="agent-dialog-close" aria-label="Cerrar captura"
            ><X :size="18" /></DialogClose
          ><img
            v-if="latestScreenshot?.image_data_url"
            :src="latestScreenshot.image_data_url"
            :alt="`Captura ampliada de ${agente.nombre}`" /></DialogContent
      ></Dialog>

      <Dialog v-model:open="revokeDialogOpen"
        ><DialogContent class="agent-dialog"
          ><DialogHeader
            ><DialogTitle>Revocar acceso del equipo</DialogTitle
            ><DialogDescription
              >{{ agente.nombre }} se desconectará y su sesión dejará de ser
              válida. Tendrás que generar un nuevo código de vinculación para
              conectarlo otra vez.</DialogDescription
            ></DialogHeader
          ><DialogClose class="agent-dialog-close" aria-label="Cerrar"
            ><X :size="18"
          /></DialogClose>
          <div class="agent-dialog-actions">
            <Button
              variant="outline"
              :disabled="isRevoking"
              @click="revokeDialogOpen = false"
              >Cancelar</Button
            ><Button
              variant="destructive"
              :disabled="isRevoking"
              @click="revocarAgente"
              >{{ isRevoking ? "Revocando…" : "Revocar acceso" }}</Button
            >
          </div></DialogContent
        ></Dialog
      >
    </template>
  </div>
</template>

<style scoped src="../../../../assets/agent-detail.css"></style>
