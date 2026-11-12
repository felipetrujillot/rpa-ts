<script setup lang="ts">
documentTitle("Flujos");
import { Workflow, Plus, RefreshCw, ArrowUpRight } from "lucide-vue-next";

type FlowListItem = {
  uuid_flujo: string;
  nombre: string;
  estado_publicacion: "draft" | "published" | "archived";
  schema_version_actual: string | null;
  version_publicada: number;
  created_at: string;
  updated_at: string;
};

const { $trpc } = useNuxtApp();

const {
  status: flowsStatus,
  data: flowsData,
  refresh: refreshFlows,
} = $trpc.flows.getFlows.useQuery();

const flows = computed<FlowListItem[]>(
  () => (flowsData.value ?? []) as FlowListItem[],
);

const goToCreate = async () => {
  await navigateTo("/admin/flujos/nuevo-flujo");
};

const {
  search,
  status: stateFilter,
  filtered: filteredFlows,
} = useAdminTable(flows, {
  search: (item) => [item.nombre, item.uuid_flujo, item.schema_version_actual],
  status: (item) => item.estado_publicacion,
});
const stateLabels: Record<string, string> = {
  draft: "Borrador",
  published: "Publicado",
  archived: "Archivado",
};
const stateOptions = Object.entries(stateLabels).map(([value, label]) => ({
  value,
  label,
}));

const formatDate = (iso: string) => {
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
        <h1>Flujos</h1>
        <p>
          Diseña procesos, publica versiones y lleva la automatización a tus
          agentes.
        </p>
      </div>
      <div class="admin-page-actions">
        <Button
          variant="outline"
          :disabled="flowsStatus === 'pending'"
          @click="refreshFlows"
          ><RefreshCw
            :size="15"
            class="mr-2"
            :class="{ 'animate-spin': flowsStatus === 'pending' }"
          />Actualizar</Button
        >
        <Button @click="goToCreate"
          ><Plus :size="17" class="mr-2" />Crear flujo</Button
        >
      </div>
    </div>
    <section class="admin-collection" aria-labelledby="flows-title">
      <div class="admin-collection-heading">
        <h2 id="flows-title">Biblioteca de flujos</h2>
        <span class="admin-total">{{ flows.length }}</span>
      </div>
      <AdminTableFilters
        v-model:search="search"
        v-model:status="stateFilter"
        placeholder="Buscar por nombre o UUID"
        :status-options="stateOptions"
        :count="filteredFlows.length"
        :total="flows.length"
      />
      <div
        v-if="flowsStatus === 'pending'"
        class="admin-load-state"
        role="status"
      >
        Cargando flujos…
      </div>
      <div v-else-if="flowsStatus === 'error'" class="admin-error" role="alert">
        No se pudieron cargar los flujos. Usa Actualizar para volver a
        intentarlo.
      </div>
      <Table v-else>
        <TableHeader
          ><TableRow
            ><TableHead>Flujo</TableHead><TableHead>Estado</TableHead
            ><TableHead>Esquema</TableHead
            ><TableHead>Versión publicada</TableHead
            ><TableHead>Última actualización</TableHead
            ><TableHead class="text-right">Acciones</TableHead></TableRow
          ></TableHeader
        >
        <TableBody>
          <TableRow v-for="flow in filteredFlows" :key="flow.uuid_flujo">
            <TableCell
              ><div class="admin-record-name">
                <span class="admin-record-icon"
                  ><Workflow :size="20" :stroke-width="1.6"
                /></span>
                <div>
                  <NuxtLink :to="`/admin/flujos/${flow.uuid_flujo}`"
                    ><strong>{{ flow.nombre }}</strong></NuxtLink
                  ><span class="admin-record-id">{{ flow.uuid_flujo }}</span>
                </div>
              </div></TableCell
            >
            <TableCell
              ><span
                class="admin-state"
                :data-state="flow.estado_publicacion"
                >{{
                  stateLabels[flow.estado_publicacion] ||
                  flow.estado_publicacion
                }}</span
              ></TableCell
            >
            <TableCell>{{
              flow.schema_version_actual || "Sin definir"
            }}</TableCell>
            <TableCell>{{
              flow.version_publicada
                ? `v${flow.version_publicada}`
                : "Sin publicar"
            }}</TableCell>
            <TableCell class="text-muted-foreground whitespace-nowrap">{{
              formatDate(flow.updated_at)
            }}</TableCell>
            <TableCell class="text-right"
              ><Button as-child variant="ghost" size="sm"
                ><NuxtLink :to="`/admin/flujos/${flow.uuid_flujo}`"
                  >Editar flujo<ArrowUpRight
                    :size="15"
                    class="ml-2" /></NuxtLink></Button
            ></TableCell>
          </TableRow>
          <TableEmpty v-if="!filteredFlows.length" :colspan="6"
            ><div class="admin-empty">
              <strong>{{
                flows.length
                  ? "No hay flujos que coincidan"
                  : "Tu primera automatización empieza aquí"
              }}</strong
              >{{
                flows.length
                  ? "Prueba otra búsqueda o limpia los filtros."
                  : "Selecciona Crear flujo para diseñar un proceso."
              }}
            </div></TableEmpty
          >
        </TableBody>
      </Table>
    </section>
  </div>
</template>
