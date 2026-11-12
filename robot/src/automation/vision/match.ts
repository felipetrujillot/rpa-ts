import { Worker } from "node:worker_threads";
import workerSource from "./match.worker.cjs?raw";
import type { ImageMatch, ImageSearchOptions } from "./types";

export async function findImage(
  screenshot: string,
  reference: Buffer,
  options: ImageSearchOptions,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ImageMatch[]> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: {
        screenshot,
        reference,
        options,
        sharpPath: require.resolve("sharp"),
        opencvPath: require.resolve("@techstark/opencv-js"),
      },
      resourceLimits: {
        maxOldGenerationSizeMb: 256,
        maxYoungGenerationSizeMb: 32,
      },
    });
    let settled = false;
    const finish = (matches?: ImageMatch[], error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      const complete = () => (error ? reject(error) : resolve(matches!));
      void worker.terminate().then(complete, complete);
    };
    const cancel = () => finish(undefined, new Error("Ejecución cancelada."));
    const timer = setTimeout(
      () =>
        finish(undefined, new Error("Tiempo de búsqueda de imagen agotado.")),
      timeoutMs,
    );
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    worker.once("message", (message) => {
      if (message.ok) finish(message.matches);
      else finish(undefined, new Error(message.error));
    });
    worker.once("error", (error) => finish(undefined, error));
    worker.once("exit", (code) => {
      if (!settled)
        finish(
          undefined,
          new Error(`El motor visual terminó sin resultado (${code}).`),
        );
    });
  });
}
