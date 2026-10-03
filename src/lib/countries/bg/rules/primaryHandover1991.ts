/**
 * Constitutional handover converts only a complete untouched first-round cohort.
 * Cast ballots, certified receipts, closed filing windows and renewed polls keep
 * their frozen rules. Every admitted cohort drops its founding count flags together.
 */
import { BG_ORDINARY_ASSEMBLY_SEATS } from "./assemblyTransition";

export function canRebindBg1991PrimaryCohort(input: {
  polls: readonly {
    id: string;
    state: string;
    cycle: number;
    primaryEndTurn?: number;
    primaryEndTimeMs?: number;
    foundingRound?: 1 | 2;
    receiptId?: string;
    ruleVersion?: string;
  }[];
  tallies: readonly { electionId: string; finalized?: boolean; votes: readonly number[] }[];
  hasCertifiedReceipt: boolean;
  turn: number;
  nowMs: number;
}): boolean {
  const regions = Object.keys(BG_ORDINARY_ASSEMBLY_SEATS);
  if (
    input.hasCertifiedReceipt ||
    !Number.isSafeInteger(input.turn) ||
    input.turn < 1 ||
    !Number.isFinite(input.nowMs) ||
    input.polls.length !== regions.length ||
    new Set(input.polls.map((row) => row.id)).size !== regions.length ||
    new Set(input.polls.map((row) => row.state)).size !== regions.length ||
    new Set(input.polls.map((row) => row.cycle)).size !== 1 ||
    input.polls.some(
      (row) =>
        !regions.includes(row.state) ||
        !Number.isSafeInteger(row.cycle) ||
        row.cycle < 1 ||
        row.foundingRound === 2
    )
  )
    return false;
  const bound = input.polls.filter((row) => row.foundingRound !== undefined);
  if (
    bound.length &&
    (bound.length !== input.polls.length ||
      bound.some(
        (row) =>
          row.receiptId !== `BG:founding1990:${row.cycle}` || row.ruleVersion !== "parallel-1990-v1"
      ))
  )
    return false;
  const tallies = new Map(input.tallies.map((row) => [row.electionId, row]));
  if (tallies.size !== input.tallies.length) return false;
  return input.polls.every((row) => {
    const tally = tallies.get(row.id);
    const open =
      row.primaryEndTurn != null
        ? Number.isSafeInteger(row.primaryEndTurn) && row.primaryEndTurn > input.turn
        : row.primaryEndTimeMs != null &&
          Number.isFinite(row.primaryEndTimeMs) &&
          row.primaryEndTimeMs > input.nowMs;
    return open && !!tally && !tally.finalized && tally.votes.every((votes) => votes === 0);
  });
}
