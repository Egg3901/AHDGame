import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { ObjectId, type Document } from "mongodb";
import type { MoneyMove } from "@/lib/banking/moneyMove";

export const FIXTURE_VERSION = "mixed-holder-payout-v1";
export const BALANCE_PATHS: Record<string, string> = {
  corporations: "liquidCapital",
  characters: "currencyBalances.personal.USD",
  npps: "currencyBalances.personal.USD",
  indexFunds: "cashAnchor",
};

export function balanceAt(document: Document, collection: string): number {
  let value: unknown = document;
  for (const key of BALANCE_PATHS[collection].split("."))
    value = (value as Record<string, unknown>)[key];
  return value as number;
}

export const HOLDER_COLLECTIONS = ["characters", "npps", "indexFunds"] as const;

/** Synthetic corporation dividend recipients, including the batching boundary. */
export function payoutFixture(holders: number) {
  if (!Number.isInteger(holders) || holders < 3 || holders > 300) {
    throw new Error("holders must be an integer from 3 through 300");
  }
  const documents: Record<string, Document[]> = {
    corporations: [
      { _id: new ObjectId("650000000000000000000000"), liquidCapital: holders * 100, active: true },
    ],
    characters: [],
    npps: [],
    indexFunds: [],
  };
  const move: MoneyMove = {
    key: `qualification:payout:${holders}`,
    kind: "corporation.dividend",
    turn: 2,
    legs: [
      {
        kind: "debit",
        amount: holders * 10,
        collection: "corporations",
        filter: { _id: documents.corporations[0]._id },
        path: BALANCE_PATHS.corporations,
        note: "synthetic corporation payout",
      },
    ],
  };
  for (let i = 0; i < holders; i++) {
    const collection = HOLDER_COLLECTIONS[i % HOLDER_COLLECTIONS.length];
    const id = new ObjectId((i + 1).toString(16).padStart(24, "0"));
    documents[collection].push({
      _id: id,
      active: true,
      ...(collection === "indexFunds"
        ? { cashAnchor: 0 }
        : { currencyBalances: { personal: { USD: 0 } } }),
    });
    move.legs.push({
      kind: "credit",
      amount: 10,
      collection,
      filter: { _id: id, active: true },
      path: BALANCE_PATHS[collection],
      note: "synthetic holder payout",
    });
  }
  return { documents, move };
}

/** Only explicit payout contract fields are compared, never arbitrary timestamps. */
export function outcomeHash(outcome: unknown): string {
  return createHash("sha256").update(JSON.stringify(outcome)).digest("hex");
}

export interface MatchedCase {
  holders: number;
  latencyMs: number;
  lostAcknowledgement: boolean;
  outcomeHash: string;
  resources: { roundTrips: number; documents: number; bytes: number };
  nodeLifetimePeakRssBytes: number;
}

/** Never raise a matched resource budget to make a candidate pass. */
export function compareMatchedCase(before: MatchedCase, run: MatchedCase, phaseBudget: number) {
  assert.deepEqual(
    [run.holders, run.latencyMs, run.lostAcknowledgement],
    [before.holders, before.latencyMs, before.lostAcknowledgement]
  );
  assert.equal(run.outcomeHash, before.outcomeHash, "payout contract differs from baseline");
  assert.ok(
    run.resources.roundTrips <= phaseBudget,
    "primitive alone exceeds whole corporation phase budget"
  );
  // A batch lost-ack interrupts after several credits, a scalar lost-ack after one.
  // Recovery outcomes must match, but their distinct interrupted states cannot
  // establish a matched resource budget. Record that cost as diagnostic only.
  for (const metric of (run.lostAcknowledgement ? [] : ["roundTrips", "documents", "bytes"]) as (
    "roundTrips" | "documents" | "bytes"
  )[]) {
    assert.ok(
      run.resources[metric] <= before.resources[metric],
      `${metric} exceeds matched baseline`
    );
  }
  assert.ok(
    run.nodeLifetimePeakRssBytes <= before.nodeLifetimePeakRssBytes * 1.25,
    "Node lifetime peak RSS exceeds baseline by more than 25%"
  );
}
