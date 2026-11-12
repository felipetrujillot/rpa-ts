<script setup lang="ts">
documentTitle("Agentes");
import { Bot, Plus, RefreshCw, ArrowUpRight } from "lucide-vue-next";

const { $trpc } = useNuxtApp();

type AgenteListItem = {
  uuid_agente: string;
  nombre: string;
  estado:
    | "pendiente"
    | "online"
    | "offline"
    | "ejecutando"
    | "desconectado"
    | "revocado";
  hostname: string | null;
  sistema_operativo: string | null;
  ultimo_ping: string | null;
  updated_at: string;
};

const {
  status: agentesStatus,
  data: agentesData,
  refresh: refreshAgentes,
} = $trpc.agentes.getAgentes.useQuery();

const agentes = computed<AgenteListItem[]>(
  () => (agentesData.value ?? []) as AgenteListItem[],
);

const {
  search,
  status: stateFilter,
  secondary: systemFilter,
  filtered: filteredAgentes,
} = useAdminTable(agentes, {
  search: (item) => [
    item.nombre,
    item.uuid_agente,
    item.hostname,
    item.sistema_operativo,
  ],
  status: (item) => item.estado,
  secondary: (item) => item.sistema_operativo || "",
});
const stateLabels: Record<string, string> = {
  pendiente: "Pendiente",
  online: "En línea",
  offline: "Sin conexión",
  ejecutando: "Ejecutando",
  desconectado: "Desconectado",
  revocado: "Revocado",
};
const stateOptions = Object.entries(stateLabels).map(([value, label]) => ({
  value,
  label,
}));
const systemOptions = computed(() =>
  [
    ...new Set(
      agentes.value
        .map((item) => item.sistema_operativo)
        .filter((value): value is string => Boolean(value)),
    ),
  ]
    .sort()
    .map((value) => ({ value, label: value })),
);

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
</script>

<template>
  <div class="admin-page">
    <div class="admin-page-heading">
      <div>
        <h1>Agentes</h1>
        <p>
          Conecta tus equipos y supervisa la operación de tus automatizaciones.
        </p>
      </div>
      <div class="admin-page-actions">
        <Button
          variant="outline"
          :disabled="agentesStatus === 'pending'"
          @click="refreshAgentes"
          ><RefreshCw
            :size="15"
            :class="{ 'animate-spin': agentesStatus === 'pending' }"
            class="mr-2"
          />Actualizar</Button
        >
        <Button as-child
          ><NuxtLink to="/admin/agentes/nuevo-agente"
            ><Plus :size="17" class="mr-2" />Nuevo agente</NuxtLink
          ></Button
        >
      </div>
    </div>
    <section class="admin-collection" aria-labelledby="agents-title">
      <div class="admin-collection-heading">
        <h2 id="agents-title">Agentes registrados</h2>
        <span class="admin-total">{{ agentes.length }}</span>
      </div>
      <AdminTableFilters
        v-model:search="search"
        v-model:status="stateFilter"
        v-model:secondary="systemFilter"
        placeholder="Buscar por nombre, host o UUID"
        :status-options="stateOptions"
        :secondary-options="systemOptions"
        secondary-label="Todos los sistemas"
        :count="filteredAgentes.length"
        :total="agentes.length"
      />
      <div
        v-if="agentesStatus === 'pending'"
        class="admin-load-state"
        role="status"
      >
        Cargando agentes…
      </div>
      <div
        v-else-if="agentesStatus === 'error'"
        class="admin-error"
        role="alert"
      >
        No se pudieron cargar los agentes. Usa Actualizar para volver a
        intentarlo.
      </div>
      <Table v-else>
        <TableHeader
          ><TableRow
            ><TableHead>Agente</TableHead><TableHead>Estado</TableHead
            ><TableHead>Sistema operativo</TableHead
            ><TableHead>Última conexión</TableHead
            ><TableHead class="text-right">Acciones</TableHead></TableRow
          ></TableHeader
        >
        <TableBody>
          <TableRow v-for="agente in filteredAgentes" :key="agente.uuid_agente">
            <TableCell
              ><div class="admin-record-name">
                <span class="admin-record-icon"
                  ><Bot :size="20" :stroke-width="1.6"
                /></span>
                <div>
                  <NuxtLink :to="`/admin/agentes/${agente.uuid_agente}`"
                    ><strong>{{ agente.nombre }}</strong></NuxtLink
                  ><span class="admin-record-id">{{ agente.uuid_agente }}</span>
                </div>
              </div></TableCell
            >
            <TableCell
              ><span class="admin-state" :data-state="agente.estado">{{
                stateLabels[agente.estado] || agente.estado
              }}</span></TableCell
            >
            <TableCell>{{
              agente.sistema_operativo || "Sin registrar"
            }}</TableCell>
            <TableCell class="text-muted-foreground whitespace-nowrap">{{
              formatDate(agente.ultimo_ping)
            }}</TableCell>
            <TableCell class="text-right"
              ><Button as-child variant="ghost" size="sm"
                ><NuxtLink :to="`/admin/agentes/${agente.uuid_agente}`"
                  >Ver detalle<ArrowUpRight
                    :size="15"
                    class="ml-2" /></NuxtLink></Button
            ></TableCell>
          </TableRow>
          <TableEmpty v-if="!filteredAgentes.length" :colspan="6"
            ><div class="admin-empty">
              <strong>{{
                agentes.length
                  ? "No hay agentes que coincidan"
                  : "Conecta tu primer agente"
              }}</strong
              >{{
                agentes.length
                  ? "Prueba otra búsqueda o limpia los filtros."
                  : "Selecciona Nuevo agente para registrar un equipo."
              }}
            </div></TableEmpty
          >
        </TableBody>
      </Table>
    </section>
  </div>
</template>
