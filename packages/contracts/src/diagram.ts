import type {
  FlowDocument,
  WorkflowNode,
  WorkflowConnections,
} from "./workflow";
export type DiagramNode = {
  id: string;
  position: { x: number; y: number };
  type: "workflow";
  deletable?: boolean;
  data: { node: WorkflowNode };
};
export type DiagramEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
};
export function workflowToDiagram(document: FlowDocument): {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
} {
  const nodes = document.workflow.nodes.map((node) => ({
    id: node.id,
    position: { x: node.position[0], y: node.position[1] },
    type: "workflow" as const,
    deletable: node.type !== "rpa.manualTrigger",
    data: { node: structuredClone(node) },
  }));
  const byName = new Map(nodes.map((node) => [node.data.node.name, node.id]));
  const edges: DiagramEdge[] = [];
  for (const [name, ports] of Object.entries(document.workflow.connections))
    for (const [output, targets] of ports.main.entries())
      for (const target of targets) {
        const source = byName.get(name),
          destination = byName.get(target.node);
        if (!source || !destination)
          throw new Error("Conexión con nodo inexistente.");
        edges.push({
          id: `${source}:${output}:${destination}:${target.index}`,
          source,
          target: destination,
          sourceHandle: `main:${output}`,
          targetHandle: `main:${target.index}`,
        });
      }
  return { nodes, edges };
}
export function diagramToWorkflow(
  document: FlowDocument,
  nodes: DiagramNode[],
  edges: DiagramEdge[],
): FlowDocument {
  const byId = new Map(nodes.map((node) => [node.id, node.data.node]));
  const connections: WorkflowConnections = {};
  for (const edge of edges) {
    const source = byId.get(edge.source),
      target = byId.get(edge.target);
    if (!source || !target) throw new Error("Conexión con nodo inexistente.");
    const output = Number(edge.sourceHandle.replace("main:", ""));
    const input = Number(edge.targetHandle.replace("main:", ""));
    if (
      !Number.isInteger(output) ||
      output < 0 ||
      !Number.isInteger(input) ||
      input !== 0
    )
      throw new Error("Puerto inválido.");
    const ports = (connections[source.name] ??= { main: [] });
    while (ports.main.length <= output) ports.main.push([]);
    ports.main[output]!.push({ node: target.name, type: "main", index: 0 });
  }
  return {
    ...document,
    workflow: {
      ...document.workflow,
      nodes: nodes.map((node) => ({
        ...node.data.node,
        position: [node.position.x, node.position.y],
      })),
      connections,
    },
  };
}
