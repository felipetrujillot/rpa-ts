<script setup lang="ts">
import { computed, ref } from "vue";
import type { FlowExpression } from "@rpa/contracts";
import WorkflowValueInput from "./WorkflowValueInput.vue";
const props = defineProps<{ modelValue: FlowExpression }>();
const emit = defineEmits<{
  "update:modelValue": [value: FlowExpression];
  invalid: [invalid: boolean];
}>();
const advanced = computed(() =>
  ["and", "or", "not"].includes(props.modelValue.op),
);
const jsonError = ref("");
const invalidFields = new Set<string>();
function invalid(field: string, value: boolean) {
  value ? invalidFields.add(field) : invalidFields.delete(field);
  emit("invalid", invalidFields.size > 0);
}
function operation(event: Event) {
  const op = (event.target as HTMLSelectElement).value as FlowExpression["op"];
  invalidFields.clear();
  emit("invalid", false);
  if (op === "truthy" || op === "falsy")
    emit("update:modelValue", { op, value: { $ref: "input.condition" } });
  else if (op !== "and" && op !== "or" && op !== "not")
    emit("update:modelValue", { op, left: { $ref: "input.valor" }, right: "" });
}
function updateJson(event: Event) {
  try {
    emit(
      "update:modelValue",
      JSON.parse((event.target as HTMLTextAreaElement).value),
    );
    jsonError.value = "";
    emit("invalid", false);
  } catch {
    jsonError.value = "JSON inválido.";
    emit("invalid", true);
  }
}
</script>
<template>
  <div class="wf-fields">
    <label
      >Operación<select :value="modelValue.op" @change="operation">
        <option v-if="advanced" :value="modelValue.op">
          Expresión compuesta ({{ modelValue.op }})
        </option>
        <option value="truthy">Tiene un valor verdadero</option>
        <option value="falsy">Tiene un valor falso</option>
        <option value="eq">Es igual a</option>
        <option value="ne">Es distinto de</option>
        <option value="gt">Es mayor que</option>
        <option value="gte">Es mayor o igual que</option>
        <option value="lt">Es menor que</option>
        <option value="lte">Es menor o igual que</option>
        <option value="contains">Contiene</option>
        <option value="in">Está en</option>
      </select></label
    >
    <template v-if="'left' in modelValue"
      ><WorkflowValueInput
        :model-value="modelValue.left"
        label="Valor izquierdo"
        @update:model-value="
          emit('update:modelValue', {
            ...modelValue,
            left: $event,
          } as FlowExpression)
        "
        @invalid="invalid('left', $event)" /><WorkflowValueInput
        :model-value="modelValue.right"
        label="Valor derecho"
        @update:model-value="
          emit('update:modelValue', {
            ...modelValue,
            right: $event,
          } as FlowExpression)
        "
        @invalid="invalid('right', $event)"
    /></template>
    <WorkflowValueInput
      v-else-if="'value' in modelValue"
      :model-value="modelValue.value"
      label="Valor a comprobar"
      @update:model-value="
        emit('update:modelValue', {
          ...modelValue,
          value: $event,
        } as FlowExpression)
      "
      @invalid="invalid('value', $event)"
    />
    <label v-else
      >Expresión JSON<textarea
        :value="JSON.stringify(modelValue, null, 2)"
        rows="8"
        spellcheck="false"
        @input="updateJson"
      /><small v-if="jsonError" role="alert" class="wf-error">{{
        jsonError
      }}</small></label
    >
  </div>
</template>
