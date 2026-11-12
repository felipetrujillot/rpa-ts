import { PROTOCOL_VERSION } from "@rpa/contracts";
import type { AgentSystemMetrics } from "@rpa/contracts";
type LivePeer = {
  send: (message: string) => void;
  close?: (code?: number, reason?: string) => void;
};

export type LiveStatusEntry = {
  connectedAt: string;
  lastHeartbeatAt: string;
  status: string;
};

export type AgentScreenshotEntry = {
  image_data_url: string;
  captured_at: string;
  received_at: string;
  width: number;
  height: number;
  source: string;
};

const GLOBAL_LIVE_STATUS_KEY = "__rpa_live_status__" as const;
const GLOBAL_LIVE_PEERS_KEY = "__rpa_live_peers__" as const;
const GLOBAL_AGENT_SCREENSHOTS_KEY = "__rpa_agent_screenshots__" as const;
const GLOBAL_AGENT_SYSTEM_METRICS_KEY = "__rpa_agent_system_metrics__" as const;

const getLiveStatusStore = () => {
  const state = ((globalThis as any)[GLOBAL_LIVE_STATUS_KEY] || {}) as Record<
    string,
    LiveStatusEntry
  >;

  (globalThis as any)[GLOBAL_LIVE_STATUS_KEY] = state;

  return state;
};

const getLivePeersStore = () => {
  const state =
    ((globalThis as any)[GLOBAL_LIVE_PEERS_KEY] as Map<string, LivePeer>) ||
    new Map<string, LivePeer>();

  (globalThis as any)[GLOBAL_LIVE_PEERS_KEY] = state;

  return state;
};

const getAgentScreenshotsStore = () => {
  const state = ((globalThis as any)[GLOBAL_AGENT_SCREENSHOTS_KEY] ||
    {}) as Record<string, AgentScreenshotEntry>;

  (globalThis as any)[GLOBAL_AGENT_SCREENSHOTS_KEY] = state;

  return state;
};

const getAgentSystemMetricsStore = () => {
  const state = ((globalThis as any)[GLOBAL_AGENT_SYSTEM_METRICS_KEY] ||
    {}) as Record<string, AgentSystemMetrics>;

  (globalThis as any)[GLOBAL_AGENT_SYSTEM_METRICS_KEY] = state;

  return state;
};

export const setLivePeer = (uuid_agente: string, peer: LivePeer) => {
  const previous = getLivePeersStore().get(uuid_agente);
  getLivePeersStore().set(uuid_agente, peer);
  if (previous && previous !== peer)
    previous.close?.(4001, "Conexión reemplazada");
};

export const isCurrentPeer = (uuid_agente: string, peer: LivePeer) =>
  getLivePeersStore().get(uuid_agente) === peer;
export const removeLivePeer = (uuid_agente: string, peer?: LivePeer) => {
  if (peer && !isCurrentPeer(uuid_agente, peer)) return false;
  return getLivePeersStore().delete(uuid_agente);
};
export const disconnectLiveAgent = (uuid_agente: string) => {
  const peer = getLivePeersStore().get(uuid_agente);
  getLivePeersStore().delete(uuid_agente);
  removeLiveStatus(uuid_agente);
  delete getAgentScreenshotsStore()[uuid_agente];
  delete getAgentSystemMetricsStore()[uuid_agente];
  peer?.close?.(4003, "Sesión revocada");
};

export const hasLivePeer = (uuid_agente: string) => {
  return getLivePeersStore().has(uuid_agente);
};

export const setLiveStatus = (uuid_agente: string, status: LiveStatusEntry) => {
  getLiveStatusStore()[uuid_agente] = status;
};

export const removeLiveStatus = (uuid_agente: string) => {
  delete getLiveStatusStore()[uuid_agente];
};

export const getLiveStatusSnapshot = () => {
  return getLiveStatusStore();
};

export const getLiveStatusByAgent = (uuid_agente: string) => {
  return getLiveStatusStore()[uuid_agente] || null;
};

export const setAgentLatestScreenshot = (
  uuid_agente: string,
  screenshot: AgentScreenshotEntry,
) => {
  getAgentScreenshotsStore()[uuid_agente] = screenshot;
};

export const getAgentLatestScreenshot = (uuid_agente: string) => {
  return getAgentScreenshotsStore()[uuid_agente] || null;
};

export const setAgentSystemMetrics = (
  uuid_agente: string,
  metrics: AgentSystemMetrics,
) => {
  getAgentSystemMetricsStore()[uuid_agente] = metrics;
};

export const getAgentSystemMetrics = (uuid_agente: string) => {
  return getAgentSystemMetricsStore()[uuid_agente] || null;
};

export const sendCommandToLiveAgent = (
  uuid_agente: string,
  payload: Record<string, unknown>,
) => {
  const peer = getLivePeersStore().get(uuid_agente);

  if (!peer) {
    return false;
  }

  try {
    peer.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, type: "command", ...payload }));
    return true;
  } catch {
    return false;
  }
};
