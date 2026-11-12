import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";
import { requireAgent, requireUser } from "../auth/principal";
const t = initTRPC.context<Context>().create();
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) =>
  next({ ctx: { user: requireUser(ctx.user) } }),
);
export const agentProcedure = t.procedure.use(({ ctx, next }) =>
  next({ ctx: { user: requireAgent(ctx.user) } }),
);
// Only operations that explicitly support a robot use this procedure.
export const deviceOrUserProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { user: ctx.user } });
});
export const rootProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 0) throw new TRPCError({ code: "FORBIDDEN" });
  return next({ ctx });
});
export const router = t.router;
export const middleware = t.middleware;
