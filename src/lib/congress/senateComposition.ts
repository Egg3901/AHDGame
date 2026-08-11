/**
 * Senate composition: seat counts by party and majority/minority bloc designation.
 * A "bloc" is a coalition (member parties' seats summed) or a single unaffiliated party.
 * Used for Pro Tempore bloc eligibility, Majority Leader largest-party eligibility,
 * Minority Leader opposition eligibility, and Congress UI.
 */
import type { Db } from "@/lib/mongodb";
import type { ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import { getPartyHex } from "@/lib/utils/politics";
import { computeBlocsForCountry, type Bloc } from "./blocs";

export interface PartySeats {
  party: string;
  partyName: string;
  partyColor: string;
  seats: number;
}

export interface SenateComposition {
  composition: PartySeats[];
  totalSeats: number;
  blocs: Bloc[];
  majorityBloc: Bloc | null;
  minorityBloc: Bloc | null;
  /** Chamber-wide largest party slug (used for Senate Majority Leader eligibility). */
  majorityParty: string | null;
  minorityParty: string | null;
  majoritySeats: number;
  minoritySeats: number;
}

export async function getSenateComposition(
  db: Db,
  partyMap: Map<string, PoliticalParty>
): Promise<SenateComposition> {
  // Scope to the US Senate — an unscoped officeType query folds other countries'
  // senators (and their parties) into the US tally (#898 cross-country leak).
  // Blocs/partyMap here are already US-only.
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({
      countryId: "US",
      officeType: "senate",
      $or: [{ characterId: { $ne: null } }, { isNPP: true }],
    })
    .toArray();

  const tally = new Map<string, { partyName: string; partyColor: string; seats: number }>();
  for (const o of officials) {
    const partySlug = o.party ?? "independent";
    const seats = 1; // each Senator holds 1 seat
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

  const composition: PartySeats[] = [...tally.entries()]
    .filter(([party]) => party !== "__vacant__")
    .map(([party, v]) => ({ party, ...v }))
    .sort((a, b) => b.seats - a.seats);

  const totalSeats = composition.reduce((s, c) => s + c.seats, 0);
  const majorityParty = composition[0]?.party ?? null;

  const { blocs, majorityBloc, minorityBloc } = await computeBlocsForCountry(
    db,
    "US",
    composition,
    partyMap
  );

  return {
    composition,
    totalSeats,
    blocs,
    majorityBloc,
    minorityBloc,
    majorityParty,
    minorityParty: minorityBloc?.dominantPartySlug ?? null,
    majoritySeats: majorityBloc?.seats ?? 0,
    minoritySeats: minorityBloc?.seats ?? 0,
  };
}
