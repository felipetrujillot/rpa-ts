<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  AlertCircle,
  ArrowUpRight,
  Bot,
  Check,
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-vue-next";
import type { RobotSetupStatus } from "@rpa/contracts";

const emit = defineEmits<{ continue: [] }>();
const props = defineProps<{ remembered: boolean }>();
const status = ref<RobotSetupStatus | null>(null);
const checking = ref(false);
const requestingPermissions = ref(false);
const error = ref("");
const permissionOutput = ref("");
const ready = computed(() => status.value?.ready === true);

async function refreshStatus() {
  if (checking.value) return;
  checking.value = true;
  error.value = "";
  try {
    status.value = await window.robot.getSetupStatus();
    if (props.remembered && status.value.ready) emit("continue");
  } catch (cause) {
    error.value = cause instanceof Error
      ? cause.message
      : "No se pudo comprobar este equipo.";
  } finally {
    checking.value = false;
  }
}

async function requestPermissions() {
  requestingPermissions.value = true;
  permissionOutput.value = "";
  error.value = "";
  try {
    const result = await window.robot.requestSetupPermissions();
    permissionOutput.value = result.output;
    await refreshStatus();
  } catch (cause) {
    error.value = cause instanceof Error
      ? cause.message
      : "No se pudieron solicitar los permisos.";
  } finally {
    requestingPermissions.value = false;
  }
}

async function openSettings(permission: "accessibility" | "screen-recording") {
  try {
    await window.robot.openSetupSettings(permission);
  } catch (cause) {
    error.value = cause instanceof Error
      ? cause.message
      : "No se pudieron abrir los ajustes del sistema.";
  }
}

onMounted(() => void refreshStatus());
</script>

<template>
  <main class="setup-screen">
    <section class="setup-card" aria-labelledby="setup-title">
      <header class="setup-brand">
        <span class="setup-brand-icon"><Bot :size="22" /></span>
        <span>Robot <span>Automatización</span></span>
      </header>

      <div class="setup-intro">
        <div class="setup-shield"><ShieldCheck :size="21" /></div>
        <p class="setup-eyebrow">PREPARACIÓN DEL EQUIPO</p>
        <h1 id="setup-title">Deja Robot listo para trabajar</h1>
        <p class="setup-description">
          Antes de empezar, comprobaremos el controlador de escritorio y los
          permisos que necesita para leer ventanas y capturar la pantalla.
        </p>
      </div>

      <div class="setup-checklist" aria-live="polite">
        <article
          v-for="item in status?.requirements ?? []"
          :key="item.id"
          class="setup-requirement"
          :class="{ 'is-ready': item.ready }"
        >
          <span class="setup-requirement-icon">
            <Check v-if="item.ready" :size="16" />
            <AlertCircle v-else :size="16" />
          </span>
          <div class="setup-requirement-copy">
            <strong>{{ item.label }}</strong>
            <p>{{ item.detail }}</p>
          </div>
          <span class="setup-requirement-state">
            {{ item.ready ? "Listo" : "Pendiente" }}
          </span>
        </article>

        <div v-if="checking && !status" class="setup-loading" role="status">
          <LoaderCircle :size="17" class="spin" />
          Comprobando CUA Driver y permisos…
        </div>
      </div>

      <p v-if="error" class="setup-feedback is-error" role="alert">{{ error }}</p>
      <p v-if="permissionOutput" class="setup-feedback" role="status">
        {{ permissionOutput }}
      </p>

      <div class="setup-actions">
        <template v-if="ready">
          <div class="setup-success" role="status">
            <CheckCircle2 :size="18" />
            <span>Este equipo cumple los requisitos para usar Robot.</span>
          </div>
          <button class="btn-primary setup-continue" @click="emit('continue')">
            Comenzar a usar Robot
          </button>
        </template>
        <template v-else>
          <div class="setup-action-row">
            <a
              v-if="status && !status.driverVersion"
              class="btn-soft"
              href="https://github.com/trycua/cua/tree/main/libs/cua-driver"
              target="_blank"
              rel="noreferrer"
            >
              Instalar CUA Driver <ArrowUpRight :size="14" />
            </a>
            <a
              v-else-if="status?.requirements.find((item) => item.id === 'cua-driver' && !item.ready)"
              class="btn-soft"
              href="https://github.com/trycua/cua/tree/main/libs/cua-driver"
              target="_blank"
              rel="noreferrer"
            >
              Guía de CUA Driver <ArrowUpRight :size="14" />
            </a>
            <button
              v-if="status?.driverVersion"
              class="btn-primary"
              :disabled="requestingPermissions || checking"
              @click="requestPermissions"
            >
              <LoaderCircle v-if="requestingPermissions" :size="15" class="spin" />
              {{ requestingPermissions ? "Solicitando permisos…" : "Solicitar permisos a CUA" }}
            </button>
            <button
              class="btn-soft"
              :disabled="checking || requestingPermissions"
              @click="refreshStatus"
            >
              <RefreshCw :size="14" :class="{ spin: checking }" />
              Volver a comprobar
            </button>
          </div>
          <div v-if="status?.requirements.some((item) => (item.id === 'accessibility' || item.id === 'screen-recording') && !item.ready)" class="setup-settings-links">
            <template v-if="status?.platform === 'darwin'">
              <button class="setup-text-button" @click="openSettings('accessibility')">
                Abrir ajustes de Accesibilidad
              </button>
              <button class="setup-text-button" @click="openSettings('screen-recording')">
                Abrir ajustes de Grabación de pantalla
              </button>
            </template>
            <button v-else class="setup-text-button" @click="openSettings('accessibility')">
              Ver instrucciones de permisos de CUA Driver
            </button>
          </div>
        </template>
      </div>
      <p v-if="!ready" class="setup-footnote">
        Robot solo continuará cuando todas las comprobaciones estén listas.
      </p>
    </section>
  </main>
</template>
