<script setup lang="ts">
import { ref } from "vue";
import AgentScriptPolicy from "../../layers/admin/app/components/AgentScriptPolicy.vue";
const persisted = ref<string[]>([]);
const data = ref({ allowedActions: [] as string[], canManage: true });
const failure = ref(false);
Object.assign(globalThis, {
  useNuxtApp: () => ({
    $trpc: {
      agentes: {
        getAgenteScriptPolicy: {
          useQuery: () => ({
            data,
            status: ref("success"),
            refresh: async () => {
              data.value = {
                allowedActions: [...persisted.value],
                canManage: true,
              };
            },
          }),
        },
        updateAgenteScriptPolicy: {
          mutate: async (input: { allowedActions: string[] }) => {
            if (failure.value) throw new Error("Servidor no disponible");
            persisted.value = [...input.allowedActions];
          },
        },
      },
    },
  }),
});
</script>
<template>
  <div
    style="width: 430px; max-width: 100%; font-family: sans-serif; margin: 24px"
  >
    <AgentScriptPolicy uuid-agente="test-robot" />
    <output aria-label="Política guardada">{{
      JSON.stringify(persisted)
    }}</output>
    <button @click="failure = !failure">Simular error de guardado</button>
  </div>
</template>
<style>
:root {
  --primary: #2563eb;
  --border: #e4e4e7;
  --muted-foreground: #71717a;
  --destructive: #dc2626;
}
</style>
