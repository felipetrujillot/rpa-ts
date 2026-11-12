<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "@/lib/utils";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <div
    :class="
      cn(
        'fadeInFast rounded-lg border px-6 py-4 fadeInFast bg-card text-card-foreground space-y-4',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
