import { assertPluginCompatibility } from "~~/server/rpa/plugin-inventory";
import { executeAgenteFlowAssignmentInputSchema } from "@rpa/contracts";
import { assertAgentAccess } from "~~/server/auth/principal";
import { and, desc, eq } from "drizzle-orm";
import { db } from "~~/server/db";
import {
  agenteFlujos,
  flowRuns,
  flowVersions,
} from "~~/server/db/schema/schema_flujos";
import { dispatchNextQueuedFlowRunForAgent } from "~~/server/rpa-flow/queue-dispatch";
import { validateFlowDocument } from "~~/server/rpa-flow/schema";
import { createUuid } from "~~/server/utils/crypto";
import { deviceOrUserProcedure } from "../../trpc";

export default deviceOrUserProcedure
  .input(executeAgenteFlowAssignmentInputSchema)
  .mutation(async ({ ctx, input }) => {
    const uuid_empresa = ctx.user!.uuid_empresa;

    const assignment = await db
      .select({
        uuid_agente_flujo: agenteFlujos.uuid_agente_flujo,
        uuid_agente: agenteFlujos.uuid_agente,
        uuid_flujo: agenteFlujos.uuid_flujo,
        uuid_flow_version: agenteFlujos.uuid_flow_version,
        activo: agenteFlujos.activo,
      })
      .from(agenteFlujos)
      .where(
        and(
          eq(agenteFlujos.uuid_agente_flujo, input.uuid_agente_flujo),
          eq(agenteFlujos.uuid_empresa, uuid_empresa),
        ),
      )
      .limit(1);

    const selectedAssignment = assignment[0];

    if (!selectedAssignment) {
      throw new Error("Asignación no encontrada.");
    }

    assertAgentAccess(ctx.user, selectedAssignment.uuid_agente);

    if (selectedAssignment.activo !== 1) {
      throw new Error("La asignación está inactiva.");
    }

    const version = selectedAssignment.uuid_flow_version
      ? await db
          .select({
            uuid_flow_version: flowVersions.uuid_flow_version,
            uuid_flujo: flowVersions.uuid_flujo,
            definition_json: flowVersions.definition_json,
          })
          .from(flowVersions)
          .where(
            and(
              eq(flowVersions.uuid_empresa, uuid_empresa),
              eq(
                flowVersions.uuid_flow_version,
                selectedAssignment.uuid_flow_version,
              ),
              eq(flowVersions.uuid_flujo, selectedAssignment.uuid_flujo),
            ),
          )
          .limit(1)
      : await db
          .select({
            uuid_flow_version: flowVersions.uuid_flow_version,
            uuid_flujo: flowVersions.uuid_flujo,
            definition_json: flowVersions.definition_json,
          })
          .from(flowVersions)
          .where(
            and(
              eq(flowVersions.uuid_empresa, uuid_empresa),
              eq(flowVersions.uuid_flujo, selectedAssignment.uuid_flujo),
              eq(flowVersions.estado, "published"),
            ),
          )
          .orderBy(desc(flowVersions.version_number))
          .limit(1);

    const selectedVersion = version[0];

    if (!selectedVersion) {
      throw new Error("No existe una versión del flujo para ejecutar.");
    }

    const validation = validateFlowDocument(selectedVersion.definition_json);

    if (!validation.ok) {
      throw new Error("La versión asignada no es válida para ejecución.");
    }

    if (validation.normalized) assertPluginCompatibility(uuid_empresa, selectedAssignment.uuid_agente, validation.normalized);
    const uuid_flow_run = createUuid();

    await db.insert(flowRuns).values({
      uuid_flow_run,
      uuid_flujo: selectedVersion.uuid_flujo,
      uuid_flow_version: selectedVersion.uuid_flow_version,
      uuid_empresa,
      uuid_agente: selectedAssignment.uuid_agente,
      uuid_agente_flujo: selectedAssignment.uuid_agente_flujo,
      trigger_type: "agent_manual",
      status: "queued",
      input_json: input.runtimeInput ?? {},
      created_at: new Date(),
      updated_at: new Date(),
    });

    const dispatchResult = await dispatchNextQueuedFlowRunForAgent(
      uuid_empresa,
      selectedAssignment.uuid_agente,
    );

    const queueStatus = dispatchResult.dispatched ? "running" : "queued";

    return {
      status: "ok" as const,
      data: {
        uuid_flow_run,
        uuid_agente_flujo: selectedAssignment.uuid_agente_flujo,
        uuid_agente: selectedAssignment.uuid_agente,
        uuid_flujo: selectedVersion.uuid_flujo,
        uuid_flow_version: selectedVersion.uuid_flow_version,
        execution: {
          mode: "agent-linked",
          queueStatus,
          dispatch: dispatchResult,
        },
      },
    };
  });
