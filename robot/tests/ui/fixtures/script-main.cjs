const { app } = require("electron");
const { Worker } = require("node:worker_threads");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

app.setPath("userData", process.env.RPA_UI_USER_DATA);
global.runScriptSmoke = (code) =>
  new Promise((resolveResult, reject) => {
    const worker = new Worker(
      readFileSync(resolve("src/automation/scripts/worker.cjs"), "utf8"),
      {
        eval: true,
        workerData: {
          code,
          inputJson: '{"name":"Electron"}',
          deadline: Date.now() + 5000,
          typescriptPath: require.resolve("typescript"),
          quickjsPath: require.resolve("quickjs-emscripten"),
        },
      },
    );
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error("Worker timeout"));
    }, 6000);
    worker.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.on("message", (message) => {
      if (message.type !== "done") return;
      clearTimeout(timer);
      void worker.terminate().then(() => resolveResult(message));
    });
  });
app.whenReady();
