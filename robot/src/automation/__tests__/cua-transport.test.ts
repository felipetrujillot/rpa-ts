import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

import { spawn } from 'node:child_process';
import { callCua } from '../drivers/cua-driver';

describe('CUA CLI transport', () => {
  let child: EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
    });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  });

  it('reports a missing application as a definite failure so the queue can continue', async () => {
    const result = callCua('launch_app', { bundle_id: 'calculator', session: 'test' });
    child.stdout.write(JSON.stringify({ error: 'APP_NOT_INSTALLED', bundle_id: 'calculator' }));
    child.emit('close', 1, null);
    await expect(result).rejects.toThrow(/^launch_app: APP_NOT_INSTALLED$/);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('keeps generic tool errors uncertain even when returned as JSON', async () => {
    const result = callCua('click', {});
    child.stdout.write(JSON.stringify({ result: { isError: true, content: [{ type: 'text', text: 'delivery failed' }] } }));
    child.emit('close', 1, null);
    await expect(result).rejects.toThrow('CUA_DRIVER_UNCERTAIN_OR_UNAVAILABLE: click: delivery failed');
  });

  it('reports an explicit refusal without blocking the queue for reconciliation', async () => {
    const result = callCua('click', {});
    child.stdout.write(JSON.stringify({ effect: 'refused', error: 'NOT_ALLOWED' }));
    child.emit('close', 1, null);
    await expect(result).rejects.toThrow(/^click: NOT_ALLOWED$/);
  });

  it('keeps a killed process uncertain even if it also reported a missing application', async () => {
    const result = callCua('launch_app', {});
    child.stdout.write(JSON.stringify({ error: 'APP_NOT_INSTALLED' }));
    child.emit('close', 1, 'SIGTERM');
    await expect(result).rejects.toThrow('CUA_DRIVER_UNCERTAIN_OR_UNAVAILABLE');
  });

  it('preserves stderr diagnostics', async () => {
    const result = callCua('list_apps', {});
    child.stderr.write('daemon unavailable\n');
    child.emit('close', 1, null);
    await expect(result).rejects.toThrow('list_apps: daemon unavailable');
  });

  it('keeps abnormal termination uncertain even with a successful stdout response', async () => {
    const result = callCua('launch_app', {});
    child.stdout.write(JSON.stringify({ pid: 10 }));
    child.emit('close', null, 'SIGTERM');
    await expect(result).rejects.toThrow('CUA_DRIVER_UNCERTAIN_OR_UNAVAILABLE: launch_app: SIGTERM');
  });

  it('parses successful CLI responses', async () => {
    const result = callCua('list_apps', {});
    child.stdout.write(JSON.stringify({ apps: [] }));
    child.emit('close', 0, null);
    await expect(result).resolves.toEqual({ apps: [], images: [] });
  });
});
