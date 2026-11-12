// Do not perform effects until the server has durably acknowledged receipt.
// A lost acknowledgement leaves the local command accepted and safe to redeliver.
export class CommandAdmissionGate {
  private pending = new Map<
    string,
    {
      token: string;
      promise: Promise<void>;
      resolve: () => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  wait(id: string, token: string): Promise<void> {
    const existing = this.pending.get(id);
    if (existing) {
      if (existing.token !== token)
        return Promise.reject(new Error("La reserva del comando cambió."));
      return existing.promise;
    }
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const timer = setTimeout(() => {
      this.pending.delete(id);
      reject(
        new Error(
          "El servidor no confirmó la admisión del comando. Se esperará su reenvío.",
        ),
      );
    }, 30_000);
    this.pending.set(id, { token, promise, resolve, reject, timer });
    return promise;
  }
  confirm(id: string, token: string) {
    const pending = this.pending.get(id);
    if (!pending || pending.token !== token) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.resolve();
  }
  disconnect() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        new Error("Conexión cerrada antes de confirmar la admisión."),
      );
    }
    this.pending.clear();
  }
}
