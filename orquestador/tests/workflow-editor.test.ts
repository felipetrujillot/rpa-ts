import {
  createWorkflowPreset,
  workflowPresets,
} from "../layers/admin/app/utils/workflow-presets";
import { defaultActionIds } from "../layers/admin/app/utils/workflow-editor";
import { describe, expect, it } from "vitest";
import {
  cuaActionDefinitions,
  scriptActionDefinition,
  createWorkflow,
  workflowToDiagram,
  diagramToWorkflow,
  validateFlowDocument,
} from "@rpa/contracts";
import {
  actionInputDefaults,
  actionCategory,
  actionLabel,
  actionDescription,
  createEditorHistory,
  editorConnection,
  makeEditorNode,
  uniqueNodeName,
} from "../layers/admin/app/utils/workflow-editor";

describe("workflow editor", () => {
  it("categorizes scripts as logic without moving integration actions", () => {
    expect(actionCategory("script.typescript.run")).toBe("logic");
    expect(actionCategory("playwright.page.evaluate")).toBe("browser");
    expect(actionCategory("cua.app.launch")).toBe("desktop");
    expect(actionCategory("word.document.open")).toBe("word");
    expect(actionCategory("excel.workbook.open")).toBe("excel");
  });
  it("creates a discoverable image click action with an image picker field", () => {
    expect(defaultActionIds).toContain("cua.image.click");
    expect(actionLabel("cua.image.click")).toBe("Buscar y hacer clic por imagen");
    const definition = cuaActionDefinitions.find(action => action.id === "cua.image.click")!;
    expect(definition.inputFields.find(field => field.key === "assetId")?.type).toBe("image");
    const node = makeEditorNode("rpa.action", [], { x: 100, y: 100 }, definition.id);
    expect(node.data.node.parameters).toEqual({ actionId: definition.id, input: definition.defaults });
  });
  it("creates TypeScript actions with editable source and JSON input", () => {
    const node = makeEditorNode(
      "rpa.action",
      [],
      { x: 0, y: 0 },
      scriptActionDefinition.id,
    );
    expect(defaultActionIds).toContain(scriptActionDefinition.id);
    expect(actionLabel(scriptActionDefinition.id)).toBe("Ejecutar TypeScript");
    expect(node.data.node.parameters).toEqual({
      actionId: scriptActionDefinition.id,
      input: scriptActionDefinition.defaults,
    });
    expect(
      validateFlowDocument({
        ...createWorkflow(),
        workflow: {
          ...createWorkflow().workflow,
          nodes: [...createWorkflow().workflow.nodes, node.data.node],
          connections: {
            Inicio: {
              main: [[{ node: node.data.node.name, type: "main", index: 0 }]],
            },
          },
        },
      }).ok,
    ).toBe(true);
  });
  it("exposes the complete CUA catalog with matching labels, descriptions and independent defaults", () => {
    expect(
      defaultActionIds.some(
        (id) => id.startsWith("robotjs.") || id === "robot.window.screenshot",
      ),
    ).toBe(false);
    for (const action of cuaActionDefinitions) {
      expect(defaultActionIds).toContain(action.id);
      expect(actionLabel(action.id)).toBe(action.name);
      expect(actionDescription(action.id)).toBe(action.description);
      const node = makeEditorNode(
        "rpa.action",
        [],
        { x: 10, y: 20 },
        action.id,
      );
      expect(node.data.node.parameters).toEqual({
        actionId: action.id,
        input: action.defaults,
      });
      const defaults = actionInputDefaults(action.id);
      defaults.changed = true;
      expect(actionInputDefaults(action.id)).toEqual(action.defaults);
    }
  });
  it("connects named branches and preserves them after renaming and moving a node", () => {
    const doc = createWorkflow();
    const { nodes, edges } = workflowToDiagram(doc);
    const branch = makeEditorNode("rpa.if", nodes, { x: 300, y: 160 });
    const end = makeEditorNode("rpa.end", [...nodes, branch], {
      x: 600,
      y: 260,
    });
    nodes.push(branch, end);
    edges.push(editorConnection(nodes, edges, "start", branch.id, 0)!);
    edges.push(editorConnection(nodes, edges, branch.id, end.id, 1)!);
    branch.data.node.name = "¿Hay resultados?";
    branch.position = { x: 400, y: 200 };
    const result = diagramToWorkflow(doc, nodes, edges);
    expect(result.workflow.connections.Inicio?.main[0]?.[0]?.node).toBe(
      "¿Hay resultados?",
    );
    expect(
      result.workflow.connections["¿Hay resultados?"]?.main[1]?.[0]?.node,
    ).toBe("Fin");
    expect(
      result.workflow.nodes.find((n) => n.id === branch.id)?.position,
    ).toEqual([400, 200]);
    expect(workflowToDiagram(result).edges.map((e) => e.sourceHandle)).toEqual([
      "main:0",
      "main:1",
    ]);
  });
  it("rejects duplicate connections, invalid ports, trigger inputs and self connections", () => {
    const { nodes, edges } = workflowToDiagram(createWorkflow());
    const end = makeEditorNode("rpa.end", nodes, { x: 300, y: 160 });
    nodes.push(end);
    const edge = editorConnection(nodes, edges, "start", end.id, 0)!;
    expect(edge).not.toBeNull();
    edges.push(edge);
    expect(editorConnection(nodes, edges, "start", end.id, 0)).toBeNull();
    expect(editorConnection(nodes, edges, "start", end.id, 1)).toBeNull();
    expect(editorConnection(nodes, edges, end.id, "start", 0)).toBeNull();
    expect(editorConnection(nodes, edges, "start", "start", 0)).toBeNull();
  });
  it("keeps valid loops and detects disconnected nodes through shared validation", () => {
    const doc = createWorkflow();
    const { nodes, edges } = workflowToDiagram(doc);
    const loop = makeEditorNode("rpa.forEach", nodes, { x: 300, y: 160 });
    const body = makeEditorNode("rpa.noOp", nodes, { x: 600, y: 80 });
    const end = makeEditorNode("rpa.end", nodes, { x: 600, y: 300 });
    nodes.push(loop, body, end);
    for (const [source, target, port] of [
      ["start", loop.id, 0],
      [loop.id, body.id, 0],
      [loop.id, end.id, 1],
      [body.id, loop.id, 0],
    ] as const)
      edges.push(editorConnection(nodes, edges, source, target, port)!);
    expect(validateFlowDocument(diagramToWorkflow(doc, nodes, edges)).ok).toBe(
      true,
    );
    nodes.push(makeEditorNode("rpa.noOp", nodes, { x: 900, y: 300 }));
    expect(validateFlowDocument(diagramToWorkflow(doc, nodes, edges)).ok).toBe(
      false,
    );
  });
  it("creates unique action nodes with the requested action and retains protected metadata", () => {
    const { nodes } = workflowToDiagram(createWorkflow());
    const node = makeEditorNode(
      "rpa.action",
      nodes,
      { x: 300, y: 160 },
      "playwright.page.type",
    );
    nodes.push(node);
    expect(node.data.node.parameters).toEqual({
      actionId: "playwright.page.type",
      input: { selector: "", text: "", clearFirst: true },
    });
    expect(uniqueNodeName(node.data.node.name, nodes)).toBe(
      `${node.data.node.name} 2`,
    );
    node.data.node.sensitiveOutput = true;
    expect(
      diagramToWorkflow(createWorkflow(), nodes, []).workflow.nodes[1]
        ?.sensitiveOutput,
    ).toBe(true);
  });
  it("supports bounded undo and redo, drops redo after a new edit, and ignores duplicate snapshots", () => {
    const history = createEditorHistory("a", 3);
    history.push("b");
    history.push("b");
    history.push("c");
    expect(history.undo()).toBe("b");
    expect(history.redo()).toBe("c");
    expect(history.undo()).toBe("b");
    history.push("d");
    expect(history.canRedo).toBe(false);
    history.push("e");
    expect(history.undo()).toBe("d");
    expect(history.undo()).toBe("b");
    expect(history.undo()).toBeUndefined();
  });
});

describe("workflow presets", () => {
  it.each(["macos", "windows", "linux"] as const)(
    "creates valid connected presets for %s",
    (platform) => {
      for (const preset of workflowPresets) {
        const document = createWorkflowPreset(preset.id, platform);
        expect(
          validateFlowDocument(document, {
            knownActionIds: new Set(defaultActionIds),
          }).ok,
        ).toBe(true);
        const diagram = workflowToDiagram(document);
        expect(diagram.edges).toHaveLength(diagram.nodes.length - 1);
        expect(document.workflow.nodes.at(-1)?.type).toBe("rpa.end");
      }
    },
  );
  it("launches the calculator application for the selected agent platform", () => {
    for (const [platform, application] of [
      ["macos", "com.apple.calculator"],
      ["windows", "calc.exe"],
      ["linux", "gnome-calculator"],
    ] as const) {
      const node = createWorkflowPreset("calculator", platform).workflow
        .nodes[1]!;
      expect(node.type).toBe("rpa.action");
      expect(node.parameters).toEqual({
        actionId: "cua.app.launch",
        input: { application },
      });
    }
  });
  it("creates independent copies so editing one preset does not change the next", () => {
    const first = createWorkflowPreset("web-screenshot", "macos");
    const second = createWorkflowPreset("web-screenshot", "macos");
    const open = first.workflow.nodes[1]!;
    if (open.type === "rpa.action")
      open.parameters.input.url = "https://changed.invalid";
    expect(second.workflow.id).not.toBe(first.workflow.id);
    expect(second.workflow.nodes[1]!.id).not.toBe(first.workflow.nodes[1]!.id);
    expect(second.workflow.nodes[1]!.parameters).toEqual({
      actionId: "playwright.browser.openTab",
      input: { url: "https://example.com" },
    });
  });
});
