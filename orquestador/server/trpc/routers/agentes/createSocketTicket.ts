import { issueSocketTicket } from "~~/server/auth/socket-tickets";
import { agentProcedure } from "../../trpc";
export default agentProcedure.mutation(({ ctx }) =>
  issueSocketTicket(ctx.user),
);
