<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
const emit = defineEmits(["files-dropped"]);

/**
 * @param e
 */
const onDrop = (e: DragEvent) => {
  emit("files-dropped", Array.from(e.dataTransfer?.files ?? []));
};

const changeFile = (e: Event) => {
  emit("files-dropped", Array.from((e.target as HTMLInputElement).files ?? []));
};
const fileInput = ref<HTMLInputElement | null>(null);

/**
 *
 */
const openInput = () => {
  fileInput.value?.click();
};
/**
 * @param e
 */
const preventDefaults = (e: Event) => {
  e.preventDefault();
};

/**
 *
 */
const events = ["dragenter", "dragover", "dragleave", "drop"];

/**
 *
 */
onMounted(() => {
  events.forEach((eventName) => {
    document.body.addEventListener(eventName, preventDefaults);
  });
});

/**
 *
 */
onUnmounted(() => {
  events.forEach((eventName) => {
    document.body.removeEventListener(eventName, preventDefaults);
  });
});
</script>

<template>
  <div>
    <input
      id="fileUpload"
      ref="fileInput"
      type="file"
      multiple
      class="hidden"
      @change="changeFile"
    />
    <div @drop.prevent="onDrop" @click.prevent="openInput">
      <slot />
    </div>
  </div>
</template>
