import { getCookie, getHeader, setHeader, type H3Event } from "h3";
import { desencriptaToken } from "../auth";
import { createUuid } from "../utils/crypto";
export const createContext = async (event: H3Event) => {
  const requestId = createUuid();
  setHeader(event, "x-request-id", requestId);
  const token = getHeader(event, "authorization") || getCookie(event, "token");
  const user = token ? await desencriptaToken(token).catch(() => null) : null;
  return { user, publicIp: event.node.req.socket.remoteAddress, requestId };
};
export type Context = Awaited<ReturnType<typeof createContext>>;
