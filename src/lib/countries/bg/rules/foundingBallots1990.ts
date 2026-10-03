/**
 * Regional campaigns project onto two separate founding ballots. Population
 * weights freeze district registers; runoffs use renewed constituency support
 * while retaining first-round list votes and the original electoral register.
 */
import { BG_1990_CONSTITUENCIES, BG_1990_LIST_DISTRICTS } from "../data/foundingDistricts1990";
import { validateBgFoundingNominations, type BgFoundingNominations } from "./foundingMandates1990";
import {
  resolveBgFoundingFirstRound,
  resolveBgFoundingRunoff,
  type BgFoundingMajorityBallot,
} from "./foundingMajority1990";
import type { BgFoundingListBallot } from "./foundingLists1990";

export interface BgFoundingRegionalCampaign {
  regionId: string;
  registeredVoters: number;
  candidates: readonly { candidateId: string; votes: number; listVotes?: number }[];
}
export interface BgFoundingBallots {
  constituencies: readonly {
    id: string;
    first: BgFoundingMajorityBallot;
    second?: BgFoundingMajorityBallot;
  }[];
  lists: readonly BgFoundingListBallot[];
}

/** Exact Hamilton shares, bounded by each ballot's remaining register. */
function split(
  total: number,
  weights: readonly { id: string; weight: number }[],
  capacity?: Readonly<Record<string, number>>
) {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    new Set(weights.map((row) => row.id)).size !== weights.length ||
    weights.some(
      (row) =>
        !row.id ||
        !Number.isSafeInteger(row.weight) ||
        row.weight < 0 ||
        (capacity && (!Number.isSafeInteger(capacity[row.id]) || capacity[row.id] < 0))
    )
  )
    throw new Error("Invalid Bulgarian founding ballot apportionment");
  const result = Object.fromEntries(weights.map((row) => [row.id, 0]));
  let remaining = total;
  while (remaining > 0) {
    const available = weights.filter(
      (row) => row.weight > 0 && (!capacity || result[row.id] < capacity[row.id])
    );
    const sum = available.reduce((value, row) => value + BigInt(row.weight), BigInt(0));
    if (sum === BigInt(0))
      throw new Error("Bulgarian founding support has no available ballot capacity");
    const shares = available.map((row) => {
      const numerator = BigInt(remaining) * BigInt(row.weight);
      return { id: row.id, count: Number(numerator / sum), remainder: numerator % sum };
    });
    const spare = remaining - shares.reduce((value, row) => value + row.count, 0);
    shares.sort((a, b) =>
      a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1
    );
    for (const row of shares.slice(0, spare)) row.count++;
    let installed = 0;
    for (const row of shares) {
      const count = Math.min(row.count, capacity ? capacity[row.id] - result[row.id] : row.count);
      result[row.id] += count;
      installed += count;
    }
    if (!installed) throw new Error("Bulgarian founding apportionment cannot advance");
    remaining -= installed;
  }
  return result;
}

function campaignMaps(
  input: readonly BgFoundingRegionalCampaign[],
  nominations: BgFoundingNominations
) {
  validateBgFoundingNominations(nominations);
  const regions = new Set(BG_1990_LIST_DISTRICTS.map((row) => row.regionId));
  if (
    input.length !== 5 ||
    new Set(input.map((row) => row.regionId)).size !== 5 ||
    input.some((row) => !regions.has(row.regionId))
  )
    throw new Error("Bulgarian founding campaign needs all five regions");
  const candidates = new Map(nominations.people.map((row) => [row.candidateId, row]));
  const votes = new Map<string, number>(),
    listVotes = new Map<string, number>();
  const people = new Map(nominations.people.map((row) => [row.id, row]));
  for (const campaign of input) {
    if (!Number.isSafeInteger(campaign.registeredVoters) || campaign.registeredVoters < 1)
      throw new Error("Invalid Bulgarian founding regional register");
    let direct = BigInt(0),
      list = BigInt(0);
    for (const row of campaign.candidates) {
      const person = candidates.get(row.candidateId);
      const listCount = row.listVotes ?? (person?.partyId === "independent" ? 0 : row.votes);
      if (
        !person ||
        person.regionId !== campaign.regionId ||
        votes.has(row.candidateId) ||
        !Number.isSafeInteger(row.votes) ||
        row.votes < 0 ||
        !Number.isSafeInteger(listCount) ||
        listCount < 0 ||
        (person.partyId === "independent" && listCount > 0)
      )
        throw new Error("Invalid Bulgarian founding campaign support");
      votes.set(row.candidateId, row.votes);
      listVotes.set(row.candidateId, listCount);
      direct += BigInt(row.votes);
      list += BigInt(listCount);
    }
    if (direct > BigInt(campaign.registeredVoters) || list > BigInt(campaign.registeredVoters))
      throw new Error("Bulgarian founding turnout exceeds its frozen register");
  }
  return { candidates, people, votes, listVotes };
}

export function projectBgFoundingBallots(
  input: readonly BgFoundingRegionalCampaign[],
  nominations: BgFoundingNominations
): BgFoundingBallots {
  const maps = campaignMaps(input, nominations);
  const registered: Record<string, number> = {},
    turnout: Record<string, number> = {};
  const localListVotes: Record<string, Record<string, number>> = {};
  for (const campaign of input) {
    const areas = BG_1990_LIST_DISTRICTS.filter((row) => row.regionId === campaign.regionId);
    const weights = areas.map((row) => ({ id: row.id, weight: row.population }));
    const areaRegister = split(campaign.registeredVoters, weights);
    const registrationWeights = areas.map((row) => ({ id: row.id, weight: areaRegister[row.id] }));
    const total = campaign.candidates.reduce((value, row) => value + row.votes, 0);
    const areaTurnout = split(total, registrationWeights, areaRegister);
    const remaining = { ...areaRegister };
    const parties = new Map<string, number>();
    for (const row of campaign.candidates) {
      const party = maps.candidates.get(row.candidateId)!.partyId;
      if (party !== "independent")
        parties.set(party, (parties.get(party) ?? 0) + maps.listVotes.get(row.candidateId)!);
    }
    for (const area of areas) localListVotes[area.id] = {};
    for (const [party, support] of [...parties].sort(([a], [b]) => a.localeCompare(b))) {
      const filed = registrationWeights.filter((row) =>
        nominations.lists.some((list) => list.districtId === row.id && list.partyId === party)
      );
      const available = filed.reduce((value, row) => value + remaining[row.id], 0);
      // An absent local list cannot receive a list vote. Excess support remains
      // an abstention rather than inventing nominees or exceeding the register.
      const distributed = split(Math.min(support, available), filed, remaining);
      for (const row of filed) {
        localListVotes[row.id][party] = distributed[row.id];
        remaining[row.id] -= distributed[row.id];
      }
    }
    for (const area of areas) {
      const districts = BG_1990_CONSTITUENCIES.filter((row) => row.listDistrictId === area.id).map(
        (row) => ({ id: row.id, weight: 1 })
      );
      if (areaRegister[area.id] < districts.length)
        throw new Error("Bulgarian founding register is smaller than constituency count");
      Object.assign(registered, split(areaRegister[area.id], districts));
      Object.assign(turnout, split(areaTurnout[area.id], districts, registered));
    }
  }
  const constituencies = nominations.constituencies.map((district) => {
    const weights = district.candidateIds.map((id) => {
      const person = maps.people.get(id)!;
      const weight =
        person.partyId === "independent"
          ? (maps.votes.get(person.candidateId) ?? 0)
          : [...maps.candidates]
              .filter(
                ([, row]) => row.partyId === person.partyId && row.regionId === person.regionId
              )
              .reduce((value, [candidate]) => value + (maps.votes.get(candidate) ?? 0), 0);
      return { id, weight };
    });
    const cast = weights.some((row) => row.weight > 0) ? turnout[district.id] : 0;
    const counted = split(cast, weights);
    return {
      id: district.id,
      first: {
        registeredVoters: registered[district.id],
        ballotsCast: cast,
        invalidBallots: 0,
        options: district.candidateIds.map((id, index) => ({
          personId: id,
          votes: counted[id],
          tieOrder: index + 1,
        })),
      },
    };
  });
  const lists = BG_1990_LIST_DISTRICTS.map((area) => ({
    districtId: area.id,
    partyVotes: Object.fromEntries(
      nominations.lists
        .filter((list) => list.districtId === area.id)
        .map((list) => [list.partyId, localListVotes[area.id][list.partyId] ?? 0])
    ),
  }));
  return { constituencies, lists };
}

/** Real renewed campaign totals determine second-round turnout and support. */
export function projectBgFoundingRunoff(
  input: readonly BgFoundingRegionalCampaign[],
  nominations: BgFoundingNominations,
  first: BgFoundingBallots
): BgFoundingBallots {
  const maps = campaignMaps(input, nominations);
  const projected = projectBgFoundingBallots(input, nominations);
  const byDistrict = new Map(projected.constituencies.map((row) => [row.id, row.first]));
  return {
    lists: first.lists,
    constituencies: first.constituencies.map((row) => {
      if (row.second && resolveBgFoundingRunoff(row.first, row.second).kind === "elected")
        return row;
      const pending = resolveBgFoundingFirstRound(row.first);
      if (pending.kind !== "runoff") return row;
      const renewed = byDistrict.get(row.id);
      if (!renewed || renewed.registeredVoters !== row.first.registeredVoters)
        throw new Error("Bulgarian runoff changes the frozen constituency register");
      const originalOrder = new Map(
        row.first.options.map((option) => [option.personId, option.tieOrder])
      );
      const nextOrder = Math.max(0, ...originalOrder.values()) + 1;
      const nominees = nominations.constituencies.find((district) => district.id === row.id)!;
      const options = pending.allowNewNominations
        ? nominees.candidateIds.map((personId, index) => ({
            personId,
            tieOrder: originalOrder.get(personId) ?? nextOrder + index,
          }))
        : row.first.options.filter((option) => pending.personIds.includes(option.personId));
      const weights = options.map((option) => {
        const person = maps.people.get(option.personId)!;
        return {
          id: option.personId,
          weight:
            person.partyId === "independent"
              ? (maps.votes.get(person.candidateId) ?? 0)
              : [...maps.candidates]
                  .filter(
                    ([, candidate]) =>
                      candidate.partyId === person.partyId && candidate.regionId === person.regionId
                  )
                  .reduce((value, [id]) => value + (maps.votes.get(id) ?? 0), 0),
        };
      });
      const cast = weights.some((option) => option.weight > 0) ? renewed.ballotsCast : 0;
      const counted = split(cast, weights);
      return {
        ...row,
        second: {
          registeredVoters: row.first.registeredVoters,
          ballotsCast: cast,
          invalidBallots: 0,
          options: weights.map((option) => ({
            personId: option.id,
            votes: counted[option.id],
            tieOrder: options.find((prior) => prior.personId === option.id)!.tieOrder,
          })),
        },
      };
    }),
  };
}
