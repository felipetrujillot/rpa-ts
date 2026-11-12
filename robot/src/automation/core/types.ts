import type {
  ActionInputField,
  ActionAvailability,
  AutomationInput,
  ActionRunResult,
} from "@rpa/contracts";
export type * from "@rpa/contracts";
export type AutomationContext = {
  appContexts?: Record<string, unknown>;
  signal?: AbortSignal;
  executeAction?: (
    actionId: string,
    input: AutomationInput,
    signal: AbortSignal,
  ) => Promise<ActionRunResult>;
  authorizeScriptAction?: (
    actionId: string,
    signal: AbortSignal,
  ) => Promise<boolean>;
  pendingActions?: Set<Promise<unknown>>;
};

export type ActionAvailabilityResolver =
  | ActionAvailability
  | ((
      context: AutomationContext,
    ) => ActionAvailability | Promise<ActionAvailability>);

export type AutomationAction = {
  id: string;
  appId: string;
  name: string;
  description: string;
  tags?: string[];
  inputFields?: ActionInputField[];
  availability?: ActionAvailabilityResolver;
  run: (
    input: AutomationInput | undefined,
    context: AutomationContext,
  ) => Promise<ActionRunResult>;
};

export type AutomationApp = {
  id: string;
  name: string;
  description: string;
  actions: AutomationAction[];
  plugin?: import("@rpa/contracts").AutomationPluginManifest;
};
