export const formatDate = (value: string): string => {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat("es", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date)
    : "—";
};
export const formatDuration = (value: number | null | undefined): string => {
  if (typeof value !== "number" || value < 0) return "—";
  if (value < 1000) return `${value} ms`;
  const seconds = Math.floor(value / 1000);
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
  return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
};
export const statusLabel = (status: string): string =>
  ({
    queued: "En cola",
    running: "En ejecución",
    cancelling: "Cancelando",
    success: "Completado",
    failed: "Con error",
    cancelled: "Cancelado",
    unknown: "Sin clasificar",
  })[status] || status;
