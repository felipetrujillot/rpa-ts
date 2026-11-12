// Trusted worker: image decoding and OpenCV stay off Electron's main thread.
const { parentPort, workerData } = require("node:worker_threads");
const sharp = require(workerData.sharpPath);

async function main() {
  const module = require(workerData.opencvPath);
  let cv;
  if (module instanceof Promise) cv = await module;
  else {
    cv = module;
    if (!cv.Mat)
      await new Promise((resolve) => {
        cv.onRuntimeInitialized = resolve;
      });
  }
  const options = workerData.options;
  const decode = (data) =>
    sharp(data, { limitInputPixels: 25_000_000 })
      .rotate()
      .flatten({ background: "#ffffff" })
      .removeAlpha()
      .toColourspace("srgb");
  const reference = decode(Buffer.from(workerData.reference));
  const stats = await reference.clone().stats();
  if (!stats.channels.some((channel) => channel.stdev >= 5))
    throw new Error(
      "La referencia es demasiado uniforme. Usa un recorte con texto, bordes o un icono.",
    );
  const ref = await reference.raw().toBuffer({ resolveWithObject: true });
  const full = await decode(Buffer.from(workerData.screenshot, "base64"))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const region = options.region ?? {
    x: 0,
    y: 0,
    width: full.info.width,
    height: full.info.height,
  };
  if (
    region.x + region.width > full.info.width ||
    region.y + region.height > full.info.height
  )
    throw new Error("La región de búsqueda queda fuera de la captura.");
  const pixels = await sharp(full.data, { raw: full.info })
    .extract({
      left: region.x,
      top: region.y,
      width: region.width,
      height: region.height,
    })
    .raw()
    .toBuffer();
  const image = cv.matFromArray(
    region.height,
    region.width,
    cv.CV_8UC3,
    pixels,
  );
  const candidates = [];
  try {
    const sizes = new Set();
    for (const scale of options.scales) {
      const width = Math.max(1, Math.round(ref.info.width * scale));
      const height = Math.max(1, Math.round(ref.info.height * scale));
      if (
        width < 4 ||
        height < 4 ||
        width > region.width ||
        height > region.height ||
        sizes.has(`${width}x${height}`)
      )
        continue;
      sizes.add(`${width}x${height}`);
      const data = await sharp(ref.data, { raw: ref.info })
        .resize(width, height, { fit: "fill" })
        .raw()
        .toBuffer();
      const template = cv.matFromArray(height, width, cv.CV_8UC3, data);
      const result = new cv.Mat();
      try {
        cv.matchTemplate(image, template, result, cv.TM_CCOEFF_NORMED);
        // Bound candidate extraction even for repetitive screens. Multiple matches fail closed.
        for (let i = 0; i < 20; i++) {
          const { maxVal, maxLoc } = cv.minMaxLoc(result);
          if (!Number.isFinite(maxVal) || maxVal < options.minSimilarity) break;
          const x = maxLoc.x,
            y = maxLoc.y;
          let difference = 0;
          for (let row = 0; row < height; row++)
            for (let col = 0; col < width * 3; col++)
              difference += Math.abs(
                pixels[((y + row) * region.width + x) * 3 + col] -
                  data[row * width * 3 + col],
              );
          const similarity = Math.min(
            maxVal,
            1 - difference / (width * height * 3 * 255),
          );
          if (similarity >= options.minSimilarity)
            candidates.push({
              x: x + region.x,
              y: y + region.y,
              width,
              height,
              similarity,
              scale,
            });
          // Neighboring peaks address the same target, not separate controls.
          const left = Math.max(0, x - Math.floor(width / 2)),
            right = Math.min(result.cols - 1, x + Math.floor(width / 2));
          const top = Math.max(0, y - Math.floor(height / 2)),
            bottom = Math.min(result.rows - 1, y + Math.floor(height / 2));
          for (let row = top; row <= bottom; row++)
            result.data32F.fill(
              -1,
              row * result.cols + left,
              row * result.cols + right + 1,
            );
        }
        if (cv.minMaxLoc(result).maxVal >= options.minSimilarity)
          throw new Error(
            "Hay demasiadas coincidencias posibles. Limita la región o usa una imagen más específica.",
          );
      } finally {
        result.delete();
        template.delete();
      }
    }
  } finally {
    image.delete();
  }
  candidates.sort((a, b) => b.similarity - a.similarity);
  const matches = [];
  for (const candidate of candidates) {
    if (
      matches.some((other) => {
        const intersection =
          Math.max(
            0,
            Math.min(candidate.x + candidate.width, other.x + other.width) -
              Math.max(candidate.x, other.x),
          ) *
          Math.max(
            0,
            Math.min(candidate.y + candidate.height, other.y + other.height) -
              Math.max(candidate.y, other.y),
          );
        return (
          intersection /
            (candidate.width * candidate.height +
              other.width * other.height -
              intersection) >
          0.3
        );
      })
    )
      continue;
    matches.push(candidate);
    if (matches.length === 2) break;
  }
  return matches;
}
main().then(
  (matches) => parentPort.postMessage({ ok: true, matches }),
  (error) =>
    parentPort.postMessage({
      ok: false,
      error: error.message || String(error),
    }),
);
