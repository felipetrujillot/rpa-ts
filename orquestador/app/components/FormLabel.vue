<script setup lang="ts">
defineProps<{
  error?: boolean;
  text: string;
  required?: boolean;
}>();
</script>

<template>
  <div class="space-y-1">
    <Label :class="error ? 'text-yellow-500' : ''">
      {{ text }}

      <span v-if="required" class="text-yellow-500">*</span>
    </Label>

    <slot />

    <Label v-if="error" class="text-xs text-yellow-500"
      >Este campo es requerido</Label
    >
  </div>
</template>
