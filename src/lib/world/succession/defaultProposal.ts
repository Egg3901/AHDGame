import type { Db } from "mongodb";
import { getWorldEntityOrThrow } from "@/lib/world/worldEntityManifest";
import { earliestFederationDecisionYear } from "./availability";
import { loadLiveSuccessionInventory } from "./loadLiveInventory";
import { openFederationPoliticalProposal } from "./politicalProposal";
import { planSuccessionFinances } from "./rules/financialSettlement";
import { planSuccessionTerritories } from "./rules/territory";

/** The complete 1991 federal regions, including Serbia's two provinces.
 * Proposals are drawn from live region populations and GDP, so pre-vote
 * demographic change does not freeze the opening census. */
const DEFAULT_TERRITORY = {
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

/** Open the documented population-default settlement as an ordinary bill.
 * The zero financial amounts here are placeholders: a proposal binds the
 * allocation rule, while stage/verify value the live balance sheet later. */
export async function openDefaultFederationPoliticalProposal(input: {
  db: Db;
  sourceCountryId: DefaultFederationSource;
  currentYear: number;
  now: Date;
  /** Explicit proposed custodians for strategic or unlocated shared assets. */
  negotiatedCustodians: Readonly<Record<string, string>>;
}) {
  const { db, sourceCountryId, currentYear, now } = input;
  const availableFromYear = earliestFederationDecisionYear("1991-default", sourceCountryId);
  if (availableFromYear === null || currentYear < availableFromYear)
    throw new Error("Federation proposal is not yet available");
  const assignments: Record<string, string> = DEFAULT_TERRITORY[sourceCountryId];
  const participants = defaultFederationParticipants(sourceCountryId);
  const inventory = await loadLiveSuccessionInventory(db, sourceCountryId);
  const territories = planSuccessionTerritories(inventory.sourceRegions, participants, assignments);
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
      successors: participants.map((id) => getWorldEntityOrThrow("1991-default", id)),
      territories,
      finances: planSuccessionFinances({
        settlementId,
        sourceEntityId: sourceCountryId,
        participants: territories.map(({ entityId, population }) => ({ entityId, population })),
        financialAssetsMinor: 0,
        creditorDebtMinor: 0,
      }),
      negotiatedCustodians: input.negotiatedCustodians,
      macroTerms: {},
      now,
    },
  });
}
