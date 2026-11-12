import { db } from "~~/server/db";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { hashPasswordBcrypt } from "~~/server/auth";
import { empresas, usuarios } from "~~/server/db/schema/schema";
import { createUuid } from "~~/server/utils/crypto";
import { rootProcedure } from "../../trpc";

export default rootProcedure
  .input(
    z.object({
      uuid_empresa: z.string(),
      nombre: z.string().min(2, "Nombre requerido"),
      email: z.string().email("Email invalido"),
      role: z.number().int().min(0).max(2).default(1),
      activo: z.number().int().min(0).max(1).default(1),
    }),
  )
  .mutation(async ({ input }) => {
    const config = useRuntimeConfig();
    const empresa = await db
      .select({ uuid_empresa: empresas.uuid_empresa })
      .from(empresas)
      .where(eq(empresas.uuid_empresa, input.uuid_empresa))
      .limit(1);

    if (!empresa[0]) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Empresa no encontrada",
      });
    }

    const normalizedEmail = input.email.toLowerCase().trim();

    const duplicate = await db
      .select({ uuid_usuario: usuarios.uuid_usuario })
      .from(usuarios)
      .where(
        and(
          eq(usuarios.uuid_empresa, input.uuid_empresa),
          eq(usuarios.email, normalizedEmail),
        ),
      )
      .limit(1);

    if (duplicate[0]) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Ya existe un usuario con este email en la empresa",
      });
    }

    const uuid_usuario = createUuid();
    const temporaryPassword = `${createUuid()}-${Date.now()}`;
    const password_hash = await hashPasswordBcrypt(temporaryPassword);

    await db.insert(usuarios).values({
      uuid_usuario,
      uuid_empresa: input.uuid_empresa,
      nombre: input.nombre.trim(),
      email: normalizedEmail,
      password: password_hash,
      role: input.role,
      activo: input.activo,
      created_at: new Date(),
      updated_at: new Date(),
    });

    /* const token = await createWelcomeResetRequest({
      uuid_usuario,
      email: normalizedEmail,
    }); */

    const pageUrl = String(config.pageUrl || "")
      .trim()
      .replace(/\/$/, "");
    if (!pageUrl) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "No se encontro la configuracion de URL publica",
      });
    }

    //const onboardingUrl = `${pageUrl}/bienvenida/${encodeURIComponent(token)}`;

    return {
      status: "ok" as const,
      uuid_usuario,
      //   onboardingUrl,
    };
  });
