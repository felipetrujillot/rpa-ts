<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ImageAsset } from "@rpa/contracts";
import WorkflowAssets from "./WorkflowAssets.vue";
const props = defineProps<{ modelValue: string; label: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const open = ref(false);
const previewFailed = ref(false);
const validId = computed(() =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
    props.modelValue,
  ),
);
watch(
  () => props.modelValue,
  () => {
    previewFailed.value = false;
  },
);
function select(asset: ImageAsset) {
  emit("update:modelValue", asset.id);
  open.value = false;
}
</script>
<template>
  <div class="wf-image-input">
    <img
      v-if="validId && !previewFailed"
      :src="`/api/assets/${modelValue}/content`"
      alt="Imagen de referencia seleccionada"
      @error="previewFailed = true"
    />
    <small v-if="previewFailed" role="status"
      >No se pudo cargar la imagen seleccionada.</small
    >
    <input
      :value="modelValue"
      :aria-label="label"
      placeholder="Selecciona una imagen o pega su ID"
      @input="
        emit('update:modelValue', ($event.target as HTMLInputElement).value)
      "
    />
    <Dialog v-model:open="open">
      <DialogTrigger as-child
        ><button type="button" class="wf-button">
          Elegir o subir imagen
        </button></DialogTrigger
      >
      <DialogContent class="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader
          ><DialogTitle>Imagen de referencia</DialogTitle
          ><DialogDescription
            >Elige un recorte del botón o la sección donde se hará
            clic.</DialogDescription
          ></DialogHeader
        >
        <WorkflowAssets selectable @select="select" />
      </DialogContent>
    </Dialog>
  </div>
</template>
<style scoped>
.wf-image-input {
  display: grid;
  gap: 8px;
}
.wf-image-input img {
  max-width: 100%;
  max-height: 140px;
  object-fit: contain;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--muted);
}
</style>
