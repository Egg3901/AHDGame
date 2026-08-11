/**
 * NPC composition: seat counts by party and majority/minority bloc.
 *
 * Mirrors `getBundestagComposition` (src/lib/congress/bundestagComposition.ts)
 * for the CN National People's Congress. Used by the NPC Standing Committee
 * Chairman election flow — eligibility, nominee/voter pool, majority-bloc
 * designation. The NPC is the lower (and only player-loop) chamber for CN; the
 * advisory CPPCC is intentionally out of scope here.
 *
 * Coalition logic uses `computeBlocsForCountry(db, "CN", ...)`.
 */
import type { Db } from "@/lib/mongodb";
import type { ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import { getPartyHex } from "@/lib/utils/politics";
import { computeBlocsForCountry, type Bloc } from "./blocs";

export interface NpcPartySeats {
  party: string;
  partyName: string;
  partyColor: string;
  seats: number;
}

export interface NpcComposition {
  composition: NpcPartySeats[];
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

export async function getNpcComposition(
  db: Db,
  partyMap: Map<string, PoliticalParty>
): Promise<NpcComposition> {
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({
      officeType: "npcDelegate",
      countryId: "CN",
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

  const composition: NpcPartySeats[] = [...tally.entries()]
    .filter(([party]) => party !== "__vacant__")
    .map(([party, v]) => ({ party, ...v }))
    .sort((a, b) => b.seats - a.seats);

  const totalSeats = composition.reduce((s, c) => s + c.seats, 0);
  const majorityParty = composition[0]?.party ?? null;

  const { blocs, majorityBloc, minorityBloc } = await computeBlocsForCountry(
    db,
    "CN",
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
