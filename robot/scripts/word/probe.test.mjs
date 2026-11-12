import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyEffect, nativeInvocation, runProcess } from './probe.mjs';

const node = (code, options) => runProcess(process.execPath, ['-e', code], options);

test('preserves UTF-8 and complete messages split across chunks on both streams', async () => {
  const lines = [];
  const result = await node(`
    const b = Buffer.from('{"stage":"writing","text":"ñ"}\\n');
    const split = b.indexOf(0xc3) + 1;
    process.stderr.write(b.subarray(0, split));
    setTimeout(() => { process.stderr.write(b.subarray(split)); process.stdout.write('fin'); }, 30);
  `, { onLine: line => lines.push(line) });
  assert.equal(result.code, 0);
  assert.deepEqual(lines, ['{"stage":"writing","text":"ñ"}', 'fin']);
  assert.equal(result.stderr, '{"stage":"writing","text":"ñ"}\n');
});

test('timeout interrupts only the helper and retains evidence of a possible effect', async () => {
  const events = [];
  const result = await node(`console.log('{"stage":"writing"}'); setInterval(() => {}, 1000);`, {
    timeoutMs: 500,
    onLine: line => events.push(JSON.parse(line)),
  });
  assert.equal(result.interruptionReason, 'timeout');
  assert.equal(classifyEffect(events, result), 'uncertain');
});

test('cancellation reaches the helper without retrying', async () => {
  const controller = new AbortController();
  const result = await node(`console.log('ready'); setInterval(() => {}, 1000);`, {
    signal: controller.signal, onLine: () => controller.abort(),
  });
  assert.equal(result.interruptionReason, 'cancelled');
});

test('already cancelled requests do not remain running', async () => {
  const controller = new AbortController();
  controller.abort();
  assert.equal((await node('setInterval(() => {}, 1000)', { signal: controller.signal })).interrupted, true);
});

test('oversized responses are bounded and uncertain', async () => {
  const result = await node(`process.stdout.write('a'.repeat(20000));`, { maxBytes: 1024 });
  assert.equal(result.interruptionReason, 'response-too-large');
  assert.ok(result.stdout.length <= 1024);
  assert.equal(classifyEffect([], result), 'uncertain');
});

test('a missing helper is a failure rather than a passed probe', async () => {
  const result = await runProcess('rpa-word-helper-that-does-not-exist', []);
  assert.match(result.spawnError, /ENOENT/);
  assert.notEqual(result.code, 0);
});

test('a closed document does not erase uncertainty about unverified writes', () => {
  assert.equal(classifyEffect([{ stage: 'writing' }, { stage: 'cleanupCompleted' }], { code: 1 }), 'uncertain');
  assert.equal(classifyEffect([{ stage: 'inspectingDocuments' }], { code: null, interruptionReason: 'timeout' }), 'none');
  assert.equal(classifyEffect([], { code: 0 }), 'uncertain');
});

test('native invocation uses data arguments and static files on both platforms', () => {
  const dangerous = 'ñ " \\ $(touch nope) `text`\n^&';
  const request = { working: dangerous, output: dangerous, pdf: dangerous, marker: dangerous, replacement: dangerous, expected: dangerous };
  const mac = nativeInvocation('darwin', request, dangerous);
  assert.equal(mac.command, '/usr/bin/osascript');
  assert.match(mac.args[0], /probe\.applescript$/);
  assert.deepEqual(mac.args.slice(1), Array(6).fill(dangerous));
  const windows = nativeInvocation('win32', request, dangerous);
  assert.equal(windows.command, 'powershell.exe');
  assert.equal(windows.args.at(-1), dangerous);
  assert.equal(windows.args.includes('-Command'), false);
  assert.throws(() => nativeInvocation('linux', request, dangerous));
});

test('shared DOCX fixture and independent verifier reject invalid results', async () => {
  const directory = dirname(fileURLToPath(import.meta.url));
  const python = process.env.RPA_WORD_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const result = await runProcess(python, [join(directory, 'fixture_test.py')]);
  assert.equal(result.code, 0, result.stderr);
});
