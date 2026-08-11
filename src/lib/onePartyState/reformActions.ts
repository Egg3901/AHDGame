/**
 * Phase-5 liberalization reform actions.
 *
 * Five actions the ruling-party leader can take any time the country
 * is still one-party. Each costs intra-party confidence, gains popular
 * legitimacy, and leaves a per-turn boost modifier (or, for the
 * cheaper actions, just the one-shot gain). A per-action cooldown
 * lives on countryState (see `reformCooldowns.ts`).
 *
 * Stage-1's "Acknowledge & promise reform" decision sets a one-turn
 * 50% discount on the next reform's intra-party cost; this layer reads
 * the flag, applies the discount, and clears it on use.
 */
import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { adjustLeaderConfidence } from "@/lib/turn/rulingPartyConfidence";
import { adjustPopularLegitimacy } from "@/lib/turn/popularLegitimacy";
import { recordPurgeEvent } from "./partyEffectAdapters";
import { isActionAvailable, setCooldown, type ReformActionId } from "./reformCooldowns";
import { getCountryState, updateCountryState } from "@/lib/countryState";
import {
  legalizeBannedParty,
  scheduleHonestByElection,
  setRulingPartyVoteMultiplierTier,
} from "./reformPrimitives";

export interface ReformActionContext {
  db: Db;
  countryId: CountryId;
  leaderCharacterId: ObjectId;
  currentTurn: number;
}

// Constitutional amendment locks renewal-bump at +2 from this point on.
const CONSTITUTIONAL_AMENDMENT_RENEWAL_BUMP = 2;

/**
 * Read the half-cost discount (set by Stage-1 Acknowledge) and, if
 * present + still valid for this turn, halve the supplied base cost
 * and clear the flag. Base costs are negative (they hit intra-party
 * confidence), so `Math.round(base * 0.5)` preserves the sign.
 */
async function consumeDiscount(ctx: ReformActionContext, baseIntraCost: number): Promise<number> {
  const state = await getCountryState(ctx.db, ctx.countryId);
  const discount = state.pendingReformDiscount;
  if (discount && discount.turn === ctx.currentTurn) {
    await updateCountryState(ctx.db, ctx.countryId, { pendingReformDiscount: undefined });
    return Math.round(baseIntraCost * discount.multiplier);
  }
  return baseIntraCost;
}

/**
 * Append a per-turn popular-boost modifier with a hard expiry turn.
 * The per-turn popular driver sums these (Phase-5 follow-up) and
 * evicts the expired ones.
 */
async function appendBoost(
  ctx: ReformActionContext,
  source: ReformActionId,
  perTurnDelta: number,
  durationTurns: number
): Promise<void> {
  const state = await getCountryState(ctx.db, ctx.countryId);
  const boosts = [...(state.popularBoostModifiers ?? [])];
  boosts.push({
    source,
    perTurnDelta,
    untilTurn: ctx.currentTurn + durationTurns,
  });
  await updateCountryState(ctx.db, ctx.countryId, { popularBoostModifiers: boosts });
}

// ── Legalize a banned party ─────────────────────────────────────────────────

export async function legalizePartyAction(
  ctx: ReformActionContext,
  partyId: number
): Promise<void> {
  if (
    !(await isActionAvailable(ctx.db, ctx.countryId, "legalizeParty", ctx.currentTurn, {
      partyId,
    }))
  ) {
    throw new Error(`legalizePartyAction: party ${partyId} on cooldown`);
  }

  const intraCost = await consumeDiscount(ctx, -6);
  await adjustLeaderConfidence(
    ctx.db,
    ctx.countryId,
    ctx.leaderCharacterId,
    intraCost,
    "Reform: Legalize banned party",
    ctx.currentTurn
  );
  await adjustPopularLegitimacy(
    ctx.db,
    ctx.countryId,
    ctx.leaderCharacterId,
    +8,
    "Reform: Legalize banned party",
    ctx.currentTurn
  );
  await legalizeBannedParty(ctx.db, ctx.countryId, partyId);
  await appendBoost(ctx, "legalizeParty", 0.2, 120);
  await setCooldown(ctx.db, ctx.countryId, "legalizeParty", ctx.currentTurn, 168, { partyId });
}

// ── Reduce vote multipliers ─────────────────────────────────────────────────

export async function reduceVoteMultipliersAction(ctx: ReformActionContext): Promise<void> {
  if (!(await isActionAvailable(ctx.db, ctx.countryId, "reduceVoteMultipliers", ctx.currentTurn))) {
    throw new Error("reduceVoteMultipliersAction: on cooldown");
  }
  const intraCost = await consumeDiscount(ctx, -4);
  await adjustLeaderConfidence(
    ctx.db,
    ctx.countryId,
    ctx.leaderCharacterId,
    intraCost,
    "Reform: Reduce vote multipliers",
    ctx.currentTurn
  );
  await adjustPopularLegitimacy(
    ctx.db,
    ctx.countryId,
    ctx.leaderCharacterId,
    +4,
    "Reform: Reduce vote multipliers",
    ctx.currentTurn
  );
  await setRulingPartyVoteMultiplierTier(ctx.db, ctx.countryId, "down");
  await appendBoost(ctx, "reduceVoteMultipliers", 0.15, 96);
  await setCooldown(ctx.db, ctx.countryId, "reduceVoteMultipliers", ctx.currentTurn, 240);
}

// ── Hold an honest by-election ──────────────────────────────────────────────

export async function holdHonestByElectionAction(ctx: ReformActionContext): Promise<void> {
  if (!(await isActionAvailable(ctx.db, ctx.countryId, "holdHonestByElection", ctx.currentTurn))) {
    throw new Error("holdHonestByElectionAction: on cooldown");
  }
  const intraCost = await consumeDiscount(ctx, -3);
  await adjustLeaderConfidence(
    ctx.db,
    ctx.countryId,
    ctx.leaderCharacterId,
    intraCost,
    "Reform: Honest by-election",
    ctx.currentTurn
  );
  await adjustPopularLegitimacy(
    ctx.db,
    ctx.countryId,
    ctx.leaderCharacterId,
    +5,
    "Reform: Honest by-election",
    ctx.currentTurn
  );
  await scheduleHonestByElection(ctx.db, ctx.countryId, { atMultiplier: 1.0 });
  await setCooldown(ctx.db, ctx.countryId, "holdHonestByElection", ctx.currentTurn, 96);
}

// ── Anti-corruption purge ───────────────────────────────────────────────────

export async function anticorruptionPurgeAction(ctx: ReformActionContext): Promise<void> {
  if (!(await isActionAvailable(ctx.db, ctx.countryId, "anticorruptionPurge", ctx.currentTurn))) {
    throw new Error("anticorruptionPurgeAction: on cooldown");
  }
  const intraCost = await consumeDiscount(ctx, -2);
  await adjustLeaderConfidence(
    ctx.db,
    ctx.countryId,
    ctx.leaderCharacterId,
    intraCost,
    "Reform: Anti-corruption purge",
    ctx.currentTurn
  );
  await adjustPopularLegitimacy(
    ctx.db,
    ctx.countryId,
    ctx.leaderCharacterId,
    +3,
    "Reform: Anti-corruption purge",
    ctx.currentTurn
  );
  await recordPurgeEvent(ctx.db, ctx.countryId, {
    severity: "minor",
    kind: "anticorruption",
    turn: ctx.currentTurn,
    reason: "Reform: Anti-corruption purge",
  });
  await setCooldown(ctx.db, ctx.countryId, "anticorruptionPurge", ctx.currentTurn, 72);
}

// ── Constitutional amendment ────────────────────────────────────────────────

export async function constitutionalAmendmentAction(ctx: ReformActionContext): Promise<void> {
  if (
    !(await isActionAvailable(ctx.db, ctx.countryId, "constitutionalAmendment", ctx.currentTurn))
  ) {
    throw new Error("constitutionalAmendmentAction: already used");
  }
  const intraCost = await consumeDiscount(ctx, -8);
  await adjustLeaderConfidence(
    ctx.db,
    ctx.countryId,
    ctx.leaderCharacterId,
    intraCost,
    "Reform: Constitutional amendment",
    ctx.currentTurn
  );
  await adjustPopularLegitimacy(
    ctx.db,
    ctx.countryId,
    ctx.leaderCharacterId,
    +12,
    "Reform: Constitutional amendment",
    ctx.currentTurn
  );
  await appendBoost(ctx, "constitutionalAmendment", 0.3, 240);
  // Persistent renewal cap: every future leader renewal grants +2
  // intra-party confidence instead of the default +5. Read by
  // `applyLeadershipRenewalBumpForCountry` in rulingPartyConfidence.
  await updateCountryState(ctx.db, ctx.countryId, {
    renewalBumpOverride: CONSTITUTIONAL_AMENDMENT_RENEWAL_BUMP,
  });
  await setCooldown(ctx.db, ctx.countryId, "constitutionalAmendment", ctx.currentTurn, 0);
}
