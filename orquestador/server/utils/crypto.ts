type FormValue = string | number | boolean | bigint | null | undefined;

export type FormParams = Record<string, FormValue>;

const textEncoder = new TextEncoder();

function getWebCrypto() {
  const webCrypto = globalThis.crypto;

  if (!webCrypto?.subtle) {
    throw new Error("Web Crypto API no disponible en este runtime");
  }

  return webCrypto;
}

function bytesToUuid(bytes: Uint8Array) {
  const segments = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  );

  return [
    segments.slice(0, 4).join(""),
    segments.slice(4, 6).join(""),
    segments.slice(6, 8).join(""),
    segments.slice(8, 10).join(""),
    segments.slice(10, 16).join(""),
  ].join("-");
}

export function createUuid() {
  const webCrypto = getWebCrypto();

  if (typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  webCrypto.getRandomValues(bytes);

  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  return bytesToUuid(bytes);
}

export async function hmacSha256Hex(message: string, secret: string) {
  const webCrypto = getWebCrypto();
  const key = await webCrypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const signature = await webCrypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(message),
  );

  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function toFormUrlEncoded(params: FormParams) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }

    searchParams.set(key, String(value));
  }

  return searchParams.toString();
}
