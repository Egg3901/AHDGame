import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Bill } from "@/lib/db/types/legislation";
import {
  FEDERATION_POLITICAL_PROPOSALS_COLLECTION,
  type FederationPoliticalProposalRecord,
} from "@/lib/world/succession/politicalProposal";
import { recordFederationRatifications } from "@/lib/world/succession/recordRatifications";
import type { State } from "@/lib/db/types/state";

/** Run after the ordinary bill lifecycle: only a signed settlement mandate
 * can trigger autonomous decisions, and replay preserves the first decision. */
export async function processFederationRatifications(
  db: Db,
  preset: string | undefined,
  currentTurn: number
): Promise<number> {
  if (preset !== "1991-default") return 0;
  if (!Number.isSafeInteger(currentTurn) || currentTurn < 1)
    throw new Error("Federation ratification needs a valid turn");
  const proposals = await db
    .collection<FederationPoliticalProposalRecord>(FEDERATION_POLITICAL_PROPOSALS_COLLECTION)
    .find({ presetId: "1991-default", status: "open" })
    .toArray();
  let processed = 0;
  for (const proposal of proposals) {
    const bill = await db
      .collection<Bill>("bills")
      .findOne(
        { _id: proposal.billId },
        { projection: { status: 1, federationSettlementMandate: 1 } }
      );
    if (
      !bill ||
      !["signed", "veto_override"].includes(bill.status) ||
      bill.federationSettlementMandate?.termsHash !== proposal.termsHash
    )
      continue;
    await recordFederationRatifications({
      db,
      sourceCountryId: proposal.sourceEntityId,
      settlementId: proposal.settlementId,
      revision: proposal.revision,
      currentTurn,
    });
    processed += 1;
  }
  return processed;
}

/** Publish only unanimously approved settlements. A rejected mandate remains
 * visible as a decision, but never changes sovereignty. Preparation is
 * replayable; the application receipt makes a resumed turn idempotent. */
export async function processRatifiedFederationSettlements(
  db: Db,
  preset: string | undefined,
  currentTurn: number,
  currentYear: number,
  now: Date
): Promise<number> {
  if (preset !== "1991-default") return 0;
  const [
    { buildRatifiedFederationActivation },
    { stageLiveFederationSettlementIntent, verifyLiveFederationSettlementIntent },
    { buildFederationPublicationPlan },
    { prepareFederationPublication },
    { applyPreparedFederationSettlement },
    { FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION },
    { runRequiredTransaction },
    { loadWorldEraUnitScale },
    { getAllCountryAccess },
  ] = await Promise.all([
    import("@/lib/world/succession/buildRatifiedActivation"),
    import("@/lib/world/succession/settlementIntent"),
    import("@/lib/world/succession/publicationPlan"),
    import("@/lib/world/succession/preparePublication"),
    import("@/lib/world/succession/applySettlement"),
    import("@/lib/world/succession/runtimeEntities"),
    import("@/lib/db/runRequiredTransaction"),
    import("@/lib/currency/gdpAnchorRate"),
    import("@/lib/countryAccess"),
  ]);
  const proposals = await db
    .collection<FederationPoliticalProposalRecord>(FEDERATION_POLITICAL_PROPOSALS_COLLECTION)
    .find({ presetId: "1991-default", status: "open" })
    .toArray();
  let applied = 0;
  for (const proposal of proposals) {
    const applicationId = `1991-default:${proposal.settlementId}:${proposal.revision}`;
    const existing = await db
      .collection(FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION)
      .findOne({ _id: applicationId });
    if (existing) continue;
    const ratifications = await db
      .collection("federationRatifications")
      .find({
        presetId: "1991-default",
        settlementId: proposal.settlementId,
        revision: proposal.revision,
        termsHash: proposal.termsHash,
      })
      .toArray();
    if (
      ratifications.length !== proposal.terms.participants.length ||
      new Set(ratifications.map((vote) => vote.entityId)).size !== ratifications.length ||
      ratifications.some((vote) => vote.choice !== "approve")
    )
      continue;
    const activation = await buildRatifiedFederationActivation({
      db,
      sourceCountryId: proposal.sourceEntityId,
      settlementId: proposal.settlementId,
      revision: proposal.revision,
      currentTurn,
      currentYear,
      now,
    });
    const access = await getAllCountryAccess(db);
    const playableCountries = (Object.keys(access) as CountryId[]).filter(
      (countryId) =>
        access[countryId].enabledForPlayers &&
        (countryId !== proposal.sourceEntityId || Boolean(activation.continuingDisplayName))
    );
    const states = await db
      .collection<State>("states")
      .find(
        { countryId: { $in: playableCountries } },
        { projection: { _id: 1, countryId: 1, parentRegionId: 1 } }
      )
      .toArray();
    const sourceRegionsRetained = new Set(
      activation.territories
        .filter((territory) => territory.entityId === proposal.sourceEntityId)
        .flatMap((territory) => territory.regionIds)
    );
    const destinations = states
      .filter(
        (state) =>
          state.countryId !== proposal.sourceEntityId ||
          sourceRegionsRetained.has(state.parentRegionId ?? state._id)
      )
      .map((state) => ({ countryId: state.countryId, stateId: state._id }));
    const intent = await stageLiveFederationSettlementIntent({
      db,
      sourceCountryId: proposal.sourceEntityId,
      activation,
      appliedOnTurn: currentTurn,
      currentYear,
      eraUnitScale: await loadWorldEraUnitScale(db),
      playableResidences: destinations,
      residenceChoices: {},
      playableHeadquarters: destinations,
      headquartersChoices: {},
    });
    const verified = await verifyLiveFederationSettlementIntent({
      db,
      intentId: intent._id,
      sourceCountryId: proposal.sourceEntityId,
      appliedOnTurn: currentTurn,
    });
    await prepareFederationPublication(
      db,
      buildFederationPublicationPlan(verified.intent, verified.snapshot),
      now
    );
    await runRequiredTransaction(
      (session) =>
        applyPreparedFederationSettlement({
          db,
          session,
          intentId: intent._id,
          sourceCountryId: proposal.sourceEntityId,
          appliedOnTurn: currentTurn,
          now,
        }),
      { timeoutMS: 60_000, maxCommitTimeMS: 30_000 }
    );
    applied += 1;
  }
  return applied;
}
