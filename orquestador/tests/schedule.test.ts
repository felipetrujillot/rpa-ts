import { describe, expect, it } from "vitest";
import {
  createScheduleDraft,
  describeSchedule,
  scheduleFromCron,
  scheduleToCron,
  upcomingSchedule,
} from "../shared/schedule";

describe("programación de asignaciones", () => {
  it("genera los horarios sin escribir cron y conserva su significado al editarlos", () => {
    const draft = createScheduleDraft();
    expect(scheduleToCron(draft)).toBe("");
    for (const [mode, cron] of [
      ["minutes", "*/15 * * * *"],
      ["daily", "0 9 * * *"],
      ["weekdays", "0 9 * * 1-5"],
      ["weekly", "0 9 * * 1,3"],
      ["monthly", "0 9 31 * *"],
    ] as const) {
      const expression = scheduleToCron({
        ...draft,
        mode,
        days: [3, 1, 1],
        monthDay: 31,
      });
      expect(expression).toBe(cron);
      expect(scheduleToCron(scheduleFromCron(cron))).toBe(cron);
    }
    expect(scheduleToCron({ ...draft, mode: "hours", interval: 4 })).toBe(
      "0 */4 * * *",
    );
    expect(describeSchedule("0 9 * * 1-5")).toBe(
      "De lunes a viernes a las 09:00",
    );
    expect(describeSchedule("* * * * *")).toBe("Cada 1 minuto");
    expect(describeSchedule("0 * * * *")).toBe("Cada 1 hora, al minuto 00");
  });
  it("conserva las expresiones avanzadas sin traducirlas a una frecuencia distinta", () => {
    const cron = "10,40 8-18 * JAN,MAR MON-FRI";
    const draft = scheduleFromCron(cron, "UTC");
    expect(draft.mode).toBe("advanced");
    expect(scheduleToCron(draft)).toBe(cron);
    expect(draft.timezone).toBe("UTC");
    expect(
      upcomingSchedule(
        cron,
        "UTC",
        new Date("2026-01-05T08:00:00Z"),
        1,
      )[0]?.toISOString(),
    ).toBe("2026-01-05T08:10:00.000Z");
  });
  it("mantiene la hora local al cambiar el horario de Santiago", () => {
    expect(
      upcomingSchedule(
        "0 9 * * *",
        "America/Santiago",
        new Date("2026-04-04T00:00:00Z"),
      ).map((date) => date.toISOString()),
    ).toEqual([
      "2026-04-04T12:00:00.000Z",
      "2026-04-05T13:00:00.000Z",
      "2026-04-06T13:00:00.000Z",
    ]);
  });
  it("omite los meses sin el día elegido y calcula fechas estrictamente posteriores", () => {
    expect(
      upcomingSchedule(
        "0 9 31 * *",
        "UTC",
        new Date("2026-01-31T09:00:00Z"),
        1,
      )[0]?.toISOString(),
    ).toBe("2026-03-31T09:00:00.000Z");
    expect(
      upcomingSchedule(
        "*/15 * * * *",
        "UTC",
        new Date("2026-01-01T10:15:00Z"),
        1,
      )[0]?.toISOString(),
    ).toBe("2026-01-01T10:30:00.000Z");
  });
  it("rechaza fechas imposibles, cron inválido, segundos y zonas desconocidas", () => {
    for (const cron of [
      "x * * * *",
      "0 25 * * *",
      "0 9 31 2 *",
      "* * * * * *",
      "@hourly",
    ])
      expect(() => upcomingSchedule(cron, "UTC")).toThrow();
    expect(() => upcomingSchedule("* * * * *", "Mars/Test")).toThrow(
      /zona horaria/,
    );
    expect(() =>
      scheduleToCron({ ...createScheduleDraft(), mode: "weekly", days: [] }),
    ).toThrow(/al menos un día/);
    expect(() =>
      scheduleToCron({
        ...createScheduleDraft(),
        mode: "minutes",
        interval: 7,
      }),
    ).toThrow(/intervalo/);
  });
});
