<script setup lang="ts">
import { computed } from "vue";
import { Handle, Position } from "@vue-flow/core";
import {
  Play,
  Globe,
  FileText,
  Monitor,
  Code2,
  GitBranch,
  Braces,
  Repeat2,
  ListRestart,
  ArrowRight,
  Square,
  Plus,
  EyeOff,
  Link2,
  AlertTriangle,
} from "lucide-vue-next";
import { nodeTypes, type WorkflowNode } from "@rpa/contracts";
import { actionLabel } from "../utils/workflow-editor";
import type { ReferenceDescription } from "../utils/workflow-references";
const props = defineProps<{
  data: { node: WorkflowNode };
  selected?: boolean;
  inputSource?: ReferenceDescription;
  isInputSource?: boolean;
}>();
const emit = defineEmits<{ append: [id: string, output: number] }>();
const descriptor = computed(() =>
  nodeTypes.find((type) => type.type === props.data.node.type)!,
);
const icon = computed(
  () =>
    ({
      "rpa.manualTrigger": Play,
      "rpa.action":
        props.data.node.type === "rpa.action" &&
        props.data.node.parameters.actionId.startsWith("script.")
          ? Code2
          : props.data.node.type === "rpa.action" &&
              props.data.node.parameters.actionId.startsWith("playwright.")
            ? Globe
            : props.data.node.type === "rpa.action" &&
                props.data.node.parameters.actionId.startsWith("word.")
              ? FileText
              : Monitor,
      "rpa.if": GitBranch,
      "rpa.set": Braces,
      "rpa.while": Repeat2,
      "rpa.forEach": ListRestart,
      "rpa.noOp": ArrowRight,
      "rpa.end": Square,
    })[props.data.node.type],
);
const caption = computed(() =>
  props.data.node.type === "rpa.action"
    ? actionLabel(props.data.node.parameters.actionId)
    : descriptor.value.displayName,
);
</script>
<template>
  <div
    class="workflow-node"
    :class="[
      data.node.type.replace('rpa.', 'node-'),
      { 'is-selected': selected, 'is-disabled': data.node.disabled, 'is-input-source': isInputSource, 'has-reference-warning': inputSource?.warning },
    ]"
  >
    <div class="workflow-node-tile">
      <component :is="icon" :size="30" :stroke-width="1.7" /><span
        v-if="data.node.sensitiveOutput"
        class="workflow-node-private"
        title="Salida protegida"
        ><EyeOff :size="12"
      /></span>
    </div>
    <Handle
      id="data:in"
      type="target"
      :position="Position.Top"
      :connectable="false"
      class="workflow-data-handle"
      :style="{ top: '0px', left: '75px' }"
    />
    <Handle
      id="data:out"
      type="source"
      :position="Position.Top"
      :connectable="false"
      class="workflow-data-handle"
      :style="{ top: '0px', left: '75px' }"
    />
    <Handle
      v-if="descriptor.inputs"
      id="main:0"
      type="target"
      :position="Position.Left"
      :style="{ top: '40px', left: '34px' }"
    />
    <div
      v-for="(output, index) in descriptor.outputs"
      :key="index"
      class="workflow-node-output"
      :style="{
        top: `${descriptor.outputs.length === 1 ? 40 : 24 + index * 32}px`,
      }"
    >
      <Handle :id="`main:${index}`" type="source" :position="Position.Right" />
      <span v-if="descriptor.outputs.length > 1" class="workflow-port-label">{{
        output
      }}</span>
      <button
        type="button"
        class="workflow-node-add nodrag nopan"
        :aria-label="`Agregar paso después de ${data.node.name}: ${output}`"
        @click.stop="emit('append', data.node.id, index)"
      >
        <Plus :size="12" />
      </button>
    </div>
    <strong>{{ data.node.name }}</strong
    ><small>{{ data.node.disabled ? "Deshabilitado" : caption }}</small>
    <span v-if="inputSource" class="workflow-node-input" :title="inputSource.warning ?? `Datos disponibles como input: ${inputSource.label}`">
      <component :is="inputSource.warning ? AlertTriangle : Link2" :size="11" />
      Entrada: {{ inputSource.label }}
    </span>
    <span v-if="isInputSource" class="workflow-node-source-label">Origen de los datos</span>
  </div>
</template>
<style scoped>
.workflow-node {
  position: relative;
  width: 150px;
  min-height: 126px;
  text-align: center;
  color: var(--foreground);
  font-family: inherit;
}
.workflow-node-tile {
  position: relative;
  display: grid;
  place-items: center;
  width: 80px;
  height: 80px;
  margin: 0 auto 12px;
  background: var(--card);
  border: 2px solid #c8ced5;
  border-radius: 18px;
  color: #64748b;
  box-shadow: 0 3px 8px #0f172a08;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}
.is-selected .workflow-node-tile {
  border-color: var(--primary);
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--primary) 14%, transparent);
}
.workflow-node:hover .workflow-node-tile {
  border-color: var(--primary);
}
.is-input-source .workflow-node-tile { border-color: #8b5cf6; box-shadow: 0 0 0 4px #8b5cf619; }
.workflow-data-handle { opacity: 0; pointer-events: none; }
.workflow-node-input { display: flex; justify-content: center; align-items: flex-start; gap: 4px; margin-top: 6px; font-size: 10px; line-height: 15px; color: var(--muted-foreground); overflow-wrap: anywhere; }
.workflow-node-input svg { flex-shrink: 0; margin-top: 2px; }
.has-reference-warning .workflow-node-input { color: var(--destructive); }
.workflow-node-source-label { display: block; margin-top: 5px; color: #8b5cf6; font-size: 10px; }
.node-manualTrigger .workflow-node-tile {
  border-radius: 26px;
  color: #d97706;
  border-color: #dfb869;
}
.node-action .workflow-node-tile {
  color: #4f80d7;
}
.node-if .workflow-node-tile {
  color: #c67734;
}
.node-set .workflow-node-tile {
  color: #8652b5;
}
.node-while .workflow-node-tile,
.node-forEach .workflow-node-tile {
  color: #239c81;
}
.node-end .workflow-node-tile {
  color: #e06c6c;
}
.is-disabled {
  opacity: 0.5;
}
.workflow-node strong {
  display: block;
  font-size: 12px;
  line-height: 17px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.workflow-node small {
  display: block;
  color: var(--muted-foreground);
  font-size: 10px;
  line-height: 16px;
  margin-top: 3px;
  overflow-wrap: anywhere;
}
.workflow-node-output {
  position: absolute;
  right: 34px;
  width: 0;
  height: 0;
}
.workflow-node-output :deep(.vue-flow__handle) {
  right: 0;
  top: 0;
}
.workflow-node :deep(.vue-flow__handle) {
  width: 10px;
  height: 10px;
  min-width: 10px;
  min-height: 10px;
  background: var(--card);
  border: 2px solid #98a2b0;
}
.workflow-node :deep(.vue-flow__handle:hover) {
  background: var(--primary);
  border-color: var(--primary);
}
.workflow-node-add {
  position: absolute;
  left: 15px;
  top: -9px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 1px solid #bbc3ce;
  border-radius: 5px;
  background: var(--card);
  color: #7a8595;
  opacity: 0;
}
.workflow-node:hover .workflow-node-add,
.is-selected .workflow-node-add,
.workflow-node-add:focus-visible {
  opacity: 1;
}
.workflow-port-label {
  position: absolute;
  left: 12px;
  top: 9px;
  font-size: 8px;
  color: var(--muted-foreground);
  white-space: nowrap;
}
.workflow-node-private {
  position: absolute;
  top: 5px;
  right: 5px;
  color: var(--muted-foreground);
}
</style>
