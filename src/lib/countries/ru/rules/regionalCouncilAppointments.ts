/**
 * Bounded regional appointments follow certified regional political support.
 * planRussianRegionalCouncilAppointments selects existing eligible NPC groups,
 * gives each subject distinct people and fixes regional terms without new accounts.
 */
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { RUSSIAN_COUNCIL_SUBJECTS_1993 } from "../data/councilSubjects1993";
import type { RussianCouncilRegionalAuthority } from "./councilComposition";
export interface RussianRegionalNpcProfile {
  ownerId: string;
  party: string;
  name: string;
  eligible: boolean;
}
export function planRussianRegionalCouncilAppointments(input: {
  turn: number;
  revision: number;
  termYears: number;
  votesByRegion: Readonly<Record<string, Readonly<Record<string, number>>>>;
  profiles: readonly RussianRegionalNpcProfile[];
}) {
  if (
    !Number.isSafeInteger(input.turn) ||
    input.turn < 1 ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 1 ||
    !Number.isSafeInteger(input.termYears) ||
    input.termYears < 1 ||
    input.termYears > 5
  )
    throw new Error("Regional appointments need bounded safe terms and revisions");
  const termEndTurn = input.turn + input.termYears * TURNS_PER_YEAR;
  if (!Number.isSafeInteger(termEndTurn))
    throw new Error("Regional authority term exceeds precision");
  if (
    new Set(input.profiles.map((row) => row.ownerId)).size !== input.profiles.length ||
    input.profiles.some(
      (row) => !row.ownerId || !row.party || !row.name || typeof row.eligible !== "boolean"
    )
  )
    throw new Error("Regional appointments need distinct existing named profile owners");
  const choices = new Map<string, { profile: RussianRegionalNpcProfile; votes: number }>();
  for (const region of new Set(RUSSIAN_COUNCIL_SUBJECTS_1993.map(([, , region]) => region))) {
    const votes = input.votesByRegion[region];
    if (!votes) return { kind: "wait" as const, reason: "missing-regional-vote" as const, region };
    if (Object.values(votes).some((value) => !Number.isSafeInteger(value) || value < 0))
      throw new Error("Regional appointments need valid certified vote counts");
    const candidates = input.profiles
      .filter((profile) => profile.eligible && (votes[profile.party] ?? 0) > 0)
      .sort(
        (a, b) =>
          (votes[b.party] ?? 0) - (votes[a.party] ?? 0) ||
          a.party.localeCompare(b.party) ||
          a.ownerId.localeCompare(b.ownerId)
      );
    if (!candidates.length)
      return { kind: "wait" as const, reason: "no-eligible-regional-nominee" as const, region };
    choices.set(region, { profile: candidates[0], votes: votes[candidates[0].party] });
  }
  const authorities: RussianCouncilRegionalAuthority[] = RUSSIAN_COUNCIL_SUBJECTS_1993.flatMap(
    ([id, subjectName, regionId]) =>
      (["executive", "legislative"] as const).map((branch) => {
        const { profile } = choices.get(regionId)!;
        return {
          subjectId: `RU-council-${id}`,
          regionId,
          branch,
          revision: input.revision,
          sinceTurn: input.turn,
          termEndTurn,
          head: {
            personId: `regional:${id}:${branch}:${input.revision}`,
            ownerId: profile.ownerId,
            isNpc: true,
            name: `${subjectName} ${branch === "executive" ? "executive head" : "legislative chair"}`,
            party: profile.party,
            eligible: true,
          },
        };
      })
  );
  return {
    kind: "appoint" as const,
    authorities,
    reason: "highest-regional-support-with-eligible-nominee" as const,
    termEndTurn,
  };
}
export function planRussianRegionalCouncilDelegates(input: {
  turn: number;
  authorities: readonly RussianCouncilRegionalAuthority[];
  profiles: readonly RussianRegionalNpcProfile[];
}) {
  if (!Number.isSafeInteger(input.turn) || input.turn < 1)
    throw new Error("Regional delegates need a safe current turn");
  return input.authorities.map((row) => {
    if (
      row.delegate ||
      !row.head.isNpc ||
      (row.termEndTurn != null && row.termEndTurn <= input.turn)
    )
      return row;
    const profile = input.profiles
      .filter((profile) => profile.eligible && profile.party === row.head.party)
      .sort((a, b) => a.ownerId.localeCompare(b.ownerId))[0];
    if (!profile) return row;
    return {
      ...row,
      delegate: {
        personId: `${row.head.personId}:delegate`,
        ownerId: profile.ownerId,
        isNpc: true,
        name: `${row.head.name} representative`,
        party: row.head.party,
        eligible: true,
        appointedByPersonId: row.head.personId,
        appointedOnTurn: input.turn,
      },
    };
  });
}
