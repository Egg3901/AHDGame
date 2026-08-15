import type { Db, ObjectId } from "mongodb";
import { ObjectId as MongoObjectId } from "mongodb";
import type {
  Character,
  GovernorQueuedBill,
  NPP,
  ElectedOfficial,
  StateBill,
  StateBillProvision,
} from "@/lib/db/types";
import { getSubNationalLegislatureKey, type CountryId } from "@/lib/constants/countries";
import {
  STATE_TERMINAL_STATUSES,
  checkDuplicateProvisions,
  checkCurrentPolicyLevel,
} from "@/lib/congress/billProposalLimits";
import {
  BILL_PROPOSE_ACTION_COST,
  countProvisionsChargedNationalInfluence,
  getProvisionCostTotal,
  SUBSIDY_BILL_CATEGORIES,
} from "@shared/constants/legislation";
import type { BillCategory } from "@shared/constants/legislation";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { stampTaxSliderProvisions } from "@/lib/politicalLegislation/taxSlider";

export interface QueueBillInput {
  countryId: CountryId;
  stateId: string;
  character: {
    _id: ObjectId;
    name: string;
    party?: string;
  };
  targetNppId: ObjectId;
  title: string;
  summary: string;
  category?: string;
  legislationTypeId?: string;
  effectDirection?: number;
  provisions?: StateBillProvision[];
}

/**
 * Queue a state bill that will fire next turn introduced by `targetNppId`.
 * Governor pays the full proposal cost up-front; the cost is refunded on
 * cancellation or auto-cancellation.
 *
 * Enforces:
 * - One pending queue per state.
 * - Target NPP is in the governor's party, holds a state-legislature seat, and
 *   has no active bill in flight.
 * - Governor has sufficient action points + NPI.
 */
export async function queueBill(
  db: Db,
  input: QueueBillInput
): Promise<{ status: number; body: { queueId?: string; error?: string } }> {
  const {
    countryId,
    stateId,
    character,
    targetNppId,
    title,
    summary,
    category,
    legislationTypeId,
    effectDirection,
    provisions,
  } = input;

  // One pending queue per state.
  const pending = await db.collection<GovernorQueuedBill>("governorLegislationQueue").findOne({
    countryId,
    stateId,
    status: "pending",
  });
  if (pending) {
    return { status: 409, body: { error: "A queued bill is already pending for this state." } };
  }

  // Target NPP eligibility.
  const npp = await db.collection<NPP>("npps").findOne({ _id: targetNppId });
  if (!npp || npp.retiredAt != null) {
    return { status: 400, body: { error: "Target NPP is unavailable." } };
  }
  if (npp.party !== character.party) {
    return { status: 400, body: { error: "NPP is not in your party." } };
  }
  const seat = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    nppId: targetNppId,
    officeType: getSubNationalLegislatureKey(countryId),
    state: stateId.toUpperCase(),
  });
  if (!seat) {
    return {
      status: 400,
      body: { error: "NPP does not hold a state-legislature seat in this state." },
    };
  }
  const activeNppBill = await db.collection<StateBill>("stateBills").findOne({
    sponsorNppId: targetNppId,
    status: { $nin: STATE_TERMINAL_STATUSES },
  });
  if (activeNppBill) {
    return { status: 400, body: { error: "NPP already has an active bill in flight." } };
  }

  let stampedProvisions = provisions;
  if (provisions && provisions.length > 0) {
    const stamped = await stampTaxSliderProvisions(db, provisions, countryId, stateId);
    if (!stamped.ok) {
      return { status: 400, body: { error: stamped.error } };
    }
    stampedProvisions = stamped.provisions;
  }

  // Policy-provision guards: refuse to queue a bill that proposes the current
  // policy level or duplicates a provision already in flight in this state.
  // Mirrors proposeStateBill so direct-propose and queued-via-NPP have parity.
  const policyProvisionsForCheck = (stampedProvisions ?? [])
    .filter(
      (p): p is { legislationTypeId: string; policyOptionId?: string; effectDirection: number } =>
        !("type" in p) || (p.type !== "subsidy" && p.type !== "end_subsidy")
    )
    .filter((p) => p.legislationTypeId);

  const duplicateCheck = await checkDuplicateProvisions(
    db,
    "stateBills",
    { stateId, status: { $nin: STATE_TERMINAL_STATUSES } },
    policyProvisionsForCheck
  );
  if (duplicateCheck) {
    return { status: 409, body: { error: duplicateCheck.error } };
  }

  const currentLevelCheck = await checkCurrentPolicyLevel(db, stateId, policyProvisionsForCheck);
  if (currentLevelCheck) {
    return { status: 409, body: { error: currentLevelCheck.error } };
  }

  // Cost calculation mirrors proposeStateBill.
  const policyCount = (stampedProvisions ?? []).filter(
    (p) => !("type" in p) || (p.type !== "subsidy" && p.type !== "end_subsidy")
  ).length;
  const subsidyCount = (stampedProvisions ?? []).filter(
    (p) => "type" in p && (p.type === "subsidy" || p.type === "end_subsidy")
  ).length;

  if (subsidyCount > 0 && category && !SUBSIDY_BILL_CATEGORIES.has(category as BillCategory)) {
    return {
      status: 400,
      body: { error: "Subsidy provisions can only be included in industry bills." },
    };
  }
  if (category === "industry" && subsidyCount === 0) {
    return {
      status: 400,
      body: { error: "Industry bills must contain at least one subsidy provision." },
    };
  }

  const influenceCount = countProvisionsChargedNationalInfluence({
    policyProvisionCount: policyCount,
    subsidyProvisionCount: subsidyCount,
  });
  const npiCost = getProvisionCostTotal(influenceCount);
  const actionCost = BILL_PROPOSE_ACTION_COST;

  // Atomic spend.
  const spend = await db.collection<Character>("characters").updateOne(
    {
      _id: character._id,
      actions: { $gte: actionCost },
      ...(npiCost > 0 ? { nationalInfluence: { $gte: npiCost } } : {}),
    },
    {
      $inc: {
        actions: -actionCost,
        ...(npiCost > 0 ? { nationalInfluence: -npiCost } : {}),
      },
      $set: { updatedAt: new Date() },
    }
  );
  if (spend.modifiedCount === 0) {
    return { status: 400, body: { error: "Insufficient actions or NPI." } };
  }

  const currentTurn = await getCurrentTurn(db);
  const id = new MongoObjectId();
  const doc: GovernorQueuedBill = {
    _id: id,
    countryId,
    stateId,
    governorCharacterId: character._id,
    governorName: character.name,
    targetNppId,
    targetNppName: npp.name,
    targetPartyId: npp.party!,
    title: title.trim(),
    summary: summary.trim(),
    ...(category ? { category } : {}),
    ...(legislationTypeId ? { legislationTypeId } : {}),
    ...(effectDirection !== undefined ? { effectDirection } : {}),
    ...(stampedProvisions ? { provisions: stampedProvisions } : {}),
    proposalActionCost: actionCost,
    proposalNpiCost: npiCost,
    queuedAtTurn: currentTurn,
    status: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.collection<GovernorQueuedBill>("governorLegislationQueue").insertOne(doc);
  return { status: 200, body: { queueId: id.toString() } };
}
