/**
 * Bulgaria retains its original four-year Grand Assembly term until an enacted
 * transition. Pending national counts block new cohorts; the first ordinary
 * campaign starts promptly and its actual ballot anchors later four-year terms.
 */
import type { Election } from "@/lib/db/types";
import { BG_ORDINARY_ASSEMBLY_START_TURN } from "./assemblyTransition";
export const BG_ASSEMBLY_TERM_TURNS = 192;
export const BG_FIRST_ORDINARY_PRIMARY_TURNS = 4;
export const BG_FIRST_ORDINARY_GENERAL_TURNS = 2;

export function bgGrandAssemblyRegularAnchor(input: {
  startingYear: number;
  preIterationTurns?: number;
  nativeAnchorTurn?: number;
}): number {
  const anchor =
    input.nativeAnchorTurn ??
    (1994 - input.startingYear) * 48 + 24 + (input.preIterationTurns ?? 0);
  if (!Number.isSafeInteger(anchor) || anchor < 1)
    throw new Error("Invalid Bulgarian Grand Assembly clock");
  return anchor;
}

export function planBg1991AssemblyClock(input: {
  currentTurn: number;
  preIterationActive?: boolean;
  authorized: boolean;
  previous?: Pick<Election, "status" | "cycle" | "endTurn" | "shiftedScheduleEndTurn">;
  previousOrdinary: boolean;
}):
  | { kind: "blocked" }
  | { kind: "founding" }
  | { kind: "canonical-grand" }
  | { kind: "canonical-ordinary" }
  | {
      kind: "ordinary-first" | "ordinary-shifted";
      cycle: number;
      startTurn: number;
      primaryEndTurn: number;
      endTurn: number;
    } {
  const { previous, currentTurn } = input;
  if (
    !Number.isSafeInteger(currentTurn) ||
    currentTurn < 0 ||
    (previous && (!Number.isSafeInteger(previous.cycle) || previous.cycle < 0))
  )
    throw new Error("Invalid Bulgarian Assembly scheduling clock");
  if (previous && ["completed", "active", "upcoming"].includes(previous.status))
    return { kind: "blocked" };
  if (input.preIterationActive)
    return previous?.status === "resolved" ? { kind: "blocked" } : { kind: "founding" };
  if (!input.authorized) return { kind: "canonical-grand" };
  const cycle = (previous?.cycle ?? 0) + 1;
  if (!previous || !input.previousOrdinary) {
    return {
      kind: "ordinary-first",
      cycle,
      startTurn: currentTurn,
      primaryEndTurn: currentTurn + BG_FIRST_ORDINARY_PRIMARY_TURNS,
      endTurn: currentTurn + BG_FIRST_ORDINARY_PRIMARY_TURNS + BG_FIRST_ORDINARY_GENERAL_TURNS,
    };
  }
  if (previous.shiftedScheduleEndTurn == null) return { kind: "canonical-ordinary" };
  if (!Number.isSafeInteger(previous.shiftedScheduleEndTurn) || previous.shiftedScheduleEndTurn < 1)
    throw new Error("Invalid Bulgarian ordinary term anchor");
  // A late turn advances the election instead of silently skipping a term.
  const endTurn = Math.max(
    previous.shiftedScheduleEndTurn + BG_ASSEMBLY_TERM_TURNS,
    currentTurn + BG_FIRST_ORDINARY_PRIMARY_TURNS + BG_FIRST_ORDINARY_GENERAL_TURNS
  );
  return {
    kind: "ordinary-shifted",
    cycle,
    startTurn: currentTurn,
    primaryEndTurn: endTurn - BG_FIRST_ORDINARY_GENERAL_TURNS,
    endTurn,
  };
}

/** A national count must settle before any region starts another cohort. */
export function bgAssemblyCohortCanSpawn(
  elections: readonly Pick<Election, "status" | "cycle">[]
): boolean {
  const latestCycle = Math.max(-1, ...elections.map((row) => row.cycle ?? -1));
  return !elections.some((row) => row.cycle === latestCycle && row.status === "completed");
}

/** Timer repair changes wall-clock dates, never a native ballot's turn deadlines. */
export function frozenBgAssemblyTurns(
  election: Pick<
    Election,
    | "countryId"
    | "electionType"
    | "bulgarianFoundingRound"
    | "shiftedScheduleEndTurn"
    | "startTurn"
    | "primaryEndTurn"
    | "endTurn"
  >
): { startTurn: number; primaryEndTurn: number; endTurn: number } | null | undefined {
  if (
    election.countryId !== "BG" ||
    election.electionType !== "nationalAssembly" ||
    (!election.bulgarianFoundingRound && election.shiftedScheduleEndTurn == null)
  )
    return undefined;
  const { startTurn, primaryEndTurn, endTurn } = election;
  if (
    startTurn == null ||
    primaryEndTurn == null ||
    endTurn == null ||
    ![startTurn, primaryEndTurn, endTurn].every(Number.isSafeInteger) ||
    startTurn < 0 ||
    primaryEndTurn < startTurn ||
    endTurn <= primaryEndTurn ||
    (election.shiftedScheduleEndTurn != null && election.shiftedScheduleEndTurn !== endTurn)
  )
    return null;
  return { startTurn, primaryEndTurn, endTurn };
}

/** Authorized election results may seat on their actual alternate-history date. */
export function bgOrdinarySeatingClockReady(input: {
  preIterationActive?: boolean;
  calendarTurn: number;
  currentTurn: number;
  authorizedTurn?: number;
}): boolean {
  return (
    !input.preIterationActive &&
    (input.calendarTurn >= BG_ORDINARY_ASSEMBLY_START_TURN ||
      (input.authorizedTurn != null &&
        Number.isSafeInteger(input.authorizedTurn) &&
        input.authorizedTurn <= input.currentTurn))
  );
}

/** A campaign completed after the old mandate expired opens a fresh bounded term. */
export function bgFoundingMandateTermAnchor(
  historicalEndTurn: number,
  seatedAtTurn: number
): number {
  if (
    ![historicalEndTurn, seatedAtTurn].every(Number.isSafeInteger) ||
    historicalEndTurn < 1 ||
    seatedAtTurn < 0
  )
    throw new Error("Invalid Bulgarian founding mandate clock");
  return historicalEndTurn > seatedAtTurn
    ? historicalEndTurn
    : seatedAtTurn + BG_ASSEMBLY_TERM_TURNS;
}
