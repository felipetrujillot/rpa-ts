import { defineTask } from "nitropack/runtime";
import { purgeAllExpiredEvidence } from "~~/server/rpa-flow/retention";
export default defineTask({
  meta: {
    name: "retention",
    description:
      "Elimina evidencia vencida por empresa y conserva el registro de auditoría.",
  },
  async run() {
    return { result: await purgeAllExpiredEvidence() };
  },
});
