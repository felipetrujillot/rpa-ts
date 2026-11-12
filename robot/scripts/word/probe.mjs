import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { arch, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { StringDecoder } from 'node:string_decoder';

const here = dirname(fileURLToPath(import.meta.url));

// Killing the helper never proves that Word stopped processing an Apple event/COM call.
export function runProcess(command, args, { timeoutMs = 60000, signal, onLine, maxBytes = 1_000_000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error('timeoutMs inválido');
  return new Promise((resolveResult) => {
    let stdout = '', stderr = '', spawnError, interruptionReason, escalation;
    let bytes = 0;
    const child = spawn(command, args, { shell: false, windowsHide: true });
    const interrupt = reason => {
      if (interruptionReason) return;
      interruptionReason = reason;
      child.kill();
      escalation = setTimeout(() => child.kill('SIGKILL'), 1000);
    };
    const abort = () => interrupt('cancelled');
    const timer = setTimeout(() => interrupt('timeout'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const stream = (source, append) => {
      const decoder = new StringDecoder('utf8');
      let pending = '';
      const consume = text => {
        append(text);
        pending += text;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop();
        lines.forEach(line => onLine?.(line));
      };
      source?.on('data', data => {
        bytes += data.length;
        if (bytes > maxBytes) { interrupt('response-too-large'); return; }
        consume(decoder.write(data));
      });
      source?.on('end', () => { consume(decoder.end()); if (pending) onLine?.(pending); });
    };
    stream(child.stdout, text => { stdout += text; });
    stream(child.stderr, text => { stderr += text; });
    child.on('error', error => { spawnError = error.message; });
    child.on('close', code => {
      clearTimeout(timer);
      clearTimeout(escalation);
      signal?.removeEventListener('abort', abort);
      resolveResult({ code, stdout, stderr, interrupted: !!interruptionReason, interruptionReason, spawnError });
    });
  });
}

export function nativeInvocation(platform, request, requestPath) {
  if (platform === 'darwin') return { command: '/usr/bin/osascript', args:
    [join(here, 'probe.applescript'), request.working, request.output, request.pdf, request.marker, request.replacement, request.expected] };
  if (platform === 'win32') return { command: 'powershell.exe', args:
    ['-NoProfile', '-NonInteractive', '-File', join(here, 'probe.ps1'), '-RequestPath', requestPath] };
  throw new Error('Plataforma no soportada');
}

export function classifyEffect(events, helper) {
  if (events.some(event => ['opening', 'writing', 'saving', 'exporting', 'reopening'].includes(event.stage))) return 'uncertain';
  // A missing or truncated native response is never evidence of absence of effects.
  if (helper.interruptionReason === 'response-too-large' || (helper.code === 0 && !events.length)) return 'uncertain';
  return 'none';
}

export async function probe({ artifacts = resolve('artifacts/word'), timeoutMs = 60000, signal } = {}) {
  if (!['darwin', 'win32'].includes(process.platform)) throw new Error('Word de escritorio requiere macOS o Windows.');
  await mkdir(artifacts, { recursive: true });
  const directory = await mkdtemp(join(artifacts, 'Prueba Word ñ '));
  const python = process.env.RPA_WORD_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const report = { schemaVersion: 1, startedAt: new Date().toISOString(), platform: process.platform,
    osRelease: release(), arch: arch(), node: process.version, directory,
    mode: 'attended-desktop-local-files', adapter: process.platform === 'darwin' ? 'applescript' : 'com',
    status: 'failed', effect: 'none', events: [] };
  const checked = async (command, args) => {
    const result = await runProcess(command, args, { timeoutMs, signal });
    if (result.code !== 0 || result.interrupted) throw new Error(JSON.stringify(result));
    return result.stdout;
  };
  try {
    if (process.platform === 'darwin') {
      report.osVersion = (await checked('/usr/bin/sw_vers', ['-productVersion'])).trim();
      report.wordVersion = (await checked('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', '/Applications/Microsoft Word.app/Contents/Info.plist'])).trim();
      report.wordBuild = (await checked('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion', '/Applications/Microsoft Word.app/Contents/Info.plist'])).trim();
    }
    // Fail before starting Word if independent verification dependencies are absent.
    await checked('pdftotext', ['-v']);
    const fixture = JSON.parse(await checked(python, [join(here, 'fixture.py'), 'create', directory]));
    const request = { ...fixture, working: join(directory, 'Copia de trabajo ñ.docx'),
      output: join(directory, 'Resultado ñ.docx'), pdf: join(directory, 'Resultado ñ.pdf'),
      pdfText: join(directory, 'Resultado ñ.txt') };
    await copyFile(request.source, request.working, constants.COPYFILE_EXCL);
    const requestPath = join(directory, 'request.json');
    await writeFile(requestPath, JSON.stringify(request, null, 2), { flag: 'wx' });
    const { command, args } = nativeInvocation(process.platform, request, requestPath);
    report.helper = await runProcess(command, args, { timeoutMs, signal, onLine: line => {
      try {
        const event = JSON.parse(line);
        if (typeof event.stage === 'string') report.events.push({ ...event, at: new Date().toISOString() });
      } catch { /* Native diagnostics remain in helper.stdout/stderr. */ }
    } });
    const stages = report.events.map(event => event.stage);
    report.effect = classifyEffect(report.events, report.helper);
    if (process.platform === 'win32') {
      const connected = report.events.find(event => event.stage === 'connected');
      report.wordVersion = connected?.version;
      report.wordBuild = connected?.build;
    }
    if (report.helper.code !== 0 || report.helper.interrupted || !stages.includes('completed')) {
      throw new Error('El auxiliar no completó el circuito; revisar helper y reconciliar los documentos antes de repetir.');
    }
    report.wordVersion = process.platform === 'darwin' ? report.helper.stdout.trim()
      : report.events.find(event => event.stage === 'connected')?.version;
    await checked('pdftotext', ['-enc', 'UTF-8', request.pdf, request.pdfText]);
    report.verification = JSON.parse(await checked(python, [join(here, 'fixture.py'), 'verify', requestPath]));
    if (!report.verification.ok) throw new Error('La verificación independiente de los archivos falló.');
    report.effect = 'confirmed';
    report.cleanup = 'completed';
    report.status = 'passed';
    report.sourceSha256 = createHash('sha256').update(await readFile(request.source)).digest('hex');
  } catch (error) {
    report.error = String(error.message || error);
    report.cleanup = report.events.some(event => event.stage === 'cleanupCompleted') ? 'completed'
      : report.events.some(event => event.stage === 'opening') ? 'unconfirmed' : 'not-needed';
  }
  report.finishedAt = new Date().toISOString();
  const reportPath = join(directory, 'report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  return { ...report, reportPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  const report = await probe({ signal: controller.signal });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
