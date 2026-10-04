/**
 * Native 1991 campaigns own their filing and ballot deadlines. Timer repair
 * updates derived dates while retaining their rounds, receipts and status;
 * malformed native bounds stay untouched for their country's campaign owner.
 */
import type { Election } from "@/lib/db/types";
import { frozenBgAssemblyTurns } from "@/lib/countries/bg/rules/assemblyClock1991";

type NativeClockElection = Pick<
  Election,
  | "countryId"
  | "electionType"
  | "startTurn"
  | "primaryEndTurn"
  | "endTurn"
  | "bulgarianFoundingRound"
  | "shiftedScheduleEndTurn"
  | "hungarianAssemblyRound"
  | "hungarianModernAssembly"
  | "hungarianModernByElection"
  | "russianPresidentialRound"
  | "russianDumaRound"
  | "russianCouncilRound"
>;

/** Undefined means generic custody; null means native custody with invalid bounds. */
export function frozenNativeCampaignTurns1991(
  election: NativeClockElection
): { startTurn: number; primaryEndTurn: number; endTurn: number } | null | undefined {
  const bulgarian = frozenBgAssemblyTurns(election);
  if (bulgarian !== undefined) return bulgarian;
  const hungarian =
    election.countryId === "HU" &&
    election.electionType === "nationalAssembly" &&
    (election.hungarianAssemblyRound != null ||
      election.hungarianModernAssembly != null ||
      election.hungarianModernByElection != null);
  const russian =
    election.countryId === "RU" &&
    ((election.electionType === "president" && election.russianPresidentialRound != null) ||
      (election.electionType === "dumaDeputy" && election.russianDumaRound != null) ||
      (election.electionType === "federationCouncilMember" &&
        election.russianCouncilRound != null));
  if (!hungarian && !russian) return undefined;
  const { startTurn, primaryEndTurn, endTurn } = election;
  if (
    startTurn == null ||
    primaryEndTurn == null ||
    endTurn == null ||
    ![startTurn, primaryEndTurn, endTurn].every(Number.isSafeInteger) ||
    startTurn < 0 ||
    primaryEndTurn < startTurn ||
    endTurn <= primaryEndTurn
  )
    return null;
  return { startTurn, primaryEndTurn, endTurn };
}
