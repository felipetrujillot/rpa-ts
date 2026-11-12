import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createConnection } from "mysql2/promise";

const name = `rpa-tests-${process.pid}`;
const password = randomBytes(24).toString("hex");
const run = (args) => {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "Docker failed");
  return result.stdout.trim();
};
try {
  run([
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "-e",
    `MARIADB_ROOT_PASSWORD=${password}`,
    "-e",
    "MARIADB_DATABASE=rpa_test",
    "-p",
    "127.0.0.1::3306",
    "mariadb:10.11.16",
  ]);
  const port = run(["port", name, "3306/tcp"]).split(":").at(-1);
  const url = `mysql://root:${password}@127.0.0.1:${port}/rpa_test`;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const connection = await createConnection(url);
      await connection.end();
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!ready) throw new Error("La base de pruebas no inició.");
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "orquestador/vitest.config.ts",
    ],
    {
      stdio: "inherit",
      env: { ...process.env, RPA_TEST_DATABASE_URL: url },
    },
  );
  process.exitCode = result.status ?? 1;
} finally {
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
}
