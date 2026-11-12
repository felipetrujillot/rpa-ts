<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import { Activity, Library, Settings2, Bot, CircleHelp } from "lucide-vue-next";
import { useAgentLinkStore } from "@/app/stores/agent-link.store";
import { useFlowMonitorStore } from "@/app/stores/flow-monitor.store";
import QueueRecovery from "@/app/components/QueueRecovery.vue";
import SetupGate from "@/app/components/SetupGate.vue";

const route = useRoute();
const link = useAgentLinkStore();
const monitor = useFlowMonitorStore();
let syncInterval: number | undefined;
const setupComplete = ref(false);
const setupRemembered = localStorage.getItem("robot.setup.completed") === "true";
const activity = computed(() => route.query.view === "activity");
const connectionLabel = computed(() =>
  !link.isLinked
    ? "Sin vincular"
    : link.realtimeConnected
      ? "Conectado"
      : "Reconectando…",
);

watch(
  () => link.agente?.uuid_agente,
  (agentId) => {
    monitor.stop();
    // A different linked agent must never see the previous agent's activity.
    monitor.runs = [];
    monitor.queue = [];
    monitor.executionState = null;
    monitor.monitorAgentId = "";
    monitor.lastSyncedAt = "";
    monitor.pollError = "";
    monitor.realtimeError = "";
    monitor.realtimeEvents = 0;
    if (agentId) monitor.start(agentId);
  },
);
function enterRobot() {
  if (setupComplete.value) return;
  link.hydrate();
  link.syncRealtimeState();
  syncInterval = window.setInterval(() => link.syncRealtimeState(), 1000);
  localStorage.setItem("robot.setup.completed", "true");
  setupComplete.value = true;
}

onUnmounted(() => {
  window.clearInterval(syncInterval);
  monitor.stop();
});
</script>

<template>
  <SetupGate
    v-if="!setupComplete"
    :remembered="setupRemembered"
    @continue="enterRobot"
  />
  <div v-else class="desktop-shell">
    <aside class="app-sidebar" aria-label="Navegación principal">
      <div class="app-brand">
        <Bot :size="23" :stroke-width="1.6" /><span
          >Robot<span class="brand-caption">Automatización</span></span
        >
      </div>
      <div class="sidebar-label">ESPACIO DE TRABAJO</div>
      <nav class="sidebar-nav">
        <RouterLink
          :to="link.isLinked ? '/flows' : '/'"
          :class="{
            selected:
              (route.path === '/flows' && !activity) ||
              route.path.startsWith('/flows/run') ||
              route.path === '/',
          }"
          :aria-current="
            (route.path === '/flows' && !activity) ||
            route.path.startsWith('/flows/run') ||
            route.path === '/'
              ? 'page'
              : undefined
          "
        >
          <Library :size="18" /><span>Flujos</span>
        </RouterLink>
        <RouterLink
          v-if="link.isLinked"
          to="/flows?view=activity"
          :class="{ selected: activity }"
          :aria-current="activity ? 'page' : undefined"
        >
          <Activity :size="18" /><span>Actividad</span
          ><span
            v-if="monitor.summary.running + monitor.summary.queued"
            class="nav-count"
            >{{ monitor.summary.running + monitor.summary.queued }}</span
          >
        </RouterLink>
      </nav>
      <div class="sidebar-bottom">
        <nav class="sidebar-nav">
          <RouterLink
            to="/settings"
            :class="{ selected: route.path === '/settings' }"
            :aria-current="route.path === '/settings' ? 'page' : undefined"
            ><Settings2 :size="18" /><span>Ajustes</span></RouterLink
          >
          <RouterLink
            to="/debug"
            :class="{
              selected: route.path === '/debug',
            }"
            ><CircleHelp :size="18" /><span>Diagnósticos</span></RouterLink
          >
        </nav>
        <div class="agent-identity">
          <span
            class="connection-dot"
            :class="{ online: link.realtimeConnected }"
          ></span>
          <div>
            <strong>{{ link.agente?.nombre || "Este equipo" }}</strong
            ><span>{{ connectionLabel }}</span>
          </div>
        </div>
      </div>
    </aside>
    <main class="app-workspace">
      <QueueRecovery v-if="link.isLinked" /><RouterView />
    </main>
  </div>
</template>
