<script setup lang="ts">
import { ref } from "vue";
import { Calculator, Monitor, Globe, ArrowRight, X } from "lucide-vue-next";
import {
  workflowPresets,
  type WorkflowPresetId,
  type PresetPlatform,
} from "../../utils/workflow-presets";
const emit = defineEmits<{
  select: [id: WorkflowPresetId, platform: PresetPlatform];
  close: [];
}>();
const platform = ref<PresetPlatform>("macos");
const icons = { calculator: Calculator, desktop: Monitor, browser: Globe };
</script>
<template>
  <section class="wf-presets" aria-label="Presets de flujos">
    <div class="wf-presets-heading">
      <div>
        <h3>Empieza con un flujo preparado</h3>
        <p>Elige un preset y adapta sus pasos antes de guardarlo.</p>
      </div>
      <button
        type="button"
        class="wf-icon-button"
        aria-label="Cerrar presets"
        @click="emit('close')"
      >
        <X :size="17" />
      </button>
    </div>
    <label class="wf-presets-platform"
      >Sistema del agente<select v-model="platform">
        <option value="macos">macOS</option>
        <option value="windows">Windows</option>
        <option value="linux">Linux</option></select
      ><span
        >Define qué aplicación abrirá el preset de Calculadora.</span
      ></label
    >
    <div class="wf-preset-grid">
      <article
        v-for="preset in workflowPresets"
        :key="preset.id"
        class="wf-preset-card"
      >
        <component :is="icons[preset.icon]" :size="23" />
        <h4>{{ preset.name }}</h4>
        <p>{{ preset.description }}</p>
        <small>{{ preset.steps }}</small>
        <p class="wf-preset-requirement">{{ preset.requirement }}</p>
        <button
          type="button"
          class="wf-button"
          :aria-label="`Usar preset: ${preset.name}`"
          @click="emit('select', preset.id, platform)"
        >
          Usar preset <ArrowRight :size="14" />
        </button>
      </article>
    </div>
  </section>
</template>
<style scoped>
.wf-presets {
  padding: 20px;
  border-bottom: 1px solid var(--border);
  background: var(--card);
}
.wf-presets-heading {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}
.wf-presets-heading h3 {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 5px;
}
.wf-presets-heading p {
  font-size: 12px;
  color: var(--muted-foreground);
  margin: 0;
}
.wf-presets-platform {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin: 18px 0;
  font-size: 11px;
}
.wf-presets-platform select {
  background: var(--background);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 9px;
  color: var(--foreground);
}
.wf-presets-platform span {
  color: var(--muted-foreground);
  font-size: 10px;
}
.wf-preset-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.wf-preset-card {
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.wf-preset-card > svg {
  color: var(--primary);
  margin-bottom: 12px;
}
.wf-preset-card h4 {
  font-size: 13px;
  font-weight: 600;
  margin: 0 0 7px;
}
.wf-preset-card p {
  font-size: 11px;
  line-height: 18px;
  color: var(--muted-foreground);
  margin: 0 0 12px;
}
.wf-preset-card small {
  font-size: 10px;
  line-height: 17px;
  margin-bottom: 12px;
}
.wf-preset-card p.wf-preset-requirement {
  font-size: 10px;
  line-height: 16px;
}
.wf-preset-card button {
  margin-top: auto;
}
@media (max-width: 850px) {
  .wf-preset-grid {
    grid-template-columns: 1fr;
  }
  .wf-preset-card {
    padding: 14px;
  }
}
</style>
