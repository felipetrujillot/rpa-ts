import type { NuxtPage } from "@nuxt/schema";
import { fileURLToPath } from "node:url";

/**
 * 7ec5e49e-428f-49d9-9f6b-291fe358b43c
 *
 */
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  devtools: { enabled: true },
  css: ["~/assets/css/tailwind.css"],

  modules: ["shadcn-nuxt", "@nuxtjs/tailwindcss", "@nuxthub/core"],
  routeRules: {
    "/admin/**": { appLayout: "admin-layout" },
  },

  hub: {
    db: {
      dialect: "mysql",
      driver: "mysql2",
      applyMigrationsDuringBuild: false,
    },
  },

  nitro: {
    scheduledTasks: { "0 * * * *": ["retention"], "* * * * *": ["schedules"] },
    experimental: {
      websocket: true,
      tasks: true,
    },
  },
  // Resolve the workspace source on both server and client so Vite never serves
  // an outdated prebundled CommonJS catalog after contracts change.
  alias: {
    "@rpa/contracts": fileURLToPath(
      new URL("../packages/contracts/src/index.ts", import.meta.url),
    ),
  },
  vite: {
    optimizeDeps: {
      exclude: ["@rpa/contracts"],
      include: [
        "@internationalized/date",
        "@vue/devtools-core",
        "@vue/devtools-kit",
        "@vueuse/core",
        "class-variance-authority",
        "clsx",
        "lucide-vue-next",
        "reka-ui",
        "reka-ui/date",
        "tailwind-merge",
        "uuid",
        "vue-sonner",
        "@vue-flow/background",
        "@vue-flow/core",
        "@vue-flow/minimap",
        "zod",
      ],
    },
  },

  build: {
    transpile: ["trpc-nuxt"],
  },
  shadcn: {
    /**
     * Prefix for all the imported component
     */
    prefix: "",
    /**
     * Directory that the component lives in.
     * @default "./components/ui"
     */
    componentDir: "./app/components/ui",
  },

  future: {
    compatibilityVersion: 4,
  },

  hooks: {
    "pages:extend"(pages) {
      /**
       *
       * @param pattern
       * @param pages
       */
      function removePagesMatching(pattern: RegExp, pages: NuxtPage[] = []) {
        const pagesToRemove: NuxtPage[] = [];
        for (const page of pages) {
          if (page.file && pattern.test(page.file)) {
            pagesToRemove.push(page);
          } else {
            removePagesMatching(pattern, page.children);
          }
        }
        for (const page of pagesToRemove) {
          pages.splice(pages.indexOf(page), 1);
        }
      }
      removePagesMatching(/_components/, pages);
      removePagesMatching(/_tabs/, pages);
    },
  },

  runtimeConfig: {
    assets: {
      provider: "local",
      localDirectory: ".data/assets",
      azureConnectionString: "",
      azureContainer: "rpa-assets",
    },
    jwtSecret: process.env.NUXT_JWT_SECRET,
    d1Name: process.env.NUXT_D1_NAME,

    mailTrapUser: process.env.NUXT_MAILTRAP_USER,
    mailTrapPass: process.env.NUXT_MAILTRAP_PASS,
    mailTrapPort: process.env.NUXT_MAILTRAP_PORT,
    mailgunApiKey: process.env.NUXT_MAILGUN_APIKEY,
    pageUrl: process.env.NUXT_PAGE_URL,

    public: {
      pageUrl: process.env.NUXT_PAGE_URL,

      projectName: process.env.NUXT_PROJECT_NAME,
    },
  },
});
