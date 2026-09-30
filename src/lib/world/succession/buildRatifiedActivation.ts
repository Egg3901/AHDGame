import type { ClientSession, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getWorldEntityOrThrow } from "@/lib/world/worldEntityManifest";
import { buildBackgroundMacroCountry } from "@/lib/world/macro/backgroundSeed";
import { earliestFederationDecisionYear } from "./availability";
import { loadLiveSuccessionInventory } from "./loadLiveInventory";
import { loadLiveSuccessionAccountingSnapshot } from "./normalizeLiveFinances";
import type { SuccessionActivationInput } from "./planActivation";
import {
  FEDERATION_POLITICAL_PROPOSALS_COLLECTION,
  type FederationPoliticalProposalRecord,
} from "./politicalProposal";
import { loadPersistedFederationApproval } from "./ratificationStore";
import { planSuccessionFinances } from "./rules/financialSettlement";
import { planSuccessionTerritories } from "./rules/territory";
import { hashFederationPoliticalTerms } from "./settlementIntent";

export type RatifiedActivation = Omit<SuccessionActivationInput, "sourceRegions" | "custodyAssets">;

/** Revalue enacted political terms against the live source. The mandate fixes
 * regions, custody and allocation rules; treasury amounts and census totals
 * are read at application time. Emergent macro profiles are only inputs here,
 * never persistent economies before sovereignty. */
export async function buildRatifiedFederationActivation(input: {
  db: Db;
  sourceCountryId: CountryId;
  settlementId: string;
  revision: number;
  currentTurn: number;
  currentYear: number;
  now: Date;
  session?: ClientSession;
}): Promise<RatifiedActivation> {
  const { db, sourceCountryId, settlementId, revision, currentTurn, currentYear, now, session } =
    input;
  if (
    !settlementId.trim() ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !Number.isSafeInteger(currentTurn) ||
    currentTurn < 1 ||
    !Number.isSafeInteger(currentYear) ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Federation activation needs a valid decision and turn");
  const proposal = await db
    .collection<FederationPoliticalProposalRecord>(FEDERATION_POLITICAL_PROPOSALS_COLLECTION)
    .findOne(
      {
        _id: `1991-default:${settlementId}:${revision}`,
        sourceEntityId: sourceCountryId,
        status: "open",
      },
      { session }
    );
  if (!proposal || proposal.terms.sourceEntityId !== sourceCountryId)
    throw new Error("Federation activation has no open approved proposal");
  const availableFromYear = earliestFederationDecisionYear("1991-default", sourceCountryId);
  if (availableFromYear === null || currentYear < availableFromYear)
    throw new Error("Federation activation is not yet available");
  const { sourceRegions } = await loadLiveSuccessionInventory(
    db,
    sourceCountryId,
    session
  );
  const assignments: Record<string, string> = {};
  for (const territory of proposal.terms.territories) {
    for (const regionId of territory.regionIds) {
      if (Object.hasOwn(assignments, regionId))
        throw new Error("Federation activation assigns a region twice");
      assignments[regionId] = territory.entityId;
    }
  }
  const territories = planSuccessionTerritories(
    sourceRegions,
    proposal.terms.participants,
    assignments
  );
  const approval = await loadPersistedFederationApproval({
    db,
    sourceEntityId: sourceCountryId,
    termsHash: proposal.termsHash,
    appliedOnTurn: currentTurn,
    session,
    approval: {
      settlementId,
      revision,
      availableFromYear,
      currentYear,
      requiredParticipants: proposal.terms.participants,
      parentMandate: { settlementId, revision },
      consents: [],
    },
  });
  const accounting = await loadLiveSuccessionAccountingSnapshot(db, sourceCountryId, session);
  const finances = planSuccessionFinances({
    settlementId,
    sourceEntityId: sourceCountryId,
    participants: territories.map(({ entityId, population }) => ({ entityId, population })),
    financialAssetsMinor: accounting.financialAssetsMinor,
    creditorDebtMinor: accounting.creditorDebtMinor,
    cashDeficitMinor: accounting.cashDeficitMinor,
    ...(proposal.terms.assetBasis === "negotiated"
      ? { assetSharesBps: proposal.terms.assetWeights }
      : {}),
    ...(proposal.terms.debtBasis === "negotiated"
      ? { debtSharesBps: proposal.terms.debtWeights }
      : {}),
  });
  const successors = proposal.terms.successors.map(({ entityId, displayName }) => {
    const entry = getWorldEntityOrThrow("1991-default", entityId);
    if (entry.displayName !== displayName || entry.parentEntityId !== sourceCountryId)
      throw new Error("Federation successor differs from approved political terms");
    return entry;
  });
  const macroTerms: RatifiedActivation["macroTerms"] = Object.fromEntries(
    successors.map((entry) => {
      const provisional = buildBackgroundMacroCountry(entry, "1991-default", now);
      const sectorWeights = Object.fromEntries(
        Object.entries(provisional.sectors).map(([sector, terms]) => [sector, terms.capacity])
      );
      return [
        entry.entityId,
        {
          presetId: "1991-default",
          currentTurn,
          economicSystem: provisional.economicSystem,
          sourceGdpToGameUnit: 1,
          fiscalCapacity: provisional.fiscalCapacity,
          stability: provisional.stability,
          tradeExposure: provisional.tradeExposure,
          sectorWeights,
          resources: provisional.resources,
        },
      ];
    })
  );
  const activation: RatifiedActivation = {
    settlementId,
    approval,
    source: getWorldEntityOrThrow("1991-default", sourceCountryId),
    continuingDisplayName: proposal.terms.continuingDisplayName,
    successors,
    territories,
    finances,
    negotiatedCustodians: proposal.terms.negotiatedCustodians,
    macroTerms,
    now,
  };
  if (hashFederationPoliticalTerms(activation) !== proposal.termsHash)
    throw new Error("Federation activation differs from the enacted political terms");
  return activation;
}
