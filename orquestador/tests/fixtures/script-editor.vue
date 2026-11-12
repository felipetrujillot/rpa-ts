<script setup lang="ts">
import { ref } from "vue";
import WorkflowTypeScriptEditor from "../../layers/admin/app/components/workflow/WorkflowTypeScriptEditor.vue";
import "../../layers/admin/app/assets/workflow-editor.css";
const source = ref(
  'const datos = input as { nombre?: string };\nreturn { nombre: datos.nombre ?? "mundo" };',
);
</script>
<template>
  <div class="wf-builder" style="width: 440px; max-width: 100%; padding: 20px">
    <WorkflowTypeScriptEditor v-model="source" />
    <output aria-label="Código guardado">{{ source }}</output>
    <button @click="source = 'return 123;'">Reemplazar código</button>
  </div>
</template>
<style>
:root {
  --background: #fff;
  --foreground: #18181b;
  --border: #e4e4e7;
  --muted: #f4f4f5;
  --muted-foreground: #71717a;
  --primary: #2563eb;
}
body {
  margin: 0;
  font-family: sans-serif;
}
output {
  display: block;
  white-space: pre-wrap;
  margin-top: 15px;
}
</style>
