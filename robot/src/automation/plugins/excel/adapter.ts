import type { ExcelActionId, PluginInventory } from "@rpa/contracts";
export type ExcelRequest = { id: string; action: ExcelActionId; input: Record<string, unknown> };
export type ExcelResponse = { id: string; ok: boolean; output?: unknown; error?: string; effect?: "none" | "uncertain"; code?: string };
export interface ExcelAdapter {
  request(request: ExcelRequest, signal?: AbortSignal): Promise<ExcelResponse>;
  dispose(): Promise<void>;
}
export type ExcelAvailability = PluginInventory["plugins"][number];
export class ExcelError extends Error {
  constructor(message: string, readonly code = "EXCEL_REJECTED", readonly uncertain = false) { super(message); }
}
