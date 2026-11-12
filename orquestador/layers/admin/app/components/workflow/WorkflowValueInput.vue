<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { FlowValue, ActionInputFieldOption } from "@rpa/contracts";
import WorkflowImageInput from "./WorkflowImageInput.vue";
const props = defineProps<{
  modelValue: FlowValue;
  label: string;
  multiline?: boolean;
  options?: ActionInputFieldOption[];
  image?: boolean;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: FlowValue];
  invalid: [invalid: boolean];
}>();
const mode = computed(() =>
  props.modelValue === null
    ? "null"
    : typeof props.modelValue === "object"
      ? "$ref" in props.modelValue
        ? "reference"
        : "json"
      : typeof props.modelValue,
);
const text = ref("");
const error = ref("");
watch(
  () => props.modelValue,
  (value) => {
    text.value =
      value && typeof value === "object" && "$ref" in value
        ? String(value.$ref)
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value ?? "");
  },
  { immediate: true, deep: true },
);
function update(value: string) {
  text.value = value;
  try {
    const parsed =
      mode.value === "number"
        ? value.trim() && Number.isFinite(Number(value))
          ? Number(value)
          : (() => {
              throw new Error("Escribe un número válido.");
            })()
        : mode.value === "boolean"
          ? value === "true"
          : mode.value === "reference"
            ? { $ref: value }
            : mode.value === "json"
              ? JSON.parse(value)
              : mode.value === "null"
                ? null
                : value;
    error.value = "";
    emit("invalid", false);
    emit("update:modelValue", parsed);
  } catch {
    error.value = "Valor inválido para el tipo seleccionado.";
    emit("invalid", true);
  }
}
function changeType(event: Event) {
  error.value = "";
  emit("invalid", false);
  const type = (event.target as HTMLSelectElement).value;
  const values: Record<string, FlowValue> = {
    string: "",
    number: 0,
    boolean: true,
    reference: { $ref: "input.valor" },
    json: {},
    null: null,
  };
  emit("update:modelValue", values[type]!);
}
</script>
<template>
  <div class="wf-value">
    <div class="wf-value-heading">
      <span>{{ label }}</span
      ><select
        :value="mode"
        :aria-label="`Tipo de ${label}`"
        @change="changeType"
      >
        <option value="string">Texto</option>
        <option value="number">Número</option>
        <option value="boolean">Booleano</option>
        <option value="reference">Referencia</option>
        <option value="json">JSON</option>
        <option value="null">Nulo</option>
      </select>
    </div>
    <WorkflowImageInput v-if="mode === 'string' && image" :model-value="modelValue as string" :label="label" @update:model-value="update" />
    <select
      v-else-if="mode === 'string' && options?.length"
      :value="modelValue as string" :aria-label="label" @change="update(($event.target as HTMLSelectElement).value)">
      <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>
    <select
      v-else-if="mode === 'boolean'"
      :value="String(modelValue)"
      :aria-label="label"
      @change="update(($event.target as HTMLSelectElement).value)"
    >
      <option value="true">Verdadero</option>
      <option value="false">Falso</option>
    </select>
    <textarea
      v-else-if="mode === 'json' || (mode === 'string' && multiline)"
      :value="text"
      :aria-label="label"
      :rows="multiline ? 14 : 3"
      :style="multiline ? { fontFamily: 'monospace', tabSize: 2 } : undefined"
      spellcheck="false"
      @input="update(($event.target as HTMLTextAreaElement).value)"
    />
    <input
      v-else-if="mode !== 'null'"
      :value="text"
      :aria-label="label"
      :type="mode === 'number' ? 'number' : 'text'"
      :placeholder="mode === 'reference' ? 'input.valor' : 'Valor'"
      @input="update(($event.target as HTMLInputElement).value)"
    />
    <small v-if="error" role="alert" class="wf-error">{{ error }}</small>
  </div>
</template>
