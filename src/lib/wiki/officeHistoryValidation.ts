import { z } from "zod";
import { badRequest } from "@/lib/api/errors";

/** "YYYY-MM-DD" date-only string (from an `<input type="date">`). */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

/** Parse a "YYYY-MM-DD" string to a Date at UTC noon (timezone-safe display). */
export function isoDateToUtcNoon(value?: string): Date | undefined {
  return value ? new Date(`${value}T12:00:00.000Z`) : undefined;
}

/**
 * Validate the tenure fields: in-game week/year must be both-or-neither, and at
 * least one start (week+year OR start date) is required. Throws `badRequest`.
 */
export function assertTenureFields(d: {
  startWeek?: number;
  startYear?: number;
  startDate?: string;
}): void {
  if ((d.startWeek != null) !== (d.startYear != null)) {
    throw badRequest("Provide both a start week and a start year, or neither.");
  }
  const hasWeekYear = d.startWeek != null && d.startYear != null;
  if (!hasWeekYear && !d.startDate) {
    throw badRequest("Provide a start week + year or a start date.");
  }
}
