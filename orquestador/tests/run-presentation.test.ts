import { describe, expect, it } from "vitest";
import {
  formatRunDate,
  runDuration,
  runStatusLabels,
  runTriggerLabel,
} from "../layers/admin/app/utils/run-presentation";
const started_at = "2026-11-03T12:00:00Z";
describe("execution presentation", () => {
  it("formats completed durations across minute and hour boundaries", () => {
    expect(
      runDuration({
        started_at,
        finished_at: "2026-11-03T12:00:45Z",
        status: "success",
      }),
    ).toBe("45 s");
    expect(
      runDuration({
        started_at,
        finished_at: "2026-11-03T12:01:05Z",
        status: "success",
      }),
    ).toBe("1 min 5 s");
    expect(
      runDuration({
        started_at,
        finished_at: "2026-11-03T13:02:00Z",
        status: "success",
      }),
    ).toBe("1 h 2 min");
  });
  it("waits for a client clock before calculating a running duration", () => {
    const run = { started_at, finished_at: null, status: "running" };
    expect(runDuration(run)).toBe("En curso");
    expect(runDuration(run, new Date("2026-11-03T12:00:10Z").getTime())).toBe(
      "10 s",
    );
  });
  it("does not invent elapsed time for unfinished terminal runs or invalid dates", () => {
    expect(
      runDuration(
        { started_at, finished_at: null, status: "failed" },
        Date.now(),
      ),
    ).toBe("Sin registrar");
    expect(
      runDuration({ started_at: null, finished_at: null, status: "queued" }),
    ).toBe("Sin iniciar");
    expect(
      runDuration({
        started_at: "invalid",
        finished_at: started_at,
        status: "success",
      }),
    ).toBe("Sin registrar");
    expect(
      runDuration({
        started_at,
        finished_at: "2026-11-03T11:00:00Z",
        status: "success",
      }),
    ).toBe("Sin registrar");
  });
  it("handles missing dates and preserves unknown origins", () => {
    expect(formatRunDate(null)).toBe("Sin registrar");
    expect(formatRunDate("invalid")).toBe("Sin registrar");
    expect(runTriggerLabel("cron")).toBe("Programada");
    expect(runTriggerLabel("external-event")).toBe("external-event");
    expect(runStatusLabels.cancelling).toBe("Cancelando");
  });
});
