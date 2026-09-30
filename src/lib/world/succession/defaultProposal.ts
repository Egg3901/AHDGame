import type { Db } from "mongodb";
import { getWorldEntityOrThrow } from "@/lib/world/worldEntityManifest";
import { earliestFederationDecisionYear } from "./availability";
import { loadLiveSuccessionInventory } from "./loadLiveInventory";
import { openFederationPoliticalProposal } from "./politicalProposal";
import { planSuccessionFinances } from "./rules/financialSettlement";
import { planSuccessionTerritories } from "./rules/territory";
import type { SuccessionCustodyAsset } from "./rules/custody";
import type { SuccessorTerritory } from "./rules/territory";
import { sovietUnionRegions1991 } from "@/lib/countries/ru/data/sovietUnionRegions1991";

/** The complete 1991 federal regions, including Serbia's two provinces.
 * Proposals are drawn from live region populations and GDP, so pre-vote
 * demographic change does not freeze the opening census. */
const DEFAULT_TERRITORY = {
  RU: Object.fromEntries(
    sovietUnionRegions1991.map((region) => [
      region._id,
      region._id.startsWith("SU_") ? region._id.slice(3) : "RU",
    ])
  ),
  CS: {
    CS_PRG: "CZ2",
    CS_BOH: "CZ2",
    CS_MOR: "CZ2",
    CS_SVK: "SK",
  },
  YU: {
    YU_SLO: "SI",
    YU_CRO: "HR",
    YU_BIH: "BA",
    YU_MKD: "MK",
    YU_SRB: "YF",
    YU_VOJ: "YF",
    YU_KOS: "YF",
    YU_MNE: "YF",
  },
} as const;

export type DefaultFederationSource = keyof typeof DEFAULT_TERRITORY;

export function defaultFederationParticipants(sourceCountryId: DefaultFederationSource): string[] {
  return [...new Set(Object.values(DEFAULT_TERRITORY[sourceCountryId]))].sort();
}

/** Put every shared or strategic asset into the published negotiating terms.
 * The largest successor is the NPC opening position; each participant still
 * has a separate consent decision and can reject these terms. */
export function defaultNpcCustodians(
  territories: readonly SuccessorTerritory[],
  assets: readonly SuccessionCustodyAsset[]
): Record<string, string> {
  const ranked = [...territories].sort(
    (a, b) => b.population - a.population || a.entityId.localeCompare(b.entityId)
  );
  if (!ranked.length || !Number.isSafeInteger(ranked[0].population) || ranked[0].population <= 0)
    throw new Error("NPC custody terms need populated successor territory");
  const assignments: Record<string, string> = {};
  for (const asset of assets) {
    if (asset.kind === "strategic-force" || asset.homeRegionId === null) {
      if (Object.hasOwn(assignments, asset.assetId))
        throw new Error("NPC custody terms repeat a shared asset");
      assignments[asset.assetId] = ranked[0].entityId;
    }
  }
  return assignments;
}

/** Open the documented population-default settlement as an ordinary bill.
 * The zero financial amounts here are placeholders: a proposal binds the
 * allocation rule, while stage/verify value the live balance sheet later. */
export async function openDefaultFederationPoliticalProposal(input: {
  db: Db;
  sourceCountryId: DefaultFederationSource;
  currentYear: number;
  now: Date;
  /** Explicit proposed custodians for strategic or unlocated shared assets. */
  /** Omit for an NPC opening position; players supply every choice explicitly. */
  negotiatedCustodians?: Readonly<Record<string, string>>;
}) {
  const { db, sourceCountryId, currentYear, now } = input;
  const availableFromYear = earliestFederationDecisionYear("1991-default", sourceCountryId);
  if (availableFromYear === null || currentYear < availableFromYear)
    throw new Error("Federation proposal is not yet available");
  const assignments: Record<string, string> = DEFAULT_TERRITORY[sourceCountryId];
  const participants = defaultFederationParticipants(sourceCountryId);
  const inventory = await loadLiveSuccessionInventory(db, sourceCountryId);
  const territories = planSuccessionTerritories(inventory.sourceRegions, participants, assignments);
  const negotiatedCustodians =
    input.negotiatedCustodians ?? defaultNpcCustodians(territories, inventory.custodyAssets);
  const settlementId = `${sourceCountryId.toLowerCase()}-1991-default`;
  return openFederationPoliticalProposal({
    db,
    sourceCountryId,
    now,
    activation: {
      settlementId,
      approval: {
        settlementId,
        revision: 1,
        availableFromYear,
        currentYear,
        requiredParticipants: participants,
        parentMandate: null,
        consents: [],
      },
      source: getWorldEntityOrThrow("1991-default", sourceCountryId),
      ...(sourceCountryId === "RU" ? { continuingDisplayName: "Russia" } : {}),
      successors: participants
        .filter((id) => id !== sourceCountryId)
        .map((id) => getWorldEntityOrThrow("1991-default", id)),
      territories,
      finances: planSuccessionFinances({
        settlementId,
        sourceEntityId: sourceCountryId,
        participants: territories.map(({ entityId, population }) => ({ entityId, population })),
        financialAssetsMinor: 0,
        creditorDebtMinor: 0,
      }),
      negotiatedCustodians,
      macroTerms: {},
      now,
    },
  });
}
