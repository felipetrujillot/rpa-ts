import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { useAdminTable } from "../layers/admin/app/composables/useAdminTable";

const createTable = () => {
  const items = ref([
    {
      name: "Conciliación Santiago",
      host: "robot-01",
      state: "online",
      system: "Windows",
    },
    {
      name: "Conciliación Valparaíso",
      host: "robot-02",
      state: "offline",
      system: "Windows",
    },
    {
      name: "Facturación Santiago",
      host: null,
      state: "online",
      system: "Linux",
    },
  ]);
  return {
    items,
    ...useAdminTable(items, {
      search: (item) => [item.name, item.host],
      status: (item) => item.state,
      secondary: (item) => item.system,
    }),
  };
};

describe("admin table filters", () => {
  it("combines words, ignores accents and case, and searches across fields", () => {
    const table = createTable();
    table.search.value = "  CONCILIACION   robot-01 ";
    expect(table.filtered.value.map((item) => item.host)).toEqual(["robot-01"]);
  });
  it("combines both selectors with search and resets to all records", () => {
    const table = createTable();
    table.search.value = "santiago";
    table.status.value = "online";
    table.secondary.value = "Windows";
    expect(table.filtered.value.map((item) => item.host)).toEqual(["robot-01"]);
    table.secondary.value = "Linux";
    expect(table.filtered.value[0]?.name).toBe("Facturación Santiago");
    table.search.value = "";
    table.status.value = "";
    table.secondary.value = "";
    expect(table.filtered.value).toHaveLength(3);
  });
  it("handles no matches and refreshed data without mutating source records", () => {
    const table = createTable();
    table.search.value = "nuevo";
    expect(table.filtered.value).toEqual([]);
    table.items.value.push({
      name: "Nuevo agente",
      host: null,
      state: "online",
      system: "Linux",
    });
    expect(table.filtered.value).toHaveLength(1);
    expect(table.items.value).toHaveLength(4);
  });
});
