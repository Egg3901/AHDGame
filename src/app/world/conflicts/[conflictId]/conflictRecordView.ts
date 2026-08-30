import { canLandMarines } from "@/lib/navair/frontSupport";
import type { FrontSupport } from "@/lib/navair/types";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { BattleReportDoc } from "@/lib/db/types/battleReport";
import type { BattleDeclarationStatus } from "@/lib/db/types/battleDeclaration";
import type { ConflictTier } from "@/lib/military/conflictVisibility";
import { contingentsOf } from "@/lib/military/battle";
import { strengthPct } from "@/lib/military/strength";
import { engageablePool } from "@/lib/military/theaterPool";
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

/** One belligerent's own dead in a single engagement. */
export interface CountryLoss {
  country: string;
  loss: number;
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
  /**
   * Dead per attacking nation, principal first — NOT a side total under the
   * principal's flag, which is what this used to be. A DD+RU offensive reported
   * "DD 16,299" when DD had lost 5,360 and RU 10,939.
   *
   * One entry per side on a pre-coalition report, carrying that side's whole loss:
   * accurate, because those reports describe bilateral battles.
   */
  attackerLosses: CountryLoss[];
  /** Dead per defending nation, principal first. */
  defenderLosses: CountryLoss[];
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
  /** Omitted for `public`; own side only for `command`; both for `archive`.
   *  One entry PER NATION, so a coalition ally gets its own. */
  rosters?: EngagementRoster[];
  /**
   * True when rosters are present but the opposing side's were filtered out.
   *
   * The renderer used to infer this from a roster count of 1, which a two-nation
   * coalition breaks — it would list both allies and imply nothing was hidden.
   */
  rostersWithheld?: boolean;
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
  /** `command` only — what the naval and air layer is delivering to this front. */
  navalAir?: NavalAirPanel;
  battles: RecordBattleRow[];
}

/**
 * The naval and air picture at a front, as the record states it.
 *
 * The viewer's own figures are exact, because a government knows its own dispositions.
 * The enemy's is a BAND and never a number, matching how this page already treats force
 * composition: a commander learns they have lost the sky, not by how much.
 */
export interface NavalAirPanel {
  /** 0..100, this side's hold on the sky over the front. */
  airSuperiority: number;
  /** 0..100, this side's hold on the adjacent water. */
  seaControl: number;
  /** Ground weight close air support delivered this turn. */
  casWeight: number;
  /** 0..1 of the enemy's supply this side is cutting. */
  interdiction: number;
  /** Coarse read of who holds the air, never a number. */
  airBand: string;
  /** Whether marines could be put ashore here right now. */
  canLandMarines: boolean;
  /** Recent surface actions in this theatre, newest first. */
  recentActions: NavalActionRow[];
}

/** One surface action, as the record states it. */
export interface NavalActionRow {
  turn: number;
  regionName: string;
  winner: string;
  marginPct: number;
  sunk: string[];
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
  /**
   * Whether the fighting is over (`isConflictConcluded`). A concluded war has stood
   * every roster down, so there is no live order of battle to show a command-tier
   * viewer and no enemy front to read a band off; the history is in the reports.
   */
  concluded?: boolean;
  /**
   * Whether the front reaches the sea. Feeds the enemy band through
   * `engageablePool`, so this page's coarse read of the enemy and the war room's odds
   * agree about a fleet that cannot reach the fighting.
   */
  seaAccess?: boolean;
  /** This side's support profile, from the naval and air layer. */
  navairSupport?: FrontSupport;
  /** The opposing side's, used ONLY to derive a band. Never surfaced as a number. */
  navairEnemySupport?: FrontSupport;
  /** Recent surface actions across every region this war is fought in. */
  navairActions?: NavalActionRow[];
  reports: BattleReportDoc[];
}

/**
 * Who holds the air, as a phrase.
 *
 * Bands rather than a difference, because "you are 34 points down on air superiority" is
 * a number a player cannot act on, while "the enemy holds the air" is a decision.
 */
export function airSuperiorityBand(own: number, enemy: number): string {
  const gap = own - enemy;
  if (own <= 0 && enemy <= 0) return "Air uncontested";
  if (gap >= 40) return "You hold the air";
  if (gap >= 12) return "Air advantage";
  if (gap > -12) return "Air contested";
  if (gap > -40) return "Enemy air advantage";
  return "Enemy holds the air";
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

/** A contingent's public half: who, and how many of theirs died. Strength is not
 *  public, so it is dropped here rather than filtered downstream. */
function toCountryLoss(c: { country: string; loss: number }): CountryLoss {
  return { country: c.country, loss: c.loss };
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
  const {
    tier,
    ownSide,
    theaterId,
    sideACountries,
    sideBCountries,
    units,
    concluded = false,
    reports,
    seaAccess,
    navairSupport,
    navairEnemySupport,
    navairActions,
  } = input;

  const ownCountries = ownSide === "A" ? sideACountries : ownSide === "B" ? sideBCountries : [];
  const enemyCountries = ownSide === "A" ? sideBCountries : ownSide === "B" ? sideACountries : [];

  const atFront = units.filter((u) => u.theaterId === theaterId);

  // A concluded war has already returned its units to reserve, so `command`'s live
  // order of battle is meaningless there — the record reads the reports instead.
  // Gated on the war, not the tier: a belligerent seat keeps command sight of a
  // resolved war while its fog window runs, and would otherwise be shown an empty
  // order of battle beside a band read off an empty enemy front.
  const showsLiveForces = tier === "command" && ownSide !== null && !concluded;
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
        attackerLosses: res ? contingentsOf(res.attacker).map(toCountryLoss) : [],
        defenderLosses: res ? contingentsOf(res.defender).map(toCountryLoss) : [],
        groundPct: groundOf(r),
      };
      if (!res) {
        row.unopposed = true;
        return row;
      }
      if (tier === "public") return row;

      // One roster PER NATION. Building one per SIDE labelled the whole coalition
      // with its principal, so `command` tier handed an allied non-principal nothing
      // (its own country never matched the side's scalar) and the archive credited
      // an ally's formations to the coalition leader.
      const sides: EngagementRoster[] = [res.attacker, res.defender].flatMap((s) =>
        contingentsOf(s).map((c) => ({
          country: c.country,
          power: c.power,
          // A pre-coalition report has no per-unit country, so every unit belongs to
          // the one country the side names — which is exactly right for those reports.
          units: s.unitResults
            .filter((u) => (u.country ?? s.country) === c.country)
            .map((u) => ({
              id: u.id,
              name: u.name,
              type: u.type,
              casualties: u.casualties,
            })),
        }))
      );

      row.rosters =
        tier === "archive" ? sides : sides.filter((s) => ownCountries.includes(s.country));
      row.rostersWithheld = row.rosters.length < sides.length;
      return row;
    });

  const extras: RecordExtras = { battles };
  if (showsLiveForces) {
    extras.ownForces = ownAtFront.map(toForceRow);
    extras.enemyBand = enemyBand(
      engageablePool(ownAtFront, seaAccess),
      engageablePool(enemyAtFront, seaAccess),
      { unopposed: enemyAtFront.length === 0 }
    );

    // Same visibility rule as the force panel above: the viewer's own dispositions are
    // exact, the enemy's are a band. Absent support means the naval and air layer has
    // nothing to say about this front, which is different from holding nothing, so the
    // panel is omitted rather than shown as zeros.
    if (navairSupport) {
      extras.navalAir = {
        airSuperiority: navairSupport.airSuperiority,
        seaControl: navairSupport.seaControl,
        casWeight: navairSupport.casWeight,
        interdiction: navairSupport.interdiction,
        airBand: airSuperiorityBand(
          navairSupport.airSuperiority,
          navairEnemySupport?.airSuperiority ?? 0
        ),
        canLandMarines: canLandMarines(navairSupport.seaControl),
        recentActions: navairActions ?? [],
      };
    }
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
