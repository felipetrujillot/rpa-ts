<script setup lang="ts">
/**
 * La idea de este select es que funcione con números
 */

const model = defineModel<number>()

type Options = {
  text: string | number
  val: number
}
const props = defineProps<{
  placeholder?: string
  options: Options[]
}>()
</script>

<template>
  <select
    class="flex h-10 w-full items-center justify-between rounded-3xl border border-input bg-background px-4 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1"
    v-model="model"
  >
    <option :value="0">
      {{ props.placeholder || 'Seleccione un valor' }}
    </option>

    <option
      v-for="(option, index) in props.options"
      :key="index"
      :value="option.val"
    >
      {{ option.text }}
    </option>
  </select>
</template>
