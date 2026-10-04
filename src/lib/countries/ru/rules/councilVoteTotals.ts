/**
 * Council ballots record one first choice and an optional distinct second choice.
 * russianCouncilVoteTotals reuses the existing appeal and approval inputs for
 * second preferences, caps valid voters and preserves prior nominee marks separately.
 */
import { calcAppeal, MAX_APPEAL } from "@/lib/utils/demographicAppeal";
import { russianPresidentialVoteIncrement } from "./presidentialVoteIncrement";
import {
  countRussianCouncilBallotBatches,
  type RussianCouncilBallotBatch,
} from "./councilVoteIncrement";
import { resolveRussianCouncilBallot } from "./councilResult";

export interface RussianCouncilVoteLedger {
  registeredVoters: number;
  validBallots: number;
  againstAllVotes: number;
  registrationOrderByCandidate: Record<string, number>;
}
export function russianCouncilVoteTotals(input: {
  registeredVoters: number;
  priorVotes: Readonly<Record<string, number>>;
  ledger?: RussianCouncilVoteLedger;
  rawVotes: Readonly<Record<string, number>>;
  rawAgainstAllVotes?: number;
  nominees: readonly {
    id: string;
    registrationOrder: number;
    economicLean: number;
    socialLean: number;
    favorability: number;
  }[];
}) {
  const validCount = (n: number) => Number.isSafeInteger(n) && n >= 0;
  const orderedNominees = [...input.nominees].sort(
    (a, b) => a.registrationOrder - b.registrationOrder || a.id.localeCompare(b.id)
  );
  const active = new Map(orderedNominees.map((row) => [row.id, row]));
  if (
    !validCount(input.registeredVoters) ||
    active.size !== input.nominees.length ||
    input.nominees.some(
      (row) =>
        !row.id ||
        !validCount(row.registrationOrder) ||
        ![row.economicLean, row.socialLean, row.favorability].every(Number.isFinite)
    ) ||
    Object.keys(input.rawVotes).some((id) => !active.has(id))
  )
    throw new Error("Council vote increments need unique registered nominees and safe inputs");
  if (!input.ledger && Object.values(input.priorVotes).some((votes) => votes !== 0))
    throw new Error("Counted Council marks need their valid-ballot ledger");
  if (input.ledger && input.ledger.registeredVoters !== input.registeredVoters)
    throw new Error("Council electoral register changed after voting");
  const orders = { ...input.ledger?.registrationOrderByCandidate };
  for (const row of orderedNominees) {
    if (
      (orders[row.id] !== undefined && orders[row.id] !== row.registrationOrder) ||
      (input.ledger?.validBallots && orders[row.id] === undefined)
    )
      throw new Error("Council nominee registration changed after voting");
    orders[row.id] = row.registrationOrder;
  }
  if (
    Object.keys(input.priorVotes).some(
      (id) =>
        !validCount(input.priorVotes[id]) || (input.priorVotes[id] > 0 && orders[id] === undefined)
    ) ||
    Object.values(orders).some((order) => !validCount(order))
  )
    throw new Error("Council prior marks need their frozen nominee registration");
  const prior = {
    registeredVoters: input.registeredVoters,
    validBallots: input.ledger?.validBallots ?? 0,
    againstAllVotes: input.ledger?.againstAllVotes ?? 0,
    options: Object.entries(orders).map(([id, registrationOrder]) => ({
      id,
      registrationOrder,
      votes: input.priorVotes[id] ?? 0,
    })),
  };
  resolveRussianCouncilBallot(prior);
  const againstAllId = "council:against-all";
  if (active.has(againstAllId)) throw new Error("Council nominee uses a reserved ballot identity");
  const firstChoices = russianPresidentialVoteIncrement({
    registeredVoters: input.registeredVoters,
    priorVotes: { validBallots: prior.validBallots },
    rawVotes: { ...input.rawVotes, [againstAllId]: input.rawAgainstAllVotes ?? 0 },
    campaignStrength: {},
  });
  const batches: RussianCouncilBallotBatch[] = [];
  const hasRegisteredPoll = Object.keys(orders).length >= 3;
  if (hasRegisteredPoll && firstChoices[againstAllId])
    batches.push({ count: firstChoices[againstAllId], choices: [] });
  // A new poll needs three registered nominees. A later withdrawal preserves
  // the poll's registration history and previously counted marks.
  if (hasRegisteredPoll)
    for (const first of orderedNominees) {
      const count = firstChoices[first.id] ?? 0;
      if (!count) continue;
      const alternatives = orderedNominees
        .filter((row) => row.id !== first.id)
        .map((row) => {
          const raw = input.rawVotes[row.id] ?? 0;
          const affinity =
            (Math.min(
              1,
              Math.max(
                0,
                calcAppeal(
                  first.economicLean,
                  first.socialLean,
                  row.economicLean,
                  row.socialLean,
                  0,
                  false
                ) / MAX_APPEAL
              )
            ) *
              Math.min(100, Math.max(0, row.favorability))) /
            100;
          return {
            id: row.id,
            raw: BigInt(raw),
            weight: BigInt(raw) * BigInt(Math.round(affinity * 1_000_000)),
          };
        });
      const alternativeRaw = alternatives.reduce((sum, row) => sum + row.raw, BigInt(0));
      const weight = alternatives.reduce((sum, row) => sum + row.weight, BigInt(0));
      const secondCount =
        alternativeRaw && weight
          ? Number((BigInt(count) * weight) / (alternativeRaw * BigInt(1_000_000)))
          : 0;
      if (count > secondCount) batches.push({ count: count - secondCount, choices: [first.id] });
      if (secondCount) {
        const quotas = alternatives
          .map((row) => ({
            id: row.id,
            count: Number((BigInt(secondCount) * row.weight) / weight),
            remainder: (BigInt(secondCount) * row.weight) % weight,
          }))
          .sort((a, b) =>
            a.remainder === b.remainder
              ? a.id.localeCompare(b.id)
              : a.remainder > b.remainder
                ? -1
                : 1
          );
        const remaining = secondCount - quotas.reduce((sum, row) => sum + row.count, 0);
        for (let i = 0; i < remaining; i++) quotas[i].count++;
        for (const row of quotas)
          if (row.count) batches.push({ count: row.count, choices: [first.id, row.id] });
      }
    }
  const ballot = countRussianCouncilBallotBatches({ prior, batches });
  return {
    votes: Object.fromEntries(ballot.options.map((row) => [row.id, row.votes])),
    ledger: {
      registeredVoters: ballot.registeredVoters,
      validBallots: ballot.validBallots,
      againstAllVotes: ballot.againstAllVotes,
      registrationOrderByCandidate: orders,
    },
    ballot,
    batches,
  };
}
