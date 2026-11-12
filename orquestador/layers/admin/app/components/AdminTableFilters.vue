<script setup lang="ts">
import { Search, SlidersHorizontal, X } from "lucide-vue-next";
type Option = { value: string; label: string };
withDefaults(
  defineProps<{
    placeholder?: string;
    statusOptions?: Option[];
    secondaryOptions?: Option[];
    secondaryLabel?: string;
    count: number;
    total: number;
  }>(),
  {
    placeholder: "Buscar…",
    statusOptions: () => [],
    secondaryOptions: () => [],
    secondaryLabel: "Categoría",
  },
);
const search = defineModel<string>("search", { default: "" });
const status = defineModel<string>("status", { default: "" });
const secondary = defineModel<string>("secondary", { default: "" });
function reset() {
  search.value = "";
  status.value = "";
  secondary.value = "";
}
</script>

<template>
  <div class="admin-table-tools">
    <div class="admin-filter-fields">
      <label class="admin-search"
        ><Search :size="18" aria-hidden="true" /><span class="sr-only">{{
          placeholder
        }}</span
        ><input v-model="search" type="search" :placeholder="placeholder"
      /></label>
      <label v-if="statusOptions.length" class="admin-filter-select"
        ><SlidersHorizontal :size="16" aria-hidden="true" /><span
          class="sr-only"
          >Filtrar por estado</span
        ><select v-model="status">
          <option value="">Todos los estados</option>
          <option
            v-for="option in statusOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select></label
      >
      <label v-if="secondaryOptions.length" class="admin-filter-select"
        ><span class="sr-only">{{ secondaryLabel }}</span
        ><select v-model="secondary">
          <option value="">{{ secondaryLabel }}</option>
          <option
            v-for="option in secondaryOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select></label
      >
      <button
        v-if="search || status || secondary"
        class="admin-clear-filters"
        type="button"
        @click="reset"
      >
        <X :size="15" />Limpiar filtros
      </button>
    </div>
    <p class="admin-result-count" role="status" aria-live="polite">
      {{ count }} de {{ total }} resultados
    </p>
  </div>
</template>
