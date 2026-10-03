/** Apply a prepared, ratified settlement under the caller's turn transaction.
 * The receipt and all physical, fiscal and player effects commit together.
 * The caller must hold the turn lock and pass its exact current turn. */
import type { ClientSession, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { verifyLiveFederationSettlementIntent } from "./settlementIntent";
import { buildFederationPublicationPlan } from "./publicationPlan";
import { verifyPreparedFederationPlan } from "./preparePublication";
import { materializeFederationTerritory } from "./materializeTerritory";
import { materializeFederationPublicCorporations } from "./materializePublicCorporations";
import { materializeFederationCustody } from "./materializeCustody";
import { materializeFederationPrivateFirms } from "./materializePrivateFirms";
import { materializeFederationResidentHolds } from "./materializeResidents";
import { materializeFederationSuccessorMacros } from "./materializeSuccessorMacros";
import { materializeFederationFiscalAccounts } from "./materializeFiscalAccounts";
import { materializeFederationFederalRetirement } from "./materializeFederalRetirement";
import { materializeProvisionalRussianCongress } from "./materializeRussianCongress";
import { publishFederationRelocations } from "./relocationLedger";
import {
  FEDERATION_POLITICAL_PROPOSALS_COLLECTION,
  type FederationPoliticalProposalRecord,
} from "./politicalProposal";
import {
  FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION,
  WORLD_ENTITY_STATES_COLLECTION,
  type FederationSettlementApplicationRecord,
  type RuntimeWorldEntityState,
  validateAppliedEntityStates,
} from "./runtimeEntities";

export async function applyPreparedFederationSettlement(input: {
  db: Db;
  session: ClientSession;
  intentId: string;
  sourceCountryId: CountryId;
  appliedOnTurn: number;
  now: Date;
}): Promise<FederationSettlementApplicationRecord> {
  const { db, session, intentId, sourceCountryId, appliedOnTurn, now } = input;
  if (
    !session.inTransaction() ||
    !intentId ||
    !Number.isSafeInteger(appliedOnTurn) ||
    appliedOnTurn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error(
      "Federation application needs an active transaction and valid intent, turn and time"
    );
  const applications = db.collection<FederationSettlementApplicationRecord>(
    FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION
  );
  const existing = await applications.findOne(
    { presetId: "1991-default", sourceEntityId: sourceCountryId, status: "applied" },
    { session }
  );
  if (existing) {
    if (existing._id !== intentId || existing.appliedOnTurn !== appliedOnTurn)
      throw new Error("Federation source already has another applied settlement");
    const states = await db
      .collection<RuntimeWorldEntityState>(WORLD_ENTITY_STATES_COLLECTION)
      .find({ applicationId: existing._id }, { session })
      .toArray();
    validateAppliedEntityStates(existing.presetId, [existing], states);
    return existing;
  }
  const { intent, snapshot } = await verifyLiveFederationSettlementIntent({
    db,
    session,
    intentId,
    sourceCountryId,
    appliedOnTurn,
  });
  const plan = buildFederationPublicationPlan(intent, snapshot);
  await verifyPreparedFederationPlan(db, plan, session);
  const applicationId = plan.receipt._id;
  await materializeFederationTerritory({
    db,
    session,
    applicationId,
    sourceCountryId,
    transfers: plan.stateTransfers,
  });
  await materializeFederationPublicCorporations({
    db,
    session,
    applicationId,
    sourceCountryId,
    transfers: plan.stateTransfers,
    assignments: plan.custodyAssignments,
  });
  await materializeFederationCustody({
    db,
    session,
    applicationId,
    sourceCountryId,
    transfers: plan.stateTransfers,
    assignments: plan.custodyAssignments,
  });
  const firmOrigins = await materializeFederationPrivateFirms({
    db,
    session,
    applicationId,
    sourceCountryId,
    transfers: plan.stateTransfers,
    firms: plan.sourceFirms,
    plans: plan.privateFirmPlans,
  });
  await materializeFederationResidentHolds({
    db,
    session,
    applicationId,
    sourceCountryId,
    transfers: plan.stateTransfers,
    residents: plan.sourceResidents,
    plans: plan.residencePlans,
    now,
  });
  await materializeFederationSuccessorMacros({
    db,
    session,
    successors: snapshot.activationPlan.successorEntities,
    countries: plan.macroCountries,
  });
  await materializeFederationFiscalAccounts({
    db,
    session,
    applicationId,
    sourceCountryId,
    accounting: snapshot.activationPlan.accounting,
    shares: plan.fiscalShares,
  });
  if (snapshot.activationPlan.sourceEntity.status === "dissolved") {
    await materializeFederationFederalRetirement({
      db,
      session,
      applicationId,
      sourceCountryId,
      appliedOnTurn,
      now,
    });
  } else if (sourceCountryId === "RU") {
    await materializeProvisionalRussianCongress({
      db,
      session,
      applicationId,
      transfers: plan.stateTransfers,
      appliedOnTurn,
      now,
    });
  }
  await applications.insertOne(plan.receipt, { session });
  await publishFederationRelocations({
    db,
    session,
    applicationId,
    residents: plan.residencePlans,
    firms: plan.privateFirmPlans,
    firmOrigins,
    now,
  });
  const completed = await db
    .collection<FederationPoliticalProposalRecord>(FEDERATION_POLITICAL_PROPOSALS_COLLECTION)
    .updateOne(
      { _id: intentId, sourceEntityId: sourceCountryId, status: "open" },
      { $set: { status: "applied" } },
      { session }
    );
  if (completed.matchedCount !== 1)
    throw new Error("Federation political proposal changed during settlement");
  return plan.receipt;
}
