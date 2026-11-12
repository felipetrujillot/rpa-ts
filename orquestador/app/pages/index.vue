<script setup lang="ts">
useHead({ title: "Orquestador | RPA" });
</script>

<template>
  <div class="orchestrator-landing">
    <header class="landing-header">
      <NuxtLink
        to="/"
        class="landing-brand"
        aria-label="RPA Orquestador, inicio"
      >
        <span class="landing-wordmark">RPA</span>
        <span class="landing-product">Orquestador</span>
      </NuxtLink>
      <span class="landing-platform">Plataforma RPA</span>
    </header>

    <main class="landing-main">
      <section class="landing-welcome" aria-labelledby="welcome-title">
        <div>
          <h1 id="welcome-title">Tu operación<br />empieza<br />aquí.</h1>
          <p class="landing-intro">
            Un espacio para conectar tus flujos, tus agentes y el trabajo de
            cada día.
          </p>
        </div>
        <ul class="landing-capabilities">
          <li>Diseña el proceso.</li>
          <li>Coordina la ejecución.</li>
          <li>Revisa el resultado.</li>
        </ul>
        <p class="landing-welcome-note">Automatización para equipos RPA.</p>
      </section>

      <section class="landing-access" aria-labelledby="login-title">
        <div class="landing-access-content">
          <LoginForm />
          <details class="landing-help">
            <summary>¿No tienes una cuenta?</summary>
            <p>
              Contacta al administrador de tu Orquestador para solicitar que
              habilite tu acceso.
            </p>
          </details>
        </div>
      </section>
    </main>

    <aside class="landing-description">
      Editor de flujos, agentes conectados y seguimiento de ejecuciones en una
      misma plataforma.
    </aside>
    <footer class="landing-footer">
      <span>RPA · Orquestador RPA</span>
      <span>Uso interno</span>
    </footer>
  </div>
</template>

<style scoped>
@font-face {
  font-family: "Barlow";
  src: url("/fonts/Barlow/Barlow-400.ttf") format("truetype");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: "Barlow";
  src: url("/fonts/Barlow/Barlow-500.ttf") format("truetype");
  font-style: normal;
  font-weight: 500;
  font-display: swap;
}
@font-face {
  font-family: "Barlow";
  src: url("/fonts/Barlow/Barlow-600.ttf") format("truetype");
  font-style: normal;
  font-weight: 600;
  font-display: swap;
}
@font-face {
  font-family: "Barlow";
  src: url("/fonts/Barlow/Barlow-700.ttf") format("truetype");
  font-style: normal;
  font-weight: 700;
  font-display: swap;
}
.orchestrator-landing {
  --rpats-blue: #002eff;
  --rpats-ink: #071e60;
  --rpats-soft: #f3f5ff;
  --rpats-border: #dce2f3;
  --rpats-muted: #66686c;
  --rpats-white: #fff;
  --rpats-focus: #ff5a1f;
  min-height: 100svh;
  display: flex;
  flex-direction: column;
  background: var(--rpats-white);
  color: var(--rpats-ink);
  font-family: "Barlow", Arial, sans-serif;
}
.landing-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 25px clamp(24px, 4vw, 64px);
}
.landing-brand {
  display: inline-flex;
  align-items: center;
  gap: 15px;
  text-decoration: none;
}
.landing-wordmark {
  color: var(--rpats-blue);
  font-size: 29px;
  font-weight: 700;
  letter-spacing: -1.5px;
  line-height: 1;
}
.landing-product {
  border-left: 1px solid var(--rpats-border);
  padding-left: 15px;
  font-size: 15px;
  font-weight: 500;
}
.landing-platform {
  color: var(--rpats-muted);
  font-size: 12px;
}
.landing-main {
  flex: 1;
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  min-height: 650px;
}
.landing-welcome {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 40px;
  padding: clamp(40px, 5vw, 72px) clamp(32px, 5vw, 80px);
  background: var(--rpats-blue);
  color: var(--rpats-white);
  border-radius: 0 25px 25px 0;
}
.landing-welcome h1 {
  margin: 0;
  font-size: clamp(48px, 5.5vw, 80px);
  font-weight: 500;
  letter-spacing: -1.8px;
  line-height: 1.03;
}
.landing-intro {
  max-width: 350px;
  margin: 25px 0 0;
  font-size: 18px;
  line-height: 1.5;
}
.landing-capabilities {
  width: 100%;
  max-width: 420px;
  list-style: none;
  padding: 0;
  margin: 0;
}
.landing-capabilities li {
  border-top: 1px solid rgb(255 255 255 / 30%);
  padding: 14px 0;
  font-size: 18px;
}
.landing-capabilities li:last-child {
  border-bottom: 1px solid rgb(255 255 255 / 30%);
}
.landing-welcome-note {
  margin: 0;
  font-size: 13px;
}
.landing-access {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 55px clamp(32px, 5vw, 80px) 40px;
}
.landing-access-content {
  width: 100%;
  max-width: 370px;
}
.landing-help {
  margin-top: 28px;
  padding-top: 22px;
  border-top: 1px solid var(--rpats-border);
  font-size: 14px;
}
.landing-help summary {
  color: var(--rpats-blue);
  cursor: pointer;
}
.landing-help p {
  margin: 12px 0 0;
  color: var(--rpats-muted);
  line-height: 1.5;
}
.landing-description {
  background: var(--rpats-soft);
  padding: 27px 30px;
  color: var(--rpats-muted);
  text-align: center;
  font-size: 13px;
  line-height: 1.5;
}
.landing-footer {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding: 23px clamp(24px, 4vw, 64px);
  border-top: 1px solid var(--rpats-border);
  color: var(--rpats-muted);
  font-size: 12px;
}
.landing-brand:focus-visible,
.landing-help summary:focus-visible {
  outline: 3px solid var(--rpats-focus);
  outline-offset: 5px;
}
@media (max-width: 760px) {
  .landing-welcome {
    padding: 44px 32px;
  }
  .landing-welcome h1 {
    font-size: 48px;
  }
  .landing-intro {
    font-size: 16px;
  }
  .landing-access {
    padding: 44px 28px;
  }
}
@media (max-width: 560px) {
  .landing-header {
    padding: 23px 24px;
    gap: 12px;
  }
  .landing-brand {
    gap: 10px;
  }
  .landing-wordmark {
    font-size: 26px;
  }
  .landing-product {
    padding-left: 10px;
    font-size: 13px;
  }
  .landing-platform {
    font-size: 11px;
  }
  .landing-main {
    grid-template-columns: 1fr;
    min-height: auto;
  }
  .landing-welcome {
    border-radius: 0 0 25px 25px;
    padding: 32px 24px;
    gap: 27px;
  }
  .landing-welcome h1 {
    font-size: 46px;
    letter-spacing: -1px;
  }
  .landing-intro {
    max-width: 340px;
    margin-top: 20px;
  }
  .landing-capabilities {
    display: none;
  }
  .landing-access {
    padding: 38px 24px;
  }
  .landing-access-content {
    max-width: none;
  }
  .landing-description {
    padding: 24px;
    text-align: left;
  }
  .landing-footer {
    flex-direction: column;
    gap: 8px;
  }
}
</style>
