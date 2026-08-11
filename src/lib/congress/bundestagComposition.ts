/**
 * Bundestag composition: seat counts by party and majority/minority bloc.
 *
 * Mirrors `getHouseComposition` (src/lib/congress/houseComposition.ts) for the
 * DE Bundestag. Used by the Bundestagspräsident election flow — eligibility,
 * nominee/voter pool, majority-bloc designation — and by any future Bundestag
 * leadership UI that wants the same shape the US Congress UI consumes.
 *
 * Coalition logic uses `computeBlocsForCountry(db, "DE", ...)`. The
 * Bundestag is the lower (and only player-loop) chamber for DE; bicameral
 * Bundesrat lookups are intentionally out of scope here.
 */
import type { Db } from "@/lib/mongodb";
import type { ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import { getPartyHex } from "@/lib/utils/politics";
import { computeBlocsForCountry, type Bloc } from "./blocs";

export interface BundestagPartySeats {
  party: string;
  partyName: string;
  partyColor: string;
  seats: number;
}

export interface BundestagComposition {
  composition: BundestagPartySeats[];
  totalSeats: number;
  /** Ordered blocs (coalitions + unaffiliated parties), largest first. */
  blocs: Bloc[];
  majorityBloc: Bloc | null;
  minorityBloc: Bloc | null;
  /** Largest single-party slug across the chamber. */
  majorityParty: string | null;
  /** Dominant party slug inside the minority bloc. */
  minorityParty: string | null;
  /** Majority bloc total seats (sum across coalition members, if applicable). */
  majoritySeats: number;
  /** Minority bloc total seats. */
  minoritySeats: number;
}

export async function getBundestagComposition(
  db: Db,
  partyMap: Map<string, PoliticalParty>
): Promise<BundestagComposition> {
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({
      officeType: "bundestag",
      countryId: "DE",
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

  const composition: BundestagPartySeats[] = [...tally.entries()]
    .filter(([party]) => party !== "__vacant__")
    .map(([party, v]) => ({ party, ...v }))
    .sort((a, b) => b.seats - a.seats);

  const totalSeats = composition.reduce((s, c) => s + c.seats, 0);
  const majorityParty = composition[0]?.party ?? null;

  const { blocs, majorityBloc, minorityBloc } = await computeBlocsForCountry(
    db,
    "DE",
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
