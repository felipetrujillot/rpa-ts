const { test } = require('node:test');
const assert = require('node:assert/strict');
const c = require('../dist');
const range = { workbookId: 'book', worksheetId: 'sheet', address: 'A1:B2' };
test('Excel bounds, rectangular matrices, literal values and invariant formulas', () => {
  assert.deepEqual(c.parseExcelAddress('$XFD$1048576'), { firstColumn: 16384, firstRow: 1048576, rows: 1, columns: 1 });
  for (const address of ['A:A', '1:2', 'A0', 'XFE1', 'A1048577', 'B2:A1', 'A1,B2', 'Sheet1!A1', 'A1:Z1000', 'A01']) assert.throws(() => c.parseExcelAddress(address));
  for (const values of [[], [[]], [[1], [2, 3]], [[NaN, 0], [1, 2]], [[Infinity, 0], [1, 2]]]) assert.throws(() => c.validateExcelInput('excel.range.writeValues', { ...range, values }));
  const values = [['001', '=SUM(A1)'], [null, '']];
  assert.deepEqual(c.validateExcelInput('excel.range.writeValues', { ...range, values }).values, values);
  assert.throws(() => c.validateExcelInput('excel.range.format', { ...range, format: { unsupported: true } }));
  assert.throws(() => c.validateExcelInput('excel.workbook.close', { workbookId: 'book' }));
  for (const f of ['SUM(A1)', '=SUM(A1;A2)', '=[external.xlsx]Hoja1!A1', '=WEBSERVICE("https://example.com")', '=SEQUENCE(3)', '=A1#']) assert.throws(() => c.validateExcelInput('excel.range.writeFormulas', { ...range, address: 'C1', formulas: [[f]] }));
  assert.equal(c.validateExcelInput('excel.range.writeFormulas', { ...range, address: 'C1', formulas: [['=SUM(A1:B2)']] }).syntax, 'A1-invariant');
});
test('Excel validates literal dimensions around unresolved typed references', () => {
  assert.throws(() => c.validateExcelTemplate('excel.range.writeValues', { ...range, workbookId: { $ref: 'last.workbookId' }, values: [[1]] }));
  assert.doesNotThrow(() => c.validateExcelTemplate('excel.range.writeValues', { ...range, values: { $ref: 'input.matrix' } }));
  assert.throws(() => c.validateExcelTemplate('excel.range.clear', { ...range, address: 'A:A' }));
  const matrix = Array.from({ length: 100 }, () => ["a".repeat(20000)]);
  assert.throws(() => c.validateExcelInput('excel.range.writeValues', { ...range, address: 'A1:A100', values: matrix }), /1 MB/);
});
test('Plugin requirements survive interchange, serialization and checksums without upgrading versions', async () => {
  const flow = c.createWorkflow();
  flow.workflow.nodes.push({ id: 'open', name: 'Open', type: 'rpa.action', typeVersion: 1, position: [10, 10], parameters: { actionId: 'excel.workbook.open', input: { path: '/tmp/template.xlsx' } } });
  flow.workflow.connections.Inicio = { main: [[{ node: 'Open', type: 'main', index: 0 }]] };
  const pinned = c.pinExcelRequirements(flow);
  assert.equal(pinned.pluginRequirements[0].actions['excel.workbook.open'], '1.0.0');
  const roundtrip = c.importN8nWorkflow(c.exportN8nWorkflow(pinned));
  assert.equal(roundtrip.ok, true);
  assert.deepEqual(roundtrip.normalized.pluginRequirements, pinned.pluginRequirements);
  assert.equal(c.validateFlowDocument(JSON.parse(JSON.stringify(pinned))).ok, true);
  const changed = structuredClone(pinned); changed.pluginRequirements[0].actions['excel.workbook.open'] = '2.0.0';
  assert.notEqual(await c.computeFlowChecksum(pinned), await c.computeFlowChecksum(changed));
  assert.equal(c.pinExcelRequirements(changed).pluginRequirements[0].actions['excel.workbook.open'], '2.0.0');
});
test('Plugin compatibility rejects stale inventory, unavailable plugins and mismatched action versions', () => {
  const req = c.excelPluginRequirement(['excel.range.read']);
  const plugin = { ...req, available: true, platform: 'darwin', capabilities: [], permissions: [], verified: false };
  const inventory = { sampledAt: new Date().toISOString(), plugins: [plugin] };
  assert.deepEqual(c.pluginCompatibility([req], inventory), []);
  assert.equal(c.pluginCompatibility([req], { ...inventory, sampledAt: new Date(Date.now() - 31000).toISOString() }).length, 1);
  assert.equal(c.pluginCompatibility([req], { ...inventory, plugins: [{ ...plugin, actions: {} }] }).length, 1);
  assert.equal(c.pluginCompatibility([req], { ...inventory, plugins: [{ ...plugin, available: false }] }).length, 1);
  assert.equal(c.hasUncertainEffect({ code: 'ACTION_EFFECT_UNCERTAIN' }), true);
});
