/**
 * Parliamentary-style bloc computation for chamber composition.
 *
 * A bloc is a coalition (all member parties' seats summed) or a single
 * unaffiliated party. The largest bloc is the "majority bloc"; its dominant
 * party drives Majority Leader/Whip eligibility (single-largest-party
 * policy), while Minority Leader/Whip exclude every party in the bloc
 * (non-coalition policy). Speaker, President Pro Tempore, and the DE
 * Bundestagspräsident are open to any seated chamber member (any-seated
 * policy) and do not key off bloc membership.
 *
 * Scope: US chamber leadership (House + Senate) and DE Bundestag. Other
 * countries have their own government-formation systems and do not use
 * this.
 */
import type { Db } from "@/lib/mongodb";
import type { PoliticalParty } from "@/lib/db/types";
import { getCoalitionsCollection } from "@/lib/db/collections/coalitions";
import type { CountryId } from "@/lib/constants/countries";

export interface PartySeatsEntry {
  party: string;
  partyName: string;
  partyColor: string;
  seats: number;
}

export interface Bloc {
  kind: "coalition" | "party";
  /** Coalition `_id` string, or party slug for unaffiliated parties. */
  id: string;
  displayName: string;
  displayColor: string;
  displayAbbreviation?: string;
  /** Party slugs whose seats count toward this bloc. Used for membership checks. */
  partySlugs: Set<string>;
  /** Combined seats across all member parties. */
  seats: number;
  /** Largest single party inside the bloc — the "face" of the bloc for NPP pickers
   * and fallback UI that still want a single party identifier. */
  dominantPartySlug: string;
  dominantPartySeats: number;
  /** If this bloc is a coalition, the sequentialId (useful for /parties/coalition/N URLs). */
  coalitionSequentialId?: number;
}

export interface BlocComposition {
  blocs: Bloc[];
  majorityBloc: Bloc | null;
  minorityBloc: Bloc | null;
}

/** Serialized bloc (Set → array) for wire transport / client state. */
export interface BlocDisplay {
  kind: "coalition" | "party";
  id: string;
  displayName: string;
  displayColor: string;
  displayAbbreviation?: string;
  partySlugs: string[];
  seats: number;
  dominantPartySlug: string;
  dominantPartySeats: number;
  coalitionSequentialId?: number;
}

export function serializeBloc(bloc: Bloc): BlocDisplay {
  return {
    kind: bloc.kind,
    id: bloc.id,
    displayName: bloc.displayName,
    displayColor: bloc.displayColor,
    displayAbbreviation: bloc.displayAbbreviation,
    partySlugs: [...bloc.partySlugs],
    seats: bloc.seats,
    dominantPartySlug: bloc.dominantPartySlug,
    dominantPartySeats: bloc.dominantPartySeats,
    coalitionSequentialId: bloc.coalitionSequentialId,
  };
}

export async function computeBlocsForCountry(
  db: Db,
  countryId: CountryId,
  partyTally: PartySeatsEntry[],
  partyMap: Map<string, PoliticalParty>
): Promise<BlocComposition> {
  if (partyTally.length === 0) {
    return { blocs: [], majorityBloc: null, minorityBloc: null };
  }

  const coalitions = await (await getCoalitionsCollection(db)).find({ countryId }).toArray();

  // Map each party's ObjectId → its coalition doc (if any).
  const partyIdToCoalition = new Map<string, (typeof coalitions)[number]>();
  for (const coalition of coalitions) {
    for (const member of coalition.members) {
      partyIdToCoalition.set(member.partyId.toString(), coalition);
    }
  }

  // Resolve each party slug → its ObjectId via partyMap, then → coalition.
  const coalitionBuckets = new Map<
    string, // coalition._id.toString()
    {
      coalition: (typeof coalitions)[number];
      parties: PartySeatsEntry[];
    }
  >();
  const standaloneParties: PartySeatsEntry[] = [];

  for (const entry of partyTally) {
    const party = partyMap.get(entry.party);
    const coalition = party ? partyIdToCoalition.get(party._id.toString()) : undefined;
    if (coalition) {
      const key = coalition._id.toString();
      const bucket = coalitionBuckets.get(key);
      if (bucket) {
        bucket.parties.push(entry);
      } else {
        coalitionBuckets.set(key, { coalition, parties: [entry] });
      }
    } else {
      standaloneParties.push(entry);
    }
  }

  const blocs: Bloc[] = [];

  for (const { coalition, parties } of coalitionBuckets.values()) {
    const seats = parties.reduce((sum, p) => sum + p.seats, 0);
    // Dominant party = largest single member inside this coalition.
    const dominant = [...parties].sort((a, b) => b.seats - a.seats)[0];
    blocs.push({
      kind: "coalition",
      id: coalition._id.toString(),
      displayName: coalition.name,
      displayColor: coalition.color,
      displayAbbreviation: coalition.abbreviation,
      partySlugs: new Set(parties.map((p) => p.party)),
      seats,
      dominantPartySlug: dominant.party,
      dominantPartySeats: dominant.seats,
      coalitionSequentialId: coalition.sequentialId,
    });
  }

  for (const entry of standaloneParties) {
    blocs.push({
      kind: "party",
      id: entry.party,
      displayName: entry.partyName,
      displayColor: entry.partyColor,
      partySlugs: new Set([entry.party]),
      seats: entry.seats,
      dominantPartySlug: entry.party,
      dominantPartySeats: entry.seats,
    });
  }

  blocs.sort((a, b) => b.seats - a.seats);

  return {
    blocs,
    majorityBloc: blocs[0] ?? null,
    minorityBloc: blocs[1] ?? null,
  };
}
