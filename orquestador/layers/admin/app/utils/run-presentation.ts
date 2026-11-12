export const runStatusLabels: Record<string, string> = {
  queued: "En cola",
  running: "En ejecución",
  cancelling: "Cancelando",
  success: "Completada",
  failed: "Fallida",
  cancelled: "Cancelada",
};
const triggerLabels: Record<string, string> = {
  manual: "Manual",
  cron: "Programada",
  schedule: "Programada",
};
export const runTriggerLabel = (trigger: string) =>
  triggerLabels[trigger] || trigger;
export function formatRunDate(iso: string | null | undefined): string {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return "Sin registrar";
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}
export function runDuration(
  run: {
    started_at: string | null;
    finished_at: string | null;
    status: string;
  },
  now: number | null = null,
): string {
  if (!run.started_at) return "Sin iniciar";
  const start = new Date(run.started_at).getTime();
  if (Number.isNaN(start)) return "Sin registrar";
  if (!run.finished_at && !["running", "cancelling"].includes(run.status))
    return "Sin registrar";
  if (!run.finished_at && now === null) return "En curso";
  const end = run.finished_at ? new Date(run.finished_at).getTime() : now!;
  if (!Number.isFinite(end) || end < start) return "Sin registrar";
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${seconds % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
