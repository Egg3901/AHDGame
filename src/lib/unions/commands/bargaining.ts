import { ObjectId, type ClientSession, type Db } from "mongodb";
import type {
  BargainingCampaign,
  Character,
  CollectiveAgreement,
  Corporation,
  CorporateSector,
  FederalBudget,
  StateMetrics,
  Union,
} from "@/lib/db/types";
import { isDuplicateKeyError } from "@/lib/api/errors";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { corporationQueryFromParamId } from "@/lib/api/corporations/resolveQuery";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import {
  BARGAINING_REOPEN_COOLDOWN_TURNS,
  buildBargainingMandate,
  buildBargainingEscalationPlan,
  counterBargainingOffer,
  escalateBargainingCampaign,
  laborTightnessFromUnemployment,
  lawSupportFromBias,
  moveCampaignToDispute,
  openBargainingCampaign,
  proposeBargainingMediation,
  respondToBargainingMediation,
  settleBargainingCampaign,
  settleMediatedBargainingCampaign,
  validateBargainingTerms,
  type BargainingTerms,
} from "@/lib/unions/bargaining";
import { strikeCallCost, STRIKE_CALL_MIN_UNIONIZATION } from "@/lib/unions/unionEconomy";
import { realWageIndex } from "@/lib/labour/unionization";
import { STRIKE_EXPECTATION_GAP_THRESHOLD } from "@/lib/labour/strikes";
import { rejectIfTurnProcessing, resolveOwnedUnion, type UnionActionResult } from "./unionActions";
// Cycle with `./ratifySettlement` is deliberate and safe: that module settles
// through `persistBargainingSettlement` here, this one opens a ballot there,
// and both references are resolved at call time, never at module init.
import { openSettlementRatification } from "./ratifySettlement";

function campaignResult(campaign: BargainingCampaign): Extract<UnionActionResult, { ok: true }> {
  return {
    ok: true,
    status: 200,
    campaignId: campaign._id.toString(),
    campaignStatus: campaign.status,
    currentOffer: campaign.currentOffer,
  };
}

/**
 * State cost-of-living for every state the locals sit in. The grievance term
 * compares persisted worker expectations against the real wage, and those
 * expectations were trended against the COL-adjusted wage by the corporation
 * turn, so the mandate has to read the same index or the comparison inverts.
 */
async function costOfLivingByState(
  db: Db,
  locals: readonly Pick<CorporateSector, "stateId">[]
): Promise<Map<string, number>> {
  const stateIds = [...new Set(locals.map((local) => local.stateId).filter(Boolean))];
  if (stateIds.length === 0) return new Map();
  const metrics = await db
    .collection<StateMetrics>("macroMetrics")
    .find({ _id: { $in: stateIds } }, { projection: { "economic.costOfLiving": 1 } })
    .toArray();
  const byState = new Map<string, number>();
  for (const doc of metrics) {
    const value = doc.economic?.costOfLiving?.value;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      byState.set(doc._id.toString(), value);
    }
  }
  return byState;
}

export async function bargainingMacroInputs(db: Db, countryId: Union["countryId"]) {
  const nationalDocId = getNationalDocId(countryId);
  const [metrics, budget] = await Promise.all([
    nationalDocId
      ? db
          .collection<StateMetrics>("macroMetrics")
          .findOne({ _id: nationalDocId }, { projection: { "economic.unemploymentRate": 1 } })
      : null,
    db
      .collection<FederalBudget>("federalBudget")
      .findOne({ _id: getNationalBudgetId(countryId) }, { projection: { unionLawBias: 1 } }),
  ]);
  return {
    laborTightness: laborTightnessFromUnemployment(metrics?.economic?.unemploymentRate?.value ?? 5),
    lawSupport: lawSupportFromBias(budget?.unionLawBias),
  };
}

export type MandateLocal = Pick<
  CorporateSector,
  "_id" | "workers" | "unionization" | "wageLevel" | "workerExpectationIndex" | "stateId"
>;

/** Projection every mandate computation needs from a local. */
export const MANDATE_LOCAL_PROJECTION = {
  _id: 1,
  workers: 1,
  unionization: 1,
  wageLevel: 1,
  workerExpectationIndex: 1,
  stateId: 1,
} as const;

/**
 * Build a mandate from the locals as they are right now. Used both to open a
 * campaign and to refresh a running one every turn, so organizing during a
 * dispute, membership loss, and new collective-bargaining law all move the
 * campaign that is already on the table.
 */
export function mandateFromLocals(args: {
  locals: readonly MandateLocal[];
  treasury: number;
  laborTightness: number;
  lawSupport: number;
  costOfLivingByState: Map<string, number>;
}) {
  const organizedCount = args.locals.filter(
    (local) => (local.unionization ?? 0) >= STRIKE_CALL_MIN_UNIONIZATION
  ).length;
  return buildBargainingMandate({
    locals: args.locals.map((local) => ({
      workers: local.workers ?? 0,
      unionization: local.unionization ?? 0,
      wageLevel: local.wageLevel ?? 1,
      workerExpectationIndex: local.workerExpectationIndex,
      costOfLivingIndex: args.costOfLivingByState.get(local.stateId),
    })),
    laborTightness: args.laborTightness,
    lawSupport: args.lawSupport,
    treasury: args.treasury,
    strikeCost: strikeCallCost(organizedCount),
  });
}

/** Shared campaign opening used by authorized players and autonomous NPPs. */
export async function openBargainingCampaignFromLiveConditions(
  db: Db,
  union: Union,
  employerCorporationId: string,
  terms: BargainingTerms,
  currentTurn: number
): Promise<UnionActionResult> {
  if (!ObjectId.isValid(employerCorporationId)) {
    return { ok: false, status: 400, error: "Invalid employer corporation ID." };
  }
  const termsValidation = validateBargainingTerms(terms);
  if (!termsValidation.ok) return { ...termsValidation, status: 400 };

  const employerId = new ObjectId(employerCorporationId);
  const [employer, sectors, activeAgreement, macro, lastEnded] = await Promise.all([
    db
      .collection<Corporation>("corporations")
      .findOne({ _id: employerId }, { projection: { _id: 1 } }),
    db
      .collection<CorporateSector>("corporateSectors")
      .find(
        {
          corporationId: employerId,
          countryId: union.countryId,
          sectorType: union.sectorType,
        },
        { projection: MANDATE_LOCAL_PROJECTION }
      )
      .toArray(),
    db.collection<CollectiveAgreement>("collectiveAgreements").findOne({
      unionId: union._id,
      employerCorporationId: employerId,
      status: "active",
      expiresAtTurn: { $gt: currentTurn },
    }),
    bargainingMacroInputs(db, union.countryId),
    db.collection<BargainingCampaign>("bargainingCampaigns").findOne(
      {
        unionId: union._id,
        employerCorporationId: employerId,
        status: { $in: ["withdrawn", "lapsed"] },
      },
      { projection: { endedAtTurn: 1 }, sort: { endedAtTurn: -1 } }
    ),
  ]);
  if (!employer) return { ok: false, status: 404, error: "Employer corporation not found." };
  if (sectors.length === 0) {
    return {
      ok: false,
      status: 404,
      error: "This employer has no locals in the union's country and industry.",
    };
  }
  if (activeAgreement) {
    return {
      ok: false,
      status: 409,
      error: `A collective agreement already covers this employer through turn ${activeAgreement.expiresAtTurn}.`,
    };
  }

  // A campaign that just collapsed cannot be reopened the next turn: without a
  // cooling-off period, lapsing a deadlocked dispute would just hand the union
  // a fresh one and the industrial action would never actually stop.
  const reopenTurn =
    lastEnded?.endedAtTurn != null
      ? lastEnded.endedAtTurn + BARGAINING_REOPEN_COOLDOWN_TURNS
      : null;
  if (reopenTurn != null && currentTurn < reopenTurn) {
    return {
      ok: false,
      status: 409,
      error: `Bargaining with this employer can reopen on turn ${reopenTurn}.`,
    };
  }

  const mandate = mandateFromLocals({
    locals: sectors,
    treasury: union.treasury,
    laborTightness: macro.laborTightness,
    lawSupport: macro.lawSupport,
    costOfLivingByState: await costOfLivingByState(db, sectors),
  });
  const now = new Date();
  const campaign = openBargainingCampaign({
    union,
    employerCorporationId: employerId,
    sectors,
    mandate,
    terms,
    currentTurn,
    now,
  });
  if ("ok" in campaign) return { ...campaign, status: 400 };
  campaign.mandateUpdatedAtTurn = currentTurn;

  try {
    await db.collection<BargainingCampaign>("bargainingCampaigns").insertOne(campaign);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return {
        ok: false,
        status: 409,
        error: "An open bargaining campaign already exists with this employer.",
      };
    }
    throw error;
  }
  return campaignResult(campaign);
}

/** Open one employer-scoped campaign after player authorization and turn gates. */
export async function proposeBargainingCampaign(
  db: Db,
  character: Character,
  unionId: string,
  employerCorporationId: string,
  terms: BargainingTerms,
  currentTurn: number
): Promise<UnionActionResult> {
  const turnBusy = await rejectIfTurnProcessing(db);
  if (turnBusy) return turnBusy;
  const resolved = await resolveOwnedUnion(db, character, unionId);
  if (!resolved.ok) return resolved;
  return openBargainingCampaignFromLiveConditions(
    db,
    resolved.union,
    employerCorporationId,
    terms,
    currentTurn
  );
}

export async function persistBargainingCounter(
  db: Db,
  campaign: BargainingCampaign,
  proposedBy: "union" | "employer",
  terms: BargainingTerms,
  currentTurn: number
): Promise<UnionActionResult> {
  const next = counterBargainingOffer({
    campaign,
    proposedBy,
    terms,
    currentTurn,
    now: new Date(),
  });
  if ("ok" in next) return { ...next, status: 400 };
  const result = await db.collection<BargainingCampaign>("bargainingCampaigns").updateOne(
    {
      _id: campaign._id,
      status: campaign.status,
      "currentOffer.revision": campaign.currentOffer.revision,
    },
    {
      $set: {
        currentOffer: next.currentOffer,
        lastActionTurn: next.lastActionTurn,
        updatedAt: next.updatedAt,
      },
      $push: { offers: next.currentOffer },
    }
  );
  if (result.modifiedCount === 0) {
    return { ok: false, status: 409, error: "Campaign state changed. Reload and try again." };
  }
  return campaignResult(next);
}

export async function persistBargainingDispute(
  db: Db,
  campaign: BargainingCampaign,
  currentTurn: number
): Promise<UnionActionResult> {
  const next = moveCampaignToDispute(campaign, currentTurn, new Date());
  if ("ok" in next) return { ...next, status: 400 };
  const result = await db.collection<BargainingCampaign>("bargainingCampaigns").updateOne(
    { _id: campaign._id, status: campaign.status },
    {
      $set: {
        status: next.status,
        disputeStartedAtTurn: next.disputeStartedAtTurn,
        lastActionTurn: next.lastActionTurn,
        updatedAt: next.updatedAt,
      },
    }
  );
  if (result.modifiedCount === 0) {
    return { ok: false, status: 409, error: "Campaign state changed. Reload and try again." };
  }
  return campaignResult(next);
}

/**
 * Put shop-floor expectations back where they were before this campaign forced
 * them up. Escalation raises `workerExpectationIndex` above the strike trigger
 * to start a strike on demand; left in place after the campaign ends, that one
 * payment buys a local that re-strikes on its own after every cooldown, for
 * free, forever.
 */
export async function restoreEscalationExpectations(
  db: Db,
  campaign: Pick<BargainingCampaign, "escalationExpectations">,
  session?: ClientSession
): Promise<number> {
  const recorded = campaign.escalationExpectations ?? [];
  if (recorded.length === 0) return 0;
  const result = await db.collection<CorporateSector>("corporateSectors").bulkWrite(
    recorded.map((entry) => ({
      updateOne: {
        filter: { _id: entry.sectorId },
        update:
          entry.previousExpectationIndex == null
            ? { $unset: { workerExpectationIndex: "" } }
            : { $set: { workerExpectationIndex: entry.previousExpectationIndex } },
      },
    })),
    { session }
  );
  return result.modifiedCount;
}

async function persistSettlementOutcome(
  db: Db,
  campaign: BargainingCampaign,
  settled: {
    campaign: BargainingCampaign;
    agreement: CollectiveAgreement;
  },
  currentTurn: number
): Promise<UnionActionResult> {
  const claimCampaign = async (session?: ClientSession) => {
    const result = await db.collection<BargainingCampaign>("bargainingCampaigns").updateOne(
      {
        _id: campaign._id,
        status: campaign.status,
        "currentOffer.revision": campaign.currentOffer.revision,
        ...(campaign.mediation && { "mediation.updatedAt": campaign.mediation.updatedAt }),
      },
      {
        $set: {
          status: "settled",
          settledAgreementId: settled.agreement._id,
          endedAtTurn: currentTurn,
          lastActionTurn: currentTurn,
          updatedAt: settled.campaign.updatedAt,
          ...(settled.campaign.mediation && { mediation: settled.campaign.mediation }),
        },
      },
      { session }
    );
    if (result.modifiedCount === 0) throw new Error("CAMPAIGN_CHANGED");
  };
  const insertAgreement = (session?: ClientSession) =>
    db
      .collection<CollectiveAgreement>("collectiveAgreements")
      .insertOne(settled.agreement, { session });
  // The agreement is the wage floor; it is NOT written into `sector.wageLevel`.
  // Writing it there makes the raise permanent, because nothing lowers the
  // field again when the agreement expires — the union would ratchet pay up
  // one campaign at a time and the term length would mean nothing. The
  // corporation turn applies the floor on top of the employer's own wage level
  // for exactly as long as the agreement is active.

  try {
    await runWithOptionalTransaction(
      async (session) => {
        await claimCampaign(session);
        await insertAgreement(session);
        await restoreEscalationExpectations(db, campaign, session);
      },
      async () => {
        await claimCampaign();
        try {
          await insertAgreement();
        } catch (error) {
          await db
            .collection<CollectiveAgreement>("collectiveAgreements")
            .deleteOne({ _id: settled.agreement._id });
          await db.collection<BargainingCampaign>("bargainingCampaigns").updateOne(
            { _id: campaign._id, settledAgreementId: settled.agreement._id },
            {
              $set: {
                status: campaign.status,
                lastActionTurn: campaign.lastActionTurn,
                updatedAt: campaign.updatedAt,
                ...(campaign.mediation && { mediation: campaign.mediation }),
              },
              $unset: { settledAgreementId: "", endedAtTurn: "" },
            }
          );
          throw error;
        }
        // The agreement row is durable at this point, so the settlement itself
        // cannot be lost. Restoring expectations is idempotent and safe to run
        // outside a transaction.
        await restoreEscalationExpectations(db, campaign);
      }
    );
  } catch (error) {
    if (error instanceof Error && error.message === "CAMPAIGN_CHANGED") {
      return { ok: false, status: 409, error: "Campaign state changed. Reload and try again." };
    }
    throw error;
  }
  return {
    ...campaignResult(settled.campaign),
    agreementId: settled.agreement._id.toString(),
    expiresAtTurn: settled.agreement.expiresAtTurn,
  };
}

export async function persistBargainingSettlement(
  db: Db,
  campaign: BargainingCampaign,
  acceptedBy: "union" | "employer",
  currentTurn: number
): Promise<UnionActionResult> {
  const settled = settleBargainingCampaign({
    campaign,
    acceptedBy,
    currentTurn,
    now: new Date(),
  });
  if (!settled.ok) return { ...settled, status: 400 };
  return persistSettlementOutcome(db, campaign, settled, currentTurn);
}

export async function persistBargainingMediationAction(
  db: Db,
  campaign: BargainingCampaign,
  party: "union" | "employer",
  action: "request_mediation" | "accept_mediation" | "reject_mediation",
  currentTurn: number
): Promise<UnionActionResult> {
  const now = new Date();
  const next =
    action === "request_mediation"
      ? proposeBargainingMediation({ campaign, requestedBy: party, currentTurn, now })
      : respondToBargainingMediation({
          campaign,
          party,
          accept: action === "accept_mediation",
          currentTurn,
          now,
        });
  if ("ok" in next) return { ...next, status: 400 };

  if (next.mediation?.unionAccepted && next.mediation.employerAccepted) {
    const settled = settleMediatedBargainingCampaign({ campaign: next, currentTurn, now });
    if (!settled.ok) return { ...settled, status: 400 };
    return persistSettlementOutcome(db, campaign, settled, currentTurn);
  }

  const mediationFilter = campaign.mediation
    ? { "mediation.updatedAt": campaign.mediation.updatedAt }
    : { mediation: { $exists: false } };
  const result = await db.collection<BargainingCampaign>("bargainingCampaigns").updateOne(
    {
      _id: campaign._id,
      status: "dispute",
      "currentOffer.revision": campaign.currentOffer.revision,
      ...mediationFilter,
    },
    {
      $set: {
        mediation: next.mediation,
        lastActionTurn: next.lastActionTurn,
        updatedAt: next.updatedAt,
      },
    }
  );
  if (result.modifiedCount === 0) {
    return { ok: false, status: 409, error: "Campaign state changed. Reload and try again." };
  }
  return {
    ...campaignResult(next),
    mediation: next.mediation,
  };
}

export async function persistUnionBargainingEscalation(
  db: Db,
  union: Union,
  campaign: BargainingCampaign,
  currentTurn: number
): Promise<UnionActionResult> {
  const now = new Date();
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find(
      { _id: { $in: campaign.sectorIds } },
      {
        projection: {
          ...MANDATE_LOCAL_PROJECTION,
          strikeStartedAtTurn: 1,
          strikeCooldownUntilTurn: 1,
        },
      }
    )
    .toArray();
  // Escalate against the shop floor as it is now, not as it was when the
  // campaign opened. A frozen mandate lets a union that has since collapsed
  // keep calling strikes, and gives no credit to one that organized during the
  // dispute.
  const [macro, colByState] = await Promise.all([
    bargainingMacroInputs(db, union.countryId),
    costOfLivingByState(db, sectors),
  ]);
  const liveMandate = mandateFromLocals({
    locals: sectors,
    treasury: union.treasury,
    laborTightness: macro.laborTightness,
    lawSupport: macro.lawSupport,
    costOfLivingByState: colByState,
  });
  const refreshed: BargainingCampaign = {
    ...campaign,
    mandate: liveMandate,
    mandateUpdatedAtTurn: currentTurn,
  };
  const next = escalateBargainingCampaign(refreshed, currentTurn, now);
  if ("ok" in next) return { ...next, status: 400 };

  // The plan is the single rule: it decides what the escalation does, what it
  // costs, and whether it is allowed. The union-level strike cooldown (which
  // the retired direct-strike route enforced, and which stops a union striking
  // a different employer every turn) used to live only here, so the preview
  // offered escalations this gate then refused.
  const plan = buildBargainingEscalationPlan(campaign, sectors, currentTurn, union);
  const targets = plan.newStrikeLocals;
  if (plan.blockedReason) {
    const status =
      plan.blockedCode === "strike_cooldown" ? 409 : plan.blockedCode === "no_target" ? 400 : 402;
    return { ok: false, status, error: plan.blockedReason };
  }
  const cost = plan.cashCost;

  const campaignCollection = db.collection<BargainingCampaign>("bargainingCampaigns");
  const unionCollection = db.collection<Union>("unions");
  const sectorCollection = db.collection<CorporateSector>("corporateSectors");
  const claimCampaign = async (session?: ClientSession) => {
    const result = await campaignCollection.updateOne(
      {
        _id: campaign._id,
        status: "dispute",
        escalationLevel: campaign.escalationLevel,
        lastActionTurn: campaign.lastActionTurn,
      },
      {
        $set: {
          escalationLevel: next.escalationLevel,
          escalationStartedAtTurn: currentTurn,
          lastActionTurn: currentTurn,
          mandate: next.mandate,
          mandateUpdatedAtTurn: currentTurn,
          updatedAt: now,
        },
        ...(recordedExpectations.length > 0 && {
          $push: { escalationExpectations: { $each: recordedExpectations } },
        }),
      },
      { session }
    );
    if (result.modifiedCount === 0) throw new Error("CAMPAIGN_CHANGED");
  };
  const fundAction = async (session?: ClientSession) => {
    if (cost === 0) return;
    const result = await unionCollection.updateOne(
      { _id: union._id, treasury: { $gte: cost } },
      {
        $inc: { treasury: -cost },
        $set: { lastCalledStrikeTurn: currentTurn, updatedAt: now },
      },
      { session }
    );
    if (result.modifiedCount === 0) throw new Error("INSUFFICIENT_TREASURY");
  };
  // Record what the shop floor believed before the strike call, so ending the
  // campaign can put it back. Locals already recorded by an earlier rung keep
  // their original value.
  const alreadyRecorded = new Set(
    (campaign.escalationExpectations ?? []).map((entry) => entry.sectorId.toString())
  );
  const recordedExpectations = targets
    .filter((sector) => !alreadyRecorded.has(sector._id.toString()))
    .map((sector) => ({
      sectorId: sector._id,
      previousExpectationIndex: sector.workerExpectationIndex ?? null,
    }));
  const strikeOps = targets.map((sector) => {
    // Same cost-of-living index the corporation turn will use next turn when
    // it recomputes the gap. A COL-blind figure makes the forced expectation
    // fall below the concession threshold on the very next turn in cheap
    // states, resolving the strike the union just paid for as a concession the
    // employer never made.
    const expectation =
      realWageIndex(sector.wageLevel ?? 1, colByState.get(sector.stateId)) +
      STRIKE_EXPECTATION_GAP_THRESHOLD +
      0.05;
    return {
      updateOne: {
        filter: { _id: sector._id, strikeStartedAtTurn: sector.strikeStartedAtTurn ?? null },
        update: {
          $set: {
            strikeStartedAtTurn: currentTurn,
            workerExpectationIndex: expectation,
            updatedAt: now,
          },
        },
      },
    };
  });
  const startStrikes = async (session?: ClientSession) => {
    if (strikeOps.length === 0) return;
    const result = await sectorCollection.bulkWrite(strikeOps, { session });
    if (result.matchedCount !== strikeOps.length) throw new Error("SECTOR_CHANGED");
  };
  const restoreCampaign = () =>
    campaignCollection.updateOne(
      {
        _id: campaign._id,
        status: "dispute",
        escalationLevel: next.escalationLevel,
        lastActionTurn: currentTurn,
      },
      {
        $set: {
          escalationLevel: campaign.escalationLevel,
          lastActionTurn: campaign.lastActionTurn,
          mandate: campaign.mandate,
          updatedAt: campaign.updatedAt,
          ...(campaign.escalationStartedAtTurn != null && {
            escalationStartedAtTurn: campaign.escalationStartedAtTurn,
          }),
          ...(campaign.mandateUpdatedAtTurn != null && {
            mandateUpdatedAtTurn: campaign.mandateUpdatedAtTurn,
          }),
        },
        ...(recordedExpectations.length > 0 && {
          $pull: {
            escalationExpectations: {
              sectorId: { $in: recordedExpectations.map((entry) => entry.sectorId) },
            },
          },
        }),
        ...((campaign.escalationStartedAtTurn == null || campaign.mandateUpdatedAtTurn == null) && {
          $unset: {
            ...(campaign.escalationStartedAtTurn == null && { escalationStartedAtTurn: "" }),
            ...(campaign.mandateUpdatedAtTurn == null && { mandateUpdatedAtTurn: "" }),
          },
        }),
      }
    );
  let fallbackFunded = false;
  const restoreFund = () =>
    !fallbackFunded
      ? Promise.resolve()
      : unionCollection.updateOne(
          { _id: union._id },
          {
            $inc: { treasury: cost },
            $set: { lastCalledStrikeTurn: union.lastCalledStrikeTurn, updatedAt: union.updatedAt },
          }
        );
  const restoreStrikes = async () => {
    if (targets.length === 0) return;
    await sectorCollection.bulkWrite(
      targets.map((sector) => ({
        updateOne: {
          filter: { _id: sector._id, strikeStartedAtTurn: currentTurn },
          update:
            sector.workerExpectationIndex == null
              ? {
                  $set: { strikeStartedAtTurn: sector.strikeStartedAtTurn ?? null },
                  $unset: { workerExpectationIndex: "" },
                }
              : {
                  $set: {
                    strikeStartedAtTurn: sector.strikeStartedAtTurn ?? null,
                    workerExpectationIndex: sector.workerExpectationIndex,
                  },
                },
        },
      }))
    );
  };

  try {
    await runWithOptionalTransaction(
      async (session) => {
        await claimCampaign(session);
        await fundAction(session);
        await startStrikes(session);
      },
      async () => {
        await claimCampaign();
        try {
          await fundAction();
          fallbackFunded = cost > 0;
          await startStrikes();
        } catch (error) {
          await restoreStrikes();
          await restoreFund();
          await restoreCampaign();
          throw error;
        }
      }
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "CAMPAIGN_CHANGED" || error.message === "SECTOR_CHANGED")
    ) {
      return { ok: false, status: 409, error: "Campaign state changed. Reload and try again." };
    }
    if (error instanceof Error && error.message === "INSUFFICIENT_TREASURY") {
      return { ok: false, status: 402, error: "The strike fund cannot finance this escalation." };
    }
    throw error;
  }
  return {
    ...campaignResult(next),
    escalationLevel: next.escalationLevel,
    sectorsStriking: targets.length,
    cashSpent: cost,
  };
}

export async function actOnBargainingCampaignAsUnion(
  db: Db,
  character: Character,
  unionRouteId: string,
  campaignId: string,
  action:
    | "accept"
    | "counter"
    | "withdraw"
    | "escalate"
    | "request_mediation"
    | "accept_mediation"
    | "reject_mediation",
  currentTurn: number,
  terms?: BargainingTerms
): Promise<UnionActionResult> {
  const turnBusy = await rejectIfTurnProcessing(db);
  if (turnBusy) return turnBusy;
  if (!ObjectId.isValid(campaignId)) {
    return { ok: false, status: 400, error: "Invalid campaign ID." };
  }
  const campaign = await db
    .collection<BargainingCampaign>("bargainingCampaigns")
    .findOne({ _id: new ObjectId(campaignId) });
  if (!campaign) return { ok: false, status: 404, error: "Bargaining campaign not found." };
  if (!ObjectId.isValid(unionRouteId) || !campaign.unionId.equals(new ObjectId(unionRouteId))) {
    return { ok: false, status: 404, error: "Bargaining campaign not found for this union." };
  }
  const resolved = await resolveOwnedUnion(db, character, campaign.unionId.toString());
  if (!resolved.ok) return resolved;

  if (action === "accept") {
    // A settlement binds every organizer to a wage floor and a no-strike term,
    // so the president moves to accept and the members decide. The vote is
    // skipped only when there is nobody holding strength to ask, which is the
    // one case where a ballot could never be answered.
    const opened = await openSettlementRatification(db, resolved.union, campaign, currentTurn);
    if (opened) return opened;
    return persistBargainingSettlement(db, campaign, "union", currentTurn);
  }
  if (action === "counter") {
    if (!terms) return { ok: false, status: 400, error: "Counteroffer terms are required." };
    return persistBargainingCounter(db, campaign, "union", terms, currentTurn);
  }
  if (
    action === "request_mediation" ||
    action === "accept_mediation" ||
    action === "reject_mediation"
  ) {
    return persistBargainingMediationAction(db, campaign, "union", action, currentTurn);
  }
  if (action === "escalate") {
    return persistUnionBargainingEscalation(db, resolved.union, campaign, currentTurn);
  }
  if (campaign.status !== "negotiating" && campaign.status !== "dispute") {
    return { ok: false, status: 400, error: "This campaign can no longer be withdrawn." };
  }
  const result = await db.collection<BargainingCampaign>("bargainingCampaigns").updateOne(
    { _id: campaign._id, status: campaign.status },
    {
      $set: {
        status: "withdrawn",
        escalationLevel: "none",
        endedAtTurn: currentTurn,
        lastActionTurn: currentTurn,
        updatedAt: new Date(),
        // A ballot on a campaign that no longer exists has nothing to decide.
        // Voided here rather than left for the turn sweep so the panel never
        // shows members voting on a withdrawn campaign.
        ...(campaign.ratification?.status === "open" && {
          "ratification.status": "void" as const,
          "ratification.closedAtTurn": currentTurn,
          "ratification.updatedAt": new Date(),
        }),
      },
    }
  );
  if (result.modifiedCount !== 1) {
    return { ok: false, status: 409, error: "Campaign state changed. Reload and try again." };
  }
  await restoreEscalationExpectations(db, campaign);
  return { ok: true, status: 200, campaignStatus: "withdrawn" };
}

export async function actOnBargainingCampaignAsEmployer(
  db: Db,
  userId: string,
  employerRouteId: string,
  campaignId: string,
  action:
    "accept" | "counter" | "reject" | "request_mediation" | "accept_mediation" | "reject_mediation",
  currentTurn: number,
  terms?: BargainingTerms
): Promise<UnionActionResult> {
  const turnBusy = await rejectIfTurnProcessing(db);
  if (turnBusy) return turnBusy;
  if (!ObjectId.isValid(campaignId)) {
    return { ok: false, status: 400, error: "Invalid campaign ID." };
  }
  const campaign = await db
    .collection<BargainingCampaign>("bargainingCampaigns")
    .findOne({ _id: new ObjectId(campaignId) });
  if (!campaign) return { ok: false, status: 404, error: "Bargaining campaign not found." };
  const employerRouteQuery = corporationQueryFromParamId(employerRouteId);
  if (!employerRouteQuery) {
    return { ok: false, status: 400, error: "Invalid employer corporation ID." };
  }
  const employer = await db
    .collection<Corporation>("corporations")
    .findOne(
      { $and: [{ _id: campaign.employerCorporationId }, employerRouteQuery] },
      { projection: { userId: 1, ceoVacant: 1 } }
    );
  if (employer?.ceoVacant || !employer?.userId || employer.userId.toString() !== userId) {
    return { ok: false, status: 403, error: "Only the employer's CEO can answer this campaign." };
  }

  if (action === "accept")
    return persistBargainingSettlement(db, campaign, "employer", currentTurn);
  if (action === "counter") {
    if (!terms) return { ok: false, status: 400, error: "Counteroffer terms are required." };
    return persistBargainingCounter(db, campaign, "employer", terms, currentTurn);
  }
  if (
    action === "request_mediation" ||
    action === "accept_mediation" ||
    action === "reject_mediation"
  ) {
    return persistBargainingMediationAction(db, campaign, "employer", action, currentTurn);
  }
  return persistBargainingDispute(db, campaign, currentTurn);
}
