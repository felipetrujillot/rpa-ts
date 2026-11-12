import { pluginCompatibility, type FlowDocument, type PluginInventory } from "@rpa/contracts";
const key = Symbol.for("rpa.plugin-inventory");
const state = globalThis as typeof globalThis & { [key]?: Map<string, PluginInventory> };
const store = state[key] ??= new Map<string, PluginInventory>();
const scope = (company: string, agent: string) => JSON.stringify([company, agent]);
export function setPluginInventory(company: string, agent: string, inventory: PluginInventory) {
  store.set(scope(company, agent), { ...inventory, sampledAt: new Date().toISOString() });
}
export function getPluginInventory(company: string, agent: string): PluginInventory | null {
  const inventory = store.get(scope(company, agent));
  if (!inventory || Date.now() - Date.parse(inventory.sampledAt) > 30_000) return null;
  return structuredClone(inventory);
}
export function assertPluginCompatibility(company: string, agent: string, document: FlowDocument) {
  const errors = pluginCompatibility(document.pluginRequirements ?? [], getPluginInventory(company, agent));
  if (errors.length) throw new Error(errors.join(" "));
}
