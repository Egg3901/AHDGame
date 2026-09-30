/** Ratified federation settlements transfer sovereignty, territory and fiscal
 * obligations together. Residents and private firms await their owners' choices. */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { State } from "@/lib/db/types/state";
import { getAllCountryAccess } from "@/lib/countryAccess";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import {
  FEDERATION_POLITICAL_PROPOSALS_COLLECTION,
  type FederationPoliticalProposalRecord,
} from "@/lib/world/succession/politicalProposal";
import {
  FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION,
  type FederationSettlementApplicationRecord,
} from "@/lib/world/succession/runtimeEntities";
import {
  FEDERATION_RATIFICATIONS_COLLECTION,
  type FederationRatificationRecord,
} from "@/lib/world/succession/ratificationStore";
import { buildSourceRegionHierarchy } from "@/lib/world/succession/sourceRegionHierarchy";

/** Called under the turn lock after ratification. Staging, preparation and all
 * effective writes share one transaction, so a failed phase can retry on a
 * later turn without leaving a frozen intent from the failed turn. */
export async function processRatifiedFederationSettlements(
  db: Db,
  preset: string | undefined,
  currentTurn: number,
  currentYear: number,
  now: Date
): Promise<number> {
  if (preset !== "1991-default") return 0;
  if (
    !Number.isSafeInteger(currentTurn) ||
    currentTurn < 1 ||
    !Number.isSafeInteger(currentYear) ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Federation settlement needs a valid turn, year and time");
  const proposals = await db
    .collection<FederationPoliticalProposalRecord>(FEDERATION_POLITICAL_PROPOSALS_COLLECTION)
    .find({ presetId: "1991-default", status: "open" })
    .toArray();
  if (proposals.length === 0) return 0;
  const [applications, votes] = await Promise.all([
    db
      .collection<FederationSettlementApplicationRecord>(
        FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION
      )
      .find({ presetId: "1991-default", status: "applied" }, { projection: { sourceEntityId: 1 } })
      .toArray(),
    db
      .collection<FederationRatificationRecord>(FEDERATION_RATIFICATIONS_COLLECTION)
      .find({
        presetId: "1991-default",
        settlementId: { $in: proposals.map((proposal) => proposal.settlementId) },
      })
      .toArray(),
  ]);
  const appliedSources = new Set(applications.map((application) => application.sourceEntityId));
  const candidates = proposals.filter((proposal) => {
    if (appliedSources.has(proposal.sourceEntityId)) return false;
    const decisions = votes.filter(
      (vote) =>
        vote.settlementId === proposal.settlementId &&
        vote.revision === proposal.revision &&
        vote.termsHash === proposal.termsHash
    );
    return (
      decisions.length === proposal.terms.participants.length &&
      new Set(decisions.map((vote) => vote.entityId)).size === decisions.length &&
      decisions.every((vote) => vote.choice === "approve")
    );
  });
  if (candidates.length === 0) return 0;
  const [
    { buildRatifiedFederationActivation },
    { stageLiveFederationSettlementIntent, verifyLiveFederationSettlementIntent },
    { buildFederationPublicationPlan },
    { prepareFederationPublication },
    { applyPreparedFederationSettlement },
  ] = await Promise.all([
    import("@/lib/world/succession/buildRatifiedActivation"),
    import("@/lib/world/succession/settlementIntent"),
    import("@/lib/world/succession/publicationPlan"),
    import("@/lib/world/succession/preparePublication"),
    import("@/lib/world/succession/applySettlement"),
  ]);
  const access = await getAllCountryAccess(db);
  const playableCountries = (Object.keys(access) as CountryId[]).filter(
    (countryId) => access[countryId].enabledForPlayers
  );
  const eraUnitScale = await loadWorldEraUnitScale(db);
  let applied = 0;
  for (const proposal of candidates) {
    const didApply = await runRequiredTransaction(
      async (session) => {
        const existing = await db
          .collection<FederationSettlementApplicationRecord>(
            FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION
          )
          .findOne(
            {
              presetId: "1991-default",
              sourceEntityId: proposal.sourceEntityId,
              status: "applied",
            },
            { session }
          );
        if (existing) return false;
        const activation = await buildRatifiedFederationActivation({
          db,
          sourceCountryId: proposal.sourceEntityId,
          settlementId: proposal.settlementId,
          revision: proposal.revision,
          currentTurn,
          currentYear,
          now,
          session,
        });
        const states = await db
          .collection<State>("states")
          .find(
            { countryId: { $in: [...new Set([...playableCountries, proposal.sourceEntityId])] } },
            {
              session,
              projection: { _id: 1, countryId: 1, parentRegionId: 1, population: 1, gdp: 1 },
            }
          )
          .toArray();
        const hierarchy = buildSourceRegionHierarchy(
          states.filter((state) => state.countryId === proposal.sourceEntityId)
        );
        const retained = new Set(
          activation.territories
            .filter((territory) => territory.entityId === proposal.sourceEntityId)
            .flatMap((territory) => territory.regionIds)
        );
        const destinations = states
          .filter(
            (state) =>
              playableCountries.includes(state.countryId) &&
              (state.countryId !== proposal.sourceEntityId ||
                retained.has(hierarchy.topLevelFor(state._id) ?? ""))
          )
          .map((state) => ({ countryId: state.countryId, stateId: state._id }))
          .sort(
            (a, b) => a.countryId.localeCompare(b.countryId) || a.stateId.localeCompare(b.stateId)
          );
        const intent = await stageLiveFederationSettlementIntent({
          db,
          sourceCountryId: proposal.sourceEntityId,
          activation,
          appliedOnTurn: currentTurn,
          currentYear,
          eraUnitScale,
          playableResidences: destinations,
          residenceChoices: {},
          playableHeadquarters: destinations,
          headquartersChoices: {},
          session,
        });
        const verified = await verifyLiveFederationSettlementIntent({
          db,
          intentId: intent._id,
          sourceCountryId: proposal.sourceEntityId,
          appliedOnTurn: currentTurn,
          session,
        });
        await prepareFederationPublication(
          db,
          buildFederationPublicationPlan(verified.intent, verified.snapshot),
          now,
          session
        );
        await applyPreparedFederationSettlement({
          db,
          session,
          intentId: intent._id,
          sourceCountryId: proposal.sourceEntityId,
          appliedOnTurn: currentTurn,
          now,
        });
        return true;
      },
      { timeoutMS: 60_000, maxCommitTimeMS: 30_000 }
    );
    if (didApply) applied += 1;
  }
  return applied;
}
