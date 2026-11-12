import { computed, ref, toValue, type MaybeRefOrGetter } from "vue";

/** Normalize accents and case so searches match the names operators type. */
export function normalizeAdminSearch(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim();
}

export function useAdminTable<T>(
  items: MaybeRefOrGetter<T[]>,
  config: {
    search: (item: T) => unknown[];
    status: (item: T) => string;
    secondary?: (item: T) => string;
  },
) {
  const search = ref("");
  const status = ref("");
  const secondary = ref("");
  const filtered = computed(() => {
    const terms = normalizeAdminSearch(search.value)
      .split(/\s+/)
      .filter(Boolean);
    return toValue(items).filter((item) => {
      const text = normalizeAdminSearch(config.search(item).join(" "));
      return (
        terms.every((term) => text.includes(term)) &&
        (!status.value || config.status(item) === status.value) &&
        (!secondary.value || config.secondary?.(item) === secondary.value)
      );
    });
  });
  return { search, status, secondary, filtered };
}
