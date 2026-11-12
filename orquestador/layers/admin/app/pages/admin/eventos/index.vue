<script setup lang="ts">
import { Bell, ArrowUpRight } from "lucide-vue-next";
documentTitle("Eventos");
</script>
<template>
  <div class="admin-page">
    <div class="admin-page-heading">
      <div>
        <h1>Eventos</h1>
        <p>Consulta la actividad y los resultados de tus automatizaciones.</p>
      </div>
    </div>
    <section class="admin-collection">
      <div class="admin-empty">
        <Bell
          :size="28"
          class="mx-auto mb-4 text-primary"
          :stroke-width="1.5"
        /><strong>La actividad está en cada agente</strong>
        <p>
          Abre un agente, selecciona un flujo asignado y revisa su historial de
          ejecuciones.
        </p>
        <Button as-child variant="outline" class="mt-6"
          ><NuxtLink to="/admin/agentes"
            >Ir a agentes<ArrowUpRight :size="16" class="ml-2" /></NuxtLink
        ></Button>
      </div>
    </section>
  </div>
</template>
