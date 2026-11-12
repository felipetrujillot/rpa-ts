<script setup lang="ts">
documentTitle("Admin");

import type { Component } from "vue";
import { LogOut, Bot, Bell, Workflow } from "lucide-vue-next";

type NavigationLink = {
  name: string;
  href: string;
  icon?: Component;
};

type NavigationGroup = {
  name: string;
  icon?: Component;
  subcategories: NavigationLink[];
};

type NavigationItem = NavigationLink | NavigationGroup;

const navigation = ref<NavigationItem[]>([
  {
    name: "RPA",
    subcategories: [
      {
        name: "Agentes",
        href: "/admin/agentes",
        icon: Bot,
      },

      {
        name: "Eventos",
        href: "/admin/eventos",
        icon: Bell,
      },

      {
        name: "Flujos",
        href: "/admin/flujos",
        icon: Workflow,
      },
    ],
  },

  { name: "Salir", href: "/logout", icon: LogOut },
]);

const { $trpc } = useNuxtApp();
const token = useCookie("token");
const userRole = ref<number | null>(null);
const userName = ref("");
const userEmail = ref("");

const visibleNavigation = computed<NavigationItem[]>(() => {
  return navigation.value;
});

onBeforeMount(async () => {
  const res = await $trpc.auth.validaToken
    .query({
      token: token.value || "",
    })
    .catch((error) => {
      logoutToIndex();
      throw new Error("Error validating token");
    });

  if (!res) {
    logoutToIndex();
    throw new Error("No session found");
  }

  userRole.value = res.role;
  userName.value = res.nombre || "";
  userEmail.value = res.email || "";
});
</script>

<template>
  <div class="admin-shell">
    <div class="admin-main">
      <AdminTopbar
        :navigation="visibleNavigation"
        :user-name="userName"
        :user-email="userEmail"
        :user-role="userRole"
      />
      <main id="admin-content" class="admin-content"><slot /></main>
      <footer class="admin-footer">
        <span>RPA Orquestador</span><span>Automatización de procesos</span>
      </footer>
    </div>
  </div>
</template>

<style src="../assets/admin.css"></style>
