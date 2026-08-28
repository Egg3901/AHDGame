import * as R from "./config";
import { cv, clamp, sum, alive } from "./engineCore";
import type { NavairUnit, EngagementOutcome } from "./types";
import type { CountryId } from "@/lib/constants/countries";
import type { RegionCode } from "@/lib/military/types";

/**
 * Surface actions.
 *
 * Fires wherever two hostile fleets share water and at least one of them is there to
 * fight. A blockade force and a sea denial force in the same sea will engage each other
 * whether or not either wanted to, which is what makes stationing a decision rather than
 * a preference.
 *
 * Losses here are real and they persist, but a formation is never deleted. That is the
 * game's existing convention and it is deliberate: `persistSide` states that a unit keeps
 * its general and its front no matter how badly it is mauled, and a hollowed out
 * formation is simply weak, rebuilding in place through the reinforcement flow. Deleting
 * a sunk squadron would dangle its assigned general and silently rearrange a chain of
 * command that battle is not allowed to touch.
 *
 * So a fleet that loses badly comes home with its hulls wrecked and its crews gone, and
 * getting it back to strength costs personnel and materiel through the same procurement
 * and reinforcement path everything else uses. That is what connects this subsystem to
 * the defence economy, and it does it without a destructive write.
 */

/** Postures that mean a formation is present to contest the water, not merely passing. */
const AGGRESSIVE: ReadonlySet<string> = new Set(["BLOCKADE", "SEA_CONTROL", "SEA_DENIAL"]);

export interface EngagementResult {
  outcome: EngagementOutcome;
  /**
   * Formations reduced to combat ineffectiveness. NOT deleted: they keep their general
   * and their theater and rebuild in place, per the game's existing loss convention.
   */
  crippled: NavairUnit[];
  /** Formations that took damage and are still able to fight. */
  damaged: NavairUnit[];
}

/**
 * Resolve one surface action between two hostile groups in one region.
 *
 * Deterministic: no RNG. A battle in this game is already noisy at the land layer, and a
 * naval engagement that also rolled dice would make the same fleet disposition produce
 * different wars on replay, which would make the static replay gate useless as evidence.
 * Strength decides it; the margin decides how badly.
 */
export function resolveEngagement(
  region: RegionCode,
  attackers: readonly NavairUnit[],
  defenders: readonly NavairUnit[]
): EngagementResult | null {
  const a = attackers.filter(alive);
  const b = defenders.filter(alive);
  if (!a.length || !b.length) return null;
  if (![...a, ...b].some((u) => AGGRESSIVE.has(u.mission ?? ""))) return null;

  const cvA = sum(a, (u) => cv(u, "combat"));
  const cvB = sum(b, (u) => cv(u, "combat"));
  const total = cvA + cvB || 1;

  // Share of a force the worst possible engagement takes, then the share of THAT a single
  // turn's action delivers. Applied raw, a parity engagement annihilated both fleets in
  // four turns, so contesting anything was never worth it. At this intensity a parity
  // fight costs about a tenth of a force per turn: a grind you can choose to fight or
  // choose to avoid, which is the decision stationing is supposed to pose.
  const intensity = R.CASUALTY_RATE_SCALE * R.NAVAL_ENGAGEMENT_INTENSITY;
  const lossA = intensity * (cvB / total);
  const lossB = intensity * (cvA / total);

  const crippled: NavairUnit[] = [];
  const damaged: NavairUnit[] = [];

  const apply = (units: readonly NavairUnit[], lossShare: number) => {
    for (const u of units) {
      u.integrity = clamp((u.integrity ?? 100) - lossShare * 100, 0, 100);
      u.readiness = clamp(u.readiness - R.COMBAT_READINESS_DROP, 0, 100);
      // Crews go down with the hulls. Combat power scales linearly with personnel in this
      // game, so this is what actually makes a mauled formation weak, and it is the same
      // quantity the reinforcement flow refills.
      u.personnel = Math.max(0, Math.round(u.personnel * (1 - lossShare)));
      u.engaged = true;
      if (u.integrity <= 0) crippled.push(u);
      else damaged.push(u);
    }
  };
  apply(a, lossA);
  apply(b, lossB);

  const aWon = cvA > cvB;
  const winners = aWon ? a : b;
  const losers = aWon ? b : a;

  return {
    outcome: {
      region,
      winner: uniqueCountries(winners),
      loser: uniqueCountries(losers),
      marginPct: Math.round((Math.abs(cvA - cvB) / total) * 100),
      sunk: crippled.map((u) => u.name),
    },
    crippled,
    damaged,
  };
}

function uniqueCountries(units: readonly NavairUnit[]): CountryId[] {
  return [...new Set(units.map((u) => u.countryId))];
}

/**
 * A human-readable line for the war wire.
 *
 * Names the region and the margin but never the force composition, because strength is
 * fogged in this game by design. A commander learns they were outweighed, not by how
 * much of what.
 */
export function engagementReport(outcome: EngagementOutcome, regionShort: string): string {
  const verdict =
    outcome.marginPct >= 45
      ? "held the water decisively"
      : outcome.marginPct >= 15
        ? "held the water"
        : "fought to a standstill";
  const sunk = outcome.sunk.length ? ` Lost: ${outcome.sunk.join(", ")}.` : "";
  return `Surface action in ${regionShort}. ${outcome.winner.join(", ")} ${verdict}.${sunk}`;
}

/**
 * Extra sea control a decisive action is worth beyond mere presence.
 *
 * Winning a fight should be worth more than sitting in empty water, but not so much that
 * one good turn hands over a region the loser has held for twenty. Capped well below the
 * full scale for that reason: the contest still has to be won by staying.
 */
export function engagementControlBonus(marginPct: number): number {
  return clamp(marginPct / 4, 0, 15);
}
