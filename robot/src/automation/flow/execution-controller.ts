// One desktop owner per process. Tombstones handle cancellation arriving before dispatch.
export class ExecutionController {
  private active: {
    id: string;
    owner: number;
    controller: AbortController;
  } | null = null;
  private completed = new Set<string>();
  private waiters: Array<() => void> = [];
  get busy() {
    return this.active !== null;
  }
  begin(id: string, owner: number): AbortSignal {
    if (this.active)
      throw new Error("El escritorio ya tiene una ejecución activa.");
    if (this.completed.has(id))
      throw new Error("La ejecución ya terminó o fue cancelada.");
    const controller = new AbortController();
    this.active = { id, owner, controller };
    return controller.signal;
  }
  cancel(id: string, owner: number): boolean {
    if (this.active?.id === id) {
      if (this.active.owner !== owner)
        throw new Error("La ejecución pertenece a otra ventana.");
      this.active.controller.abort();
      return true;
    }
    this.remember(id);
    return false;
  }
  async stopAll(stopDriver: () => Promise<void>) {
    if (!this.active) return;
    const idle = new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active.controller.abort();
    await stopDriver();
    await idle;
  }
  finish(id: string) {
    if (this.active?.id === id) {
      this.active = null;
      for (const resolve of this.waiters.splice(0)) resolve();
    }
    this.remember(id);
  }
  private remember(id: string) {
    this.completed.add(id);
    if (this.completed.size > 2000)
      this.completed.delete(this.completed.values().next().value!);
  }
}
