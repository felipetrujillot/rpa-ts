import { createTRPCUntypedClient, httpLink } from "@trpc/client";
import { scriptAuthorizationResponseSchema } from "@rpa/contracts";
import { fetchTrpcJson } from "../../main/orquestador-http";

/** Only the trusted host obtains credentials and contacts the configured server.
 * Neither credentials nor policy callbacks are exposed to the guest interpreter.
 * No allow/deny cache: every call checks the current server policy.
 */
export class OrquestadorScriptAuthorization {
  constructor(
    private readonly options: {
      trpcUrl: string;
      authenticate: () => Promise<string>;
      fetch?: typeof fetch;
    },
  ) {}

  async authorize(actionId: string, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    const token = await this.options.authenticate();
    signal.throwIfAborted();
    const client = createTRPCUntypedClient({
      links: [
        httpLink({
          url: this.options.trpcUrl,
          headers: { authorization: `Bearer ${token}` },
          fetch: (url, init) =>
            (this.options.fetch ?? fetchTrpcJson)(url, {
              ...init,
              signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
              redirect: "error",
            }),
        }),
      ],
    });
    const response = await client.query("agentes.authorizeScriptAction", {
      actionId,
    });
    signal.throwIfAborted();
    return scriptAuthorizationResponseSchema.parse(response).allowed;
  }
}
