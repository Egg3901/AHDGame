/**
 * Council voting counts each valid ballot once and each distinct candidate choice once.
 * countRussianCouncilBallotBatches adds one-choice, two-choice and against-all batches
 * to a frozen register without treating two candidate marks as two voters.
 */
import { resolveRussianCouncilBallot, type RussianCouncilBallotInput } from "./councilResult";

export interface RussianCouncilBallotBatch {
  count: number;
  /** An empty choice set means against all; otherwise choose one or two nominees. */
  choices: readonly string[];
}

export function countRussianCouncilBallotBatches(input: {
  prior: RussianCouncilBallotInput;
  batches: readonly RussianCouncilBallotBatch[];
}): RussianCouncilBallotInput {
  resolveRussianCouncilBallot(input.prior);
  const votes = new Map(input.prior.options.map((row) => [row.id, BigInt(row.votes)]));
  let valid = BigInt(input.prior.validBallots);
  let againstAll = BigInt(input.prior.againstAllVotes);
  for (const batch of input.batches) {
    if (
      !Number.isSafeInteger(batch.count) ||
      batch.count < 0 ||
      batch.choices.length > 2 ||
      new Set(batch.choices).size !== batch.choices.length ||
      batch.choices.some((id) => !votes.has(id))
    )
      throw new Error(
        "Council ballot batches need safe counts and up to two distinct registered choices"
      );
    const count = BigInt(batch.count);
    valid += count;
    if (!batch.choices.length) againstAll += count;
    for (const id of batch.choices) votes.set(id, votes.get(id)! + count);
  }
  if (valid > BigInt(input.prior.registeredVoters))
    throw new Error("Council ballot batches exceed the frozen register");
  const result = {
    ...input.prior,
    validBallots: Number(valid),
    againstAllVotes: Number(againstAll),
    options: input.prior.options.map((row) => ({ ...row, votes: Number(votes.get(row.id)!) })),
  };
  resolveRussianCouncilBallot(result);
  return result;
}
