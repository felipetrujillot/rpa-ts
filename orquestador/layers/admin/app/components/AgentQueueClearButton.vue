<script setup lang="ts">
import { Trash2 } from "lucide-vue-next";

const props = defineProps<{ uuidAgente: string }>();
const emit = defineEmits<{ cleared: [] }>();
const { $trpc } = useNuxtApp();
const clearing = ref(false);

async function clearQueue() {
  if (clearing.value) return;
  clearing.value = true;
  try {
    const result = await $trpc.agentes.clearAgenteFlowQueue.mutate({ uuid_agente: props.uuidAgente });
    emit("cleared");
    await toast("success", result.cancelled_count
      ? `Cola vaciada: ${result.cancelled_count} ejecuciones pendientes canceladas.`
      : "La cola ya está vacía.");
  } catch (error) {
    await toast("error", error instanceof Error ? error.message : "No se pudo vaciar la cola.");
  } finally {
    clearing.value = false;
  }
}
</script>

<template>
  <Button type="button" variant="destructive" :disabled="clearing" @click="clearQueue">
    <Trash2 class="h-4 w-4" />
    {{ clearing ? "Vaciando cola…" : "Vaciar toda la cola del agente" }}
  </Button>
</template>
