/**
 * Per-turn aggregator for popularLegitimacy drift.
 *
 * `computePopularTurnDrift` is a pure function: it sums the individual
 * driver contributions and returns both the total and a per-component
 * breakdown. The breakdown surfaces in the UI's Regime Health tab
 * (Phase 7) so the player can diagnose what's hurting them.
 *
 * The persistence side — actually applying the drift to a leader-state
 * doc — lives in {@link processPopularLegitimacyTurn}, which is called
 * once per turn from `onePartyBillLifecycle.ts`.
 */
import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { PopularMoodAxisProfile } from "@/lib/constants/popularMoodProfiles";
import { adjustPopularLegitimacy, INITIAL_POPULAR_LEGITIMACY } from "./popularLegitimacy";
import { getCountryLeaderStatesCollection } from "@/lib/db/collections/countryLeaderState";
import { getCountryState, updateCountryState } from "@/lib/countryState";
import type { PopularBoostModifier } from "@/lib/db/types/countryState";
import {
  economicHealthDrift,
  repressionIntensityDrift,
  internalRepressionDrift,
  policyPopularityDrift,
  electionCredibilityShock,
  intraPartyCouplingBleed,
  naturalRecoveryDrift,
  type EconomicSignals,
  type PurgeEventInput,
  type EnactedBillInput,
  type ElectionCredibilitySignals,
  type InternalRepressionSignals,
} from "./popularLegitimacyDrivers";

// ── Pure aggregator ────────────────────────────────────────────────────────

export interface PopularTurnInputs {
  currentLegitimacy: number;
  partyConfidence: number;
  economic: EconomicSignals;
  purges: PurgeEventInput[];
  enactedBills: EnactedBillInput[];
  election: ElectionCredibilitySignals;
  /** Command-economy internal-repression signals. Omit / undefined for market
   *  countries (contributes zero). */
  internalRepression?: InternalRepressionSignals;
  moodProfile: PopularMoodAxisProfile;
  /** Phase-5 reform-action boost modifiers. Currently-active entries are summed. */
  boosts: PopularBoostModifier[];
  /** Used to filter expired boost modifiers (untilTurn >= currentTurn). */
  currentTurn: number;
}

export interface PopularTurnDrift {
  components: {
    economic: number;
    repression: number;
    /** Command-economy internal-repression legitimacy cost (repression × shortage). */
    internalRepression: number;
    policy: number;
    election: number;
    coupling: number;
    naturalRecovery: number;
    /** Sum of `boosts[].perTurnDelta` whose `untilTurn >= currentTurn`. */
    boosts: number;
  };
  total: number;
}

/**
 * Sum every per-turn contribution to popular-legitimacy drift. Returns
 * the total plus a breakdown for UI consumption (Phase 7's Regime
 * Health tab) and for audit logs (which reason-string the drivers
 * contributed each turn).
 *
 * Pure — no DB access, no side effects.
 */
export function computePopularTurnDrift(inputs: PopularTurnInputs): PopularTurnDrift {
  const boostsSum = inputs.boosts
    .filter((b) => b.untilTurn >= inputs.currentTurn)
    .reduce((acc, b) => acc + b.perTurnDelta, 0);

  const components = {
    economic: economicHealthDrift(inputs.economic),
    repression: repressionIntensityDrift(inputs.purges),
    internalRepression: internalRepressionDrift(inputs.internalRepression),
    policy: policyPopularityDrift(inputs.enactedBills, inputs.moodProfile),
    election: electionCredibilityShock(inputs.election),
    coupling: intraPartyCouplingBleed(inputs.partyConfidence),
    naturalRecovery: naturalRecoveryDrift(inputs.currentLegitimacy),
    boosts: boostsSum,
  };

  const total =
    components.economic +
    components.repression +
    components.internalRepression +
    components.policy +
    components.election +
    components.coupling +
    components.naturalRecovery +
    components.boosts;

  return { components, total };
}

// ── Per-turn persistence ────────────────────────────────────────────────────

export interface PopularTurnContext {
  db: Db;
  countryId: CountryId;
  leaderCharacterId: ObjectId;
  currentTurn: number;
  economic: EconomicSignals;
  purges: PurgeEventInput[];
  enactedBills: EnactedBillInput[];
  election: ElectionCredibilitySignals;
  /** Command-economy internal-repression signals; omit for market countries
   *  (defaults to no repression / no shortage → zero contribution). */
  internalRepression?: InternalRepressionSignals;
}

/**
 * Compute and apply this turn's popularLegitimacy drift for a one-party
 * country. Returns the drift breakdown for UI / audit consumption, or
 * `null` if the country's leader state is missing or
 * `popularMoodProfile` is not configured.
 *
 * Reads the leader's current `popularLegitimacy` (defaulting to
 * {@link INITIAL_POPULAR_LEGITIMACY} for docs created before Phase 2)
 * and current `partyConfidence`, then delegates to
 * {@link computePopularTurnDrift} for the math and
 * {@link adjustPopularLegitimacy} for the write.
 */
export async function processPopularLegitimacyTurn(
  ctx: PopularTurnContext
): Promise<PopularTurnDrift | null> {
  const cfg = COUNTRY_CONFIGS[ctx.countryId];
  const moodProfile = cfg?.popularMoodProfile;
  if (!moodProfile) return null;

  const leaderColl = getCountryLeaderStatesCollection(ctx.db);
  const leaderState = await leaderColl.findOne({
    countryId: ctx.countryId,
    leaderCharacterId: ctx.leaderCharacterId,
  });
  if (!leaderState) return null;

  // Read Phase-5 boost modifiers from countryState. Wrapped in try/catch
  // so MockDb-shaped tests that don't stub countryState still get
  // []-default behavior rather than throwing.
  let boosts: PopularBoostModifier[] = [];
  try {
    const countryState = await getCountryState(ctx.db, ctx.countryId);
    boosts = countryState.popularBoostModifiers ?? [];
  } catch {
    boosts = [];
  }

  const drift = computePopularTurnDrift({
    currentLegitimacy: leaderState.popularLegitimacy ?? INITIAL_POPULAR_LEGITIMACY,
    partyConfidence: leaderState.partyConfidence,
    economic: ctx.economic,
    purges: ctx.purges,
    enactedBills: ctx.enactedBills,
    election: ctx.election,
    internalRepression: ctx.internalRepression ?? { internalRepression: 0, shortageIndex: 0 },
    moodProfile,
    boosts,
    currentTurn: ctx.currentTurn,
  });

  if (drift.total !== 0) {
    await adjustPopularLegitimacy(
      ctx.db,
      ctx.countryId,
      ctx.leaderCharacterId,
      drift.total,
      summarizeReason(drift),
      ctx.currentTurn
    );
  }

  // Evict expired boost modifiers so the array doesn't grow unbounded.
  // Only writes when something actually changed.
  if (boosts.length > 0) {
    const remaining = boosts.filter((b) => b.untilTurn >= ctx.currentTurn);
    if (remaining.length !== boosts.length) {
      await updateCountryState(ctx.db, ctx.countryId, { popularBoostModifiers: remaining });
    }
  }

  return drift;
}

function summarizeReason(drift: PopularTurnDrift): string {
  const parts: string[] = [];
  if (drift.components.economic !== 0) parts.push(`econ ${fmt(drift.components.economic)}`);
  if (drift.components.repression !== 0)
    parts.push(`repression ${fmt(drift.components.repression)}`);
  if (drift.components.internalRepression !== 0)
    parts.push(`internal repression ${fmt(drift.components.internalRepression)}`);
  if (drift.components.policy !== 0) parts.push(`policy ${fmt(drift.components.policy)}`);
  if (drift.components.election !== 0) parts.push(`election ${fmt(drift.components.election)}`);
  if (drift.components.coupling !== 0) parts.push(`coupling ${fmt(drift.components.coupling)}`);
  if (drift.components.naturalRecovery !== 0)
    parts.push(`recovery ${fmt(drift.components.naturalRecovery)}`);
  if (drift.components.boosts !== 0) parts.push(`boosts ${fmt(drift.components.boosts)}`);
  return parts.length ? `Turn drift: ${parts.join(", ")}` : "Turn drift: no change";
}

function fmt(n: number): string {
  return n >= 0 ? `+${n.toFixed(2)}` : n.toFixed(2);
}
