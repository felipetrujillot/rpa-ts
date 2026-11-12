import {
  validateFlowDocument,
  hasUncertainEffect,
  pluginCompatibility,
  pinBuiltinPluginRequirements,
  type FlowDocument,
  type FlowValue,
  type FlowExpression,
  type FlowRuntimeContext,
  type FlowExecutionEnvironment,
  type FlowExecutionResult,
  type FlowNodeRun,
  type WorkflowNode,
  type AutomationInput,
  type NodeEventListener,
} from "@rpa/contracts";
type State = {
  input: Record<string, unknown>;
  vars: Record<string, unknown>;
  nodeOutputs: Record<string, unknown>;
  last?: unknown;
  json: Record<string, unknown>;
};
const blocked = new Set(["__proto__", "prototype", "constructor"]);
const get = (state: State, path: string): unknown => {
  let value: unknown = state;
  for (const part of path.split(".")) {
    if (blocked.has(part)) throw new Error("Referencia reservada.");
    if (
      value === null ||
      typeof value !== "object" ||
      !Object.hasOwn(value, part)
    )
      return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
};
export const resolveTemplate = (template: FlowValue, state: State): unknown => {
  if (Array.isArray(template))
    return template.map((value) => resolveTemplate(value, state));
  if (template && typeof template === "object") {
    if ("$ref" in template) return get(state, String(template.$ref));
    return Object.fromEntries(
      Object.entries(template).map(([key, value]) => [
        key,
        resolveTemplate(value, state),
      ]),
    );
  }
  if (typeof template === "string") {
    const exact = /^\{\{\s*([\w.\-]+)\s*\}\}$/.exec(template);
    if (exact) return get(state, exact[1]!);
    return template.replace(/\{\{\s*([\w.\-]+)\s*\}\}/g, (_, path: string) => {
      const value = get(state, path);
      return value === undefined
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    });
  }
  return template;
};
const evaluate = (expression: FlowExpression, state: State): boolean => {
  switch (expression.op) {
    case "and":
      return expression.args.every((arg) => evaluate(arg, state));
    case "or":
      return expression.args.some((arg) => evaluate(arg, state));
    case "not":
      return !evaluate(expression.arg, state);
    case "truthy":
      return Boolean(resolveTemplate(expression.value, state));
    case "falsy":
      return !resolveTemplate(expression.value, state);
    default: {
      const left = resolveTemplate(expression.left, state),
        right = resolveTemplate(expression.right, state);
      switch (expression.op) {
        case "eq":
          return JSON.stringify(left) === JSON.stringify(right);
        case "ne":
          return JSON.stringify(left) !== JSON.stringify(right);
        case "gt":
          return Number(left) > Number(right);
        case "gte":
          return Number(left) >= Number(right);
        case "lt":
          return Number(left) < Number(right);
        case "lte":
          return Number(left) <= Number(right);
        case "contains":
          return Array.isArray(left)
            ? left.includes(right)
            : typeof left === "string" && left.includes(String(right));
        case "in":
          return Array.isArray(right)
            ? right.includes(left)
            : typeof right === "string" && right.includes(String(left));
      }
    }
  }
};
const fail = (code: string, message: string) =>
  Object.assign(new Error(message), { code });
const json = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value };
export const executeFlowDocument = async (
  document: FlowDocument,
  runtime: FlowRuntimeContext,
  environment: FlowExecutionEnvironment,
  options: {
    signal?: AbortSignal;
    now?: () => Date;
    onNodeEvent?: NodeEventListener;
  } = {},
): Promise<FlowExecutionResult> => {
  const now = options.now || (() => new Date());
  const startedAt = now().toISOString();
  const nodeRuns: FlowNodeRun[] = [];
  const state: State = {
    input: runtime.input || {},
    vars: {},
    nodeOutputs: {},
    json: runtime.input || {},
  };
  const output = (
    status: FlowExecutionResult["status"],
    error?: FlowExecutionResult["error"],
  ): FlowExecutionResult => ({
    status,
    startedAt,
    finishedAt: now().toISOString(),
    nodeRuns,
    outputs: {
      vars: state.vars,
      nodeOutputs: state.nodeOutputs,
      last: state.last,
    },
    error,
  });
  const validated = validateFlowDocument(document);
  if (!validated.ok || !validated.normalized)
    return output("failed", {
      code: "INVALID_WORKFLOW",
      message: validated.errors
        .map((error) => `${error.path}: ${error.message}`)
        .join("; "),
    });
  const compatibility = pluginCompatibility(pinBuiltinPluginRequirements(validated.normalized).pluginRequirements ?? [], environment.plugins);
  if (compatibility.length) return output("failed", { code: "PLUGIN_INCOMPATIBLE", message: compatibility.join(" ") });
  const workflow = validated.normalized.workflow;
  const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
  state.vars = resolveTemplate(workflow.variables, state) as Record<
    string,
    unknown
  >;
  const trigger = workflow.nodes.find(
    (node) => node.type === "rpa.manualTrigger",
  )!;
  const queue: Array<{ node: WorkflowNode; json: Record<string, unknown> }> = [
    { node: trigger, json: state.json },
  ];
  const loops = new Map<string, { index: number; items?: unknown[] }>();
  let executions = 0;
  while (queue.length) {
    if (options.signal?.aborted)
      return output("cancelled", {
        code: "FLOW_CANCELLED",
        message: "Ejecución cancelada.",
      });
    if (++executions > workflow.settings.maxNodeExecutions)
      return output("failed", {
        code: "NODE_EXECUTION_LIMIT",
        message: "Se alcanzó el límite de ejecuciones de nodos.",
      });
    const task = queue.shift()!;
    const node = task.node;
    state.json = task.json;
    const run: FlowNodeRun = {
      nodeId: node.id,
      nodeName: node.name,
      type: node.type,
      status: "success",
      startedAt: now().toISOString(),
      finishedAt: "",
      outputIndex: 0,
    };
    if (options.onNodeEvent)
      await options.onNodeEvent({
        phase: "started",
        executionIndex: executions,
        node: {
          nodeId: node.id,
          nodeName: node.name,
          type: node.type,
          startedAt: run.startedAt,
        },
      });
    let value: unknown = task.json;
    let port = 0;
    try {
      if (options.signal?.aborted)
        throw fail("FLOW_CANCELLED", "Ejecución cancelada.");
      if (!node.disabled)
        switch (node.type) {
          case "rpa.manualTrigger":
            break;
          case "rpa.action": {
            const input = resolveTemplate(
              node.parameters.actionId === "script.typescript.run"
                ? Object.fromEntries(
                    Object.entries(node.parameters.input).filter(
                      ([key]) => key !== "code" && key !== "allowedActions",
                    ),
                  )
                : node.parameters.input,
              state,
            ) as AutomationInput;
            // Source is literal: interpolating workflow values into code enables code injection.
            if (node.parameters.actionId === "script.typescript.run") {
              if (typeof node.parameters.input.code !== "string")
                throw fail(
                  "SCRIPT_VALIDATION_ERROR",
                  "code debe ser texto literal. Pasa los valores mediante data.",
                );
              input.code = node.parameters.input.code;
              input.allowedActions = node.parameters.input.allowedActions ?? [];
            }
            // Word's search marker is literal; explicit $ref objects still resolve normally.
            if (node.parameters.actionId === "word.document.replaceText" && typeof node.parameters.input.find === "string")
              input.find = node.parameters.input.find;
            const result = await environment.runAction(
              node.parameters.actionId,
              input,
            );
            value = result.output;
            if (node.parameters.actionId === "script.typescript.run")
              run.output = value;
            if (!result.ok)
              throw fail(result.errorCode || "ACTION_FAILED", result.message);
            break;
          }
          case "rpa.set": {
            const values = resolveTemplate(
              node.parameters.values,
              state,
            ) as Record<string, unknown>;
            Object.assign(state.vars, values);
            value = values;
            break;
          }
          case "rpa.if": {
            const branch = evaluate(node.parameters.condition, state);
            port = branch ? 0 : 1;
            value = { branch };
            break;
          }
          case "rpa.while": {
            const loop = loops.get(node.id) || { index: 0 };
            if (!evaluate(node.parameters.condition, state)) {
              port = 1;
              loops.delete(node.id);
              value = { iterations: loop.index };
            } else {
              if (loop.index >= node.parameters.maxIterations)
                throw fail("LOOP_LIMIT", "El bucle alcanzó su límite.");
              loop.index++;
              loops.set(node.id, loop);
              value = { iteration: loop.index };
            }
            break;
          }
          case "rpa.forEach": {
            let loop = loops.get(node.id);
            if (!loop) {
              const items = resolveTemplate(node.parameters.items, state);
              if (!Array.isArray(items))
                throw fail("INVALID_ITEMS", "El bucle requiere una lista.");
              if (items.length > node.parameters.maxIterations)
                throw fail(
                  "LOOP_LIMIT",
                  "La lista supera el límite del bucle.",
                );
              loop = { index: 0, items: [...items] };
              loops.set(node.id, loop);
            }
            if (loop.index >= loop.items!.length) {
              port = 1;
              loops.delete(node.id);
              value = { iterations: loop.index };
            } else {
              const item = loop.items![loop.index];
              state.vars[node.parameters.itemVar] = item;
              if (node.parameters.indexVar)
                state.vars[node.parameters.indexVar] = loop.index;
              value = { item, index: loop.index++ };
            }
            break;
          }
          case "rpa.noOp":
            break;
          case "rpa.end":
            port = -1;
            break;
        }
      run.output = value;
      run.outputIndex = port;
      state.nodeOutputs[node.id] = value;
      state.last = value;
    } catch (error) {
      run.status = "failed";
      run.error = {
        message: error instanceof Error ? error.message : String(error),
        code:
          typeof (error as { code?: unknown })?.code === "string"
            ? (error as { code: string }).code
            : "NODE_FAILED",
      };
      if (
        node.onError !== "continueRegularOutput" ||
        hasUncertainEffect(run.error)
      ) {
        run.finishedAt = now().toISOString();
        nodeRuns.push(run);
        if (options.onNodeEvent)
          await options.onNodeEvent({
            phase: "finished",
            executionIndex: executions,
            node: run,
          });
        return options.signal?.aborted
          ? output("cancelled", {
              code: "FLOW_CANCELLED",
              message: "Ejecución cancelada.",
            })
          : output("failed", { ...run.error, nodeId: node.id });
      }
      value = { error: run.error };
      state.nodeOutputs[node.id] = value;
      state.last = value;
    }
    run.finishedAt = now().toISOString();
    nodeRuns.push(run);
    if (options.onNodeEvent)
      await options.onNodeEvent({
        phase: "finished",
        executionIndex: executions,
        node: run,
      });
    if (options.signal?.aborted)
      return output("cancelled", {
        code: "FLOW_CANCELLED",
        message: "Ejecución cancelada.",
      });
    if (port >= 0)
      for (const connection of workflow.connections[node.name]?.main[port] ||
        [])
        queue.push({ node: nodes.get(connection.node)!, json: json(value) });
  }
  return output("success");
};
