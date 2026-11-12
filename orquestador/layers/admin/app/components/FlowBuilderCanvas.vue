<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  useId,
} from "vue";
import {
  VueFlow,
  useVueFlow,
  MarkerType,
  type Connection,
  type NodeMouseEvent,
  type EdgeMouseEvent,
  type Edge,
} from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { MiniMap } from "@vue-flow/minimap";
import {
  Plus,
  Search,
  X,
  Undo2,
  Redo2,
  Maximize,
  LayoutGrid,
  Map as MapIcon,
  ZoomIn,
  ZoomOut,
  GitBranch,
  Braces,
  Repeat2,
  ListRestart,
  ArrowRight,
  Square,
  Globe,
  Monitor,
  Code2,
  FileText,
  Table2,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Trash2,
} from "lucide-vue-next";
import {
  flowDocumentSchema,
  nodeTypes,
  nodeOutputCount,
  workflowToDiagram,
  diagramToWorkflow,
  createWorkflow,
  validateFlowDocument,
  type FlowDocument,
  type WorkflowNode,
  type DiagramNode,
  type DiagramEdge,
} from "@rpa/contracts";
import {
  actionLabel,
  actionCategory,
  actionDescription,
  nodeDescription,
  makeEditorNode,
  editorConnection,
  uniqueNodeName,
  createEditorHistory,
} from "../utils/workflow-editor";
import WorkflowDiagramNode from "./WorkflowDiagramNode.vue";
import WorkflowNodeInspector from "./workflow/WorkflowNodeInspector.vue";
import { dataReferences, scriptInputDescription, upstreamNodeIds, type ReferenceExample } from "../utils/workflow-references";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "../assets/workflow-editor.css";
const props = defineProps<{
  modelValue: string;
  flowName: string;
  knownActionIds: string[];
  referenceExample?: ReferenceExample;
  exampleLoading?: boolean;
  exampleError?: string;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: string];
  pending: [value: boolean];
  "request-example": [];
}>();
const flowId = `workflow-editor-${useId()}`;
const { fitView, zoomIn, zoomOut, screenToFlowCoordinate, onNodesInitialized } =
  useVueFlow({ id: flowId });
const root = ref<HTMLElement>();
const workspace = ref<HTMLElement>();
const inspector = ref<InstanceType<typeof WorkflowNodeInspector>>();
const document = shallowRef<FlowDocument>(createWorkflow());
const nodes = ref<DiagramNode[]>([]),
  edges = ref<DiagramEdge[]>([]);
const selectedId = ref(""),
  selectedEdge = ref("");
const selected = computed(() =>
  nodes.value.find((n) => n.id === selectedId.value),
);
const inspectedDraft = ref<WorkflowNode>();
watch(selectedId, () => { inspectedDraft.value = undefined; }, { flush: "sync" });
const workflowNodes = computed(() => nodes.value.map(item => item.id === selectedId.value && inspectedDraft.value ? inspectedDraft.value : item.data.node));
const availableNodeIds = computed(() => upstreamNodeIds(selectedId.value, edges.value));
const variableNames = computed(() => [...new Set([
  ...Object.keys(document.value.workflow.variables),
  ...workflowNodes.value.filter(node => availableNodeIds.value.includes(node.id)).flatMap(node => node.type === "rpa.set" ? Object.keys(node.parameters.values) : node.type === "rpa.forEach" ? [node.parameters.itemVar, ...(node.parameters.indexVar ? [node.parameters.indexVar] : [])] : []),
])]);
const inputSource = (node: WorkflowNode) => scriptInputDescription(workflowNodes.value.find(item => item.id === node.id) ?? node, workflowNodes.value, upstreamNodeIds(node.id, edges.value));
const referenceSourceIds = computed(() => {
  const node = inspectedDraft.value ?? selected.value?.data.node;
  if (node?.type !== "rpa.action" || node.parameters.actionId !== "script.typescript.run") return [];
  return [...new Set(dataReferences(node.parameters.input.data).filter(path => path.startsWith("nodeOutputs.")).map(path => path.split(".")[1]!).filter(id => id !== node.id && nodes.value.some(item => item.id === id)))];
});
// Display-only dependencies never become execution connections or enter saved history.
const displayEdges = computed<Edge[]>({
  get: () => [...edges.value, ...referenceSourceIds.value.map(source => ({
    id: `reference:${source}:${selectedId.value}`,
    source, target: selectedId.value, sourceHandle: "data:out", targetHandle: "data:in",
    type: "default", label: "Datos → input",
    data: { referenceDependency: true },
    style: { stroke: "#8b5cf6", strokeWidth: 2, strokeDasharray: "5 5", pointerEvents: "none" },
    labelStyle: { fill: "var(--foreground)", fontSize: 10 },
    labelBgStyle: { fill: "var(--card)" },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#8b5cf6" },
    selectable: false, updatable: false, deletable: false, focusable: false,
  }))],
  set: value => { edges.value = value.filter(edge => !edge.data?.referenceDependency) as DiagramEdge[]; },
});
const palette = ref(true),
  search = ref(""),
  category = ref("all"),
  miniMap = ref(false),
  showIssues = ref(false);
const panelWidth = ref(360);
const panelMaxWidth = ref(720);
const isResizingPanel = ref(false);
let resizePointerId: number | undefined;
let resizeStartX = 0;
let resizeStartWidth = 0;
function clampPanelWidth(width: number) {
  return Math.round(Math.max(260, Math.min(panelMaxWidth.value, width)));
}
function startPanelResize(event: PointerEvent) {
  if (event.button !== 0) return;
  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
  resizePointerId = event.pointerId;
  resizeStartX = event.clientX;
  resizeStartWidth = panelWidth.value;
  isResizingPanel.value = true;
}
function movePanelResize(event: PointerEvent) {
  if (!isResizingPanel.value || event.pointerId !== resizePointerId) return;
  panelWidth.value = clampPanelWidth(
    resizeStartWidth - (event.clientX - resizeStartX),
  );
}
function stopPanelResize(event: PointerEvent) {
  if (event.pointerId !== resizePointerId) return;
  isResizingPanel.value = false;
  resizePointerId = undefined;
}
function onPanelResizeKeydown(event: KeyboardEvent) {
  const step = event.shiftKey ? 48 : 16;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    panelWidth.value = clampPanelWidth(
      panelWidth.value + (event.key === "ArrowLeft" ? step : -step),
    );
  } else if (event.key === "Home") {
    event.preventDefault();
    panelWidth.value = 260;
  } else if (event.key === "End") {
    event.preventDefault();
    panelWidth.value = clampPanelWidth(720);
  }
}
const appendSource = ref<{ id: string; output: number } | null>(null);
const importError = ref("");
const history = createEditorHistory(props.modelValue);
const historyRevision = ref(0);
const canUndo = computed(() => (historyRevision.value, history.canUndo)),
  canRedo = computed(() => (historyRevision.value, history.canRedo));
let lastEmitted = "";
const controlIcons = {
  "rpa.if": GitBranch,
  "rpa.set": Braces,
  "rpa.while": Repeat2,
  "rpa.forEach": ListRestart,
  "rpa.noOp": ArrowRight,
  "rpa.end": Square,
};
const paletteItems = computed(() =>
  [
    ...nodeTypes
      .filter((n) => !["rpa.manualTrigger", "rpa.action"].includes(n.type))
      .map((n) => ({
        key: n.type,
        type: n.type,
        actionId: undefined as string | undefined,
        name: n.displayName as string,
        description: nodeDescription[n.type],
        group: n.type === "rpa.set" ? "data" : "logic",
        icon: controlIcons[n.type as keyof typeof controlIcons],
      })),
    ...props.knownActionIds.map((id) => ({
      key: id,
      type: "rpa.action" as const,
      actionId: id,
      name: actionLabel(id),
      description: actionDescription(id),
      group: actionCategory(id),
      icon: id.startsWith("script.")
        ? Code2
        : id.startsWith("excel.")
          ? Table2
          : id.startsWith("word.")
            ? FileText
            : id.startsWith("playwright.")
              ? Globe
              : Monitor,
    })),
  ].filter(
    (item) =>
      (category.value === "all" || category.value === item.group) &&
      `${item.name} ${item.description}`
        .toLowerCase()
        .includes(search.value.toLowerCase()),
  ),
);
const validation = computed(() =>
  validateFlowDocument(
    diagramToWorkflow(
      document.value,
      nodes.value,
      edges.value.filter(
        (e) =>
          nodes.value.some((n) => n.id === e.source) &&
          nodes.value.some((n) => n.id === e.target),
      ),
    ),
    { knownActionIds: new Set(props.knownActionIds) },
  ),
);
function load(text: string, record = true) {
  try {
    const parsed = flowDocumentSchema.parse(JSON.parse(text));
    const diagram = workflowToDiagram(parsed);
    document.value = parsed;
    nodes.value = diagram.nodes;
    edges.value = diagram.edges;
    selectedId.value = "";
    selectedEdge.value = "";
    importError.value = "";
    emit("pending", false);
    if (record) {
      history.push(text);
      historyRevision.value++;
    }
    return true;
  } catch (e) {
    importError.value = e instanceof Error ? e.message : String(e);
    return false;
  }
}
watch(
  () => props.modelValue,
  (text) => {
    if (text === lastEmitted) {
      lastEmitted = "";
      return;
    }
    lastEmitted = "";
    load(text);
  },
  { immediate: true },
);
function sync() {
  if (importError.value) return;
  const present = new Set(nodes.value.map((n) => n.id));
  edges.value = edges.value.filter(
    (e) => present.has(e.source) && present.has(e.target),
  );
  const next = diagramToWorkflow(document.value, nodes.value, edges.value);
  if (props.flowName.trim()) next.workflow.name = props.flowName.trim();
  document.value = next;
  const text = JSON.stringify(next, null, 2);
  history.push(text);
  historyRevision.value++;
  if (text !== props.modelValue) {
    lastEmitted = text;
    emit("update:modelValue", text);
  }
}
watch(() => props.flowName, sync);
function flush() {
  return inspector.value?.apply() ?? !importError.value;
}
function select({ node }: NodeMouseEvent) {
  if (selectedId.value === node.id || !flush()) return;
  selectedId.value = node.id;
  selectedEdge.value = "";
  palette.value = false;
}
function closeInspector() {
  if (flush()) selectedId.value = "";
}
function openPalette(source?: { id: string; output: number }) {
  if (!flush()) return;
  selectedId.value = "";
  selectedEdge.value = "";
  appendSource.value = source ?? null;
  palette.value = true;
  nextTick(() =>
    root.value
      ?.querySelector<HTMLInputElement>("[data-palette-search]")
      ?.focus(),
  );
}
function connect(connection: Connection) {
  const output = Number(connection.sourceHandle?.replace("main:", ""));
  if (connection.targetHandle !== "main:0") return;
  const edge = editorConnection(
    nodes.value,
    edges.value,
    connection.source,
    connection.target,
    output,
  );
  if (edge) {
    edges.value = [...edges.value, edge];
    sync();
  }
}
function add(
  type: WorkflowNode["type"],
  actionId?: string,
  at?: { x: number; y: number },
) {
  if (!flush() || importError.value) return;
  const source =
    appendSource.value &&
    nodes.value.find((n) => n.id === appendSource.value!.id);
  const bounds = root.value
    ?.querySelector(".wf-canvas")
    ?.getBoundingClientRect();
  const position =
    at ??
    (source
      ? {
          x: source.position.x + 280,
          y: source.position.y + appendSource.value!.output * 160,
        }
      : bounds
        ? screenToFlowCoordinate({
            x: bounds.left + bounds.width / 2 - 75,
            y: bounds.top + bounds.height / 2 - 60,
          })
        : { x: 340, y: 160 });
  const node = makeEditorNode(type, nodes.value, position, actionId);
  nodes.value = [...nodes.value, node];
  if (source && appendSource.value) {
    const edge = editorConnection(
      nodes.value,
      edges.value,
      source.id,
      node.id,
      appendSource.value.output,
    );
    if (edge) edges.value = [...edges.value, edge];
  }
  appendSource.value = null;
  selectedId.value = node.id;
  selectedEdge.value = "";
  palette.value = false;
  sync();
  nextTick(() => fitView({ padding: 0.3, duration: 250 }));
}
function applyNode(node: WorkflowNode) {
  const item = nodes.value.find((n) => n.id === node.id);
  if (!item) return;
  item.data = { node };
  nodes.value = [...nodes.value];
  sync();
}
function duplicate() {
  if (!selected.value || selected.value.data.node.type === "rpa.manualTrigger")
    return;
  const original = selected.value;
  const node = JSON.parse(JSON.stringify(original)) as DiagramNode;
  node.id = crypto.randomUUID();
  node.data.node.id = node.id;
  node.data.node.name = uniqueNodeName(
    `${node.data.node.name} copia`,
    nodes.value,
  );
  node.position = { x: original.position.x + 50, y: original.position.y + 160 };
  node.data.node.position = [node.position.x, node.position.y];
  nodes.value = [...nodes.value, node];
  selectedId.value = node.id;
  sync();
}
function removeSelected() {
  if (selectedEdge.value) {
    edges.value = edges.value.filter((e) => e.id !== selectedEdge.value);
    selectedEdge.value = "";
    sync();
    return;
  }
  if (!selected.value || selected.value.data.node.type === "rpa.manualTrigger")
    return;
  const id = selectedId.value;
  nodes.value = nodes.value.filter((n) => n.id !== id);
  edges.value = edges.value.filter((e) => e.source !== id && e.target !== id);
  selectedId.value = "";
  emit("pending", false);
  sync();
}
function travel(direction: "undo" | "redo") {
  if (!flush()) return;
  const text = history[direction]();
  historyRevision.value++;
  if (text && load(text, false)) {
    lastEmitted = text;
    emit("update:modelValue", text);
  }
}
function arrange() {
  if (!flush()) return;
  const visited = new Set<string>(),
    levels = new Map<number, number>();
  const queue: Array<{ id: string; depth: number }> = nodes.value
    .filter((n) => n.data.node.type === "rpa.manualTrigger")
    .map((n) => ({ id: n.id, depth: 0 }));
  const positions = new Map<string, { x: number; y: number }>();
  const walk = () => {
    while (queue.length) {
      const item = queue.shift()!;
      if (visited.has(item.id)) continue;
      visited.add(item.id);
      const row = levels.get(item.depth) ?? 0;
      positions.set(item.id, { x: 80 + item.depth * 280, y: 120 + row * 210 });
      levels.set(item.depth, row + 1);
      edges.value
        .filter((e) => e.source === item.id)
        .forEach((e) => queue.push({ id: e.target, depth: item.depth + 1 }));
    }
  };
  walk();
  for (const node of nodes.value)
    if (!visited.has(node.id)) {
      queue.push({ id: node.id, depth: 0 });
      walk();
    }
  nodes.value = nodes.value.map((n) => ({
    ...n,
    position: positions.get(n.id)!,
  }));
  sync();
  nextTick(() => fitView({ padding: 0.25, duration: 300 }));
}
function keydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement;
  if (target.closest('input,textarea,select,[contenteditable="true"]')) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    travel(event.shiftKey ? "redo" : "undo");
  } else if (
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === "d" &&
    selected.value
  ) {
    event.preventDefault();
    if (flush()) duplicate();
  } else if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    removeSelected();
  } else if (event.key === "Tab") {
    if (event.target === root.value) {
      event.preventDefault();
      openPalette();
    }
  } else if (event.key === "Escape") {
    closeInspector();
    palette.value = false;
    selectedEdge.value = "";
  }
}
function drag(event: DragEvent, type: string, actionId?: string) {
  event.dataTransfer?.setData(
    "application/rpa-node",
    JSON.stringify({ type, actionId }),
  );
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
}
function drop(event: DragEvent) {
  event.preventDefault();
  try {
    const item = JSON.parse(
      event.dataTransfer?.getData("application/rpa-node") ?? "",
    );
    if (
      !nodeTypes.some(
        (n) => n.type === item.type && n.type !== "rpa.manualTrigger",
      )
    )
      return;
    appendSource.value = null;
    add(
      item.type,
      item.actionId,
      screenToFlowCoordinate({ x: event.clientX, y: event.clientY }),
    );
  } catch {
    /* Ignore unrelated drops. */
  }
}
function selectEdge({ edge }: EdgeMouseEvent) {
  if (edge.data?.referenceDependency) return;
  if (!flush()) return;
  selectedId.value = "";
  selectedEdge.value = edge.id;
}
onNodesInitialized(() => fitView({ padding: 0.35, maxZoom: 1 }));
let workspaceObserver: ResizeObserver | undefined;
onMounted(() => {
  if (!workspace.value) return;
  workspaceObserver = new ResizeObserver(([entry]) => {
    panelMaxWidth.value = Math.max(
      260,
      Math.min(720, (entry?.contentRect.width ?? 1080) - 360),
    );
    panelWidth.value = Math.min(panelWidth.value, panelMaxWidth.value);
  });
  workspaceObserver.observe(workspace.value);
});
onBeforeUnmount(() => {
  isResizingPanel.value = false;
  workspaceObserver?.disconnect();
});
defineExpose({ flush });
</script>
<template>
  <section
    ref="root"
    class="wf-builder"
    tabindex="0"
    aria-label="Editor visual del flujo"
    @keydown="keydown"
  >
    <div v-if="importError" role="alert" class="wf-import-error">
      <AlertCircle :size="20" />
      <div>
        <strong>No se pudo abrir el documento</strong>
        <p>{{ importError }}</p>
        <p>Abre el editor JSON para corregirlo.</p>
      </div>
    </div>
    <template v-else>
      <div
        ref="workspace"
        class="wf-workspace"
        :class="{ 'is-resizing-panel': isResizingPanel }"
        :style="{ '--wf-panel-width': `${panelWidth}px` }"
      >
        <div class="wf-canvas" @dragover.prevent @drop="drop">
          <VueFlow
            :id="flowId"
            v-model:nodes="nodes"
            v-model:edges="displayEdges"
            fit-view-on-init
            :min-zoom="0.15"
            :max-zoom="2"
            :delete-key-code="null"
            :snap-to-grid="true"
            :snap-grid="[20, 20]"
            :default-edge-options="{
              type: 'smoothstep',
              markerEnd: MarkerType.ArrowClosed,
              style: { stroke: '#98a2b0', strokeWidth: 1.8 },
            }"
            @connect="connect"
            @node-click="select"
            @node-drag-stop="sync"
            @edge-click="selectEdge"
            @pane-click="closeInspector"
          >
            <template #node-workflow="nodeProps"
              ><WorkflowDiagramNode
                v-bind="nodeProps"
                :input-source="inputSource(nodeProps.data.node)"
                :is-input-source="referenceSourceIds.includes(nodeProps.id)"
                @append="(id, output) => openPalette({ id, output })"
            /></template>
            <Background :gap="20" :size="1" pattern-color="#c6ccd5" />
            <MiniMap v-if="miniMap" pannable zoomable :node-color="'#91b7c5'" />
          </VueFlow>
          <div class="wf-canvas-top">
            <div class="wf-canvas-label">
              <span class="wf-status-dot" /> Editor
              <span class="wf-canvas-count">{{ nodes.length }} pasos</span>
            </div>
            <button
              type="button"
              class="wf-button wf-button-add"
              @click="openPalette()"
            >
              <Plus :size="16" /> Agregar paso
            </button>
          </div>
          <div v-if="nodes.length === 1" class="wf-empty-coach">
            <span class="wf-eyebrow">TU AUTOMATIZACIÓN EMPIEZA AQUÍ</span>
            <h3>¿Qué debería pasar después?</h3>
            <p>Agrega una acción y conecta los pasos de tu flujo.</p>
            <button
              type="button"
              class="wf-text-button"
              @click="openPalette({ id: nodes[0]!.id, output: 0 })"
            >
              Elegir el primer paso <ChevronRight :size="14" />
            </button>
          </div>
          <div class="wf-canvas-bottom">
            <div class="wf-tools" aria-label="Herramientas del lienzo">
              <button
                type="button"
                class="wf-icon-button"
                aria-label="Acercar"
                title="Acercar"
                @click="zoomIn()"
              >
                <ZoomIn :size="17" /></button
              ><button
                type="button"
                class="wf-icon-button"
                aria-label="Alejar"
                title="Alejar"
                @click="zoomOut()"
              >
                <ZoomOut :size="17" /></button
              ><button
                type="button"
                class="wf-icon-button"
                aria-label="Ajustar a pantalla"
                title="Ajustar a pantalla"
                @click="fitView({ padding: 0.3, duration: 200 })"
              >
                <Maximize :size="17" /></button
              ><span class="wf-tool-divider" /><button
                type="button"
                class="wf-icon-button"
                aria-label="Ordenar nodos"
                title="Ordenar nodos"
                @click="arrange"
              >
                <LayoutGrid :size="17" /></button
              ><button
                type="button"
                class="wf-icon-button"
                aria-label="Mostrar minimapa"
                title="Minimapa"
                :aria-pressed="miniMap"
                @click="miniMap = !miniMap"
              >
                <MapIcon :size="17" /></button
              ><span class="wf-tool-divider" /><button
                type="button"
                class="wf-icon-button"
                aria-label="Deshacer"
                title="Deshacer (⌘/Ctrl Z)"
                :disabled="!canUndo"
                @click="travel('undo')"
              >
                <Undo2 :size="17" /></button
              ><button
                type="button"
                class="wf-icon-button"
                aria-label="Rehacer"
                title="Rehacer (⌘/Ctrl ⇧ Z)"
                :disabled="!canRedo"
                @click="travel('redo')"
              >
                <Redo2 :size="17" />
              </button>
            </div>
            <span class="wf-canvas-tip"
              >Arrastra para mover · Rueda para acercar</span
            >
          </div>
          <div v-if="selectedEdge" class="wf-edge-toolbar">
            <span>Conexión seleccionada</span
            ><button
              type="button"
              class="wf-text-button wf-danger"
              @click="removeSelected"
            >
              <Trash2 :size="14" /> Eliminar
            </button>
          </div>
        </div>
        <button
          v-if="selected || palette"
          type="button"
          class="wf-resize-handle"
          role="separator"
          aria-label="Cambiar ancho del panel"
          aria-orientation="vertical"
          aria-valuemin="260"
          :aria-valuemax="panelMaxWidth"
          :aria-valuenow="panelWidth"
          tabindex="0"
          title="Arrastra para cambiar el ancho del panel"
          @pointerdown="startPanelResize"
          @pointermove="movePanelResize"
          @pointerup="stopPanelResize"
          @pointercancel="stopPanelResize"
          @lostpointercapture="stopPanelResize"
          @keydown="onPanelResizeKeydown"
        />
        <WorkflowNodeInspector
          v-if="selected"
          :key="selected.id"
          ref="inspector"
          :node="selected.data.node"
          :names="nodes.map((n) => n.data.node.name)"
          :known-action-ids="knownActionIds"
          :nodes="workflowNodes"
          :available-node-ids="availableNodeIds"
          :variables="variableNames"
          :reference-example="referenceExample"
          :example-loading="exampleLoading"
          :example-error="exampleError"
          @draft-update="inspectedDraft = $event"
          @request-example="emit('request-example')"
          @apply="applyNode"
          @close="closeInspector"
          @remove="removeSelected"
          @duplicate="duplicate"
          @pending="emit('pending', $event)"
        />
        <aside
          v-else-if="palette"
          class="wf-panel wf-palette"
          aria-label="Catálogo de pasos"
        >
          <div class="wf-panel-header">
            <div>
              <span class="wf-eyebrow">CONSTRUYE TU FLUJO</span>
              <h3>{{ appendSource ? "¿Qué sigue?" : "Agregar un paso" }}</h3>
            </div>
            <button
              type="button"
              class="wf-icon-button"
              aria-label="Cerrar catálogo"
              @click="
                palette = false;
                appendSource = null;
              "
            >
              <X :size="18" />
            </button>
          </div>
          <div class="wf-palette-search">
            <Search :size="16" /><input
              v-model="search"
              data-palette-search
              placeholder="Buscar pasos o acciones…"
              aria-label="Buscar pasos o acciones"
            />
          </div>
          <div class="wf-categories">
            <button
              v-for="item in [
                { id: 'all', name: 'Todos' },
                { id: 'browser', name: 'Navegador' },
                { id: 'desktop', name: 'Escritorio' },
                { id: 'word', name: 'Word' },
                { id: 'excel', name: 'Excel' },
                { id: 'logic', name: 'Lógica' },
                { id: 'data', name: 'Datos' },
              ]"
              :key="item.id"
              type="button"
              :class="{ active: category === item.id }"
              :aria-pressed="category === item.id"
              @click="category = item.id"
            >
              {{ item.name }}
            </button>
          </div>
          <div class="wf-palette-list">
            <button
              v-for="item in paletteItems"
              :key="item.key"
              type="button"
              class="wf-palette-item"
              draggable="true"
              @dragstart="drag($event, item.type, item.actionId)"
              @click="add(item.type, item.actionId)"
            >
              <span class="wf-palette-icon" :class="`wf-group-${item.group}`"
                ><component :is="item.icon" :size="20" /></span
              ><span
                ><strong>{{ item.name }}</strong
                ><small>{{ item.description }}</small></span
              ><Plus :size="14" class="wf-palette-plus" />
            </button>
            <div v-if="!paletteItems.length" class="wf-palette-empty">
              <Search :size="24" /><strong>Sin resultados</strong>
              <p>Prueba con otro nombre o categoría.</p>
            </div>
          </div>
          <div class="wf-palette-footer">
            Selecciona un paso o arrástralo al lienzo.
          </div>
        </aside>
      </div>
      <div class="wf-validation" :class="{ 'has-errors': !validation.ok }">
        <button
          type="button"
          class="wf-text-button"
          :aria-expanded="showIssues"
          @click="showIssues = !showIssues"
        >
          <CheckCircle2 v-if="validation.ok" :size="14" /><AlertCircle
            v-else
            :size="14"
          />{{
            validation.ok
              ? "El flujo está listo para guardar"
              : `${validation.errors.length} problemas por resolver`
          }}<ChevronRight
            v-if="!validation.ok"
            :size="13"
            :class="{ 'wf-rotate': showIssues }"
          /></button
        ><span>{{ edges.length }} conexiones</span>
      </div>
      <div v-if="showIssues && !validation.ok" class="wf-issues" role="status">
        <p v-for="(issue, index) in validation.errors" :key="index">
          <AlertCircle :size="13" /><span
            >{{ issue.message }} <code>{{ issue.path }}</code></span
          >
        </p>
      </div>
    </template>
  </section>
</template>
