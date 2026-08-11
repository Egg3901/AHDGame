/**
 * Pure SVG-geometry for the poll series on a FIXED 0–100 vertical scale (so a
 * small real swing reads small). Shared by the Briefing sparkline and the
 * detail tracking-poll chart. x is spread evenly across readings in turn order.
 */
import type { PollPoint } from "./pollSnapshot";

export function buildPollPath(history: PollPoint[], width: number, height: number): string {
  if (!history || history.length < 2) return "";
  const sorted = [...history].sort((a, b) => a.turn - b.turn);
  const stepX = width / (sorted.length - 1);
  return sorted
    .map((p, i) => {
      const x = Math.round(i * stepX * 100) / 100;
      const y = Math.round((1 - Math.max(0, Math.min(100, p.yesShare)) / 100) * height * 100) / 100;
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}
