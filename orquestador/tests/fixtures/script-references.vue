<script setup lang="ts">
import { ref } from "vue";
import { createWorkflow, type FlowDocument } from "@rpa/contracts";
import FlowBuilderCanvas from "../../layers/admin/app/components/FlowBuilderCanvas.vue";
import type { ReferenceExample } from "../../layers/admin/app/utils/workflow-references";

const document: FlowDocument = createWorkflow("Prueba de referencias");
document.workflow.variables = { cliente: { nombre: "Felipe" } };
document.workflow.nodes.push(
  {
    id: "source-id",
    name: "Obtener cliente",
    type: "rpa.action",
    typeVersion: 1,
    position: [260, 100],
    parameters: {
      actionId: "script.typescript.run",
      input: { code: 'return { nombre: "Felipe" };', data: {} },
    },
  },
  {
    id: "consumer-id",
    name: "Saludar",
    type: "rpa.action",
    typeVersion: 1,
    position: [540, 100],
    parameters: {
      actionId: "script.typescript.run",
      input: {
        code: "return input;",
        data: { nombre: "Manual" },
        timeoutMs: 5000,
      },
    },
  },
  {
    id: "future-id",
    name: "Paso posterior",
    type: "rpa.noOp",
    typeVersion: 1,
    position: [800, 100],
    parameters: {},
  },
);
document.workflow.connections = {
  Inicio: { main: [[{ node: "Obtener cliente", type: "main", index: 0 }]] },
  "Obtener cliente": { main: [[{ node: "Saludar", type: "main", index: 0 }]] },
  Saludar: { main: [[{ node: "Paso posterior", type: "main", index: 0 }]] },
};
const text = ref(JSON.stringify(document));
const pending = ref(false);
const example = ref<ReferenceExample>();
function loadExample() {
  example.value = {
    runId: "execution-example",
    date: "2026-01-01T10:00:00Z",
    versionId: "v1",
    context: {
      input: {},
      vars: { cliente: { nombre: "Felipe" } },
      nodeOutputs: { "source-id": { result: { nombre: "Felipe" }, logs: [] } },
    },
  };
}
function renameSource() {
  const doc = JSON.parse(text.value) as FlowDocument;
  doc.workflow.nodes.find((node) => node.id === "source-id")!.name =
    "Consultar cliente";
  doc.workflow.connections["Consultar cliente"] =
    doc.workflow.connections["Obtener cliente"]!;
  delete doc.workflow.connections["Obtener cliente"];
  doc.workflow.connections.Inicio!.main[0]![0]!.node = "Consultar cliente";
  text.value = JSON.stringify(doc);
}
function insertStep() {
  const doc = JSON.parse(text.value) as FlowDocument;
  const sourceName = doc.workflow.nodes.find(
    (node) => node.id === "source-id",
  )!.name;
  doc.workflow.nodes.push({
    id: "middle-id",
    name: "Paso intermedio",
    type: "rpa.noOp",
    typeVersion: 1,
    position: [400, 300],
    parameters: {},
  });
  doc.workflow.connections[sourceName] = {
    main: [[{ node: "Paso intermedio", type: "main", index: 0 }]],
  };
  doc.workflow.connections["Paso intermedio"] = {
    main: [[{ node: "Saludar", type: "main", index: 0 }]],
  };
  text.value = JSON.stringify(doc);
}
function removeSource() {
  const doc = JSON.parse(text.value) as FlowDocument;
  const sourceName = doc.workflow.nodes.find(
    (node) => node.id === "source-id",
  )!.name;
  doc.workflow.nodes = doc.workflow.nodes.filter(
    (node) => node.id !== "source-id",
  );
  delete doc.workflow.connections[sourceName];
  doc.workflow.connections.Inicio = {
    main: [[{ node: "Saludar", type: "main", index: 0 }]],
  };
  text.value = JSON.stringify(doc);
}
</script>
<template>
  <FlowBuilderCanvas
    v-model="text"
    flow-name="Prueba de referencias"
    :known-action-ids="['script.typescript.run', 'playwright.browser.openTab', 'playwright.browser.closeTab']"
    :reference-example="example"
    @pending="pending = $event"
    @request-example="loadExample"
  />
  <output aria-label="Flujo guardado">{{ text }}</output>
  <output aria-label="Cambios pendientes">{{ pending }}</output>
  <button @click="renameSource">Renombrar origen</button>
  <button @click="insertStep">Insertar paso intermedio</button>
  <button @click="removeSource">Eliminar origen</button>
</template>
<style>
:root {
  --background: #fff;
  --card: #fff;
  --foreground: #18181b;
  --border: #e4e4e7;
  --muted: #f4f4f5;
  --muted-foreground: #71717a;
  --primary: #2563eb;
  --primary-foreground: #fff;
  --destructive: #b91c1c;
}
body {
  margin: 0;
  font-family: sans-serif;
}
output {
  display: block;
  max-height: 80px;
  overflow: auto;
}
</style>
