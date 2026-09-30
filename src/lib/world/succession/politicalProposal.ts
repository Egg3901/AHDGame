import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getCountryConfig } from "@/lib/constants/countries";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import type { Bill } from "@/lib/db/types/legislation";
import type { GameState } from "@/lib/db/types/gameState";
import { getWorldEntityOrThrow } from "@/lib/world/worldEntityManifest";
import { earliestFederationDecisionYear } from "./availability";
import { proposalRevisionConflict } from "./rules/proposalRevision";
import { loadLiveSuccessionInventory } from "./loadLiveInventory";
import { planSuccessionCustody } from "./rules/custody";
import { planSuccessionTerritories } from "./rules/territory";
import {
  FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION,
  type FederationSettlementApplicationRecord,
} from "./runtimeEntities";
import {
  hashFederationPoliticalTerms,
  federationPoliticalTermsFromActivation,
  type FederationPoliticalTerms,
} from "./settlementIntent";

export const FEDERATION_POLITICAL_PROPOSALS_COLLECTION = "federationPoliticalProposals";
const VOTING_DURATION_TURNS = 24;
const APPROX_TURN_MS = 3_600_000;

export class FederationProposalConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FederationProposalConflictError";
  }
}

export interface FederationPoliticalProposalRecord {
  _id: string;
  presetId: "1991-default";
  sourceEntityId: CountryId;
  settlementId: string;
  revision: number;
  termsHash: string;
  terms: FederationPoliticalTerms;
  billId: ObjectId;
  status: "open" | "rejected" | "withdrawn" | "applied";
  openedOnTurn: number;
  createdAt: Date;
}

type Activation = Parameters<typeof hashFederationPoliticalTerms>[0];

/** Open a rejectable political choice using the ordinary national bill
 * lifecycle. Cash and creditor amounts are not fixed by this vote; only the
 * territorial, custody and allocation terms are. A retry repairs a proposal
 * saved before its bill without creating a second vote. */
export async function openFederationPoliticalProposal(input: {
  db: Db;
  sourceCountryId: CountryId;
  activation: Activation;
  now: Date;
}): Promise<FederationPoliticalProposalRecord> {
  const { db, sourceCountryId, activation, now } = input;
  const state = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1, currentYear: 1, currentTurn: 1 } });
  const availableYear = earliestFederationDecisionYear(state?.preset ?? "", sourceCountryId);
  if (
    state?.preset !== "1991-default" ||
    !Number.isSafeInteger(state.currentYear) ||
    availableYear === null ||
    state.currentYear < availableYear ||
    !Number.isSafeInteger(state.currentTurn) ||
    state.currentTurn < 1 ||
    !Number.isFinite(now.getTime()) ||
    activation.source.presetId !== "1991-default" ||
    activation.source.entityId !== sourceCountryId ||
    activation.approval.currentYear !== state.currentYear ||
    activation.approval.availableFromYear !== availableYear
  )
    throw new Error("Federation proposal is unavailable in this world or year");
  const terms = federationPoliticalTermsFromActivation(activation);
  const participants = new Set(terms.participants);
  const targets = new Set(terms.successors.map((entry) => entry.entityId));
  if (
    !terms.settlementId.trim() ||
    !Number.isSafeInteger(terms.revision) ||
    terms.revision < 1 ||
    participants.size < 2 ||
    participants.size !== terms.participants.length ||
    targets.size !== terms.successors.length ||
    targets.has(sourceCountryId) ||
    [...participants].filter((id) => id !== sourceCountryId).some((id) => !targets.has(id)) ||
    targets.size !== participants.size - (participants.has(sourceCountryId) ? 1 : 0) ||
    participants.has(sourceCountryId) !== !!terms.continuingDisplayName?.trim()
  )
    throw new Error("Federation proposal has incomplete political terms");
  const source = getWorldEntityOrThrow("1991-default", sourceCountryId);
  if (source.status !== "sovereign") throw new Error("Federation source is not sovereign");
  for (const target of terms.successors) {
    const entry = getWorldEntityOrThrow("1991-default", target.entityId);
    if (
      entry.parentEntityId !== sourceCountryId ||
      (entry.status !== "emergent" && entry.status !== "dependent") ||
      entry.simulationTier !== "background-macro" ||
      entry.displayName !== target.displayName
    )
      throw new Error("Federation target is not an eligible background successor");
  }
  const inventory = await loadLiveSuccessionInventory(db, sourceCountryId);
  const assignments: Record<string, string> = {};
  for (const territory of terms.territories) {
    for (const regionId of territory.regionIds) {
      if (Object.hasOwn(assignments, regionId))
        throw new Error("Federation proposal assigns a region twice");
      assignments[regionId] = territory.entityId;
    }
  }
  const territories = planSuccessionTerritories(
    inventory.sourceRegions,
    terms.participants,
    assignments
  );
  planSuccessionCustody({
    sourceEntityId: sourceCountryId,
    territories,
    assets: inventory.custodyAssets,
    negotiatedCustodians: terms.negotiatedCustodians,
  });
  const validWeights = (
    basis: FederationPoliticalTerms["assetBasis"],
    weights: Record<string, number>
  ) =>
    basis === "population"
      ? Object.keys(weights).length === 0
      : Object.keys(weights).sort().join(",") === terms.participants.join(",") &&
        Object.values(weights).every((weight) => Number.isSafeInteger(weight) && weight >= 0) &&
        Object.values(weights).reduce((sum, weight) => sum + weight, 0) === 10_000;
  if (
    !validWeights(terms.assetBasis, terms.assetWeights) ||
    !validWeights(terms.debtBasis, terms.debtWeights)
  )
    throw new Error("Federation proposal financial shares disagree with territory");
  const applied = await db
    .collection<FederationSettlementApplicationRecord>(
      FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION
    )
    .findOne({ presetId: "1991-default", sourceEntityId: sourceCountryId, status: "applied" });
  if (applied) throw new FederationProposalConflictError("Federation has already settled");

  const _id = `1991-default:${terms.settlementId}:${terms.revision}`;
  const termsHash = hashFederationPoliticalTerms(activation);
  const collection = db.collection<FederationPoliticalProposalRecord>(
    FEDERATION_POLITICAL_PROPOSALS_COLLECTION
  );
  const latest = (
    await collection
      .find(
        { presetId: "1991-default", sourceEntityId: sourceCountryId },
        { projection: { settlementId: 1, revision: 1, status: 1 } }
      )
      .sort({ revision: -1 })
      .limit(1)
      .toArray()
  )[0];
  const revisionConflict = proposalRevisionConflict({
    settlementId: terms.settlementId,
    revision: terms.revision,
    latest,
  });
  if (revisionConflict) throw new FederationProposalConflictError(revisionConflict);
  const intended: FederationPoliticalProposalRecord = {
    _id,
    presetId: "1991-default",
    sourceEntityId: sourceCountryId,
    settlementId: terms.settlementId,
    revision: terms.revision,
    termsHash,
    terms,
    billId: new ObjectId(),
    status: "open",
    openedOnTurn: state.currentTurn,
    createdAt: now,
  };
  await collection.updateOne({ _id }, { $setOnInsert: intended }, { upsert: true });
  const stored = await collection.findOne({ _id });
  if (
    !stored ||
    stored.sourceEntityId !== sourceCountryId ||
    stored.status !== "open" ||
    stored.termsHash !== termsHash ||
    !ObjectId.isValid(stored.billId)
  )
    throw new FederationProposalConflictError(
      "Federation proposal key conflicts with another decision"
    );
  const chamber = getCountryConfig(sourceCountryId, "1991-default").legislature.lowerChamber.key;
  const allocationSummary = (basis: string, weights: Record<string, number>) =>
    basis === "population"
      ? "live population shares"
      : Object.entries(weights)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, bps]) => `${id} ${(bps / 100).toFixed(2)}%`)
          .join(", ");
  const bill: Bill = {
    _id: stored.billId,
    countryId: sourceCountryId,
    stateId: getNationalDocId(sourceCountryId) ?? `${sourceCountryId.toLowerCase()}_national`,
    title: `${source.displayName} Federation Settlement Mandate`,
    summary: `Authorize negotiations on the recorded ${source.displayName} federation settlement terms. Public financial assets use ${allocationSummary(terms.assetBasis, terms.assetWeights)}. Existing debt and any cash deficit use ${allocationSummary(terms.debtBasis, terms.debtWeights)}. Original creditor contracts retain their issuer and currency. Each successor must also consent before any change takes effect.`,
    originChamber: chamber,
    currentChamber: chamber,
    sponsorId: null,
    sponsorName: `${source.displayName} Government`,
    status: "active",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    category: "foreign policy",
    provisions: [],
    federationSettlementMandate: {
      settlementId: terms.settlementId,
      revision: terms.revision,
      sourceEntityId: sourceCountryId,
      termsHash,
    },
    proposedAt: stored.createdAt,
    votingStartedAt: stored.createdAt,
    votingEndsAt: new Date(stored.createdAt.getTime() + VOTING_DURATION_TURNS * APPROX_TURN_MS),
    votingEndsOnTurn: stored.openedOnTurn + VOTING_DURATION_TURNS,
    createdAt: stored.createdAt,
    updatedAt: stored.createdAt,
  };
  const bills = db.collection<Bill>("bills");
  await bills.updateOne({ _id: stored.billId }, { $setOnInsert: bill }, { upsert: true });
  const savedBill = await bills.findOne({ _id: stored.billId });
  if (
    !savedBill ||
    savedBill.countryId !== sourceCountryId ||
    savedBill.federationSettlementMandate?.termsHash !== termsHash ||
    savedBill.federationSettlementMandate.settlementId !== terms.settlementId ||
    savedBill.federationSettlementMandate.revision !== terms.revision
  )
    throw new Error("Federation mandate bill key conflicts with another vote");
  return stored;
}
