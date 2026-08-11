import { ObjectId, type Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { NATIONAL_TERMINAL_STATUSES } from "@/lib/congress/billProposalLimits";
import { getOrganizationLegislationCollection } from "@/lib/db/collections";
import type { Bill } from "@/lib/db/types";
import {
  getBillProposalAutoFailWarning,
  type BillProposalOriginChamber,
} from "@/lib/legislature/billAutoFailWarning";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { BILL_PROPOSE_ACTION_COST } from "@shared/constants/legislation";
import { recordOrgHistoryEvent } from "@/lib/internationalOrganizations/service";

function buildOrganizationWithdrawalBill(
  countryId: CountryId,
  organizationId: string,
  organizationName: string
): Pick<Bill, "title" | "summary" | "fullText" | "provisions"> {
  const countryName = COUNTRY_CONFIGS[countryId].name;
  return {
    title: `Resolution to Withdraw ${countryName} from ${organizationName}`,
    summary: `${countryName} would leave ${organizationName} if the legislature approves this withdrawal measure.`,
    fullText: `${countryName} shall withdraw from ${organizationName} upon enactment of this resolution. Any organization-hosted agreements involving ${countryName} shall be updated or terminated as required by membership departure.`,
    // Org-membership leave is modeled as an international_organization provision
    // (FTA withdrawal stays on internationalAction below).
    provisions: [
      {
        type: "international_organization",
        subType: "leave",
        organizationId,
        organizationName,
      },
    ],
  };
}

function buildFtaWithdrawalBill(
  countryId: CountryId,
  organizationId: string,
  organizationName: string,
  legislationId: ObjectId,
  legislationTitle: string,
  partiesSnapshot: CountryId[]
): Pick<Bill, "title" | "summary" | "fullText" | "internationalAction"> {
  const countryName = COUNTRY_CONFIGS[countryId].name;
  const partyNames = partiesSnapshot
    .map((partyId) => COUNTRY_CONFIGS[partyId]?.name ?? partyId)
    .join(", ");
  return {
    title: `Resolution to Withdraw ${countryName} from ${legislationTitle}`,
    summary: `${countryName} would leave the ${organizationName} free-trade agreement covering ${partyNames}.`,
    fullText: `${countryName} shall withdraw from ${legislationTitle} upon enactment of this resolution. If at least two partner countries remain, the agreement shall continue in force for those remaining parties; otherwise it shall terminate.`,
    internationalAction: {
      type: "leave_free_trade_agreement",
      targetCountryId: countryId,
      organizationId,
      organizationName,
      organizationLegislationId: legislationId,
      organizationLegislationTitle: legislationTitle,
      partiesSnapshot,
    },
  };
}

export async function proposeInternationalOrganizationLeave(params: {
  db: Db;
  countryId: CountryId;
  orgId: string;
  organizationName: string;
  actor: {
    characterId: ObjectId;
    characterName: string;
    party?: string;
    actions: number;
  };
  input:
    | { targetType: "organization"; confirmElectionRisk?: boolean }
    | {
        targetType: "free_trade_agreement";
        legislationId: string;
        confirmElectionRisk?: boolean;
      };
}) {
  const { db, countryId, orgId, organizationName, actor, input } = params;
  const openInternationalBill = await db.collection<Bill>("bills").findOne({
    sponsorId: actor.characterId,
    countryId,
    status: { $nin: NATIONAL_TERMINAL_STATUSES },
    // Legacy internationalAction (FTA) OR the new international_organization provision (org leave).
    $or: [
      { internationalAction: { $exists: true } },
      { "provisions.type": "international_organization" },
    ],
  });
  if (openInternationalBill) {
    return {
      ok: false as const,
      status: 409,
      error:
        "You already have an international-organization withdrawal measure in progress. Wait for it to resolve before proposing another.",
    };
  }

  const lowerChamberKey = COUNTRY_CONFIGS[countryId].legislature.lowerChamber.key;
  const nationalStateId = getNationalDocId(countryId) ?? `${countryId.toLowerCase()}_national`;
  const now = new Date();
  const currentTurn = await getCurrentTurn(db);

  let billDraft: Pick<
    Bill,
    "title" | "summary" | "fullText" | "internationalAction" | "provisions"
  >;
  let duplicateFilter: Record<string, unknown>;

  if (input.targetType === "organization") {
    billDraft = buildOrganizationWithdrawalBill(countryId, orgId, organizationName);
    duplicateFilter = {
      countryId,
      status: { $nin: NATIONAL_TERMINAL_STATUSES },
      "provisions.type": "international_organization",
      "provisions.subType": "leave",
      "provisions.organizationId": orgId,
    };
  } else {
    const legislation = await getOrganizationLegislationCollection(db);
    const targetLegislation = await legislation.findOne({
      _id: new ObjectId(input.legislationId),
      organizationId: orgId,
      type: "free_trade_agreement",
      status: "active",
    });
    if (!targetLegislation) {
      return {
        ok: false as const,
        status: 404,
        error: "Free-trade agreement not found or no longer active.",
      };
    }

    const targetParties = [...new Set(targetLegislation.parties as CountryId[])];
    if (!targetParties.includes(countryId)) {
      return {
        ok: false as const,
        status: 400,
        error: `${COUNTRY_CONFIGS[countryId].name} is not a party to that agreement.`,
      };
    }

    billDraft = buildFtaWithdrawalBill(
      countryId,
      orgId,
      organizationName,
      targetLegislation._id,
      targetLegislation.title,
      targetParties
    );
    duplicateFilter = {
      countryId,
      status: { $nin: NATIONAL_TERMINAL_STATUSES },
      "internationalAction.type": "leave_free_trade_agreement",
      "internationalAction.organizationId": orgId,
      "internationalAction.organizationLegislationId": targetLegislation._id,
      "internationalAction.targetCountryId": countryId,
    };
  }

  const duplicate = await db.collection<Bill>("bills").findOne(duplicateFilter);
  if (duplicate) {
    return {
      ok: false as const,
      status: 409,
      error: "A withdrawal measure for that target is already in progress.",
    };
  }

  const proposalWarning = await getBillProposalAutoFailWarning(
    db,
    countryId,
    lowerChamberKey as BillProposalOriginChamber,
    now
  );
  if (proposalWarning && !input.confirmElectionRisk) {
    return {
      ok: false as const,
      status: 409,
      error: "Election timing makes this bill likely to auto-fail.",
      autoFailWarning: proposalWarning,
      requiresElectionRiskConfirmation: true,
    };
  }

  const actionCost = BILL_PROPOSE_ACTION_COST;
  if ((actor.actions ?? 0) < actionCost) {
    return {
      ok: false as const,
      status: 400,
      error: `Proposing a bill costs ${actionCost} action points (you have ${actor.actions ?? 0}).`,
    };
  }

  const spendResult = await db.collection("characters").updateOne(
    { _id: actor.characterId, actions: { $gte: actionCost } },
    {
      $inc: { actions: -actionCost },
      $set: { updatedAt: new Date() },
    }
  );
  if (spendResult.modifiedCount === 0) {
    return {
      ok: false as const,
      status: 409,
      error: "Your available actions changed. Please try again.",
    };
  }

  const billId = new ObjectId();
  try {
    await db.collection<Bill>("bills").insertOne({
      _id: billId,
      countryId,
      stateId: nationalStateId,
      title: billDraft.title,
      summary: billDraft.summary,
      fullText: billDraft.fullText,
      originChamber: lowerChamberKey,
      currentChamber: lowerChamberKey,
      sponsorId: actor.characterId,
      sponsorName: actor.characterName,
      sponsorParty: actor.party ?? undefined,
      status: "active",
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: {},
      category: "foreign policy",
      ...(billDraft.internationalAction
        ? { internationalAction: billDraft.internationalAction }
        : {}),
      ...(billDraft.provisions ? { provisions: billDraft.provisions } : {}),
      proposalActionCost: actionCost,
      proposedAt: now,
      votingStartedAt: now,
      votingEndsAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      votingEndsOnTurn: (await getCurrentTurn(db)) + 24,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    await db
      .collection("characters")
      .updateOne(
        { _id: actor.characterId },
        { $inc: { actions: actionCost }, $set: { updatedAt: new Date() } }
      );
    throw error;
  }

  const historyLine =
    input.targetType === "organization"
      ? `${COUNTRY_CONFIGS[countryId].name} proposed a legislative withdrawal from ${organizationName}.`
      : `${COUNTRY_CONFIGS[countryId].name} proposed a legislative withdrawal from ${billDraft.internationalAction?.organizationLegislationTitle ?? "a free-trade agreement"} in ${organizationName}.`;
  await recordOrgHistoryEvent(db, countryId, currentTurn, historyLine, {
    organizationId: orgId,
    billId: billId.toString(),
    targetType: input.targetType,
  });

  return { ok: true as const, billId: billId.toString() };
}
