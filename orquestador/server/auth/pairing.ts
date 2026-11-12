import {
  randomBytes,
  randomInt,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { TRPCError } from "@trpc/server";

export const PAIRING_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const generatePairingCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const block = () =>
    Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join(
      "",
    );
  return `${block()}-${block()}`;
};
export const generateRefreshToken = () => randomBytes(32).toString("hex");
export const hashRefreshToken = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const matchesRefreshToken = (token: string, hash: string | null) => {
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return false;
  return timingSafeEqual(
    Buffer.from(hashRefreshToken(token), "hex"),
    Buffer.from(hash, "hex"),
  );
};
export const isPairingAvailable = (
  agent: { estado: string; codigo_vinculacion_expira: Date | null },
  now = new Date(),
) =>
  agent.estado === "pendiente" &&
  !!agent.codigo_vinculacion_expira &&
  agent.codigo_vinculacion_expira > now;

// Single-process abuse guard. Distributed deployments must put a shared limiter at the gateway.
const attempts = new Map<string, { count: number; until: number }>();
export const checkPairingRateLimit = (key: string) => {
  const now = Date.now();
  for (const [id, value] of attempts)
    if (value.until <= now) attempts.delete(id);
  const entry = attempts.get(key) ?? { count: 0, until: now + 60_000 };
  if (entry.count >= 1000 || (attempts.size >= 10_000 && !attempts.has(key))) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Demasiados intentos. Intenta en un minuto.",
    });
  }
  entry.count++;
  attempts.set(key, entry);
};
