import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentMessageSchema,
  createWorkflow,
  PROTOCOL_VERSION,
  type AgentSystemMetrics,
} from "@rpa/contracts";

const systemMetrics: AgentSystemMetrics = {
  sampled_at: "2026-11-03T12:00:00.000Z",
  cpu_usage_percent: 25,
  memory_used_bytes: 1024,
  memory_total_bytes: 4096,
  storage_used_bytes: null,
  storage_available_bytes: null,
  storage_total_bytes: null,
};

const { ticket } = vi.hoisted(() => ({ ticket: vi.fn() }));
vi.mock("../../src/renderer/src/app/services/orquestador-trpc", () => ({
  AGENTE_TOKEN_STORAGE_KEY: "robot.agente.token", createAgentSocketTicket: ticket,
}));
import { connectRobotRealtime, disconnectRobotRealtime, getRealtimeState } from "../../src/renderer/src/app/services/robot-realtime";

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => { this.readyState = 3; this.onclose?.({ code: 1000, reason: "" }); });
  constructor(readonly url: string) { FakeSocket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(type: string, data: Record<string, unknown> = {}, command?: string) {
    this.onmessage?.({ data: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, type, data, command }) });
  }
}

let refresh: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  refresh = vi.fn().mockResolvedValue({ token: "test-token" });
  ticket.mockResolvedValue({ ticket: "one-use-ticket" });
  vi.stubGlobal("localStorage", { setItem: vi.fn() });
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("window", {
    setTimeout, clearTimeout, setInterval, clearInterval,
    robot: {
      refreshAgentSession: refresh,
      getSystemMetrics: vi.fn().mockResolvedValue(systemMetrics),
      listActions: vi.fn().mockResolvedValue({ actions: [], generatedAt: new Date().toISOString(), plugins: { sampledAt: new Date().toISOString(), plugins: [] } }),
      onTelemetryAvailable: () => () => {},
      telemetrySnapshot: async () => [], commandSnapshot: async () => ({ records: [] }),
      acceptCommand: vi.fn(async () => ({})), runCommand: vi.fn(async () => ({})),
    },
  });
});
afterEach(() => {
  disconnectRobotRealtime();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("robot reconnection", () => {
  it("redelivers unadmitted work after reconnect without keeping an old admission error", async () => {
    const command = {
      command_id: crypto.randomUUID(), uuid_agente: "agent", uuid_flow_run: "run",
      lease_token: crypto.randomUUID(), lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      may_have_started: false, document: createWorkflow(), runtime: {},
    };
    connectRobotRealtime(); await settle();
    const first = FakeSocket.instances[0]!;
    first.open(); first.receive("connected"); await settle();
    first.receive("command", command, "run_flow"); await settle();
    expect(window.robot.runCommand).not.toHaveBeenCalled();
    first.onerror?.(); await settle();
    expect(getRealtimeState().lastError).not.toContain("admisión");
    await vi.advanceTimersByTimeAsync(1500);
    const recovered = FakeSocket.instances[1]!;
    recovered.open(); recovered.receive("connected"); await settle();
    recovered.receive("command", command, "run_flow"); await settle();
    recovered.receive("command_accepted", { command_id: command.command_id, lease_token: command.lease_token });
    await settle();
    expect(window.robot.runCommand).toHaveBeenCalledTimes(1);
    expect(getRealtimeState().lastError).toBe("");
  });
  it("waits for server authentication before marking connected or sending heartbeats", async () => {
    connectRobotRealtime(); await settle();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    expect(getRealtimeState().connected).toBe(false);
    expect(socket.send).not.toHaveBeenCalled();
    expect(window.robot.getSystemMetrics).not.toHaveBeenCalled();
    socket.receive("connected"); await settle();
    expect(getRealtimeState().connected).toBe(true);
    expect(window.robot.getSystemMetrics).toHaveBeenCalledTimes(1);
    expect(socket.send).toHaveBeenCalledTimes(1);
    const heartbeat = agentMessageSchema.parse(
      JSON.parse(socket.send.mock.calls[0]![0]),
    );
    expect(heartbeat).toMatchObject({
      type: "heartbeat",
      status: "online",
      system_metrics: systemMetrics,
    });
  });
  it("recovers from a WebSocket handshake that never completes", async () => {
    connectRobotRealtime(); await settle();
    const stalled = FakeSocket.instances[0]!;
    await vi.advanceTimersByTimeAsync(16_500);
    expect(stalled.close).toHaveBeenCalled();
    expect(FakeSocket.instances.length).toBeGreaterThan(1);
  });
  it("reconnects when an open socket stops receiving server responses", async () => {
    connectRobotRealtime(); await settle();
    const socket = FakeSocket.instances[0]!;
    socket.open(); socket.receive("connected"); await settle();
    await vi.advanceTimersByTimeAsync(32_000);
    expect(socket.close).toHaveBeenCalled();
    expect(FakeSocket.instances.length).toBeGreaterThan(1);
    expect(getRealtimeState().connected).toBe(false);
  });
  it("can reconnect while an old session refresh is still pending", async () => {
    let finish!: (value: { token: string }) => void;
    refresh.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    connectRobotRealtime(); await settle();
    disconnectRobotRealtime();
    connectRobotRealtime(); await settle();
    expect(FakeSocket.instances).toHaveLength(1);
    finish({ token: "stale-token" }); await settle();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(localStorage.setItem).not.toHaveBeenCalledWith("robot.agente.token", "stale-token");
  });
  it("retries if the session refresh itself never returns", async () => {
    refresh.mockImplementationOnce(() => new Promise(() => {}));
    connectRobotRealtime(); await settle();
    await vi.advanceTimersByTimeAsync(17_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
