import { calendarTurn, turnToGameMonth, type GameDateAnchor } from "@/lib/utils/gameDate";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function marketTurnLabel(
  rawTurn: number,
  calendar: GameDateAnchor | null,
  detail = false
): string {
  if (!calendar) return `T${rawTurn}`;
  const turn = calendarTurn(rawTurn, calendar);
  const { year, month } = turnToGameMonth(turn, calendar.startingYear);
  const founding = rawTurn <= (calendar.preIterationTurns ?? 0) || calendar.preIterationActive;
  return `${MONTHS[month]} ${year}${detail ? ` · ${founding ? "Founding · " : `Week ${((turn - 1) % 4) + 1} · `}T${rawTurn}` : ""}`;
}
