import { cancelAgenteFlowRunInputSchema } from "@rpa/contracts";
import { assertAgentAccess } from "~~/server/auth/principal";
import { and, eq } from "drizzle-orm";
import { db } from "~~/server/db";
import { flowRuns } from "~~/server/db/schema/schema_flujos";
import { dispatchNextQueuedFlowRunForAgent } from "~~/server/rpa-flow/queue-dispatch";
import {
  deliverPendingCommands,
  ensureCancellationCommand,
} from "~~/server/rpa-flow/durable-execution";
import { deviceOrUserProcedure } from "../../trpc";

export default deviceOrUserProcedure
  .input(cancelAgenteFlowRunInputSchema)
  .mutation(async ({ ctx, input }) => {
    const uuid_empresa = ctx.user!.uuid_empresa;

    const foundRun = await db
      .select({
        uuid_flow_run: flowRuns.uuid_flow_run,
        uuid_agente: flowRuns.uuid_agente,
        status: flowRuns.status,
      })
      .from(flowRuns)
      .where(
        and(
          eq(flowRuns.uuid_empresa, uuid_empresa),
          eq(flowRuns.uuid_flow_run, input.uuid_flow_run),
        ),
      )
      .limit(1);

    const selectedRun = foundRun[0];

    if (!selectedRun) {
      throw new Error("Ejecución no encontrada.");
    }

    if (selectedRun.uuid_agente)
      assertAgentAccess(ctx.user, selectedRun.uuid_agente);
    else if (ctx.user.tipo === "agente")
      throw new Error("Ejecución no encontrada.");

    if (input.uuid_agente && selectedRun.uuid_agente !== input.uuid_agente) {
      throw new Error("Ejecución no encontrada para este agente.");
    }

    // Compare-and-set against the state read above. If dispatch wins the race,
    // retry so a running robot is never treated as an unstarted queued run.
    for (let attempt = 0; attempt < 3; attempt++) {
      const [run] = await db
        .select({ status: flowRuns.status })
        .from(flowRuns)
        .where(
          and(
            eq(flowRuns.uuid_empresa, uuid_empresa),
            eq(flowRuns.uuid_flow_run, selectedRun.uuid_flow_run),
          ),
        )
        .limit(1);
      if (!run) throw new Error("Ejecución no encontrada.");
      const current_status =
        run.status === "queued"
          ? ("cancelled" as const)
          : run.status === "running" || run.status === "cancelling"
            ? ("cancelling" as const)
            : run.status;
      if (!["queued", "running", "cancelling"].includes(run.status)) {
        return {
          status: "ok" as const,
          data: {
            uuid_flow_run: selectedRun.uuid_flow_run,
            cancelled: false,
            current_status,
          },
        };
      }
      const changed = await db
        .update(flowRuns)
        .set({
          status: current_status,
          finished_at: current_status === "cancelled" ? new Date() : undefined,
          error_summary:
            current_status === "cancelled"
              ? "Cancelado antes de iniciar."
              : "Cancelación solicitada; esperando al robot.",
          updated_at: new Date(),
        })
        .where(
          and(
            eq(flowRuns.uuid_empresa, uuid_empresa),
            eq(flowRuns.uuid_flow_run, selectedRun.uuid_flow_run),
            eq(flowRuns.status, run.status),
          ),
        );
      if (!changed[0].affectedRows) continue;
      if (selectedRun.uuid_agente) {
        if (current_status === "cancelling") {
          const identity = {
            uuid_empresa,
            uuid_agente: selectedRun.uuid_agente,
          };
          await ensureCancellationCommand(identity, selectedRun.uuid_flow_run);
          await deliverPendingCommands(identity);
        } else
          await dispatchNextQueuedFlowRunForAgent(
            uuid_empresa,
            selectedRun.uuid_agente,
          );
      }
      return {
        status: "ok" as const,
        data: {
          uuid_flow_run: selectedRun.uuid_flow_run,
          cancelled: current_status === "cancelled",
          current_status,
        },
      };
    }
    throw new Error("La ejecución cambió de estado. Reintenta la cancelación.");
  });
