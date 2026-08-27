import type { BattleReportDoc } from "@/lib/db/types/battleReport";
import { contingentsOf } from "@/lib/military/battle";
import type { BattleReportView } from "./useCombatState";

/**
 * One battle report, told from one nation's side of it.
 *
 * Extracted from the war room's server component purely so this rule is testable —
 * the perspective it picks is the whole content of the row, and it was wrong for
 * every coalition ally.
 *
 * The viewer's side used to be `declarerCountry === country`, which is only ever true
 * for the principal. An ally that joined a merged offensive therefore fell through to
 * the DEFENDING branch of every ternary: it was shown losing a battle its side won,
 * against its own coalition leader, with the enemy's casualties printed as its own.
 * Side membership comes off the report's rosters instead.
 */
export function toBattleReportView(
  report: BattleReportDoc,
  country: string,
  theaterName: string,
  groundPct: number | null
): BattleReportView {
  // Pre-coalition reports carry no rosters and name exactly one country per side.
  const attackers: string[] = report.attackers ?? [report.declarerCountry];
  const isAttacker = attackers.includes(country);

  if (!report.result) {
    return {
      id: String(report._id),
      theaterId: report.theaterId,
      theaterName,
      turn: report.turn,
      noContact: true,
      role: isAttacker ? "offensive" : "defensive",
      win: false,
      ownLoss: 0,
      enemyLoss: 0,
      enemyCountry: isAttacker ? report.targetCountry : report.declarerCountry,
      // No contact still moves the front when the defender left the front empty.
      verdict: report.unopposedAdvance
        ? isAttacker
          ? "Unopposed advance"
          : "Ground lost — no contact"
        : "No contact",
      retreat: null,
      groundPct,
    };
  }

  const own = isAttacker ? report.result.attacker : report.result.defender;
  const enemy = isAttacker ? report.result.defender : report.result.attacker;
  // This nation's own dead, never the coalition's. `own.loss` is the whole side's,
  // so quoting it told each ally it had taken every casualty its side did.
  const ownLoss = contingentsOf(own).find((c) => c.country === country)?.loss ?? own.loss;

  return {
    id: String(report._id),
    theaterId: report.theaterId,
    theaterName,
    turn: report.turn,
    noContact: false,
    role: isAttacker ? "offensive" : "defensive",
    win: isAttacker ? report.result.win : !report.result.win,
    ownLoss,
    // The enemy side as a whole — the viewer faced all of it.
    enemyLoss: enemy.loss,
    enemyCountry: enemy.country,
    verdict: report.result.verdict,
    // Viewer-relative: a break by the attacking side is "own" only when this viewer
    // was attacking.
    retreat: report.result.retreat
      ? (report.result.retreat.side === "attacker") === isAttacker
        ? ("own" as const)
        : ("enemy" as const)
      : null,
    groundPct,
  };
}
