import { rawTurnToLarpDate } from "@/lib/utils/formatters";
import { type CalendarClock } from "@/lib/utils/gameDate";

export interface FormationDateClock extends CalendarClock {
  startingYear: number;
}

/** Render a stored raw formation turn on the active world's display calendar. */
export function formationTurnToLarpDate(formedTurn: number, clock: FormationDateClock): string {
  return rawTurnToLarpDate(formedTurn, clock.startingYear, clock);
}
