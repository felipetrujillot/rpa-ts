import { afterAll, beforeAll, expect, it } from "vitest";
import { _electron, type ElectronApplication } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let electron: ElectronApplication;
let profile: string;
beforeAll(async () => {
  profile = await mkdtemp(join(tmpdir(), "rpa-script-smoke-"));
  const env = { ...process.env, RPA_UI_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  electron = await _electron.launch({
    args: [resolve("tests/ui/fixtures/script-main.cjs")],
    env,
  });
});
afterAll(async () => {
  await electron?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});
it("executes the TypeScript WASM worker inside Electron without exposing Node", async () => {
  const result = await electron.evaluate(async () => {
    const run = (
      globalThis as unknown as {
        runScriptSmoke: (code: string) => Promise<unknown>;
      }
    ).runScriptSmoke;
    return await run(
      "const name: string = input.name; log(name); return { name, node: typeof process };",
    );
  });
  expect(result).toMatchObject({
    ok: true,
    result: { name: "Electron", node: "undefined" },
    logs: [["Electron"]],
  });
});
