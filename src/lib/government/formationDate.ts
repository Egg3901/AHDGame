import { turnToLarpDate } from "@/lib/utils/formatters";
import { calendarTurn, type CalendarClock } from "@/lib/utils/gameDate";

export interface FormationDateClock extends CalendarClock {
  startingYear: number;
}

/** Render a stored raw formation turn on the active world's display calendar. */
export function formationTurnToLarpDate(formedTurn: number, clock: FormationDateClock): string {
  return turnToLarpDate(calendarTurn(formedTurn, clock), clock.startingYear);
}
