const { test } = require('node:test');
const assert = require('node:assert/strict');
const c = require('../dist');
const documentId = 'd6c8acbe-8021-4818-98eb-f0caf8d4b934';
test('Word has eight serializable versioned actions with validated input and output schemas', () => {
  assert.equal(c.wordActionDefinitions.length, 8);
  c.validatePluginManifest(JSON.parse(JSON.stringify(c.wordPluginManifest)));
  for (const a of c.wordActionDefinitions) { assert.equal(a.inputSchema.type, 'object'); assert.equal(a.outputSchema.type, 'object'); }
  assert.deepEqual(c.validateWordInput('word.document.fillTemplate', { documentId, data: { cliente: { nombre: 'María' }, items: [1, true, null] } }).data, { cliente: { nombre: 'María' }, items: [1, true, null] });
  for (const input of [{ documentId, find: '', replacement: '' }, { documentId, find: 'a', replacement: '', extra: true }]) assert.throws(() => c.validateWordInput('word.document.replaceText', input));
  assert.throws(() => c.validateWordInput('word.document.close', { documentId }));
  assert.throws(() => c.validateWordInput('word.document.fillTemplate', { documentId, data: JSON.parse('{"__proto__":"x"}') }));
});
test('Word versions persist through interchange and checksum; incompatible requirements never get silently upgraded', async () => {
  const doc = c.createWorkflow();
  doc.workflow.nodes.push({ id: 'open', name: 'Open', type: 'rpa.action', typeVersion: 1, position: [1, 1], parameters: { actionId: 'word.document.open', input: { path: '/robot/template.docx' } } });
  doc.workflow.connections.Inicio = { main: [[{ node: 'Open', type: 'main', index: 0 }]] };
  const pinned = c.pinBuiltinPluginRequirements(doc);
  assert.deepEqual(c.importN8nWorkflow(c.exportN8nWorkflow(pinned)).normalized.pluginRequirements, pinned.pluginRequirements);
  const incompatible = structuredClone(pinned); incompatible.pluginRequirements[0].sdkVersion = '2.0.0';
  assert.notEqual(await c.computeFlowChecksum(pinned), await c.computeFlowChecksum(incompatible));
  assert.equal(c.pinWordRequirements(incompatible).pluginRequirements[0].sdkVersion, '2.0.0');
  assert.equal(c.validateBuiltinPluginRequirements(incompatible).length, 1);
});
