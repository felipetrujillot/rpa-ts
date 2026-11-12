import { router } from "../trpc";
import type { inferRouterOutputs } from "@trpc/server";
import { authTrpc } from "./auth/";
import { rootTrpc } from "./root";
import { agentesTrpc } from "./agentes";
import { flowsTrpc } from "./flows";
/**
 *
 */
export const appRouter = router({
  auth: authTrpc,

  root: rootTrpc,

  agentes: agentesTrpc,

  flows: flowsTrpc,
});

// export type definition of API
export type AppRouter = typeof appRouter;
export type RouterOutput = inferRouterOutputs<AppRouter>;
export type RouterInput = inferRouterOutputs<AppRouter>;
