/**
 * Product-level counters for banking, per turn.
 *
 * Generic turn health says whether the phase ran and how long it took. It
 * cannot say that every loan command was rejected this turn, that a third of
 * settlements were replays, or that a projection has been out of step with
 * its journal for six turns. Those are the numbers that catch the failures
 * this subsystem actually has, so they get their own document.
 *
 * One document per turn in `bankingTelemetry`, written with `$inc` so any
 * number of writers can bump a counter without reading it first. Every write
 * is fire-and-forget: telemetry must never fail a command or a turn.
 */

import * as Sentry from "@sentry/nextjs";
import type { Db } from "mongodb";

export const BANKING_TELEMETRY_COLLECTION = "bankingTelemetry";

export type BankingCounter =
  /** Commands the rules refused (cap, capability, validation). */
  | "rejectedCommands"
  /** Commands that lost a race with another writer. */
  | "staleCommands"
  /** Settlements that found their key already claimed and moved nothing. */
  | "replayedSettlements"
  /** Settlements that stopped part way and were left for repair. */
  | "partialSettlements"
  /** Settlements the journal refused outright (unbalanced, missing target). */
  | "rejectedSettlements"
  /** Projections found out of step with journal truth by a reconciliation pass. */
  | "unreconciledProjections"
  /** Projections a recovery pass brought back into step. */
  | "recoveredProjections";

export type BankingStage =
  | "funding"
  | "depositInterest"
  | "insurancePremium"
  | "loanServicing"
  | "householdBook"
  | "deadBankLoans"
  | "interbank"
  | "solvency"
  | "resolution"
  | "supervision"
  | "shadowCompare";

export interface BankingTelemetryDoc {
  _id: number;
  counters?: Partial<Record<BankingCounter, number>>;
  /** Total milliseconds spent in each lifecycle stage this turn, across banks. */
  stageMs?: Partial<Record<BankingStage, number>>;
  /** How many bank passes contributed to each stage. */
  stageRuns?: Partial<Record<BankingStage, number>>;
  updatedAt?: Date;
}

function swallow(write: () => unknown, phase: string): void {
  try {
    Promise.resolve(write()).catch((err) => {
      Sentry.captureException(err, { extra: { phase } });
    });
  } catch (err) {
    Sentry.captureException(err, { extra: { phase } });
  }
}

/** Bump a counter for `turn`. Never awaited, never throws. */
export function countBankingEvent(db: Db, turn: number, counter: BankingCounter, by = 1): void {
  if (!(by > 0) || !Number.isFinite(turn)) return;
  swallow(
    () =>
      db
        .collection<BankingTelemetryDoc>(BANKING_TELEMETRY_COLLECTION)
        .updateOne(
          { _id: turn },
          { $inc: { [`counters.${counter}`]: by }, $set: { updatedAt: new Date() } },
          { upsert: true }
        ),
    "bankingTelemetry.count"
  );
}

/** Record time spent in a lifecycle stage. Never awaited, never throws. */
export function recordBankingStage(db: Db, turn: number, stage: BankingStage, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0 || !Number.isFinite(turn)) return;
  swallow(
    () =>
      db.collection<BankingTelemetryDoc>(BANKING_TELEMETRY_COLLECTION).updateOne(
        { _id: turn },
        {
          $inc: { [`stageMs.${stage}`]: Math.round(ms), [`stageRuns.${stage}`]: 1 },
          $set: { updatedAt: new Date() },
        },
        { upsert: true }
      ),
    "bankingTelemetry.stage"
  );
}

/**
 * Time one stage of a bank pass. The stage's own result is returned
 * untouched; the timing is recorded on the way out, success or failure.
 */
export async function timedBankingStage<T>(
  db: Db,
  turn: number,
  stage: BankingStage,
  fn: () => Promise<T>
): Promise<T> {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    recordBankingStage(db, turn, stage, Date.now() - started);
  }
}

/** The telemetry documents for the most recent `turns` turns, newest first. */
export async function loadBankingTelemetry(db: Db, turns = 12): Promise<BankingTelemetryDoc[]> {
  return db
    .collection<BankingTelemetryDoc>(BANKING_TELEMETRY_COLLECTION)
    .find({})
    .sort({ _id: -1 })
    .limit(Math.max(1, turns))
    .toArray();
}
