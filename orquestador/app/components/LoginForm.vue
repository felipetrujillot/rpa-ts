<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { Loader2 } from "lucide-vue-next";
import { cn } from "@/lib/utils";

const props = defineProps<{ class?: HTMLAttributes["class"] }>();
const { $trpc } = useNuxtApp();
const userForm = ref({ email: "", password: "" });
const showPassword = ref(false);
const isSubmitting = ref(false);
const errorMessage = ref("");
const maxAge = 3600 * 24 * 365;
const token = useCookie("token", { maxAge });
const logo_empresa = useCookie("logo_empresa", { maxAge });
const role = useCookie("role", { maxAge });

const loginForm = async () => {
  if (isSubmitting.value) return;
  errorMessage.value = "";
  const email = userForm.value.email.trim();
  const password = userForm.value.password;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errorMessage.value = "Ingresa un correo electrónico válido.";
    return;
  }
  if (password.trim() === "") {
    errorMessage.value = "Ingresa tu contraseña para continuar.";
    return;
  }

  isSubmitting.value = true;
  try {
    const res = await $trpc.auth.loginApi.mutate({ email, password });
    if (res.status === "ok") {
      logo_empresa.value = res.usuario_db.logo_empresa;
      token.value = res.token;
      role.value = res.usuario_db.role.toString();
      await navigateTo("/admin");
    } else {
      errorMessage.value = res.data;
    }
  } catch {
    errorMessage.value = "No se pudo iniciar sesión. Intenta nuevamente.";
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<template>
  <form
    :class="cn('rpats-login', props.class)"
    :aria-busy="isSubmitting"
    @submit.prevent="loginForm"
  >
    <h2 id="login-title">Ingresa al<br />Orquestador</h2>
    <p class="login-description">Continúa con tu cuenta de la plataforma.</p>

    <div class="login-field">
      <label for="email">Correo electrónico</label>
      <input
        id="email"
        v-model="userForm.email"
        name="email"
        type="email"
        autocomplete="username"
        placeholder="nombre@rpats.cl"
        required
        :readonly="isSubmitting"
        :aria-describedby="errorMessage ? 'login-error' : undefined"
      />
    </div>
    <div class="login-field">
      <label for="password">Contraseña</label>
      <div class="login-password">
        <input
          id="password"
          v-model="userForm.password"
          name="password"
          :type="showPassword ? 'text' : 'password'"
          autocomplete="current-password"
          required
          :readonly="isSubmitting"
          :aria-describedby="errorMessage ? 'login-error' : undefined"
        />
        <button
          class="login-reveal"
          type="button"
          aria-controls="password"
          :aria-pressed="showPassword"
          :aria-label="
            showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'
          "
          @click="showPassword = !showPassword"
        >
          {{ showPassword ? "Ocultar" : "Mostrar" }}
        </button>
      </div>
    </div>

    <p v-if="errorMessage" id="login-error" class="login-error" role="alert">
      {{ errorMessage }}
    </p>
    <button class="login-submit" type="submit" :disabled="isSubmitting">
      <Loader2 v-if="isSubmitting" class="login-spinner" aria-hidden="true" />
      {{ isSubmitting ? "Ingresando…" : "Ingresar al Orquestador" }}
    </button>
  </form>
</template>

<style scoped>
.rpats-login {
  width: 100%;
  font-family: inherit;
}
.rpats-login h2 {
  margin: 0;
  color: var(--rpats-ink);
  font-size: clamp(32px, 3vw, 40px);
  font-weight: 500;
  letter-spacing: -0.6px;
  line-height: 1.1;
}
.login-description {
  margin: 12px 0 28px;
  color: var(--rpats-muted);
  font-size: 16px;
  line-height: 1.5;
}
.login-field {
  margin-top: 22px;
}
.login-field label {
  display: block;
  margin-bottom: 8px;
  font-size: 15px;
  font-weight: 500;
}
.login-field input {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 49px;
  border: 1px solid var(--rpats-border);
  border-radius: 9px;
  padding: 13px 14px;
  background: var(--rpats-white);
  color: var(--rpats-ink);
  font: inherit;
  font-size: 16px;
}
.login-field input::placeholder {
  color: var(--rpats-muted);
}
.login-password {
  position: relative;
}
.login-password input {
  padding-right: 84px;
}
.login-reveal {
  position: absolute;
  top: 5px;
  right: 5px;
  min-height: 39px;
  padding: 8px;
  border: 0;
  border-radius: 5px;
  background: var(--rpats-soft);
  color: var(--rpats-blue);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.login-submit {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 49px;
  margin-top: 26px;
  padding: 12px 20px;
  border: 0;
  border-radius: 28px;
  background: var(--rpats-blue);
  color: var(--rpats-white);
  font: inherit;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
}
.login-submit:hover:not(:disabled) {
  background: #c21e0f;
}
.login-submit:disabled {
  opacity: 0.7;
  cursor: wait;
}
.login-field input:focus-visible,
.login-reveal:focus-visible,
.login-submit:focus-visible {
  outline: 3px solid var(--rpats-focus);
  outline-offset: 4px;
}
.login-error {
  margin: 18px 0 0;
  color: #b42318;
  font-size: 14px;
  line-height: 1.5;
}
.login-spinner {
  width: 18px;
  height: 18px;
  animation: login-spin 1s linear infinite;
}
@keyframes login-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .login-spinner {
    animation: none;
  }
}
@media (max-width: 560px) {
  .rpats-login h2 {
    font-size: 32px;
  }
}
</style>
