import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  DEFAULT_SCHEDULE_TIMEZONE,
  upcomingSchedule,
} from "~~/shared/schedule";

export const scheduleTimezoneSchema = z.string().trim().min(1).max(100);

export function scheduleSettings(
  cron: string | undefined,
  timezone = DEFAULT_SCHEDULE_TIMEZONE,
  now = new Date(),
) {
  const cron_expression = cron?.trim().replace(/\s+/g, " ") || null;
  let dates: Date[];
  try {
    dates = upcomingSchedule(cron_expression || "", timezone, now, 1);
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: (error as Error).message,
    });
  }
  return {
    cron_expression,
    schedule_timezone: timezone,
    next_scheduled_at: dates[0] || null,
    scheduling_error: null,
  };
}
