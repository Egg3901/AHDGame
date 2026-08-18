import { ObjectId, type Db } from "mongodb";
import type { Crisis, CrisisEffect, CrisisInteraction } from "@/lib/db/types/crisis";
import type { Character, FederalBudget, Union } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { applyUnionLawProvision, isUnionsBanned } from "@/lib/labour/unionLaws";
import { spendFromTreasury } from "@/lib/budget/treasurySpend";
import { unionApproval } from "@/lib/unions/unionDues";
import { ALL_CRISIS_TEMPLATES } from "./templates";
import { createCrisisFromTemplate } from "./createCrisisFromTemplate";
import { UNION_BAN_STRIKE_NODES, UNION_BAN_STRIKE_TEMPLATE_KEY } from "./unionBanStrikeCopy";
import { announceUnionBanStrikeEnd, announceUnionBanStrikeStart } from "./unionBanStrikeWire";

/**
 * Wildcat general strike triggered by an enacted union ban.
 *
 * The ban itself is already a real, mechanical policy: a `union_law` provision
 * with `banAction: "ban"` sets `FederalBudget.unionsBanned`, suspends every
 * player union in the country and shuts the ordinary strike state machine off
 * (`src/lib/labour/unionLaws.ts`, `src/lib/labour/strikes.ts`). What was
 * missing was the consequence. Outlawing organised labour in a country where
 * organised labour exists is not a quiet administrative act, so enactment now
 * puts the executive in front of a general strike they have to answer for.
 *
 * The strike deliberately reuses the machinery the steel strike established
 * rather than growing its own engine: a country-scoped crisis with decaying
 * `profitMargin` effects, an interaction tree whose options carry real
 * `CrisisOptionAction` hooks, and the ordinary crisis turn for expiry. The one
 * new capability is that a hook can end the crisis itself, which the ordinary
 * turn loop had no way to express (see {@link endUnionBanStrike}).
 */

/**
 * Which archetypes read as labour/liberal and which as business/conservative in
 * each country, so the same crisis can charge the right constituencies without
 * branching on the country id at every call site. Countries with no row use
 * `default`, which carries only archetypes shared across the tables in
 * `archetypeAffinities.ts`.
 */
export interface StrikeSegments {
  labour: string[];
  business: string[];
}

export const UNION_BAN_SEGMENTS: Record<string, StrikeSegments> = {
  default: {
    labour: ["public_sector"],
    business: ["small_business", "rural_traditionalists"],
  },
  US: {
    labour: ["union_trades", "college_liberals", "public_sector"],
    business: ["small_business", "libertarians", "rural_traditionalists"],
  },
  UK: {
    labour: ["post_industrial_workers", "urban_progressives", "public_sector"],
    business: ["small_business", "populist_right", "rural_traditionalists"],
  },
  IE: {
    labour: ["working_class", "young_urban"],
    business: ["small_business", "rural_traditional"],
  },
};

/** Segment table for a country. */
export function segmentsFor(countryId: string): StrikeSegments {
  return UNION_BAN_SEGMENTS[countryId] ?? UNION_BAN_SEGMENTS.default;
}

/** How each resolution path is priced against the executive who chose it. */
export interface ExecutiveCost {
  /** Points off `Character.favorability` (0-100). */
  favorability: number;
  /** Points off each labour/liberal archetype's approval of them. */
  labourSegment: number;
  /** Points off each business/conservative archetype's approval of them. */
  businessSegment: number;
}

export const UNION_BAN_EXECUTIVE_COSTS: Record<
  "army" | "negotiateFailure" | "rideOut" | "backDown",
  ExecutiveCost
> = {
  // Troops in the plants end the strike, and end the President's standing with
  // everyone who works in one.
  army: { favorability: 12, labourSegment: 25, businessSegment: 0 },
  // A round of talks that produced nothing still cost something.
  negotiateFailure: { favorability: 1, labourSegment: 2, businessSegment: 0 },
  // Waiting it out is cheaper on the day and bleeds every turn after.
  rideOut: { favorability: 4, labourSegment: 8, businessSegment: 3 },
  // Repealing the ban buys labour peace and hands the right a scalp.
  backDown: { favorability: 5, labourSegment: 0, businessSegment: 20 },
};

/** Fraction of the ban's remaining effects that survives a ride-it-out choice. */
export const RIDE_OUT_EFFECT_RETENTION = 0.5;

/** Share of GDP a failed round of negotiation costs the treasury. */
export const NEGOTIATION_ATTEMPT_COST_PCT_GDP = 0.0005;

/** Floor and ceiling on the per-attempt chance that negotiation settles it. */
export const NEGOTIATE_MIN_CHANCE = 0.2;
export const NEGOTIATE_MAX_CHANCE = 0.7;

/**
 * Per-attempt probability that negotiation ends the strike, from how the
 * membership rates its unions (`Union.approval`, 0-100). A well-regarded union
 * leadership can sell a settlement to its members; one the members do not trust
 * cannot, however reasonable the offer. Bounded at both ends so no world state
 * makes talks either futile or a formality. Pure.
 */
export function negotiateSuccessChance(labourApproval: number): number {
  const approval = Number.isFinite(labourApproval)
    ? Math.max(0, Math.min(100, labourApproval))
    : 50;
  const raw =
    NEGOTIATE_MIN_CHANCE + (approval / 100) * (NEGOTIATE_MAX_CHANCE - NEGOTIATE_MIN_CHANCE);
  return Math.max(NEGOTIATE_MIN_CHANCE, Math.min(NEGOTIATE_MAX_CHANCE, raw));
}

/** Scale a crisis's remaining effects by `factor`. Pure. */
export function diminishEffects(effects: CrisisEffect[], factor: number): CrisisEffect[] {
  return effects.map((effect) => ({ ...effect, value: effect.value * factor }));
}

/** Mean `Union.approval` across a country's unions; 50 when it has none. */
export async function countryLabourApproval(db: Db, countryId: string): Promise<number> {
  const unions = await db
    .collection<Union>("unions")
    .find({ countryId: countryId as CountryId }, { projection: { approval: 1 } })
    .toArray();
  if (unions.length === 0) return 50;
  const total = unions.reduce((sum, union) => sum + unionApproval(union), 0);
  return total / unions.length;
}

/** True when the country has at least one union to be banned. */
async function countryHasUnions(db: Db, countryId: string): Promise<boolean> {
  const union = await db
    .collection<Union>("unions")
    .findOne({ countryId: countryId as CountryId }, { projection: { _id: 1 } });
  return union !== null;
}

/** The live wildcat strike in a country, if one is running. */
export async function getActiveUnionBanStrike(db: Db, countryId: string): Promise<Crisis | null> {
  return db.collection<Crisis>("crises").findOne({
    templateKey: UNION_BAN_STRIKE_TEMPLATE_KEY,
    countryIds: countryId,
    status: "active",
  });
}

export type UnionBanStrikeSkipReason =
  "not_banned" | "no_unions" | "already_striking" | "no_template";

export interface UnionBanStrikeTriggerResult {
  triggered: boolean;
  crisisId?: ObjectId;
  reason?: UnionBanStrikeSkipReason;
}

/**
 * Fire the wildcat general strike for a country whose union ban has just been
 * enacted. Called from the `union_law` branch of `applyLegislationEffect`,
 * immediately after `applyUnionLawProvision` has written the ban.
 *
 * Refuses in three cases, each of which is a real world state rather than an
 * error:
 *  - the ban is not actually in force (a `repeal_ban`, or a write that did not
 *    land), so there is nothing to strike against;
 *  - the country has no unions at all, so there is nobody to call a strike;
 *  - a wildcat strike from an earlier ban is still running, which is what makes
 *    the trigger fire exactly once per enactment even if a second ban bill
 *    passes while the first strike is on.
 */
export async function triggerUnionBanStrike(
  db: Db,
  countryId: string,
  currentTurn: number
): Promise<UnionBanStrikeTriggerResult> {
  if (!(await isUnionsBanned(db, countryId as CountryId))) {
    return { triggered: false, reason: "not_banned" };
  }

  if (!(await countryHasUnions(db, countryId))) return { triggered: false, reason: "no_unions" };
  if (await getActiveUnionBanStrike(db, countryId)) {
    return { triggered: false, reason: "already_striking" };
  }

  const template = ALL_CRISIS_TEMPLATES[UNION_BAN_STRIKE_TEMPLATE_KEY];
  if (!template) return { triggered: false, reason: "no_template" };

  const crisisId = await createCrisisFromTemplate(db, {
    template,
    templateKey: UNION_BAN_STRIKE_TEMPLATE_KEY,
    scope: "country",
    countryIds: [countryId],
    regionIds: [],
    currentTurn,
    autoGenerated: true,
    autoSource: "condition",
  });

  // A crisis created outside the turn loop's `turn === startTurn` branch is
  // never announced by it, so announce here. Dynamically imported: the turn
  // module reaches this file through the template registry, and a static import
  // back would close the cycle.
  const { announceCrisisStart } = await import("@/lib/turn/crisisTurn");
  const crisis = await db.collection<Crisis>("crises").findOne({ _id: crisisId });
  if (crisis) await announceCrisisStart(db, crisis);
  await announceUnionBanStrikeStart(countryId);

  return { triggered: true, crisisId };
}

/**
 * End a live wildcat strike early.
 *
 * Resolving the crisis document is the whole unwind: the crisis turn only reads
 * `status: "active"` crises, so the decaying margin/production penalties and the
 * per-turn ticks stop the moment this lands. Nothing needs to be reversed,
 * because nothing was written into the sectors that outlives the crisis.
 */
export async function endUnionBanStrike(
  db: Db,
  crisis: Crisis,
  currentTurn: number,
  outcome: string
): Promise<void> {
  const now = new Date();
  await db
    .collection<Crisis>("crises")
    .updateOne(
      { _id: crisis._id, status: "active" },
      { $set: { status: "resolved", endTurn: currentTurn, resolvedAt: now } }
    );
  await announceUnionBanStrikeEnd(crisis.countryIds[0] ?? "", outcome);
}

/**
 * Charge a resolution to the executive who chose it.
 *
 * Personal favorability and per-archetype approval are the two channels the
 * game already models for "this decision cost you standing with these people"
 * (`Character.favorability` and `Character.archetypeApprovals`, both read by
 * `effectiveFavorability`). Deltas land on the deciding character only: the
 * strike's country-wide approval damage is carried by the crisis's own
 * `targetType: "approval"` effects, which is a different thing from what the
 * President personally is now worth to a steelworker.
 */
export async function chargeExecutive(
  db: Db,
  characterId: ObjectId,
  countryId: string,
  cost: ExecutiveCost
): Promise<void> {
  const segments = segmentsFor(countryId);
  const inc: Record<string, number> = {};
  if (cost.favorability) inc.favorability = -cost.favorability;
  if (cost.labourSegment) {
    for (const id of segments.labour) inc[`archetypeApprovals.${id}`] = -cost.labourSegment;
  }
  if (cost.businessSegment) {
    for (const id of segments.business) inc[`archetypeApprovals.${id}`] = -cost.businessSegment;
  }
  if (Object.keys(inc).length === 0) return;

  await db.collection<Character>("characters").updateOne({ _id: characterId }, { $inc: inc });

  // Clamp after the fact, exactly as `applyArchetypeImpactsToVoters` does:
  // favorability is a 0-100 scale and archetype approvals are -100..100, and a
  // bare `$inc` respects neither.
  const character = await db
    .collection<Character>("characters")
    .findOne({ _id: characterId }, { projection: { favorability: 1, archetypeApprovals: 1 } });
  if (!character) return;

  const set: Record<string, unknown> = {};
  const clampedFavorability = Math.max(0, Math.min(100, character.favorability ?? 0));
  if (clampedFavorability !== character.favorability) set.favorability = clampedFavorability;
  if (character.archetypeApprovals) {
    const clamped: Record<string, number> = {};
    let drifted = false;
    for (const [id, value] of Object.entries(character.archetypeApprovals)) {
      const next = Math.max(-100, Math.min(100, value));
      clamped[id] = next;
      if (next !== value) drifted = true;
    }
    if (drifted) set.archetypeApprovals = clamped;
  }
  if (Object.keys(set).length > 0) {
    await db.collection<Character>("characters").updateOne({ _id: characterId }, { $set: set });
  }
}

/**
 * What a resolution attempt did.
 *
 * `nextNodeId` is set only when the handler has to overrule the option's own
 * target. That is exactly one case: talks that settled. Everything else lands on
 * the terminal the option already points at.
 */
export interface UnionBanStrikeResponseResult {
  nextNodeId?: string;
}

/**
 * Deploy the army. The strike ends at once and the executive pays for it with
 * the people who were on the picket line.
 */
async function respondWithArmy(
  db: Db,
  crisis: Crisis,
  characterId: ObjectId,
  countryId: string,
  currentTurn: number
): Promise<UnionBanStrikeResponseResult> {
  await endUnionBanStrike(db, crisis, currentTurn, "troops");
  await chargeExecutive(db, characterId, countryId, UNION_BAN_EXECUTIVE_COSTS.army);
  return {};
}

/**
 * Negotiate. One roll per attempt, weighted by how much the membership trusts
 * its own leadership. Every round costs a concession out of the treasury,
 * settled or not, because the offer has to be real to be worth rolling on.
 * Failure leaves the strike running and the decision node open, so the
 * executive can keep trying or switch to another path.
 */
async function respondWithNegotiation(
  db: Db,
  crisis: Crisis,
  characterId: ObjectId,
  countryId: string,
  currentTurn: number
): Promise<UnionBanStrikeResponseResult> {
  const approval = await countryLabourApproval(db, countryId);
  const settled = Math.random() < negotiateSuccessChance(approval);

  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ countryId: countryId as CountryId }, { projection: { gdp: 1, gdpSmoothed: 1 } });
  const gdp =
    budget?.gdpSmoothed && budget.gdpSmoothed > 0 ? budget.gdpSmoothed : (budget?.gdp ?? 0);
  const concession = gdp > 0 ? gdp * NEGOTIATION_ATTEMPT_COST_PCT_GDP : 0;
  if (concession > 0) {
    await spendFromTreasury(db, countryId, concession, { resyncDerived: true });
  }

  if (settled) {
    await endUnionBanStrike(db, crisis, currentTurn, "settlement");
    return { nextNodeId: UNION_BAN_STRIKE_NODES.settlement };
  }

  await chargeExecutive(db, characterId, countryId, UNION_BAN_EXECUTIVE_COSTS.negotiateFailure);
  return {};
}

/**
 * Ride it out. The strike runs to its 24-turn expiry, but at half strength from
 * this turn on: pickets thin, some plants restart, the paralysis becomes an
 * inconvenience instead of a stoppage. Bought with standing rather than money.
 */
async function respondByRidingItOut(
  db: Db,
  crisis: Crisis,
  characterId: ObjectId,
  countryId: string
): Promise<UnionBanStrikeResponseResult> {
  await db
    .collection<Crisis>("crises")
    .updateOne(
      { _id: crisis._id },
      { $set: { effects: diminishEffects(crisis.effects, RIDE_OUT_EFFECT_RETENTION) } }
    );
  await chargeExecutive(db, characterId, countryId, UNION_BAN_EXECUTIVE_COSTS.rideOut);
  return {};
}

/**
 * Back down: repeal the ban through the same primitive the legislature uses, so
 * `FederalBudget.unionsBanned` clears and every suspended union is restored with
 * its leadership, treasury and pressure intact. The strike has nothing left to
 * be about, so it ends.
 *
 * The repeal runs through `applyUnionLawProvision` rather than a bespoke write:
 * that function is the single source of truth for what a ban is, and a second
 * copy of it here would drift. It does not route back through
 * `applyLegislationEffect`, so this can never re-enter the trigger.
 */
async function respondByBackingDown(
  db: Db,
  crisis: Crisis,
  characterId: ObjectId,
  countryId: string,
  currentTurn: number
): Promise<UnionBanStrikeResponseResult> {
  await applyUnionLawProvision(db, countryId as CountryId, {
    type: "union_law",
    bias: 0,
    banAction: "repeal_ban",
  });
  await endUnionBanStrike(db, crisis, currentTurn, "repeal");
  await chargeExecutive(db, characterId, countryId, UNION_BAN_EXECUTIVE_COSTS.backDown);
  return {};
}

export type UnionBanStrikeResponse = "army" | "negotiate" | "rideOut" | "backDown";

/**
 * Run one executive response to the wildcat strike. Dispatched from
 * `runCrisisOptionAction`; a returned `nextNodeId` redirects the interaction,
 * and everything else follows the option's own branch of the tree.
 */
export async function runUnionBanStrikeResponse(args: {
  db: Db;
  crisis: Crisis;
  interaction: CrisisInteraction;
  characterId: ObjectId;
  countryId: string;
  currentTurn: number;
  response: UnionBanStrikeResponse;
}): Promise<UnionBanStrikeResponseResult> {
  const { db, crisis, characterId, countryId, currentTurn, response } = args;

  // The crisis on the context is a snapshot taken when the decision was
  // submitted. Re-read it so a strike that expired or was already resolved on
  // another path cannot be resolved a second time.
  const live = await db.collection<Crisis>("crises").findOne({ _id: crisis._id, status: "active" });
  if (!live) return { nextNodeId: UNION_BAN_STRIKE_NODES.alreadyOver };

  switch (response) {
    case "army":
      return respondWithArmy(db, live, characterId, countryId, currentTurn);
    case "negotiate":
      return respondWithNegotiation(db, live, characterId, countryId, currentTurn);
    case "rideOut":
      return respondByRidingItOut(db, live, characterId, countryId);
    case "backDown":
      return respondByBackingDown(db, live, characterId, countryId, currentTurn);
  }
}
