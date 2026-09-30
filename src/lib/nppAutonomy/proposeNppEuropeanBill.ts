/**
 * National European bills use seated sponsors and ordinary chamber votes.
 * Existing sponsorship limits apply; duplicate or recently attempted decisions
 * do not create another bill. No treaty consent is written by this command.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type {
  Bill,
  BillChamber,
  BillStatus,
  ElectedOfficial,
  NPP,
  PoliticalParty,
} from "@/lib/db/types";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import {
  getChamberKeyForOfficeType,
  getLowerChamberOfficeType,
} from "@/lib/legislature/chamberOfficeType";
import { buildActiveNationalBillFilter } from "@/lib/legislature/nationalBillScope";
import { NATIONAL_TERMINAL_STATUSES } from "@/lib/congress/billProposalLimits";
import { validateBillProvisions } from "@/lib/congress/billProposal";
import { getCountryState } from "@/lib/countryState";
import { isBannedParty } from "@/lib/turn/onePartyConstraints";
import { NPP_BILL_VOTING_DURATION_HOURS } from "./constants";
import type { NationalEuropeanDecision } from "@/lib/internationalOrganizations/europeanIntegration/rules/nationalDecisions";

export async function proposeNppEuropeanBill(
  db: Db,
  countryId: CountryId,
  npp: Pick<NPP, "_id" | "name" | "party">,
  official: Pick<ElectedOfficial, "countryId" | "nppId" | "officeType">,
  decision: NationalEuropeanDecision,
  currentTurn: number,
  now: Date
): Promise<boolean> {
  if (
    official.countryId !== countryId ||
    String(official.nppId) !== String(npp._id) ||
    official.officeType !== getLowerChamberOfficeType(countryId)
  )
    return false;
  const runtime = await getCountryState(db, countryId);
  if (runtime.governmentType === "onePartyState" && npp.party) {
    const party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ countryId, sequentialId: Number(npp.party) });
    if (isBannedParty({ governmentType: runtime.governmentType }, party)) return false;
  }
  const provision: NonNullable<Bill["provisions"]>[number] =
    decision.kind === "maastricht"
      ? { type: "european_treaty", treaty: "maastricht", action: decision.action }
      : { type: "euro_adoption" };
  const category = decision.kind === "euro" ? "economy" : "foreign policy";
  const validation = await validateBillProvisions(db, [provision], category, countryId);
  if (!validation.ok) return false;
  const activeScope = buildActiveNationalBillFilter(
    countryId,
    NATIONAL_TERMINAL_STATUSES as BillStatus[]
  );
  const existing = await db.collection<Bill>("bills").findOne(
    {
      "provisions.type": provision.type,
      $or: [activeScope, { countryId, proposedTurn: { $gte: currentTurn - 48 } }],
    },
    { projection: { _id: 1 } }
  );
  if (existing) return false;
  const chamber = getChamberKeyForOfficeType(countryId, official.officeType) as BillChamber;
  if (!chamber) return false;
  const duration = NPP_BILL_VOTING_DURATION_HOURS;
  const bill: Omit<Bill, "_id"> = {
    countryId,
    stateId: getNationalDocId(countryId) ?? `${countryId.toLowerCase()}_national`,
    title:
      decision.kind === "euro"
        ? "Euro Accession Authorization"
        : decision.action === "ratify"
          ? "Maastricht Treaty Ratification"
          : "Maastricht Treaty Rejection",
    summary: decision.reasons.join(" "),
    category,
    provisions: [provision],
    originChamber: chamber,
    currentChamber: chamber,
    sponsorId: npp._id,
    sponsorName: npp.name,
    sponsorParty: npp.party ?? undefined,
    nppSponsored: true,
    status: "active",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    proposedAt: now,
    proposedTurn: currentTurn,
    votingStartedAt: now,
    votingEndsAt: new Date(now.getTime() + duration * 60 * 60 * 1000),
    votingEndsOnTurn: currentTurn + duration,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection<Omit<Bill, "_id">>("bills").insertOne(bill);
  return true;
}
