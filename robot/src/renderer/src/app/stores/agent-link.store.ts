import { defineStore } from "pinia";
import { TRPCClientError } from "@trpc/client";
import {
  AGENTE_TOKEN_STORAGE_KEY,
  desvincularAgente,
  type VincularAgenteInput,
  vincularAgente,
} from "@/app/services/orquestador-trpc";
import {
  connectRobotRealtime,
  disconnectRobotRealtime,
  getRealtimeState,
} from "@/app/services/robot-realtime";

type LinkedAgent = {
  uuid_agente: string;
  uuid_empresa: string;
  nombre: string;
};

const AGENTE_STORAGE_KEY = "robot.agente.data";

export const useAgentLinkStore = defineStore("agent-link", {
  state: () => ({
    token: "",
    agente: null as LinkedAgent | null,
    linkedAt: "",
    realtimeConnected: false,
    lastHeartbeatAt: "",
    connectionError: "",
  }),
  getters: {
    isLinked: (state) => state.token.length > 0,
  },
  actions: {
    async clearLinkedState() {
      disconnectRobotRealtime();
      await window.robot.clearAgentCredentials();

      this.token = "";
      this.agente = null;
      this.linkedAt = "";
      this.realtimeConnected = false;
      this.lastHeartbeatAt = "";
      this.connectionError = "";

      localStorage.removeItem(AGENTE_TOKEN_STORAGE_KEY);
      localStorage.removeItem(AGENTE_STORAGE_KEY);
      localStorage.removeItem("robot.agente.linkedAt");
    },

    hydrate() {
      const token = localStorage.getItem(AGENTE_TOKEN_STORAGE_KEY) || "";
      const linkedAt = localStorage.getItem("robot.agente.linkedAt") || "";
      const agenteRaw = localStorage.getItem(AGENTE_STORAGE_KEY);

      this.token = token;
      this.linkedAt = linkedAt;
      try {
        this.agente = agenteRaw ? (JSON.parse(agenteRaw) as LinkedAgent) : null;
      } catch {
        this.agente = null;
      }

      if (this.token) {
        connectRobotRealtime(() => "online");
        this.syncRealtimeState();
      }
    },

    async vincularConCodigo(codigo: string) {
      const input: VincularAgenteInput = {
        codigo_vinculacion: codigo,
        hostname: window.navigator.userAgent,
        sistema_operativo: window.navigator.platform,
        sistema_operativo_version: window.navigator.userAgent.slice(0, 100),
        arquitectura: window.navigator.platform,
        version_electron: "renderer",
      };

      const response = await vincularAgente(input);

      await window.robot.saveAgentCredentials({
        uuid_agente: response.data.agente.uuid_agente,
        refresh_token: response.data.refresh_token,
      });
      this.token = response.data.token;
      this.agente = response.data.agente;
      this.linkedAt = new Date().toISOString();

      localStorage.setItem(AGENTE_TOKEN_STORAGE_KEY, this.token);
      localStorage.setItem(AGENTE_STORAGE_KEY, JSON.stringify(this.agente));
      localStorage.setItem("robot.agente.linkedAt", this.linkedAt);

      connectRobotRealtime(() => "online");
      this.syncRealtimeState();

      return response;
    },

    syncRealtimeState() {
      const state = getRealtimeState();
      this.realtimeConnected = state.connected;
      this.lastHeartbeatAt = state.lastAckAt;
      this.connectionError = state.lastError;
    },

    reconnect() {
      if (!this.isLinked) return;
      disconnectRobotRealtime();
      connectRobotRealtime(() => "online");
      this.syncRealtimeState();
    },

    async desvincular() {
      if (!this.token) {
        await this.clearLinkedState();
        return;
      }

      await window.robot.stopAllFlows();
      try {
        await desvincularAgente();
      } catch (error) {
        // Already revoked or expired credentials can still be removed locally.
        if (
          !(error instanceof TRPCClientError) ||
          error.data?.code !== "UNAUTHORIZED"
        )
          throw error;
      }
      await this.clearLinkedState();
    },
  },
});
