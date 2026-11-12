<script setup lang="ts">
import type { Component } from "vue";
import { ChevronDown } from "lucide-vue-next";

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

const props = defineProps<{
  navigation: NavigationItem[];
  userName?: string;
  userEmail?: string;
  userRole?: number | null;
  logoHref?: string;
}>();

const route = useRoute();

const mainNavigation = computed(() =>
  props.navigation.flatMap((item) =>
    "subcategories" in item
      ? item.subcategories
      : item.name !== "Salir"
        ? [item]
        : [],
  ),
);

const accountOpen = ref(false);
watch(
  () => route.path,
  () => {
    accountOpen.value = false;
  },
);

const logoutItem = computed(() =>
  props.navigation.find((item): item is NavigationLink => {
    return "href" in item && item.name === "Salir";
  }),
);

const hasUserInfo = computed(() => {
  return Boolean(props.userName || props.userEmail || props.userRole != null);
});

const userRoleLabel = computed(() => {
  if (props.userRole === 0) return "Root";
  if (props.userRole === 1) return "Admin";
  if (props.userRole === 2) return "Asesor";
  return "-";
});

const allNavigationHrefs = computed(() => {
  return props.navigation.flatMap((item) => {
    if ("href" in item) return [item.href];
    return item.subcategories.map((subcategory) => subcategory.href);
  });
});

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }

  return path;
}

function isActive(href: string): boolean {
  const path = normalizePath(route.path);
  const normalizedHref = normalizePath(href);

  if (path === normalizedHref) {
    return true;
  }

  if (!path.startsWith(`${normalizedHref}/`)) {
    return false;
  }

  return !allNavigationHrefs.value.some((candidateHref) => {
    const normalizedCandidate = normalizePath(candidateHref);

    return (
      ((normalizedCandidate !== normalizedHref &&
        path.startsWith(`${normalizedCandidate}/`)) ||
        path === normalizedCandidate) &&
      normalizedCandidate.startsWith(`${normalizedHref}/`)
    );
  });
}

const convertUserNameInitials = (name: string): string => {
  const names = name.trim().split(/\s+/).filter(Boolean);
  const first = names[0]?.charAt(0)?.toUpperCase() ?? "U";
  const last = names[names.length - 1]?.charAt(0)?.toUpperCase() ?? "";

  if (names.length <= 1) {
    return first;
  }

  return first + last;
};
</script>

<template>
  <header class="admin-topbar">
    <NuxtLink
      :to="logoHref || '/admin/agentes'"
      class="admin-brand"
      aria-label="RPA, inicio del Orquestador"
    >
      <span>Orquestador <span class="admin-brand-tag">RPA</span></span>
    </NuxtLink>
    <nav class="admin-navigation" aria-label="Navegación principal">
      <NuxtLink
        v-for="item in mainNavigation"
        :key="item.href"
        :to="item.href"
        class="admin-nav-link"
        :class="{ 'is-active': isActive(item.href) }"
        :aria-current="isActive(item.href) ? 'page' : undefined"
      >
        <component
          :is="item.icon"
          v-if="item.icon"
          :size="19"
          :stroke-width="1.7"
          aria-hidden="true"
        />
        {{ item.name }}
      </NuxtLink>
    </nav>
    <Popover v-model:open="accountOpen">
      <PopoverTrigger as-child>
        <button
          type="button"
          class="admin-account-trigger"
          aria-label="Abrir menú de cuenta"
        >
          <span class="admin-avatar">{{
            convertUserNameInitials(userName || "Usuario")
          }}</span>
          <span class="admin-account-name">{{ userName || "Mi cuenta" }}</span>
          <ChevronDown :size="16" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" class="admin-account-menu">
        <div v-if="hasUserInfo" class="admin-user">
          <strong>{{ userName || "Usuario" }}</strong>
          <span v-if="userEmail" class="admin-user-email">{{ userEmail }}</span>
          <span class="admin-role">{{ userRoleLabel }}</span>
        </div>
        <NuxtLink
          v-if="logoutItem"
          :to="logoutItem.href"
          class="admin-nav-link admin-logout"
          @click="accountOpen = false"
        >
          <component :is="logoutItem.icon" v-if="logoutItem.icon" :size="18" />
          Cerrar sesión
        </NuxtLink>
      </PopoverContent>
    </Popover>
  </header>
</template>
