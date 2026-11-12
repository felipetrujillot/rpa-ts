import { createTRPCNuxtHandler } from "trpc-nuxt/server";
import { appRouter } from "~~/server/trpc/routers";
import { createContext } from "~~/server/trpc/context";

// export API handler
export default createTRPCNuxtHandler({
  router: appRouter,
  createContext,
  onError(opts) {
    console.error("tRPC request failed", {
      code: opts.error.code,
      path: opts.path,
    });
  },
});
