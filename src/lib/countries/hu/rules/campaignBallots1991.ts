/**
 * Hungarian campaign support reaches 176 constituency and 20 territorial
 * ballots from six regional campaigns. Each ballot has its frozen electorate;
 * projectHu1991Runoff preserves first-round votes and admits only qualifiers.
 */
import {
  HU_1991_CONSTITUENCIES,
  HU_1991_TERRITORIAL_DISTRICTS,
} from "../data/electoralDistricts1991";
import { validateHu1991Nominations, type Hu1991Nominations } from "./mandates1991";
import type { Hu1991MixedBallots, Hu1991MixedCount } from "./mixedElection1991";

export interface Hu1991RegionalCampaign {
  regionId: string;
  registeredVoters: number;
  /** Actual renewed campaign totals, not a manufactured second-round majority. */
  candidates: readonly { candidateId: string; votes: number }[];
}

/** Integer Hamilton shares with exact remainders and stable key ties. */
function split(
  total: number,
  weights: readonly { id: string; weight: number }[]
): Record<string, number> {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    new Set(weights.map((row) => row.id)).size !== weights.length ||
    weights.some((row) => !row.id || !Number.isSafeInteger(row.weight) || row.weight < 0)
  )
    throw new Error("Invalid Hungarian campaign apportionment");
  const sum = weights.reduce((s, row) => s + BigInt(row.weight), BigInt(0));
  if (sum === BigInt(0)) {
    if (total > 0) throw new Error("Hungarian ballot has no positive support");
    return Object.fromEntries(weights.map((row) => [row.id, 0]));
  }
  const rows = weights.map((row) => {
    const numerator = BigInt(total) * BigInt(row.weight);
    return { id: row.id, seats: Number(numerator / sum), remainder: numerator % sum };
  });
  const remaining = total - rows.reduce((s, row) => s + row.seats, 0);
  rows.sort((a, b) =>
    a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1
  );
  for (const row of rows.slice(0, remaining)) row.seats++;
  return Object.fromEntries(rows.map((row) => [row.id, row.seats]));
}
/** Preserve each support stream while respecting the frozen local electorate. */
function splitCapped(
  total: number,
  weights: readonly { id: string; weight: number }[],
  capacity: Readonly<Record<string, number>>
): Record<string, number> {
  if (
    weights.some((row) => !Number.isSafeInteger(capacity[row.id]) || capacity[row.id] < 0) ||
    weights.reduce((sum, row) => sum + BigInt(capacity[row.id]), BigInt(0)) < BigInt(total)
  )
    throw new Error("Hungarian support exceeds its frozen ballot capacity");
  const result = Object.fromEntries(weights.map((row) => [row.id, 0]));
  let remaining = total;
  while (remaining > 0) {
    const available = weights.filter((row) => row.weight > 0 && result[row.id] < capacity[row.id]);
    const shares = split(remaining, available);
    let installed = 0;
    for (const row of available) {
      const count = Math.min(shares[row.id], capacity[row.id] - result[row.id]);
      result[row.id] += count;
      installed += count;
    }
    if (installed === 0) throw new Error("Hungarian campaign allocation cannot make progress");
    remaining -= installed;
  }
  return result;
}
function campaignMaps(input: readonly Hu1991RegionalCampaign[], nominations: Hu1991Nominations) {
  validateHu1991Nominations(nominations);
  const regions = [...new Set(HU_1991_TERRITORIAL_DISTRICTS.map((row) => row.regionId))];
  if (
    input.length !== regions.length ||
    new Set(input.map((row) => row.regionId)).size !== regions.length ||
    input.some((row) => !regions.includes(row.regionId))
  )
    throw new Error("Hungarian campaign requires all six regions");
  const people = new Map(nominations.people.map((row) => [row.id, row]));
  const candidateMap = new Map(nominations.people.map((row) => [row.candidateId, row]));
  const campaigns = new Map(input.map((row) => [row.regionId, row]));
  const votes = new Map<string, number>(),
    totals = new Map<string, number>();
  for (const row of input) {
    if (!Number.isSafeInteger(row.registeredVoters) || row.registeredVoters < 1)
      throw new Error("Invalid Hungarian frozen regional electorate");
    let total = 0;
    for (const candidate of row.candidates) {
      if (
        votes.has(candidate.candidateId) ||
        candidateMap.get(candidate.candidateId)?.regionId !== row.regionId ||
        !Number.isSafeInteger(candidate.votes) ||
        candidate.votes < 0
      )
        throw new Error("Invalid or unknown Hungarian campaign tally");
      votes.set(candidate.candidateId, candidate.votes);
      total += candidate.votes;
      if (!Number.isSafeInteger(total)) throw new Error("Hungarian campaign vote total overflows");
    }
    if (total > row.registeredVoters)
      throw new Error("Hungarian campaign participation exceeds its electorate");
    totals.set(row.regionId, total);
  }
  return { campaigns, people, candidateMap, votes, totals };
}

/**
 * The bounded geography uses official county population and equal electorate
 * shares within each county. Party list and constituency support share the
 * regional campaign baseline, as in the game's existing mixed-election model.
 * A player has one personal district; NPC support belongs to their party slate.
 */
export function projectHu1991CampaignBallots(
  input: readonly Hu1991RegionalCampaign[],
  nominations: Hu1991Nominations
): Hu1991MixedBallots {
  const maps = campaignMaps(input, nominations);
  const registered: Record<string, number> = {},
    turnout: Record<string, number> = {};
  const countyPartyVotes: Record<string, Record<string, number>> = {};
  for (const [regionId, campaign] of maps.campaigns) {
    const counties = HU_1991_TERRITORIAL_DISTRICTS.filter((row) => row.regionId === regionId);
    const weights = counties.map((row) => ({ id: row.id, weight: row.population }));
    const countyRegister = split(campaign.registeredVoters, weights);
    const registrationWeights = counties.map((row) => ({
      id: row.id,
      weight: countyRegister[row.id],
    }));
    const countyTurnout = splitCapped(
      maps.totals.get(regionId)!,
      registrationWeights,
      countyRegister
    );
    const available = { ...countyRegister };
    const partyTotals: Record<string, number> = {};
    for (const [candidateId, person] of maps.candidateMap) {
      if (person.regionId !== regionId) continue;
      partyTotals[person.partyId] =
        (partyTotals[person.partyId] ?? 0) + (maps.votes.get(candidateId) ?? 0);
    }
    for (const county of counties) countyPartyVotes[county.id] = {};
    for (const partyId of Object.keys(partyTotals).sort()) {
      const shares = splitCapped(partyTotals[partyId], registrationWeights, available);
      for (const county of counties) {
        countyPartyVotes[county.id][partyId] = shares[county.id];
        available[county.id] -= shares[county.id];
      }
    }
    for (const county of counties) {
      if (countyRegister[county.id] < county.constituencySeats)
        throw new Error("Hungarian county electorate is smaller than its constituency count");
      registered[county.id] = countyRegister[county.id];
      turnout[county.id] = countyTurnout[county.id];
      const districts = HU_1991_CONSTITUENCIES.filter((row) => row.countyId === county.id).map(
        (row) => ({ id: row.id, weight: 1 })
      );
      Object.assign(registered, split(countyRegister[county.id], districts));
      Object.assign(turnout, splitCapped(countyTurnout[county.id], districts, registered));
    }
  }
  const constituencyMap = new Map(nominations.constituencies.map((row) => [row.id, row]));
  const constituency = HU_1991_CONSTITUENCIES.map((district) => {
    const filed = constituencyMap.get(district.id)!;
    const weights = filed.candidateIds.map((id) => {
      const person = maps.people.get(id)!;
      const weight =
        person.partyId === "independent"
          ? (maps.votes.get(person.candidateId) ?? 0)
          : [...maps.candidateMap]
              .filter(
                ([, row]) => row.partyId === person.partyId && row.regionId === district.regionId
              )
              .reduce((sum, [candidateId]) => sum + (maps.votes.get(candidateId) ?? 0), 0);
      return { id, weight };
    });
    const ballotsCast = weights.some((row) => row.weight > 0) ? turnout[district.id] : 0;
    const counted = split(ballotsCast, weights);
    return {
      id: district.id,
      first: {
        registeredVoters: registered[district.id],
        ballotsCast,
        candidates: filed.candidateIds.map((candidateId) => ({
          candidateId,
          partyId: maps.people.get(candidateId)!.partyId,
          votes: counted[candidateId],
        })),
      },
    };
  });
  const territorial = HU_1991_TERRITORIAL_DISTRICTS.map((county) => {
    const lists = nominations.territorial.find((row) => row.id === county.id)!.lists;
    const votes = countyPartyVotes[county.id];
    const ballotsCast = lists.reduce((sum, list) => sum + (votes[list.partyId] ?? 0), 0);
    // Support for an independent or an unfiled party list is not a list ballot.
    return {
      id: county.id,
      first: {
        registeredVoters: registered[county.id],
        ballotsCast,
        lists: lists.map((list, index) => ({
          partyId: list.partyId,
          ballotOrder: index + 1,
          votes: votes[list.partyId] ?? 0,
        })),
      },
    };
  });
  return {
    constituencies: constituency,
    ...(nominations.electoralLaw ? { electoralLaw: nominations.electoralLaw } : {}),
    territorial,
    nationalLists: nominations.national.map((row, index) => ({
      partyId: row.partyId,
      ballotOrder: index + 1,
    })),
  };
}

/** A new campaign counts only the statutory unresolved ballots in its second round. */
export function projectHu1991Runoff(
  first: Hu1991MixedBallots,
  pending: Extract<Hu1991MixedCount, { kind: "pending" }>,
  input: readonly Hu1991RegionalCampaign[],
  nominations: Hu1991Nominations
): Hu1991MixedBallots {
  const renewed = projectHu1991CampaignBallots(input, nominations);
  return {
    ...first,
    constituencies: first.constituencies.map((row) => {
      const qualifiers = pending.constituencyRunoffs[row.id];
      if (!qualifiers) return row;
      const updated = renewed.constituencies.find((ballot) => ballot.id === row.id)!.first;
      const weights = updated.candidates
        .filter((candidate) => qualifiers.includes(candidate.candidateId))
        .map((candidate) => ({ id: candidate.candidateId, weight: candidate.votes }));
      const ballotsCast = weights.some((candidate) => candidate.weight > 0)
        ? Math.min(updated.ballotsCast, row.first.registeredVoters)
        : 0;
      const counted = split(ballotsCast, weights);
      return {
        ...row,
        second: {
          registeredVoters: row.first.registeredVoters,
          ballotsCast,
          candidates: row.first.candidates
            .filter((candidate) => qualifiers.includes(candidate.candidateId))
            .map((candidate) => ({ ...candidate, votes: counted[candidate.candidateId] ?? 0 })),
        },
      };
    }),
    territorial: first.territorial.map((row) => {
      const repeat = pending.territorialRepeats?.includes(row.id) ?? false;
      if (!repeat && !pending.territorialRunoffs.includes(row.id)) return row;
      const updated = renewed.territorial.find((ballot) => ballot.id === row.id)!.first;
      const weights = row.first.lists.map((list) => ({
        id: list.partyId,
        weight: updated.lists.find((candidate) => candidate.partyId === list.partyId)?.votes ?? 0,
      }));
      const ballotsCast = weights.some((candidate) => candidate.weight > 0)
        ? Math.min(updated.ballotsCast, row.first.registeredVoters)
        : 0;
      const counted = split(ballotsCast, weights);
      const round = {
        registeredVoters: row.first.registeredVoters,
        ballotsCast,
        lists: row.first.lists.map((list) => ({ ...list, votes: counted[list.partyId] })),
      };
      if (repeat) return { ...row, repeats: [...(row.repeats ?? []), { first: round }] };
      if (row.repeats?.length)
        return {
          ...row,
          repeats: row.repeats.map((generation, index) =>
            index === row.repeats!.length - 1 ? { ...generation, second: round } : generation
          ),
        };
      return { ...row, second: round };
    }),
  };
}
