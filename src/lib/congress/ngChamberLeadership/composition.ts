/**
 * NG chamber composition: seat counts by party plus majority-bloc designation
 * for one chamber of the National Assembly (House of Representatives or
 * Senate). Mirrors `getBundestagComposition` but scoped to the NG chamber's
 * member officeType so the seated-member eligibility check ("any-seated") only
 * counts that chamber's parties. Used by the NG presiding-officer election
 * flow to build a `ChamberLeadershipContext`.
 */
import type { Db } from "@/lib/mongodb";
import type { ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import { getPartyHex } from "@/lib/utils/politics";
import { computeBlocsForCountry, type Bloc } from "@/lib/congress/blocs";

export interface NgChamberPartySeats {
  party: string;
  partyName: string;
  partyColor: string;
  seats: number;
}

export interface NgChamberComposition {
  composition: NgChamberPartySeats[];
  totalSeats: number;
  majorityBloc: Bloc | null;
  majorityParty: string | null;
}

export async function getNgChamberComposition(
  db: Db,
  partyMap: Map<string, PoliticalParty>,
  memberOfficeType: "house" | "senate"
): Promise<NgChamberComposition> {
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({
      officeType: memberOfficeType,
      countryId: "NG",
      $or: [{ characterId: { $ne: null } }, { isNPP: true }],
    })
    .toArray();

  const tally = new Map<string, { partyName: string; partyColor: string; seats: number }>();
  for (const o of officials) {
    const partySlug = o.party ?? "independent";
    const seats = o.seatsHeld ?? 1;
    const p = partyMap.get(partySlug);
    const existing = tally.get(partySlug);
    if (existing) {
      existing.seats += seats;
    } else {
      tally.set(partySlug, {
        partyName: p?.name ?? (partySlug === "independent" ? "Independent" : partySlug),
        partyColor: getPartyHex(partySlug, p?.color),
        seats,
      });
    }
  }

  const composition: NgChamberPartySeats[] = [...tally.entries()]
    .filter(([party]) => party !== "__vacant__")
    .map(([party, v]) => ({ party, ...v }))
    .sort((a, b) => b.seats - a.seats);

  const totalSeats = composition.reduce((s, c) => s + c.seats, 0);
  const majorityParty = composition[0]?.party ?? null;

  const { majorityBloc } = await computeBlocsForCountry(db, "NG", composition, partyMap);

  return { composition, totalSeats, majorityBloc, majorityParty };
}
