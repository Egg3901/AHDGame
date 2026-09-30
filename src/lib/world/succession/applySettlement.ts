import type { ClientSession, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CountryGameState } from "@/lib/db/types/gameState";
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
import { publishFederationRelocations } from "./relocationLedger";
import {
  FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION,
  WORLD_ENTITY_STATES_COLLECTION,
  type FederationSettlementApplicationRecord,
  type RuntimeWorldEntityState,
  validateAppliedEntityStates,
} from "./runtimeEntities";

/** Apply a prepared, ratified settlement under the caller's turn transaction.
 * The receipt and all physical, fiscal and player effects commit together.
 * The caller must hold the turn lock and pass its exact current turn. */
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
    const updated = await db.collection<CountryGameState>("countryGameStates").updateOne(
      { _id: sourceCountryId, dissolvedTurn: null },
      {
        $set: {
          dissolvedTurn: appliedOnTurn,
          updatedAt: now,
          ...(sourceCountryId === "YU" ? { yuSettlementAppliedSinceTurn: appliedOnTurn } : {}),
        },
      },
      { session }
    );
    if (updated.matchedCount !== 1)
      throw new Error("Federation source country changed before dissolution");
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
  return plan.receipt;
}
