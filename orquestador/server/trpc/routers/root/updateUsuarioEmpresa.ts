import { db } from "~~/server/db";
import { TRPCError } from "@trpc/server";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { hashPasswordBcrypt } from "~~/server/auth";
import { usuarios } from "~~/server/db/schema/schema";
import { rootProcedure } from "../../trpc";

function cleanUndefined<T extends Record<string, unknown>>(obj: T) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as T;
}

export default rootProcedure
  .input(
    z.object({
      uuid_usuario: z.string(),
      uuid_empresa: z.string(),
      nombre: z.string().min(2).optional(),
      email: z.string().email().optional(),
      role: z.number().int().min(0).max(2).optional(),
      activo: z.number().int().min(0).max(1).optional(),
      password: z
        .string()
        .min(6, "La contrasena debe tener al menos 6 caracteres")
        .optional(),
    }),
  )
  .mutation(async ({ input }) => {
    const found = await db
      .select({ uuid_usuario: usuarios.uuid_usuario })
      .from(usuarios)
      .where(
        and(
          eq(usuarios.uuid_usuario, input.uuid_usuario),
          eq(usuarios.uuid_empresa, input.uuid_empresa),
        ),
      )
      .limit(1);

    if (!found[0]) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Usuario no encontrado",
      });
    }

    const normalizedEmail = input.email?.toLowerCase().trim();

    if (normalizedEmail) {
      const duplicate = await db
        .select({ uuid_usuario: usuarios.uuid_usuario })
        .from(usuarios)
        .where(
          and(
            eq(usuarios.uuid_empresa, input.uuid_empresa),
            eq(usuarios.email, normalizedEmail),
            ne(usuarios.uuid_usuario, input.uuid_usuario),
          ),
        )
        .limit(1);

      if (duplicate[0]) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Ya existe otro usuario con este email",
        });
      }
    }

    const passwordHash = input.password
      ? await hashPasswordBcrypt(input.password)
      : undefined;

    await db
      .update(usuarios)
      .set(
        cleanUndefined({
          nombre: input.nombre?.trim(),
          email: normalizedEmail,
          role: input.role,
          activo: input.activo,
          password: passwordHash,
          updated_at: new Date(),
        }),
      )
      .where(
        and(
          eq(usuarios.uuid_usuario, input.uuid_usuario),
          eq(usuarios.uuid_empresa, input.uuid_empresa),
        ),
      );

    return {
      status: "ok" as const,
      uuid_usuario: input.uuid_usuario,
    };
  });
