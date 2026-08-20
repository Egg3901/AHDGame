import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { BattleReportDoc } from "@/lib/db/types/battleReport";
import type { BattleDeclarationStatus } from "@/lib/db/types/battleDeclaration";
import type { ConflictTier } from "@/lib/military/conflictVisibility";
import { strengthPct } from "@/lib/military/strength";
import { theaterPool } from "@/lib/military/theaterPool";
import { enemyBand } from "@/lib/military/forecastFog";
import { READINESS_DRIFT_STEP, readinessBaselineOf } from "@/lib/military/readinessDrift";

/**
 * The tier-scoped half of a conflict record.
 *
 * THE FOG RULE: this runs on the server and whatever it returns ends up in the HTML
 * payload, so a field a tier may not see is OMITTED here — never rendered
 * conditionally on the client. `battleReports` carry the enemy's roster and both
 * sides' strengths; only `archive` may pass them through.
 *
 * Spec: docs/superpowers/specs/2026-07-26-conflict-viewer-tiers-design.md
 */

/** One formation in a live order of battle. */
export interface ForceRow {
  id: string;
  name: string;
  type: string;
  domain: string;
  posture: string;
  readiness: number;
  /** Null when the archetype is unknown — show headcount, not a fake ratio. */
  strengthPct: number | null;
}

/** One side's participation in a single engagement, from the battle report. */
export interface EngagementRoster {
  country: string;
  power: number;
  units: { id: string; name: string; type: string; casualties: number }[];
}

export interface RecordBattleRow {
  id: string;
  turn: number;
  verdict: string;
  declarer: string;
  target: string;
  /** Every belligerent on each side. Falls back to the principal on pre-coalition
   *  reports, which named only one country per side. */
  attackers: string[];
  defenders: string[];
  declarerLoss: number;
  targetLoss: number;
  /**
   * True when the offensive met nothing — the front still moved, but no
   * engagement was fought. The war log tells the two apart; both are events.
   */
  unopposed?: boolean;
  /**
   * Points of the host this engagement moved, from SIDE A's perspective
   * (positive = side A gained). Null on reports written before the front's
   * position was recorded — unknown, which must not read as a stalemate.
   */
  groundPct?: number | null;
  /** Omitted for `public`; own side only for `command`; both for `archive`. */
  rosters?: EngagementRoster[];
}

export interface RecordExtras {
  /**
   * The viewer nation's unfunded upkeep share (0..1). Every readiness-recovery figure in
   * the record is quoted against the baseline this suppresses, so the record cannot
   * promise a recovery the turn processor will not deliver.
   */
  arrearsRatio?: number;
  /**
   * The viewer nation's department-wide readiness setting (reduced / standard / elevated).
   * It scales the same baseline, so the record must quote against it too.
   */
  readinessTier?: string | null;
  /** `command` only — the viewer's live forces at this front. */
  ownForces?: ForceRow[];
  /** `command` only — a coarse read of the opposing force, never a number. */
  enemyBand?: string;
  battles: RecordBattleRow[];
}

export interface RecordExtrasInput {
  tier: ConflictTier;
  /** The viewer's side by explicit roster membership; null when not a belligerent. */
  ownSide: "A" | "B" | null;
  theaterId: string;
  sideACountries: string[];
  sideBCountries: string[];
  /** Every unit of both sides' countries (the caller scopes the query). */
  units: MilitaryUnit[];
  reports: BattleReportDoc[];
}

/** One side's live force at a front, as the FORCE panel states it. */
export interface SideForce {
  /** Formation count. Null when the viewer may not see composition. */
  divisions: number | null;
  /**
   * Men at this front. Null when withheld.
   *
   * Deliberately personnel rather than `theaterPool`'s effective combat power:
   * the panel states it beside a division count and a casualty count, and a
   * unitless power score in that column reads as a fourth kind of number nobody
   * asked for. The power figure still drives `enemyBand` — server-side, where it
   * belongs.
   */
  personnel: number | null;
  /** Mean readiness across the side's formations, 0–100. Null when withheld. */
  readiness: number | null;
  /**
   * Readiness recovered per turn at rest, and the turns to full — the one number
   * that tells a commander whether to attack now or wait. Null when withheld, or
   * when the force is already at its posture's baseline.
   */
  recovery: { perTurn: number; turnsToFull: number } | null;
  /** Cumulative dead at this front. PUBLIC on both sides — it is in the record. */
  casualties: number;
}

/**
 * How many formations are genuinely still recovering readiness.
 *
 * Takes `arrearsRatio` because a nation that cannot fund its upkeep settles toward a
 * SUPPRESSED baseline: counting against the nominal one would report formations as
 * "recovering" that have already reached their real floor and will never climb further.
 *
 * Extracted from the conflict page's render body purely so this rule is testable — a
 * server component cannot be unit-tested in place.
 */
export function recoveringCount(
  units: Pick<MilitaryUnit, "readiness" | "posture">[],
  arrearsRatio = 0,
  readinessTier?: string | null
): number {
  return units.filter(
    (u) => u.readiness < readinessBaselineOf(u.posture, arrearsRatio, readinessTier)
  ).length;
}

/** A force's mean readiness and how fast it recovers, or null for an empty force. */
export function forceReadiness(
  units: Pick<MilitaryUnit, "readiness" | "posture">[],
  /**
   * The owning country's unfunded upkeep share. A force its nation cannot pay for settles
   * toward a suppressed baseline, so the projection must be quoted against the SAME target
   * the turn processor drifts to — otherwise this promises a recovery that never arrives.
   */
  arrearsRatio = 0,
  /** The owning country's department-wide readiness tier, which scales the same baseline. */
  readinessTier?: string | null
): { readiness: number; recovery: { perTurn: number; turnsToFull: number } | null } | null {
  if (units.length === 0) return null;
  const readiness = Math.round(units.reduce((s, u) => s + u.readiness, 0) / units.length);
  const target = Math.round(
    units.reduce((s, u) => s + readinessBaselineOf(u.posture, arrearsRatio, readinessTier), 0) /
      units.length
  );
  // Already at (or above) baseline: nothing to recover, and promising a gain that
  // will not arrive is worse than saying nothing.
  if (readiness >= target) return { readiness, recovery: null };
  return {
    readiness,
    recovery: {
      perTurn: READINESS_DRIFT_STEP,
      turnsToFull: Math.ceil((target - readiness) / READINESS_DRIFT_STEP),
    },
  };
}

/**
 * Cumulative dead per side, folded from `theaterRecord`'s per-country totals.
 *
 * Both sides' totals are PUBLIC in every tier — they are in the record, and the
 * design states so beside the withheld composition. The unit-by-unit breakdown
 * behind them is what the fog withholds, and that lives on `rosters`.
 *
 * A country in neither roster (a since-departed belligerent whose reports remain
 * on file) is counted on neither side rather than silently folded into one.
 */
export function casualtiesBySide(
  byCountry: Record<string, number>,
  sideACountries: string[],
  sideBCountries: string[]
): { A: number; B: number } {
  const out = { A: 0, B: 0 };
  for (const [country, loss] of Object.entries(byCountry)) {
    if (sideACountries.includes(country)) out.A += loss;
    else if (sideBCountries.includes(country)) out.B += loss;
  }
  return out;
}

function toForceRow(u: MilitaryUnit): ForceRow {
  return {
    id: String(u._id),
    name: u.name,
    type: u.type,
    domain: u.domain,
    posture: u.posture,
    readiness: u.readiness,
    strengthPct: strengthPct({ domain: u.domain, type: u.type, personnel: u.personnel }),
  };
}

export function buildRecordExtras(input: RecordExtrasInput): RecordExtras {
  const { tier, ownSide, theaterId, sideACountries, sideBCountries, units, reports } = input;

  const ownCountries = ownSide === "A" ? sideACountries : ownSide === "B" ? sideBCountries : [];
  const enemyCountries = ownSide === "A" ? sideBCountries : ownSide === "B" ? sideACountries : [];

  const atFront = units.filter((u) => u.theaterId === theaterId);

  // A resolved war has already returned its units to reserve, so `command`'s live
  // order of battle is meaningless there — archive reads the reports instead.
  const showsLiveForces = tier === "command" && ownSide !== null;
  const ownAtFront = atFront.filter((u) => ownCountries.includes(u.countryId));
  const enemyAtFront = atFront.filter((u) => enemyCountries.includes(u.countryId));

  /** Points of the host this report moved, from side A's side. */
  const groundOf = (r: BattleReportDoc): number | null => {
    if (r.controlBefore == null || r.controlAfter == null) return null;
    // `control` is side B's share, so side A gains when it FALLS.
    return Math.round((r.controlBefore - r.controlAfter) * 10) / 10;
  };

  // Unopposed advances are events too. The list used to drop every report with no
  // `result`, so a war won entirely by walkover showed a front that claimed never
  // to have been contested next to a history that recorded nothing at all.
  const battles: RecordBattleRow[] = reports
    .filter((r) => r.result || r.unopposedAdvance)
    .map((r) => {
      const res = r.result;
      const row: RecordBattleRow = {
        id: String(r._id),
        turn: r.turn,
        verdict: res ? res.verdict : "Unopposed advance",
        declarer: r.declarerCountry,
        target: r.targetCountry,
        attackers: r.attackers ?? [r.declarerCountry],
        defenders: r.defenders ?? [r.targetCountry],
        declarerLoss: res?.attacker.loss ?? 0,
        targetLoss: res?.defender.loss ?? 0,
        groundPct: groundOf(r),
      };
      if (!res) {
        row.unopposed = true;
        return row;
      }
      if (tier === "public") return row;

      const sides: EngagementRoster[] = [res.attacker, res.defender].map((s) => ({
        country: s.country,
        power: s.power,
        units: s.unitResults.map((u) => ({
          id: u.id,
          name: u.name,
          type: u.type,
          casualties: u.casualties,
        })),
      }));

      row.rosters =
        tier === "archive" ? sides : sides.filter((s) => ownCountries.includes(s.country));
      return row;
    });

  const extras: RecordExtras = { battles };
  if (showsLiveForces) {
    extras.ownForces = ownAtFront.map(toForceRow);
    extras.enemyBand = enemyBand(theaterPool(ownAtFront), theaterPool(enemyAtFront), {
      unopposed: enemyAtFront.length === 0,
    });
  }
  return extras;
}

/** What a resolved offensive achieved, ready to render beside it. */
export interface DeclarationOutcome {
  /** Phrased from the DECLARER's side, because the list names declarer → target. */
  label: string;
  /** True when the declarer prevailed, false when repulsed, null when unknowable. */
  declarerWon: boolean | null;
}

/**
 * Read a finished offensive's outcome off its battle report.
 *
 * The offensive list said only "resolved T448", which records that the turn processor
 * got to it and nothing about what happened — a player who had just run three
 * successful offensives could not tell from this panel that any of them had won.
 *
 * The walkover is the case that matters most. `result` is null when the target had no
 * forces at the front, and `buildRecordExtras` drops those reports from the engagement
 * list entirely — so an unopposed advance produced a front that claimed never to have
 * been contested next to a history that said only "resolved". Taking ground unopposed
 * is a real outcome, and this says so.
 */
export function declarationOutcome(
  report: Pick<BattleReportDoc, "result" | "noContact" | "unopposedAdvance"> | null,
  status: BattleDeclarationStatus
): DeclarationOutcome {
  // Takes the full status union rather than the resolved/fizzled pair the history
  // query happens to return, so a caller that widens its query gets a sensible answer
  // instead of a cast that quietly mislabels a pending offensive as resolved.
  if (status === "pending") return { label: "pending", declarerWon: null };
  // Fizzled never became an engagement — withdrawn, or no forces to send. Nothing was
  // won and there is no report to read.
  if (status === "fizzled") return { label: "fizzled", declarerWon: null };
  // No matching report: older than the window read here, or filed by an ally who was
  // not the principal of a merged offensive. Say only what is known.
  if (!report) return { label: "resolved", declarerWon: null };
  if (report.result) return { label: report.result.verdict, declarerWon: report.result.win };
  if (report.noContact) {
    return report.unopposedAdvance
      ? { label: "unopposed advance", declarerWon: true }
      : { label: "no contact", declarerWon: null };
  }
  return { label: "resolved", declarerWon: null };
}
