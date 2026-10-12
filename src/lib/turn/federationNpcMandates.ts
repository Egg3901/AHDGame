import type { Db } from "mongodb";
import type { ElectedOfficial } from "@/lib/db/types/officials";
import {
  getLowerChamberOfficeType,
  getUpperChamberOfficeType,
} from "@/lib/legislature/chamberOfficeType";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { earliestFederationDecisionYear } from "@/lib/world/succession/availability";
import { openDefaultFederationPoliticalProposal } from "@/lib/world/succession/defaultProposal";
import {
  FEDERATION_POLITICAL_PROPOSALS_COLLECTION,
  type FederationPoliticalProposalRecord,
} from "@/lib/world/succession/politicalProposal";
import {
  FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION,
  type FederationSettlementApplicationRecord,
} from "@/lib/world/succession/runtimeEntities";

const SOURCES = ["CS", "YU"] as const;

/** An NPC legislature opens one rejectable mandate after its historical
 * decision window. A player-held government or chamber keeps the choice in
 * player hands. The bill and subsequent successor consent decide the result. */
export async function processFederationNpcMandates(
  db: Db,
  preset: string | undefined,
  currentYear: number,
  now: Date
): Promise<number> {
  if (preset !== "1991-default") return 0;
  if (!Number.isSafeInteger(currentYear) || !Number.isFinite(now.getTime()))
    throw new Error("Federation NPC mandate needs a valid year and time");
  // The proposal checks eligibility against the STORED world year. On the turn
  // the year rolls over, the year this phase is handed can run ahead of it, so
  // judge eligibility on the stored year too; otherwise the proposal throws
  // and takes the whole government formation phase down with it.
  const stored = await db
    .collection<{ _id: string; currentYear?: number }>("gameState")
    .findOne({ _id: "current" }, { projection: { currentYear: 1 } });
  const year = Number.isSafeInteger(stored?.currentYear)
    ? (stored?.currentYear as number)
    : currentYear;
  const eligible = SOURCES.filter((source) => {
    const from = earliestFederationDecisionYear(preset, source);
    return from !== null && year >= from;
  });
  if (eligible.length === 0) return 0;
  const [proposals, applications, officials, governments] = await Promise.all([
    db
      .collection<FederationPoliticalProposalRecord>(FEDERATION_POLITICAL_PROPOSALS_COLLECTION)
      .find(
        { presetId: "1991-default", sourceEntityId: { $in: eligible } },
        { projection: { sourceEntityId: 1 } }
      )
      .toArray(),
    db
      .collection<FederationSettlementApplicationRecord>(
        FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION
      )
      .find(
        { presetId: "1991-default", sourceEntityId: { $in: eligible }, status: "applied" },
        { projection: { sourceEntityId: 1 } }
      )
      .toArray(),
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find(
        { countryId: { $in: eligible } },
        { projection: { countryId: 1, officeType: 1, characterId: 1, nppId: 1 } }
      )
      .toArray(),
    getGovernmentFormationsCollection(db)
      .find(
        { _id: { $in: eligible } },
        { projection: { _id: 1, pmCharacterId: 1, pmNppId: 1, status: 1 } }
      )
      .toArray(),
  ]);
  const occupied = new Set([
    ...proposals.map((proposal) => proposal.sourceEntityId),
    ...applications.map((application) => application.sourceEntityId),
  ]);
  let opened = 0;
  for (const source of eligible) {
    if (occupied.has(source)) continue;
    const lowerOffice = getLowerChamberOfficeType(source, "1991-default");
    const upperOffice = getUpperChamberOfficeType(source, "1991-default");
    const legislatureOffices = new Set([lowerOffice, upperOffice].filter(Boolean));
    const federalOfficials = officials.filter(
      (official) => official.countryId === source && legislatureOffices.has(official.officeType)
    );
    const government = governments.find((formation) => formation._id === source);
    if (
      (government &&
        (government.status !== "formed" || government.pmCharacterId || !government.pmNppId)) ||
      federalOfficials.some((official) => official.characterId) ||
      !federalOfficials.some((official) => official.officeType === lowerOffice && official.nppId)
    )
      continue;
    try {
      await openDefaultFederationPoliticalProposal({
        db,
        sourceCountryId: source,
        currentYear: year,
        now,
      });
      opened += 1;
    } catch (error) {
      // One country's mandate must not fail government formation for every
      // country; it is retried next turn.
      console.warn(`[federationNpcMandates] ${source}: mandate not opened`, error);
    }
  }
  return opened;
}
