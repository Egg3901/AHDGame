import { getEraContext } from "@/lib/era/context";
import type { Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { ProspectingSurvey } from "@/lib/db/types/prospectingSurvey";
import type { ExtractableResource } from "@/lib/constants/commodities";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getProspectingSurveysCollection } from "@/lib/db/collections/prospectingSurveys";
import { getStateResourceCapacityCollection } from "@/lib/db/collections/stateResourceCapacity";
import {
  getCorpFxRate,
  anchorToCorpLiquidCapital,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { insufficientCapitalMessage } from "@/lib/currency/insufficientCapitalMessage";
import { emitTx } from "@/lib/financialTxLog/emit";
import {
  prospectDurationTurns,
  PROSPECT_MAX_ACTIVE_PER_INITIATOR,
  prospectCostAnchor,
  prospectCostMultiplier,
} from "@/lib/constants/prospecting";

export interface CorpProspectCosts {
  costAnchor: number;
  costLocal: number;
  currencyCode: CurrencyCode | string;
  priorSuccessCount: number;
  costMultiplier: number;
}

export type LaunchCorpProspectResult =
  | { ok: true; status: 200; survey: ProspectingSurvey; costs: CorpProspectCosts }
  | { ok: false; status: number; error: string };

/**
 * Launch a corporation-funded geological survey against one (state, resource).
 *
 * Caller handles auth (requireCeo), the prospecting feature gate, corp-actions
 * pause, and resolving the corporation. This command owns eligibility, cost
 * escalation, the atomic guarded liquidCapital debit, the tx emit, and the
 * survey insert. Designed to be correct on the standalone-Mongo (no-transaction)
 * path: the only balance-critical write is the single guarded `updateOne`.
 */
export async function launchCorpProspect(
  db: Db,
  corporation: Corporation,
  args: { stateId: string; resource: ExtractableResource },
  turn: number,
  now: Date
): Promise<LaunchCorpProspectResult> {
  const { stateId, resource } = args;

  if (corporation.type !== "extraction" && corporation.secondaryType !== "extraction") {
    return {
      ok: false,
      status: 400,
      error: "Only corporations with an extraction sector can prospect.",
    };
  }

  // Corp must operate a sector in the target state. The sector is authoritative
  // for the state's owning country (cross-country state-id collisions).
  const sector = await db
    .collection<CorporateSector>("corporateSectors")
    .findOne({ corporationId: corporation._id, stateId }, { projection: { countryId: 1 } });
  if (!sector) {
    return {
      ok: false,
      status: 400,
      error: "Your company has no operations in that state.",
    };
  }
  const countryId = sector.countryId;

  // Resource must be an enabled deposit (capacity doc exists, value > 0).
  //
  // Deliberately gated on the per-turn CEILING, not on what is left in the
  // ground: under the plants tier deposits deplete (see
  // `@/lib/extraction/depletion`), and surveying a worked-out field is exactly
  // how a player extends it. Because reserves are DERIVED
  // (`resources[r] × DEPOSIT_RESERVE_TURNS`) rather than stored, the capacity
  // bump `resolveProspects` writes on success raises the remaining life of the
  // field as well as its rate — no second write is needed here or there.
  const capCol = await getStateResourceCapacityCollection(db);
  const cap = await capCol.findOne({ stateId, countryId });
  if ((cap?.resources?.[resource] ?? 0) <= 0) {
    return {
      ok: false,
      status: 400,
      error: "That resource is not extractable in this state.",
    };
  }

  const surveysCol = await getProspectingSurveysCollection(db);

  // Max active surveys per corp.
  const activeCount = await surveysCol.countDocuments({
    corporationId: corporation._id,
    status: "active",
  });
  if (activeCount >= PROSPECT_MAX_ACTIVE_PER_INITIATOR) {
    return {
      ok: false,
      status: 409,
      error: `A company can run at most ${PROSPECT_MAX_ACTIVE_PER_INITIATOR} surveys at a time.`,
    };
  }

  // One active survey per (corp, state, resource).
  const dup = await surveysCol.findOne({
    corporationId: corporation._id,
    stateId,
    resource,
    status: "active",
  });
  if (dup) {
    return {
      ok: false,
      status: 409,
      error: "Your company is already surveying that resource in this state.",
    };
  }

  // Cost escalation: succeeded surveys (any initiator) for this (state, resource).
  const priorSuccessCount = await surveysCol.countDocuments({
    stateId,
    resource,
    status: "succeeded",
  });
  const costAnchor = prospectCostAnchor(priorSuccessCount);
  const fxRate = await getCorpFxRate(db, corporation);
  const costLocal = anchorToCorpLiquidCapital(costAnchor, corporation, fxRate);
  const currencyCode = resolveCorpLiquidCurrencyCode(corporation) ?? "USD";

  // Atomic guarded debit — the affordability guard lives in the filter so the
  // $inc can never overdraw under concurrency.
  const debit = await db
    .collection<Corporation>("corporations")
    .updateOne(
      { _id: corporation._id, liquidCapital: { $gte: costLocal } },
      { $inc: { liquidCapital: -costLocal }, $set: { updatedAt: now } }
    );
  if (debit.modifiedCount === 0) {
    return {
      ok: false,
      status: 402,
      error: insufficientCapitalMessage(
        "A geological survey",
        costLocal,
        corporation.liquidCapital ?? 0,
        currencyCode
      ),
    };
  }

  void emitTx(db, {
    type: "corp_prospecting_cost",
    turn,
    createdAt: now,
    subjectType: "corporation",
    subjectId: corporation._id,
    subjectName: corporation.name ?? "Corporation",
    amount: -costLocal,
    currencyCode: currencyCode as CurrencyCode,
    anchorAmount: -costAnchor,
    meta: { stateId, resource, priorSuccessCount },
  });

  const survey: ProspectingSurvey = {
    _id: undefined as never,
    initiatorType: "corporation",
    corporationId: corporation._id,
    initiatorUserId: corporation.userId?.toString(),
    countryId,
    stateId,
    resource,
    startedTurn: turn,
    // Era-scaled: a 1953 survey is paper seismic read over seasons, not a
    // digitally-processed one. Stamped at LAUNCH so a survey already in the
    // ground keeps the duration it was sold with, even if the clock rolls
    // into a new era before it resolves.
    completesTurn: turn + prospectDurationTurns((await getEraContext(db)).year),
    costAnchor,
    rdScoreAtStart: corporation.rdScore ?? 0,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  const insert = await surveysCol.insertOne(survey);
  survey._id = insert.insertedId;

  return {
    ok: true,
    status: 200,
    survey,
    costs: {
      costAnchor,
      costLocal,
      currencyCode,
      priorSuccessCount,
      costMultiplier: prospectCostMultiplier(priorSuccessCount),
    },
  };
}
