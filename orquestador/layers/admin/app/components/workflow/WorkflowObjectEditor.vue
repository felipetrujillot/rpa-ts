<script setup lang="ts">
import { ref } from "vue";
import { Plus, Trash2 } from "lucide-vue-next";
import type { FlowValue, ActionInputField } from "@rpa/contracts";
import WorkflowValueInput from "./WorkflowValueInput.vue";
import WorkflowTypeScriptEditor from "./WorkflowTypeScriptEditor.vue";
const props = defineProps<{
  modelValue: Record<string, FlowValue>;
  label: string;
  multilineKeys?: string[];
  codeKeys?: string[];
  hiddenKeys?: string[];
  fields?: ActionInputField[];
  recursive?: boolean;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: Record<string, FlowValue>];
  invalid: [invalid: boolean];
}>();
const newKey = ref("");
const error = ref("");
const invalidFields = new Set<string>();
function invalid(key: string, value: boolean) {
  value ? invalidFields.add(key) : invalidFields.delete(key);
  emit("invalid", invalidFields.size > 0 || !!error.value);
}
function add() {
  const key = newKey.value.trim();
  if (
    !key ||
    ["__proto__", "prototype", "constructor"].includes(key) ||
    key.length > 200 ||
    Object.hasOwn(props.modelValue, key)
  ) {
    error.value = "Escribe un nombre único y válido.";
    emit("invalid", true);
    return;
  }
  emit("update:modelValue", { ...props.modelValue, [key]: "" });
  newKey.value = "";
  error.value = "";
  emit("invalid", invalidFields.size > 0);
}
function remove(key: string) {
  const next = { ...props.modelValue };
  delete next[key];
  invalidFields.delete(key);
  emit("update:modelValue", next);
  emit("invalid", invalidFields.size > 0);
}
</script>
<template>
  <div class="wf-object">
    <p class="wf-field-title">{{ label }}</p>
    <p v-if="!Object.keys(modelValue).length" class="wf-muted">
      Sin campos. Agrega los datos que necesita este paso.
    </p>
    <div v-for="(value, key) in Object.fromEntries(Object.entries(modelValue).filter(([key]) => !hiddenKeys?.includes(key)))" :key="key" class="wf-object-row">
      <WorkflowTypeScriptEditor
        v-if="codeKeys?.includes(String(key)) && typeof value === 'string'"
        :model-value="value"
        :label="fields?.find(f => f.key === String(key))?.label ?? String(key)"
        @update:model-value="emit('update:modelValue', { ...modelValue, [key]: $event })"
      />
      <div v-else-if="recursive && value && typeof value === 'object' && !Array.isArray(value) && !('$ref' in value)" class="wf-value">
        <WorkflowObjectEditor :model-value="value" :label="fields?.find(f => f.key === String(key))?.label ?? String(key)" recursive
          @update:model-value="emit('update:modelValue', { ...modelValue, [key]: $event })" @invalid="invalid(String(key), $event)" />
        <button type="button" class="wf-text-button" @click="emit('update:modelValue', { ...modelValue, [key]: { $ref: 'input.data' } })">Usar referencia</button>
      </div>
      <WorkflowValueInput
        v-else
        :model-value="value"
        :label="fields?.find(f => f.key === String(key))?.label ?? String(key)"
        :options="fields?.find(f => f.key === String(key))?.options"
        :image="fields?.find(f => f.key === String(key))?.type === 'image'"
        :multiline="multilineKeys?.includes(String(key))"
        @update:model-value="
          emit('update:modelValue', { ...modelValue, [key]: $event })
        "
        @invalid="invalid(String(key), $event)"
      />
      <button
        type="button"
        class="wf-icon-button"
        :aria-label="`Eliminar campo ${key}`"
        @click="remove(String(key))"
      >
        <Trash2 :size="14" />
      </button>
    </div>
    <div class="wf-add-field">
      <input
        v-model="newKey"
        aria-label="Nombre del nuevo campo"
        placeholder="Nombre del campo"
        @keydown.enter.prevent="add"
      /><button
        type="button"
        class="wf-icon-button"
        aria-label="Agregar campo"
        @click="add"
      >
        <Plus :size="16" />
      </button>
    </div>
    <small v-if="error" role="alert" class="wf-error">{{ error }}</small>
  </div>
</template>
