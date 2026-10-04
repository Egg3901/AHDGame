/**
 * Failed single-candidate constituencies admit new direct nominees under
 * Article73(3). Admission preserves the original first ballot and party lists;
 * ordinary top-two runoffs retain only their qualified people.
 */
import { BG_1990_CONSTITUENCIES } from "../data/foundingDistricts1990";
import type { BgFoundingBallots } from "./foundingBallots1990";
import type { BgFoundingCount } from "./foundingCount1990";
import { resolveBgFoundingFirstRound } from "./foundingMajority1990";
import {
  validateBgFoundingNominations,
  type BgFoundingNominations,
  type BgFoundingPerson,
} from "./foundingMandates1990";

export function bgFoundingOpenNominationDistricts(
  count: BgFoundingCount,
  ballots: BgFoundingBallots,
  regionId?: string
): string[] {
  const unresolved = new Set(count.unresolved);
  return ballots.constituencies
    .filter((row) => {
      if (!unresolved.has(row.id)) return false;
      const result = resolveBgFoundingFirstRound(row.first);
      return (
        result.kind === "runoff" &&
        result.allowNewNominations &&
        (!regionId ||
          BG_1990_CONSTITUENCIES.some(
            (district) => district.id === row.id && district.regionId === regionId
          ))
      );
    })
    .map((row) => row.id);
}

export function addBgFoundingRenewedNominee(input: {
  count: BgFoundingCount;
  first: BgFoundingBallots;
  nominations: BgFoundingNominations;
  person: BgFoundingPerson;
  constituencyId: string;
}): BgFoundingNominations {
  validateBgFoundingNominations(input.nominations);
  if (
    !bgFoundingOpenNominationDistricts(input.count, input.first, input.person.regionId).includes(
      input.constituencyId
    )
  )
    throw new Error("Bulgarian constituency does not admit renewed nominations");
  if (
    input.nominations.people.some(
      (person) =>
        person.id === input.person.id ||
        person.candidateId === input.person.candidateId ||
        (person.ownerId === input.person.ownerId && person.isNpc === input.person.isNpc)
    )
  )
    throw new Error("Bulgarian renewed nominee already belongs to the election");
  const result: BgFoundingNominations = {
    people: [...input.nominations.people, input.person],
    constituencies: input.nominations.constituencies.map((row) =>
      row.id === input.constituencyId
        ? { ...row, candidateIds: [...row.candidateIds, input.person.id] }
        : row
    ),
    lists: input.nominations.lists,
  };
  validateBgFoundingNominations(result);
  return result;
}

/** One existing NPC financial owner represents distinct direct-only people. */
export function addBgFoundingRenewedNpcSlate(input: {
  count: BgFoundingCount;
  first: BgFoundingBallots;
  nominations: BgFoundingNominations;
  owner: Omit<BgFoundingPerson, "id" | "isNpc">;
}): BgFoundingNominations {
  validateBgFoundingNominations(input.nominations);
  if (
    input.owner.partyId === "independent" ||
    input.nominations.people.some(
      (person) =>
        person.candidateId === input.owner.candidateId ||
        (person.isNpc && person.ownerId === input.owner.ownerId)
    )
  )
    throw new Error("Bulgarian renewed NPC slate reuses a filed financial owner");
  const open = new Set(
    bgFoundingOpenNominationDistricts(input.count, input.first, input.owner.regionId)
  );
  const people = new Map(input.nominations.people.map((person) => [person.id, person]));
  const eligible = input.nominations.constituencies.filter(
    (row) =>
      open.has(row.id) &&
      !row.candidateIds.some((id) => people.get(id)!.partyId === input.owner.partyId)
  );
  const additions = eligible.map((row) => ({
    ...input.owner,
    id: `${input.owner.candidateId}:renewed:${row.id}`,
    isNpc: true,
  }));
  const result: BgFoundingNominations = {
    people: [...input.nominations.people, ...additions],
    constituencies: input.nominations.constituencies.map((row) => {
      const added = additions.find(
        (person) => person.id === `${input.owner.candidateId}:renewed:${row.id}`
      );
      return added ? { ...row, candidateIds: [...row.candidateIds, added.id] } : row;
    }),
    lists: input.nominations.lists,
  };
  validateBgFoundingNominations(result);
  return result;
}
