/**
 * Grand Assembly constituency vacancies require a fresh individual ballot.
 * Partial elections need a month's notice, retain the original term and
 * cannot be newly scheduled in its last six months. List awards stay frozen.
 */
import { BG_1990_CONSTITUENCIES, BG_1990_LIST_DISTRICTS } from "../data/foundingDistricts1990";
import {
  resolveBgFoundingFirstRound,
  resolveBgFoundingRunoff,
  type BgFoundingMajorityBallot,
} from "./foundingMajority1990";

export function bgGrandAssemblyAllowsPartialElection(
  input: {
    dissolvedTurn?: number;
    bgOrdinaryAssemblySinceTurn?: number;
    bgGrandAssemblyDissolutionSinceTurn?: number;
    bgConstitution1991SinceTurn?: number;
    bgGrandAssemblyContinuationSinceTurn?: number;
  } | null
): boolean {
  return (
    !!input &&
    input.dissolvedTurn == null &&
    input.bgOrdinaryAssemblySinceTurn == null &&
    input.bgGrandAssemblyDissolutionSinceTurn == null &&
    (input.bgConstitution1991SinceTurn == null ||
      input.bgGrandAssemblyContinuationSinceTurn != null)
  );
}

export function bgGrandPartialOwnerEligible(input: {
  ownerExists: boolean;
  ownerParty?: string;
  candidateParty: string;
  officeType?: string | null;
  retired?: boolean;
  technocrat?: boolean;
  pendingRelocation?: boolean;
  isNpc: boolean;
  heldPlayerMandates: number;
}): boolean {
  return (
    input.ownerExists &&
    input.ownerParty === input.candidateParty &&
    !input.retired &&
    !input.technocrat &&
    !input.pendingRelocation &&
    (!input.officeType || ["assemblyDeputy", "primeMinister"].includes(input.officeType)) &&
    (input.isNpc || input.heldPlayerMandates === 0)
  );
}

export function bgGrandPartialElectionSchedule(input: {
  turn: number;
  vacancyObservedTurn: number;
  termEndTurn: number;
  firstPollTurn?: number;
}) {
  if (
    [input.turn, input.vacancyObservedTurn, input.termEndTurn].some(
      (value) => !Number.isSafeInteger(value) || value < 0
    ) ||
    input.vacancyObservedTurn > input.turn
  )
    throw new Error("Invalid Bulgarian partial-election clock");
  // Article80 bars scheduling, rather than polling, in the final six months.
  if (input.turn >= input.termEndTurn - 24) return null;
  const endTurn = input.firstPollTurn ?? input.turn + 4;
  if (!Number.isSafeInteger(endTurn) || endTurn < input.turn + 4 || endTurn >= input.termEndTurn)
    throw new Error(
      "Bulgarian partial election needs at least one month of notice within the original term"
    );
  return {
    startTurn: input.turn,
    primaryEndTurn: endTurn - 3,
    endTurn,
    scheduleDeadlineTurn: input.vacancyObservedTurn + 8,
    overdue: input.turn > input.vacancyObservedTurn + 8,
  };
}

export function bgGrandConstituencyRegister(districtId: string, regionalRegister: number): number {
  const district = BG_1990_CONSTITUENCIES.find((row) => row.id === districtId);
  if (!district || !Number.isSafeInteger(regionalRegister) || regionalRegister < 1)
    throw new Error("Invalid Bulgarian partial-election register");
  const areas = BG_1990_LIST_DISTRICTS.filter((row) => row.regionId === district.regionId);
  const area = areas.find((row) => row.id === district.listDistrictId)!;
  const total = areas.reduce((sum, row) => sum + row.population, 0);
  const divisions = BG_1990_CONSTITUENCIES.filter((row) => row.listDistrictId === area.id).length;
  const register = Number(
    (BigInt(regionalRegister) * BigInt(area.population)) / (BigInt(total) * BigInt(divisions))
  );
  if (register < 1) throw new Error("Bulgarian partial-election register is empty");
  return register;
}

export function countBgGrandPartialElection(input: {
  districtId: string;
  first: BgFoundingMajorityBallot;
  second?: BgFoundingMajorityBallot;
}) {
  if (!BG_1990_CONSTITUENCIES.some((row) => row.id === input.districtId))
    throw new Error("Unknown Bulgarian partial-election constituency");
  return input.second
    ? resolveBgFoundingRunoff(input.first, input.second)
    : resolveBgFoundingFirstRound(input.first);
}

/** Party actors supply one nominee per district; each independent actor files once. */
export function planBgGrandPartialNpcNominees(input: {
  districtIds: readonly string[];
  registeredPartyIds: ReadonlySet<string>;
  owners: readonly {
    ownerId: string;
    partyId: string;
    regionId: string;
    officeType?: string | null;
  }[];
}) {
  if (
    new Set(input.districtIds).size !== input.districtIds.length ||
    input.districtIds.some((id) => !BG_1990_CONSTITUENCIES.some((row) => row.id === id))
  )
    throw new Error("Invalid Bulgarian partial nomination districts");
  const result: Array<{ districtId: string; ownerId: string; partyId: string }> = [];
  const slots = new Set<string>(),
    ownerIds = new Set<string>();
  for (const owner of [...input.owners].sort((a, b) => a.ownerId.localeCompare(b.ownerId))) {
    if (!owner.ownerId || ownerIds.has(owner.ownerId))
      throw new Error("Duplicate Bulgarian partial financial owner");
    ownerIds.add(owner.ownerId);
    if (
      !bgGrandPartialOwnerEligible({
        ownerExists: true,
        ownerParty: owner.partyId,
        candidateParty: owner.partyId,
        officeType: owner.officeType,
        isNpc: true,
        heldPlayerMandates: 0,
      }) ||
      (owner.partyId !== "independent" && !input.registeredPartyIds.has(owner.partyId))
    )
      continue;
    const districts = input.districtIds
      .filter(
        (id) => BG_1990_CONSTITUENCIES.find((row) => row.id === id)!.regionId === owner.regionId
      )
      .sort();
    for (const districtId of owner.partyId === "independent" ? districts.slice(0, 1) : districts) {
      const key = `${districtId}:${owner.partyId}`;
      if (owner.partyId !== "independent" && slots.has(key)) continue;
      slots.add(key);
      result.push({ districtId, ownerId: owner.ownerId, partyId: owner.partyId });
    }
  }
  return result;
}
