/**
 * Create the two concurrent consent bills for a passed NI reunification
 * referendum — one in each parliament:
 *   - a Westminster (Commons) bill for the UK to RELEASE Northern Ireland, and
 *   - a Dáil bill for Ireland to ADMIT Northern Ireland.
 *
 * Both are real, procedural (provision-less) national bills voted on through the
 * normal bill lifecycle (the unified engine, per-country config for UK and IE).
 * The region only transfers if BOTH pass within the conversion window — the
 * North's referendum plus both legislatures' consent.
 */
import { getNationalDocId } from "@/lib/constants/nationalScope";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Bill } from "@/lib/db/types";
import type { Referendum } from "@/lib/db/types/referendum";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { CONVERSION_WINDOW_TURNS } from "@/lib/constants/referendum";

/** Display-only votingEndsAt offset; turn-based resolution uses votingEndsOnTurn. */
const APPROX_TURN_MS = 3_600_000;

async function createConsentBill(
  db: Db,
  args: {
    countryId: CountryId;
    title: string;
    summary: string;
    sponsorName: string;
    currentTurn: number;
    category?: string;
  }
): Promise<ObjectId> {
  const now = new Date();
  const chamberKey = getCountryConfig(args.countryId).legislature.lowerChamber.key;
  const billId = new ObjectId();
  const bill = {
    _id: billId,
    countryId: args.countryId,
    stateId: getNationalDocId(args.countryId) ?? `${args.countryId.toLowerCase()}_national`,
    title: args.title,
    summary: args.summary,
    originChamber: chamberKey,
    currentChamber: chamberKey,
    sponsorId: null,
    sponsorName: args.sponsorName,
    adminProposed: true,
    status: "active",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    category: args.category ?? "reunification",
    provisions: [],
    proposedAt: now,
    votingStartedAt: now,
    votingEndsAt: new Date(now.getTime() + CONVERSION_WINDOW_TURNS * APPROX_TURN_MS),
    votingEndsOnTurn: args.currentTurn + CONVERSION_WINDOW_TURNS,
    createdAt: now,
    updatedAt: now,
  } as unknown as Bill;
  await db.collection<Bill>("bills").insertOne(bill);
  return billId;
}

export async function createReunificationConsentBills(
  db: Db,
  ref: Referendum,
  currentTurn: number
): Promise<{ westminsterBillId: ObjectId; dailBillId: ObjectId }> {
  const fromCountry = ref.countryId; // UK (releasing)
  const toCountry = (ref.targetCountryId ?? "IE") as CountryId; // IE (admitting)

  const westminsterBillId = await createConsentBill(db, {
    countryId: fromCountry,
    title: "Northern Ireland (Reunification) Bill",
    summary:
      "A bill for the United Kingdom to release Northern Ireland following its reunification " +
      "referendum, so it may join the Republic of Ireland. The Commons must consent for the " +
      "union to take effect.",
    sponsorName: "His Majesty's Government",
    currentTurn,
  });

  const dailBillId = await createConsentBill(db, {
    countryId: toCountry,
    title: "Reunification with Northern Ireland",
    summary:
      "A bill to admit Northern Ireland into the Republic of Ireland following its reunification " +
      "referendum. The Dáil must consent for the union to take effect.",
    sponsorName: "Government of Ireland",
    currentTurn,
  });

  return { westminsterBillId, dailBillId };
}

/**
 * Create the SINGLE Westminster consent bill for a passed independence
 * referendum — the UK Commons must consent to release the region as a new
 * sovereign country. No counterpart bill (there is no admitting parliament).
 */
export async function createIndependenceConsentBill(
  db: Db,
  ref: Referendum,
  currentTurn: number
): Promise<{ westminsterBillId: ObjectId }> {
  const regionName = getCountryConfig(ref.regionId as CountryId)?.name ?? ref.regionId;
  const westminsterBillId = await createConsentBill(db, {
    countryId: ref.countryId, // UK (releasing)
    title: `${regionName} (Independence) Bill`,
    summary:
      `A bill for the United Kingdom to release ${regionName} as an independent sovereign ` +
      "country following its independence referendum. The Commons must consent for independence " +
      "to take effect.",
    sponsorName: "His Majesty's Government",
    currentTurn,
    category: "independence",
  });
  return { westminsterBillId };
}
