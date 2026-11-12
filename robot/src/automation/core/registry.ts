import type {
  ActionAvailability,
  ActionDescriptor,
  ActionRunResult,
  AutomationAction,
  AutomationApp,
  AutomationContext,
  AutomationInput,
} from "./types";
import { validatePluginManifest } from "@rpa/contracts";

export type ListActionsFilter = {
  appId?: string;
};

const resolveAvailability = async (
  action: AutomationAction,
  context: AutomationContext,
): Promise<ActionAvailability> => {
  if (!action.availability) {
    return { available: true };
  }

  if (typeof action.availability === "function") {
    return action.availability(context);
  }

  return action.availability;
};

export class AutomationRegistry {
  private readonly apps = new Map<string, AutomationApp>();
  private readonly actions = new Map<string, AutomationAction>();

  registerApp(app: AutomationApp): void {
    if (this.apps.has(app.id)) {
      throw new Error(`App already registered: ${app.id}`);
    }

    const ids = new Set<string>();
    for (const action of app.actions) {
      if (
        action.appId !== app.id ||
        ids.has(action.id) ||
        this.actions.has(action.id)
      )
        throw new Error(`Invalid or duplicate action: ${action.id}`);
      ids.add(action.id);
    }
    if (
      app.plugin &&
      (app.plugin.id !== app.id ||
        app.plugin.sdkVersion !== "1.0.0" ||
        app.plugin.actions.length !== ids.size ||
        app.plugin.actions.some((action) => !ids.has(action.id)))
    )
      throw new Error(`Invalid plugin manifest: ${app.id}`);
    if (app.plugin) validatePluginManifest(app.plugin);
    this.apps.set(app.id, app);

    for (const action of app.actions) {
      this.registerAction(action);
    }
  }

  registerPlugin(
    app: AutomationApp & { plugin: NonNullable<AutomationApp["plugin"]> },
  ): void {
    this.registerApp(app);
  }

  registerApps(apps: AutomationApp[]): void {
    for (const app of apps) {
      this.registerApp(app);
    }
  }

  registerAction(action: AutomationAction): void {
    if (this.actions.has(action.id)) {
      throw new Error(`Action already registered: ${action.id}`);
    }

    this.actions.set(action.id, action);
  }

  listApps(): AutomationApp[] {
    return Array.from(this.apps.values()).map((app) => ({
      ...app,
      actions: [...app.actions],
    }));
  }

  hasAction(actionId: string): boolean {
    return this.actions.has(actionId);
  }

  getActionIds(): string[] {
    return Array.from(this.actions.keys());
  }

  async listActions(
    context: AutomationContext,
    filter?: ListActionsFilter,
  ): Promise<ActionDescriptor[]> {
    const allActions = Array.from(this.actions.values()).filter((action) => {
      if (!filter?.appId) {
        return true;
      }

      return action.appId === filter.appId;
    });

    const descriptors = await Promise.all(
      allActions.map(async (action) => {
        const availability = await resolveAvailability(action, context);

        return {
          id: action.id,
          appId: action.appId,
          name: action.name,
          description: action.description,
          tags: action.tags,
          inputFields: action.inputFields,
          available: availability.available,
          unavailableReason: availability.unavailableReason,
        } satisfies ActionDescriptor;
      }),
    );

    return descriptors;
  }

  async execute(
    actionId: string,
    input: AutomationInput | undefined,
    context: AutomationContext,
  ): Promise<ActionRunResult> {
    const action = this.actions.get(actionId);

    if (!action) {
      return {
        ok: false,
        message: `Action not found: ${actionId}`,
        errorCode: "ACTION_NOT_FOUND",
      };
    }

    const availability = await resolveAvailability(action, context);

    if (!availability.available) {
      return {
        ok: false,
        message: availability.unavailableReason ?? "Action is unavailable",
        errorCode: "ACTION_UNAVAILABLE",
      };
    }

    context.appContexts ??= {};
    context.pendingActions ??= new Set();
    const executeAction = (
      id: string,
      childInput: AutomationInput,
      signal: AbortSignal,
    ) => {
      const operation = this.execute(id, childInput, { ...context, signal });
      context.pendingActions!.add(operation);
      void operation.then(
        () => context.pendingActions!.delete(operation),
        () => context.pendingActions!.delete(operation),
      );
      return operation;
    };
    if (context.signal?.aborted)
      return {
        ok: false,
        message: "Ejecución cancelada.",
        errorCode: "FLOW_CANCELLED",
      };
    return action.run(input, { ...context, executeAction });
  }
}
