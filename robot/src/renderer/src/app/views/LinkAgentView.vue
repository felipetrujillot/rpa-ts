<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAgentLinkStore } from "@/app/stores/agent-link.store";

const linkStore = useAgentLinkStore();
const router = useRouter();
const codigo = ref("");
const status = ref("");
const failed = ref(false);
const loading = ref(false);

const vincular = async () => {
  if (loading.value || !codigo.value.trim()) return;
  failed.value = false;
  loading.value = true;
  status.value = "Vinculando...";

  try {
    await linkStore.vincularConCodigo(codigo.value.trim());
    status.value = "Robot vinculado correctamente.";
    await router.push("/flows");
  } catch (error) {
    failed.value = true;
    const message = error instanceof Error ? error.message : String(error);

    status.value = `No se pudo vincular: ${message}`;
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <section>
    <header class="workspace-toolbar">
      <div>
        <h1>Bienvenido a Robot</h1>
        <span class="toolbar-subtitle"
          >Configura este equipo para comenzar</span
        >
      </div>
    </header>
    <div class="link-view">
      <div class="link-content">
        <span class="subtle-label">CONECTA TU ESPACIO DE TRABAJO</span>
        <h2>Vincular este equipo</h2>
        <p>
          Ingresa el código de vinculación de tu orquestador. Tus flujos
          aparecerán aquí automáticamente.
        </p>
        <form @submit.prevent="vincular">
          <label class="field-label" for="codigo-vinculacion"
            >Código de vinculación</label
          ><input
            id="codigo-vinculacion"
            v-model="codigo"
            class="field-input link-code"
            placeholder="ABCD-1234"
            autocomplete="off"
            spellcheck="false"
            :disabled="loading"
            required
          /><button class="btn-primary" :disabled="loading || !codigo.trim()">
            {{ loading ? "Vinculando…" : "Vincular este equipo" }}
          </button>
        </form>
        <p
          v-if="status"
          class="notice"
          :class="{ error: failed }"
          :role="failed ? 'alert' : 'status'"
        >
          {{ status }}
        </p>
      </div>
    </div>
  </section>
</template>
