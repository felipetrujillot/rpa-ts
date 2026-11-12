<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { RouterLink } from "vue-router";
import { Settings2, Unplug } from "lucide-vue-next";
import { useAgentLinkStore } from "@/app/stores/agent-link.store";
import { formatDate } from "@/app/utils/flow-display";
const link = useAgentLinkStore();
const router = useRouter();
const confirming = ref(false);
const busy = ref(false);
const error = ref("");
async function unlink() {
  busy.value = true;
  error.value = "";
  try {
    await link.desvincular();
    await router.push("/");
  } catch (cause) {
    error.value = `No se pudo desvincular: ${cause instanceof Error ? cause.message : String(cause)}`;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section>
    <header class="workspace-toolbar">
      <div>
        <h1>Ajustes</h1>
        <span class="toolbar-subtitle">Conexión de este robot</span>
      </div>
      <Settings2 :size="18" class="text-slate-400" />
    </header>
    <div class="page-content">
      <h2>Conexión del agente</h2>
      <p class="page-description">
        Este equipo recibe y ejecuta los flujos asignados a su agente.
      </p>
      <section class="settings-section">
        <h3>Agente</h3>
        <div class="settings-row">
          <strong>Nombre</strong
          ><span>{{ link.agente?.nombre || "Sin agente vinculado" }}</span>
        </div>
        <div class="settings-row">
          <strong>Conexión</strong
          ><span>{{
            !link.isLinked
              ? "Sin vincular"
              : link.realtimeConnected
                ? "Conectado"
                : "Reconectando…"
          }}</span>
        </div>
        <div v-if="link.linkedAt" class="settings-row">
          <strong>Vinculado desde</strong
          ><span>{{ formatDate(link.linkedAt) }}</span>
        </div>
        <div v-if="link.lastHeartbeatAt" class="settings-row">
          <strong>Última comunicación</strong
          ><span>{{ formatDate(link.lastHeartbeatAt) }}</span>
        </div>
        <RouterLink v-if="!link.isLinked" class="btn-soft" to="/"
          >Vincular agente</RouterLink
        >
        <template v-if="link.isLinked && !link.realtimeConnected">
          <p v-if="link.connectionError" class="notice warning" role="status">{{ link.connectionError }}</p>
          <button class="btn-soft" @click="link.reconnect">Reconectar ahora</button>
        </template>
      </section>
      <section v-if="link.isLinked" class="settings-section">
        <h3>Vinculación del equipo</h3>
        <p class="page-description mt-3">
          Desvincular detendrá las ejecuciones activas y desconectará este robot
          del agente.
        </p>
        <button
          v-if="!confirming"
          class="btn-soft danger-text"
          @click="confirming = true"
        >
          <Unplug :size="15" />Desvincular robot…
        </button>
        <div v-else class="run-actions">
          <button class="btn-soft danger-text" :disabled="busy" @click="unlink">
            {{ busy ? "Desvinculando…" : "Confirmar desvinculación" }}</button
          ><button
            class="btn-soft"
            :disabled="busy"
            @click="confirming = false"
          >
            Volver
          </button>
        </div>
        <p v-if="error" class="notice error mt-3" role="alert">{{ error }}</p>
      </section>
    </div>
  </section>
</template>
