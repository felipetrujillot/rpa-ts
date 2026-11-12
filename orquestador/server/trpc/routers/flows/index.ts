import {
  pinBuiltinPluginRequirements,
  serializeFlowDocument,
  validateBuiltinPluginRequirements,
} from "@rpa/contracts";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "~~/server/db";
import {
  flowRuns,
  flowVersions,
  flujos,
} from "~~/server/db/schema/schema_flujos";
import {
  computeFlowChecksum,
  isSchemaVersionCompatible,
  validateFlowDocument,
} from "~~/server/rpa-flow/schema";
import { createUuid } from "~~/server/utils/crypto";
import { protectedProcedure, router } from "../../trpc";

const validateSchema = protectedProcedure
  .input(
    z.object({
      document: z.unknown(),
      knownActionIds: z.array(z.string()).optional(),
    }),
  )
  .query(async ({ input }) => {
    const validation = validateFlowDocument(input.document, {
      knownActionIds: input.knownActionIds
        ? new Set(input.knownActionIds)
        : undefined,
    });

    if (!validation.ok || !validation.normalized) {
      return {
        ...validation,
        compatibility: {
          accepted: false,
          reason: "validation_error",
        },
      };
    }

    const compatible = isSchemaVersionCompatible(
      validation.normalized.schemaVersion,
    );

    return {
      ...validation,
      compatibility: {
        accepted: compatible,
        reason: compatible ? "ok" : "unsupported_major",
      },
    };
  });

const getFlows = protectedProcedure.query(async ({ ctx }) => {
  const uuid_empresa = ctx.user!.uuid_empresa;

  return db
    .select({
      uuid_flujo: flujos.uuid_flujo,
      nombre: flujos.nombre,
      estado_publicacion: flujos.estado_publicacion,
      schema_version_actual: flujos.schema_version_actual,
      version_publicada: flujos.version_publicada,
      created_at: flujos.created_at,
      updated_at: flujos.updated_at,
    })
    .from(flujos)
    .where(eq(flujos.uuid_empresa, uuid_empresa))
    .orderBy(desc(flujos.updated_at));
});

const getFlow = protectedProcedure
  .input(z.object({ uuid_flujo: z.string().min(1) }))
  .query(async ({ ctx, input }) => {
    const uuid_empresa = ctx.user!.uuid_empresa;
    const [flow] = await db
      .select()
      .from(flujos)
      .where(
        and(
          eq(flujos.uuid_flujo, input.uuid_flujo),
          eq(flujos.uuid_empresa, uuid_empresa),
        ),
      )
      .limit(1);
    if (!flow)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Flujo no encontrado.",
      });
    const [[latestVersion], [published]] = await Promise.all([
      db
        .select()
        .from(flowVersions)
        .where(
          and(
            eq(flowVersions.uuid_flujo, input.uuid_flujo),
            eq(flowVersions.uuid_empresa, uuid_empresa),
          ),
        )
        .orderBy(desc(flowVersions.version_number))
        .limit(1),
      db
        .select({ id: flowVersions.uuid_flow_version })
        .from(flowVersions)
        .where(
          and(
            eq(flowVersions.uuid_flujo, input.uuid_flujo),
            eq(flowVersions.uuid_empresa, uuid_empresa),
            eq(flowVersions.estado, "published"),
          ),
        )
        .orderBy(desc(flowVersions.version_number))
        .limit(1),
    ]);
    if (!latestVersion)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "El flujo no tiene una versión editable.",
      });
    return {
      ...flow,
      latestVersion,
      publishedVersionId: published?.id ?? null,
    };
  });

const getFlowVersions = protectedProcedure
  .input(
    z.object({
      uuid_flujo: z.string().min(1),
    }),
  )
  .query(async ({ ctx, input }) => {
    const uuid_empresa = ctx.user!.uuid_empresa;

    return db
      .select({
        uuid_flow_version: flowVersions.uuid_flow_version,
        uuid_flujo: flowVersions.uuid_flujo,
        version_number: flowVersions.version_number,
        schema_version: flowVersions.schema_version,
        estado: flowVersions.estado,
        checksum: flowVersions.checksum,
        definition_json: flowVersions.definition_json,
        created_by: flowVersions.created_by,
        published_at: flowVersions.published_at,
        created_at: flowVersions.created_at,
        updated_at: flowVersions.updated_at,
      })
      .from(flowVersions)
      .where(
        and(
          eq(flowVersions.uuid_flujo, input.uuid_flujo),
          eq(flowVersions.uuid_empresa, uuid_empresa),
        ),
      )
      .orderBy(desc(flowVersions.version_number));
  });

const getFlowRuns = protectedProcedure
  .input(
    z.object({
      uuid_flujo: z.string().min(1),
      limit: z.number().int().positive().max(100).optional(),
    }),
  )
  .query(async ({ ctx, input }) => {
    const uuid_empresa = ctx.user!.uuid_empresa;
    const limit = input.limit ?? 20;

    return db
      .select({
        uuid_flow_run: flowRuns.uuid_flow_run,
        uuid_flujo: flowRuns.uuid_flujo,
        uuid_flow_version: flowRuns.uuid_flow_version,
        trigger_type: flowRuns.trigger_type,
        status: flowRuns.status,
        input_json: flowRuns.input_json,
        output_json: flowRuns.output_json,
        error_summary: flowRuns.error_summary,
        started_at: flowRuns.started_at,
        finished_at: flowRuns.finished_at,
        created_at: flowRuns.created_at,
        updated_at: flowRuns.updated_at,
      })
      .from(flowRuns)
      .where(
        and(
          eq(flowRuns.uuid_flujo, input.uuid_flujo),
          eq(flowRuns.uuid_empresa, uuid_empresa),
        ),
      )
      .orderBy(desc(flowRuns.created_at))
      .limit(limit);
  });

const createDraft = protectedProcedure
  .input(
    z.object({
      uuid_flujo: z.string().min(1).optional(),
      nombre: z.string().trim().min(1).max(250),
      document: z.unknown(),
      knownActionIds: z.array(z.string()).optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const uuid_empresa = ctx.user!.uuid_empresa;

    const validation = validateFlowDocument(input.document, {
      knownActionIds: input.knownActionIds
        ? new Set(input.knownActionIds)
        : undefined,
    });

    if (!validation.ok || !validation.normalized) {
      throw new Error("Flow schema validation failed.");
    }

    if (!isSchemaVersionCompatible(validation.normalized.schemaVersion)) {
      throw new Error(
        "Flow schemaVersion is not compatible with current backend policy.",
      );
    }

    const document = pinBuiltinPluginRequirements(validation.normalized);
    document.workflow.name = input.nombre.trim();
    const uuid_flujo = input.uuid_flujo ?? createUuid();
    const checksum = await computeFlowChecksum(document);
    return db.transaction(async (tx) => {
      if (!input.uuid_flujo) {
        await tx.insert(flujos).values({
          uuid_flujo,
          uuid_empresa,
          nombre: document.workflow.name,
          estado_publicacion: "draft",
          schema_version_actual: document.schemaVersion,
          version_publicada: 0,
          created_at: new Date(),
          updated_at: new Date(),
        });
      }
      // Serialize version creation for a flow, including concurrent editor saves.
      const [flow] = await tx
        .select({ uuid_flujo: flujos.uuid_flujo })
        .from(flujos)
        .where(
          and(
            eq(flujos.uuid_flujo, uuid_flujo),
            eq(flujos.uuid_empresa, uuid_empresa),
          ),
        )
        .limit(1)
        .for("update");
      if (!flow)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Flujo no encontrado.",
        });
      const [current] = await tx
        .select({ version_number: flowVersions.version_number })
        .from(flowVersions)
        .where(
          and(
            eq(flowVersions.uuid_flujo, uuid_flujo),
            eq(flowVersions.uuid_empresa, uuid_empresa),
          ),
        )
        .orderBy(desc(flowVersions.version_number))
        .limit(1);
      const nextVersion = (current?.version_number ?? 0) + 1;
      const uuid_flow_version = createUuid();
      await tx.insert(flowVersions).values({
        uuid_flow_version,
        uuid_flujo,
        uuid_empresa,
        version_number: nextVersion,
        schema_version: document.schemaVersion,
        estado: "draft",
        checksum,
        definition_json: document,
        created_by: ctx.user!.uuid_usuario,
        created_at: new Date(),
        updated_at: new Date(),
      });
      await tx
        .update(flujos)
        .set({
          nombre: document.workflow.name,
          schema_version_actual: document.schemaVersion,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(flujos.uuid_flujo, uuid_flujo),
            eq(flujos.uuid_empresa, uuid_empresa),
          ),
        );
      return {
        status: "ok" as const,
        data: {
          uuid_flujo,
          uuid_flow_version,
          version_number: nextVersion,
          checksum,
        },
      };
    });
  });

const publishVersion = protectedProcedure
  .input(
    z.object({
      uuid_flujo: z.string().min(1),
      uuid_flow_version: z.string().min(1),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const uuid_empresa = ctx.user!.uuid_empresa;

    const version = await db
      .select({
        uuid_flow_version: flowVersions.uuid_flow_version,
        uuid_flujo: flowVersions.uuid_flujo,
        version_number: flowVersions.version_number,
        schema_version: flowVersions.schema_version,
        definition_json: flowVersions.definition_json,
      })
      .from(flowVersions)
      .where(
        and(
          eq(flowVersions.uuid_flow_version, input.uuid_flow_version),
          eq(flowVersions.uuid_flujo, input.uuid_flujo),
          eq(flowVersions.uuid_empresa, uuid_empresa),
        ),
      )
      .limit(1);

    if (!version[0]) {
      throw new Error("Flow version no encontrada.");
    }

    const checked = validateFlowDocument(version[0].definition_json);
    if (!checked.ok || !checked.normalized)
      throw new Error("La versión no contiene un workflow v2 válido.");
    const pinned = pinBuiltinPluginRequirements(checked.normalized);
    // JSON storage may reorder object keys, including the pinned action map.
    if (serializeFlowDocument(pinned) !== serializeFlowDocument(checked.normalized))
      throw new Error("Guarda una nueva versión para fijar los requisitos de plugins antes de publicar.");
    const pluginErrors = validateBuiltinPluginRequirements(pinned);
    if (pluginErrors.length) throw new Error(pluginErrors.join(" "));

    await db
      .update(flowVersions)
      .set({
        estado: "archived",
        updated_at: new Date(),
      })
      .where(
        and(
          eq(flowVersions.uuid_flujo, input.uuid_flujo),
          eq(flowVersions.uuid_empresa, uuid_empresa),
          eq(flowVersions.estado, "published"),
        ),
      );

    await db
      .update(flowVersions)
      .set({
        estado: "published",
        published_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(flowVersions.uuid_flow_version, input.uuid_flow_version));

    await db
      .update(flujos)
      .set({
        estado_publicacion: "published",
        schema_version_actual: version[0].schema_version,
        version_publicada: version[0].version_number,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(flujos.uuid_flujo, input.uuid_flujo),
          eq(flujos.uuid_empresa, uuid_empresa),
        ),
      );

    return {
      status: "ok" as const,
      data: {
        uuid_flujo: input.uuid_flujo,
        uuid_flow_version: input.uuid_flow_version,
        version_number: version[0].version_number,
      },
    };
  });

const runManual = protectedProcedure
  .input(
    z.object({
      uuid_flujo: z.string().min(1),
      uuid_flow_version: z.string().min(1).optional(),
      runtimeInput: z.record(z.string(), z.unknown()).optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const uuid_empresa = ctx.user!.uuid_empresa;

    const selectedVersion = input.uuid_flow_version
      ? await db
          .select({
            uuid_flow_version: flowVersions.uuid_flow_version,
            uuid_flujo: flowVersions.uuid_flujo,
            schema_version: flowVersions.schema_version,
            definition_json: flowVersions.definition_json,
          })
          .from(flowVersions)
          .where(
            and(
              eq(flowVersions.uuid_flow_version, input.uuid_flow_version),
              eq(flowVersions.uuid_flujo, input.uuid_flujo),
              eq(flowVersions.uuid_empresa, uuid_empresa),
            ),
          )
          .limit(1)
      : await db
          .select({
            uuid_flow_version: flowVersions.uuid_flow_version,
            uuid_flujo: flowVersions.uuid_flujo,
            schema_version: flowVersions.schema_version,
            definition_json: flowVersions.definition_json,
          })
          .from(flowVersions)
          .where(
            and(
              eq(flowVersions.uuid_flujo, input.uuid_flujo),
              eq(flowVersions.uuid_empresa, uuid_empresa),
              eq(flowVersions.estado, "published"),
            ),
          )
          .orderBy(desc(flowVersions.version_number))
          .limit(1);

    const version = selectedVersion[0];

    if (!version) {
      throw new Error("No existe una version publicable para ejecutar.");
    }

    const validation = validateFlowDocument(version.definition_json);

    if (!validation.ok) {
      throw new Error("La version seleccionada no es valida para ejecucion.");
    }

    const uuid_flow_run = createUuid();

    await db.insert(flowRuns).values({
      uuid_flow_run,
      uuid_flujo: version.uuid_flujo,
      uuid_flow_version: version.uuid_flow_version,
      uuid_empresa,
      trigger_type: "manual",
      status: "queued",
      input_json: input.runtimeInput ?? {},
      created_at: new Date(),
      updated_at: new Date(),
    });

    return {
      status: "ok" as const,
      data: {
        uuid_flow_run,
        uuid_flujo: version.uuid_flujo,
        uuid_flow_version: version.uuid_flow_version,
        execution: {
          mode: "client-electron",
          queueStatus: "queued",
        },
      },
    };
  });

export const flowsTrpc = router({
  getFlows,
  getFlow,
  getFlowVersions,
  getFlowRuns,
  validateSchema,
  createDraft,
  publishVersion,
  runManual,
});
