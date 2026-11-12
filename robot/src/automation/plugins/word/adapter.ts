export type WordRequest = { id: string; action: string; input: Record<string, unknown> };
export type WordResponse = { id: string; ok: boolean; output?: Record<string, unknown>; error?: string; effect?: "none" | "uncertain" };
export interface WordAdapter {
  request(request: WordRequest, signal?: AbortSignal): Promise<WordResponse>;
  dispose(): Promise<void>;
}
export class WordError extends Error {
  constructor(message: string, readonly code = "WORD_REJECTED", readonly uncertain = false) { super(message); }
}
