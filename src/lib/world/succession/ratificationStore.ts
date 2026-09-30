import type { ObjectId, ClientSession, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Bill } from "@/lib/db/types/legislation";
import type { FederationPoliticalProposalRecord } from "./politicalProposal";
import {
  evaluateSuccessionApproval,
  type SuccessionApprovalInput,
  type SuccessionConsent,
} from "./rules/decision";

export const FEDERATION_RATIFICATIONS_COLLECTION = "federationRatifications";

/** A background republic records a bounded, explained decision on one set of
 * negotiated terms. A continuing source's own consent must cite its bill. */
export interface FederationRatificationRecord extends SuccessionConsent {
  _id: string;
  presetId: "1991-default";
  sourceEntityId: CountryId;
  termsHash: string;
  mode: "legislative" | "autonomous";
  reason: string;
  decidedOnTurn: number;
  billId?: ObjectId;
}

/** Load real enacted legislation and persisted successor decisions, rather
 * than trusting approval objects supplied by a caller. */
export async function loadPersistedFederationApproval(input: {
  db: Db;
  sourceEntityId: CountryId;
  approval: SuccessionApprovalInput;
  termsHash: string;
  appliedOnTurn: number;
  session?: ClientSession;
}): Promise<SuccessionApprovalInput> {
  const { db, sourceEntityId, approval, termsHash, appliedOnTurn, session } = input;
  if (
    !/^[a-f0-9]{64}$/.test(termsHash) ||
    !Number.isSafeInteger(appliedOnTurn) ||
    appliedOnTurn < 1 ||
    !Number.isSafeInteger(approval.revision) ||
    approval.revision < 1 ||
    !approval.settlementId.trim()
  )
    throw new Error("Federation ratification has invalid settlement terms");
  const proposal = await db
    .collection<FederationPoliticalProposalRecord>("federationPoliticalProposals")
    .findOne({ _id: `1991-default:${approval.settlementId}:${approval.revision}` }, { session });
  if (
    !proposal ||
    proposal.status !== "open" ||
    proposal.sourceEntityId !== sourceEntityId ||
    proposal.termsHash !== termsHash
  )
    throw new Error("Federation vote has no matching open political proposal");
  const bills = await db
    .collection<Bill>("bills")
    .find(
      {
        countryId: sourceEntityId,
        status: { $in: ["signed", "veto_override"] },
        "federationSettlementMandate.settlementId": approval.settlementId,
        "federationSettlementMandate.revision": approval.revision,
        "federationSettlementMandate.termsHash": termsHash,
      },
      {
        session,
        projection: {
          _id: 1,
          countryId: 1,
          status: 1,
          enactedAt: 1,
          federationSettlementMandate: 1,
        },
      }
    )
    .toArray();
  if (
    bills.length !== 1 ||
    bills[0].federationSettlementMandate?.sourceEntityId !== sourceEntityId ||
    bills[0]._id.toString() !== proposal.billId.toString() ||
    !(bills[0].enactedAt instanceof Date) ||
    !Number.isFinite(bills[0].enactedAt.getTime())
  )
    throw new Error("Federation parent mandate has no unique enacted bill");
  const billId = bills[0]._id.toString();
  const ratifications = await db
    .collection<FederationRatificationRecord>(FEDERATION_RATIFICATIONS_COLLECTION)
    .find(
      {
        presetId: "1991-default",
        settlementId: approval.settlementId,
        revision: approval.revision,
      },
      { session }
    )
    .toArray();
  const participants = new Set(approval.requiredParticipants);
  if (
    ratifications.length !== participants.size ||
    ratifications.some(
      (record) =>
        record._id !==
          `1991-default:${approval.settlementId}:${approval.revision}:${record.entityId}` ||
        record.sourceEntityId !== sourceEntityId ||
        record.termsHash !== termsHash ||
        !participants.has(record.entityId) ||
        !["approve", "reject"].includes(record.choice) ||
        !record.reason.trim() ||
        !Number.isSafeInteger(record.decidedOnTurn) ||
        record.decidedOnTurn < 1 ||
        record.decidedOnTurn > appliedOnTurn ||
        (record.entityId === sourceEntityId
          ? record.mode !== "legislative" || record.billId?.toString() !== billId
          : record.mode !== "autonomous" || record.billId !== undefined)
    ) ||
    new Set(ratifications.map((record) => record.entityId)).size !== participants.size
  )
    throw new Error("Federation participants lack matching recorded consent");
  const persisted: SuccessionApprovalInput = {
    ...approval,
    parentMandate: { settlementId: approval.settlementId, revision: approval.revision },
    consents: ratifications.map(({ entityId, settlementId, revision, choice }) => ({
      entityId,
      settlementId,
      revision,
      choice,
    })),
  };
  if (evaluateSuccessionApproval(persisted).status !== "ready")
    throw new Error("Federation settlement has not received every required approval");
  return persisted;
}
