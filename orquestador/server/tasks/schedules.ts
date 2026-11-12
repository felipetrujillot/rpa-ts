import { defineTask } from "nitropack/runtime";
import { runAssignmentSchedules } from "~~/server/rpa-flow/scheduler";

export default defineTask({
  meta: {
    name: "schedules",
    description: "Encola las asignaciones programadas que están pendientes.",
  },
  async run() {
    return { result: await runAssignmentSchedules() };
  },
});
