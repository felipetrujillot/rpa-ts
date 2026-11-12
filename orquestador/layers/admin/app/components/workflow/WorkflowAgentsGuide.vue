<script setup lang="ts">
import { computed, ref } from "vue";
import { Copy, Download } from "lucide-vue-next";
import { createWorkflowAgentsGuide } from "../../utils/workflow-agents";

const props = defineProps<{ knownActionIds: string[] }>();
const content = computed(() => createWorkflowAgentsGuide(props.knownActionIds));
const status = ref("");
const error = ref("");

async function copy() {
  status.value = "";
  error.value = "";
  try {
    await navigator.clipboard.writeText(content.value);
    status.value = "AGENTS.md copiado. Ya puedes entregárselo a tu agente.";
  } catch {
    error.value = "No se pudo copiar. Selecciona el contenido o descarga AGENTS.md.";
  }
}

function download() {
  const url = URL.createObjectURL(
    new Blob([content.value], { type: "text/markdown;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "AGENTS.md";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>

<template>
  <section class="wf-agents-panel" aria-labelledby="wf-agents-title">
    <div class="wf-agents-heading">
      <div>
        <h3 id="wf-agents-title">Genera un flujo con tu agente</h3>
        <p>
          Copia o descarga este AGENTS.md y entrégaselo a tu agente junto con lo
          que necesitas automatizar. La guía incluye el formato JSON, las acciones
          configuradas en Ajustes y un ejemplo completo.
        </p>
      </div>
      <div class="wf-agents-actions">
        <button type="button" class="wf-button" @click="copy">
          <Copy :size="14" /> Copiar
        </button>
        <button type="button" class="wf-button" @click="download">
          <Download :size="14" /> Descargar AGENTS.md
        </button>
      </div>
    </div>
    <ol class="wf-agents-steps">
      <li>Entrega la guía y describe tu necesidad al agente.</li>
      <li>Importa el JSON que genere o pégalo en la pestaña JSON.</li>
      <li>Revisa los pasos, guarda el borrador y prueba el flujo.</li>
    </ol>
    <p v-if="status" role="status" class="wf-agents-feedback">{{ status }}</p>
    <p v-if="error" role="alert" class="wf-error wf-agents-feedback">{{ error }}</p>
    <label for="wf-agents-content" class="wf-agents-label">Contenido de AGENTS.md · solo lectura</label>
    <textarea
      id="wf-agents-content"
      :value="content"
      class="wf-code wf-agents-content"
      readonly
      spellcheck="false"
      aria-label="Instrucciones AGENTS.md para generar un flujo"
    />
  </section>
</template>

<style scoped>
.wf-agents-panel {
  padding: 24px;
}
.wf-agents-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
}
.wf-agents-heading h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 6px;
}
.wf-agents-heading p {
  max-width: 720px;
  font-size: 12px;
  line-height: 20px;
  color: var(--wf-dim);
}
.wf-agents-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.wf-agents-steps {
  padding-left: 20px;
  margin: 16px 0;
  list-style: decimal;
  font-size: 12px;
  line-height: 22px;
}
.wf-agents-feedback {
  margin-bottom: 12px;
  font-size: 12px;
}
.wf-agents-label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--wf-dim);
}
.wf-agents-content {
  display: block;
  width: 100%;
  min-height: 520px;
  padding: 18px;
  line-height: 1.7;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--muted);
  color: var(--foreground);
  resize: vertical;
}
</style>
