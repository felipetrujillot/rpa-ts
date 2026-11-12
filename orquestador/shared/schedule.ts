import { Cron } from "croner";

export const DEFAULT_SCHEDULE_TIMEZONE = "America/Santiago";
export const weekDays = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" },
];
export type ScheduleMode =
  | "manual"
  | "minutes"
  | "hours"
  | "daily"
  | "weekdays"
  | "weekly"
  | "monthly"
  | "advanced";
export type ScheduleDraft = {
  mode: ScheduleMode;
  interval: number;
  time: string;
  days: number[];
  monthDay: number;
  cron: string;
  timezone: string;
};
export const createScheduleDraft = (): ScheduleDraft => ({
  mode: "manual",
  interval: 15,
  time: "09:00",
  days: [1],
  monthDay: 1,
  cron: "",
  timezone: DEFAULT_SCHEDULE_TIMEZONE,
});

export function scheduleToCron(draft: ScheduleDraft): string {
  if (draft.mode === "manual") return "";
  if (draft.mode === "advanced") return draft.cron.trim().replace(/\s+/g, " ");
  if (draft.mode === "minutes" || draft.mode === "hours") {
    const allowed =
      draft.mode === "minutes"
        ? [1, 5, 10, 15, 20, 30]
        : [1, 2, 3, 4, 6, 8, 12];
    if (!allowed.includes(Number(draft.interval)))
      throw new Error("Selecciona un intervalo válido.");
    return draft.mode === "minutes"
      ? `*/${draft.interval} * * * *`
      : `0 */${draft.interval} * * *`;
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time))
    throw new Error("Selecciona una hora válida.");
  const [hour, minute] = draft.time.split(":").map(Number);
  if (draft.mode === "daily") return `${minute} ${hour} * * *`;
  if (draft.mode === "weekdays") return `${minute} ${hour} * * 1-5`;
  if (draft.mode === "weekly") {
    const days = [...new Set(draft.days)].sort((a, b) => a - b);
    if (
      !days.length ||
      days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
    )
      throw new Error("Selecciona al menos un día de la semana.");
    return `${minute} ${hour} * * ${days.join(",")}`;
  }
  if (
    !Number.isInteger(draft.monthDay) ||
    draft.monthDay < 1 ||
    draft.monthDay > 31
  )
    throw new Error("El día del mes debe estar entre 1 y 31.");
  return `${minute} ${hour} ${draft.monthDay} * *`;
}

// Unknown expressions remain in advanced mode, preserving their exact meaning.
export function scheduleFromCron(
  cron: string | null | undefined,
  timezone = DEFAULT_SCHEDULE_TIMEZONE,
): ScheduleDraft {
  const draft = {
    ...createScheduleDraft(),
    timezone,
    cron: cron?.trim() || "",
  };
  if (!draft.cron) return draft;
  draft.mode = "advanced";
  const [minute, hour, day, month, weekday] = draft.cron.split(/\s+/);
  if (draft.cron.split(/\s+/).length !== 5) return draft;
  if (
    (minute === "*" || /^\*\/(1|5|10|15|20|30)$/.test(minute!)) &&
    [hour, day, month, weekday].every((value) => value === "*")
  ) {
    draft.mode = "minutes";
    draft.interval = minute === "*" ? 1 : Number(minute!.slice(2));
  } else if (
    minute === "0" &&
    (hour === "*" || /^\*\/(1|2|3|4|6|8|12)$/.test(hour!)) &&
    [day, month, weekday].every((value) => value === "*")
  ) {
    draft.mode = "hours";
    draft.interval = hour === "*" ? 1 : Number(hour!.slice(2));
  } else if (
    /^\d+$/.test(minute!) &&
    Number(minute) < 60 &&
    /^\d+$/.test(hour!) &&
    Number(hour) < 24 &&
    month === "*"
  ) {
    draft.time = `${hour!.padStart(2, "0")}:${minute!.padStart(2, "0")}`;
    if (day === "*" && weekday === "*") draft.mode = "daily";
    else if (day === "*" && weekday === "1-5") draft.mode = "weekdays";
    else if (day === "*" && /^[0-6](,[0-6])*$/.test(weekday!)) {
      draft.mode = "weekly";
      draft.days = weekday!.split(",").map(Number);
    } else if (
      weekday === "*" &&
      /^\d+$/.test(day!) &&
      Number(day) >= 1 &&
      Number(day) <= 31
    ) {
      draft.mode = "monthly";
      draft.monthDay = Number(day);
    }
  }
  return draft;
}

export function upcomingSchedule(
  cron: string,
  timezone: string,
  now = new Date(),
  count = 3,
): Date[] {
  try {
    new Intl.DateTimeFormat("es", { timeZone: timezone });
  } catch {
    throw new Error(
      "Selecciona una zona horaria válida, por ejemplo America/Santiago.",
    );
  }
  const expression = cron.trim();
  if (!expression) return [];
  if (expression.length > 120 || expression.split(/\s+/).length !== 5)
    throw new Error(
      "Usa un cron de cinco campos: minuto, hora, día, mes y día de semana.",
    );
  try {
    // No callback: this instance only calculates dates, it never starts a timer.
    const dates = new Cron(expression, {
      timezone,
      paused: true,
      legacyMode: true,
    }).nextRuns(count, now);
    if (!dates.length) throw new Error("no-next-date");
    return dates;
  } catch {
    throw new Error(
      "La expresión cron no es válida o no tiene próximas ejecuciones.",
    );
  }
}

export function describeSchedule(
  cron: string | null | undefined,
  timezone = DEFAULT_SCHEDULE_TIMEZONE,
): string {
  const draft = scheduleFromCron(cron, timezone);
  switch (draft.mode) {
    case "manual":
      return "Ejecución manual";
    case "minutes":
      return `Cada ${draft.interval} ${draft.interval === 1 ? "minuto" : "minutos"}`;
    case "hours":
      return `Cada ${draft.interval} ${draft.interval === 1 ? "hora" : "horas"}, al minuto 00`;
    case "daily":
      return `Todos los días a las ${draft.time}`;
    case "weekdays":
      return `De lunes a viernes a las ${draft.time}`;
    case "weekly":
      return `${weekDays
        .filter((day) => draft.days.includes(day.value))
        .map((day) => day.label)
        .join(", ")} a las ${draft.time}`;
    case "monthly":
      return `El día ${draft.monthDay} de cada mes a las ${draft.time}`;
    default:
      return `Cron: ${draft.cron}`;
  }
}
