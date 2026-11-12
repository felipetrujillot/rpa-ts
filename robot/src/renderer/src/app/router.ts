import { createRouter, createWebHashHistory } from "vue-router";
import SettingsView from "@/app/views/SettingsView.vue";
import HomeView from "@/app/views/HomeView.vue";
import LinkAgentView from "@/app/views/LinkAgentView.vue";
import FlowAssignmentsView from "@/app/views/FlowAssignmentsView.vue";
import FlowRunDetailView from "@/app/views/FlowRunDetailView.vue";
import { AGENTE_TOKEN_STORAGE_KEY } from "@/app/services/orquestador-trpc";

const router = createRouter({
  history: createWebHashHistory(process.env.BASE_URL),
  routes: [
    { path: "/settings", name: "settings", component: SettingsView },
    {
      path: "/",
      name: "vincular",
      component: LinkAgentView,
      beforeEnter: () => {
        const token = localStorage.getItem(AGENTE_TOKEN_STORAGE_KEY) || "";

        if (token && token.length > 2) {
          return { path: "/flows" };
        }

        return true;
      },
    },
    {
      path: "/debug",
      name: "debug",
      component: HomeView,
    },
    {
      path: "/flows",
      name: "flows",
      component: FlowAssignmentsView,
      beforeEnter: () => {
        const token = localStorage.getItem(AGENTE_TOKEN_STORAGE_KEY) || "";

        if (!token) {
          return { path: "/" };
        }

        return true;
      },
    },
    {
      path: "/flows/run/:runId",
      name: "flow-run-detail",
      component: FlowRunDetailView,
      beforeEnter: () => {
        const token = localStorage.getItem(AGENTE_TOKEN_STORAGE_KEY) || "";

        if (!token) {
          return { path: "/" };
        }

        return true;
      },
    },
  ],
});

export default router;
