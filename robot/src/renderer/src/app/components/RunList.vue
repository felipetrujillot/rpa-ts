<script setup lang="ts">
import { RouterLink } from "vue-router";
import { ArrowUpRight, Square } from "lucide-vue-next";
import type { TraceableFlowRun } from "@/app/stores/flow-monitor.store";
import {
  formatDate,
  formatDuration,
  statusLabel,
} from "@/app/utils/flow-display";
defineProps<{ runs: TraceableFlowRun[]; cancelingId: string }>();
defineEmits<{ cancel: [id: string] }>();
</script>

<template>
  <ul class="run-list" aria-label="Ejecuciones">
    <li v-for="run in runs" :key="run.uuid_flow_run" class="run-row">
      <span
        class="run-status-dot"
        :class="run.status"
        :title="statusLabel(run.status)"
      ></span>
      <div class="run-description">
        <RouterLink :to="`/flows/run/${run.uuid_flow_run}`">{{
          run.nombre_flujo || "Ejecución del flujo"
        }}</RouterLink
        ><span
          >{{ formatDate(run.started_at || run.queued_at || run.created_at)
          }}<template
            v-if="run.status === 'queued' && run.queue_position !== null"
          >
            · Posición {{ run.queue_position }}</template
          ></span
        >
      </div>
      <span class="run-duration">{{ formatDuration(run.duration_ms) }}</span>
      <span class="status-label" :class="run.status">{{
        statusLabel(run.status)
      }}</span>
      <button
        v-if="['queued', 'running'].includes(run.status)"
        class="icon-button danger"
        :disabled="Boolean(cancelingId)"
        :aria-label="`Cancelar ${run.nombre_flujo || 'ejecución'}`"
        title="Cancelar ejecución"
        @click="$emit('cancel', run.uuid_flow_run)"
      >
        <Square :size="14" />
      </button>
      <RouterLink
        v-else
        class="icon-button"
        :to="`/flows/run/${run.uuid_flow_run}`"
        aria-label="Ver detalle de ejecución"
        title="Ver detalle"
        ><ArrowUpRight :size="16"
      /></RouterLink>
    </li>
  </ul>
</template>
