import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { NATIONAL_TERMINAL_STATUSES } from "@/lib/congress/billProposalLimits";
import type { Bill, BillChamber, BillStatus, ElectedOfficial, NPP } from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { Tariff } from "@/lib/db/types/tariff";
import { getLowerChamberOfficeType } from "@/lib/legislature/chamberOfficeType";
import { buildActiveNationalBillFilter } from "@/lib/legislature/nationalBillScope";
import { NPP_BILL_VOTING_DURATION_HOURS } from "./constants";

export type NppTradeBillIntent = "raise_tariff" | "lower_tariff";

export type ProposeNppTradeBillResult =
  { ok: true; billId: string } | { ok: false; reason: string };

/**
 * Put one autonomous trade-policy intent through the country's ordinary
 * national legislature. The government chooses the intent, but a seated NPP
 * from its governing party remains the bill sponsor and every normal chamber,
 * vote, executive-action, and enactment rule still applies.
 */
export async function proposeNppForeignPolicyBill(
  db: Db,
  countryId: CountryId,
  head: NPP,
  intent: NppTradeBillIntent,
  targetCountryId: CountryId,
  currentTurn: number,
  now: Date
): Promise<ProposeNppTradeBillResult> {
  if (countryId === targetCountryId) {
    return { ok: false, reason: "A country cannot tariff itself." };
  }

  const [gameState, government] = await Promise.all([
    db.collection<{ _id: string; preset?: string }>("gameState").findOne({ _id: "current" }),
    db.collection<GovernmentFormation>("governmentFormations").findOne({ _id: countryId }),
  ]);
  if (!government || government.status !== "formed") {
    return { ok: false, reason: "No formed government can introduce the trade bill." };
  }

  const lowerOfficeType = getLowerChamberOfficeType(countryId, gameState?.preset);
  const official = await db.collection<ElectedOfficial>("electedOfficials").findOne(
    {
      countryId,
      officeType: lowerOfficeType,
      nppId: { $exists: true },
      ...(government.governingPartyId ? { party: government.governingPartyId } : {}),
    },
    { sort: { seatsHeld: -1, _id: 1 } }
  );
  if (!official?.nppId) {
    return { ok: false, reason: "The governing party has no seated NPP bill sponsor." };
  }
  const sponsor = await db.collection<NPP>("npps").findOne({ _id: official.nppId });
  if (!sponsor) {
    return { ok: false, reason: "The selected legislative sponsor no longer exists." };
  }

  const existingBill = await db.collection<Bill>("bills").findOne({
    ...buildActiveNationalBillFilter(countryId, NATIONAL_TERMINAL_STATUSES as BillStatus[]),
    "provisions.type": "tariff",
    "provisions.scopeType": "origin_country",
    "provisions.targetOriginCountryId": targetCountryId,
  });
  if (existingBill) {
    return { ok: false, reason: "A targeted tariff bill is already before the legislature." };
  }

  const currentTariff = await db.collection<Tariff>("tariffs").findOne({
    countryId,
    scopeType: "origin_country",
    targetOriginCountryId: targetCountryId,
  });
  const rate = intent === "raise_tariff" ? Math.max(15, currentTariff?.rate ?? 0) : 0;
  if (intent === "lower_tariff" && !(currentTariff && currentTariff.rate > 0)) {
    return { ok: false, reason: "No active targeted tariff needs to be lowered." };
  }

  const config = getCountryConfig(countryId, gameState?.preset);
  const chamber = config.legislature.lowerChamber.key as BillChamber;
  const targetName = COUNTRY_CONFIGS[targetCountryId]?.name ?? targetCountryId;
  const votingEndsAt = new Date(now.getTime() + NPP_BILL_VOTING_DURATION_HOURS * 60 * 60 * 1000);
  const bill: Omit<Bill, "_id"> = {
    countryId,
    stateId: getNationalDocId(countryId) ?? `${countryId.toLowerCase()}_national`,
    title:
      intent === "raise_tariff"
        ? `Targeted Tariff on Imports from ${targetName}`
        : `Tariff Normalization with ${targetName}`,
    summary:
      intent === "raise_tariff"
        ? `${head.name}'s government proposes a ${rate}% tariff on imports from ${targetName}.`
        : `${head.name}'s government proposes ending the targeted tariff on imports from ${targetName}.`,
    category: "trade",
    provisions: [
      {
        type: "tariff",
        scopeType: "origin_country",
        targetOriginCountryId: targetCountryId,
        rate,
      },
    ],
    originChamber: chamber,
    currentChamber: chamber,
    sponsorId: sponsor._id,
    sponsorName: sponsor.name,
    sponsorParty: sponsor.party,
    nppSponsored: true,
    status: "active",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    proposedAt: now,
    proposedTurn: currentTurn,
    votingStartedAt: now,
    votingEndsAt,
    votingEndsOnTurn: currentTurn + NPP_BILL_VOTING_DURATION_HOURS,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const result = await db.collection<Omit<Bill, "_id">>("bills").insertOne(bill);
    return { ok: true, billId: result.insertedId.toString() };
  } catch (error) {
    return {
      ok: false,
      reason: `Trade bill insert failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
