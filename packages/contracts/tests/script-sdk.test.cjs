const { test } = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const c = require("../dist");

function diagnostics(code) {
  const file = "/virtual-sdk.ts";
  const options = {
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ES2020,
    lib: ["lib.es2020.d.ts"],
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (name, language, ...args) =>
    name === file
      ? ts.createSourceFile(
          file,
          c.scriptSdkDeclarations() + "\n" + code,
          language,
          true,
        )
      : read(name, language, ...args);
  return ts
    .getPreEmitDiagnostics(ts.createProgram([file], options, host))
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

test("Monaco SDK declarations compile, infer results and check all action signatures", () => {
  assert.deepEqual(
    diagnostics(`async function example() {
    const tab = await rpa.browser.openTab({url: 'https://example.com'});
    const tabId: string = tab.tabId;
    const response = await rpa.actions.execute('playwright.network.request', {method: 'GET', url: tab.url});
    const status: number = response.status;
    await rpa.word.document.fillTemplate({documentId: 'id', data: {nested: [{name: 'Ana', items: [null, true]}]}});
    const cells = await rpa.excel.range.read({workbookId: 'id', worksheetId: 'Sheet1', address: 'A1:B2'});
    return cells;
  }`),
    [],
  );
  const errors = diagnostics(`async function invalid() {
    await rpa.browser.openTab({url: 42});
    await rpa.browser.click({});
    await rpa.actions.execute('shell.exec', {});
    const tab = await rpa.browser.openTab({});
    const count: number = tab.tabId;
  }`);
  assert.equal(errors.length, 4, errors.join("\n"));
});

test("script-only Office actions pin plugin requirements and permissions stay literal", () => {
  const doc = c.createWorkflow();
  const node = {
    id: "s",
    name: "Script",
    type: "rpa.action",
    typeVersion: 1,
    position: [0, 0],
    parameters: {
      actionId: "script.typescript.run",
      input: {
        code: "return 1;",
        allowedActions: ["excel.workbook.open", "word.document.open"],
      },
    },
  };
  doc.workflow.nodes.push(node);
  doc.workflow.connections.Inicio = {
    main: [[{ node: "Script", type: "main", index: 0 }]],
  };
  const pinned = c.pinBuiltinPluginRequirements(doc);
  assert.deepEqual(
    new Set(pinned.pluginRequirements.map((p) => p.pluginId)),
    new Set(["excel", "word"]),
  );
  assert.equal(c.validateFlowDocument(doc).ok, true);
  for (const permissions of [
    { $ref: "input.permissions" },
    ["playwright.*"],
    ["script.typescript.run"],
  ]) {
    node.parameters.input.allowedActions = permissions;
    assert.equal(c.validateFlowDocument(doc).ok, false);
  }
  node.parameters.input.allowedActions = ["unknown.action"];
  assert.equal(c.validateFlowDocument(doc).ok, false);
});

test("desktop SDK signatures preserve required coordinates, targets and native input shapes", () => {
  assert.doesNotThrow(() =>
    c.validateScriptSdkInput("cua.mouse.click", {
      scope: "desktop",
      x: 2,
      y: 3,
    }),
  );
  assert.doesNotThrow(() =>
    c.validateScriptSdkInput("cua.mouse.click", {
      pid: 1,
      windowId: 0,
      x: 2,
      y: 3,
    }),
  );
  for (const input of [
    { scope: "desktop" },
    { x: 2, y: 3 },
    { scope: "window", pid: 1, x: 2, y: 3 },
  ])
    assert.throws(() => c.validateScriptSdkInput("cua.mouse.click", input));
  assert.throws(() =>
    c.validateScriptSdkInput("cua.menu.invoke", {
      pid: 1,
      windowId: 0,
      path: ["File", "Open"],
    }),
  );
  assert.doesNotThrow(() =>
    c.validateScriptSdkInput("cua.app.launch", {
      application: "Safari",
      urls: ["https://example.com"],
    }),
  );
});

test("persisted SDK traces tolerate redacted or unrelated output", () => {
  assert.deepEqual(c.scriptActionTraces(null), []);
  assert.deepEqual(
    c.scriptActionTraces({
      actions: [
        {},
        { sequence: 1, actionId: "x", startedAt: "date", status: "success" },
      ],
    }),
    [{ sequence: 1, actionId: "x", startedAt: "date", status: "success" }],
  );
});
