import * as scriptPolicy from "./scriptPolicy";
import getAgentePlugins from "./getAgentePlugins";
import * as observability from "./observability";
import getAgenteExecutionState from "./getAgenteExecutionState";
import releaseAgenteReservation from "./releaseAgenteReservation";
import { protectedProcedure, router } from "../../trpc";
//import { db } from "~~/server/db/db";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { usuarios } from "~~/server/db/schema/schema";
import getAgentes from "./getAgentes";
import getAgenteById from "./getAgenteById";
import addAgente from "./addAgente";
import createSocketTicket from "./createSocketTicket";
import revocarAgente from "./revocarAgente";
import refreshAgente from "./refreshAgente";
import vincularAgente from "./vincularAgente";
import desvincularAgenteCliente from "./desvincularAgenteCliente";
import regenerarCodigoVinculacion from "./regenerarCodigoVinculacion";
import getAssignableFlows from "./getAssignableFlows";
import getAgenteFlowAssignments from "./getAgenteFlowAssignments";
import assignFlowToAgente from "./assignFlowToAgente";
import updateAgenteFlowAssignment from "./updateAgenteFlowAssignment";
import removeAgenteFlowAssignment from "./removeAgenteFlowAssignment";
import executeAgenteFlowAssignment from "./executeAgenteFlowAssignment";
import getAgenteFlowRuns from "./getAgenteFlowRuns";
import getAgenteFlowQueue from "./getAgenteFlowQueue";
import cancelAgenteFlowRun from "./cancelAgenteFlowRun";
import clearAgenteFlowQueue from "./clearAgenteFlowQueue";
import requestAgenteScreenshot from "./requestAgenteScreenshot";
import getAgenteLatestScreenshot from "./getAgenteLatestScreenshot";
import getAgenteSystemMetrics from "./getAgenteSystemMetrics";
/**
 *
 */
export const agentesTrpc = router({
  ...scriptPolicy,
  ...observability,
  getAgenteExecutionState,
  releaseAgenteReservation,
  getAgentes: getAgentes,

  getAgenteById: getAgenteById,

  addAgente: addAgente,

  vincularAgente: vincularAgente,
  refreshAgente,
  createSocketTicket,
  revocarAgente,

  desvincularAgenteCliente: desvincularAgenteCliente,

  regenerarCodigoVinculacion: regenerarCodigoVinculacion,

  getAssignableFlows: getAssignableFlows,

  getAgenteFlowAssignments: getAgenteFlowAssignments,

  assignFlowToAgente: assignFlowToAgente,

  updateAgenteFlowAssignment,

  removeAgenteFlowAssignment,

  executeAgenteFlowAssignment: executeAgenteFlowAssignment,

  requestAgenteScreenshot: requestAgenteScreenshot,

  getAgenteLatestScreenshot: getAgenteLatestScreenshot,
  getAgenteSystemMetrics,
  getAgentePlugins,

  getAgenteFlowRuns: getAgenteFlowRuns,

  getAgenteFlowQueue: getAgenteFlowQueue,

  cancelAgenteFlowRun: cancelAgenteFlowRun,
  clearAgenteFlowQueue,
});
