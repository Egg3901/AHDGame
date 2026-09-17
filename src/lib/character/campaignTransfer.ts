import { randomUUID } from "node:crypto";
import type { Db, ObjectId } from "mongodb";
import { getCharactersCollection } from "@/lib/db/collections/characters";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  claimMoneyFlowReceipt,
  runMoneyFlowLegs,
  type MoneyFlowLeg,
  type MoneyFlowLegOutcome,
} from "@/lib/db/nonAtomicMoneyFlow";
import type { Character } from "@/lib/db/types";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";

const CAMPAIGN_FUNDS_FIELDS = new Set(["funds", "currencyBalances.campaign"]);

export interface CampaignTransferInput {
  senderId: ObjectId;
  targetId: ObjectId;
  /** Whole units in the sender's local home currency. */
  amountLocal: number;
  /** Balance field holding campaign funds (`funds` pre-forex). */
  fundsField: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same transfer replays the stored outcome instead
   * of moving money again. Omit to mint one: the transfer is still
   * crash-safe within the attempt, but a client retry mints a new key and
   * is treated as a new transfer.
   */
  idempotencyKey?: string;
}

function mapLegError(index: number, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical sentinel surface: index 0 is the guarded sender
  // debit (missing sender and insufficient funds were both
  // `INSUFFICIENT_FUNDS`), index 1 is the target credit.
  if (index === 0) return new Error("INSUFFICIENT_FUNDS");
  if (outcome === "missing") return new Error("TARGET_NOT_FOUND");
  return new Error("TARGET_NOT_FOUND");
}

/**
 * Move campaign funds between two same-country characters so the result is
 * exactly-once on every topology (issue #1672).
 *
 * Under real transactions the legs and the idempotency receipt join the
 * transaction and commit atomically, preserving the old behavior. On a
 * standalone deployment the fallback runs the same legs through keyed
 * idempotent writes: a crash between the debit and the credit leaves an
 * `in_progress` receipt, and retrying with the same key reconciles to
 * exactly one completed transfer instead of destroying or duplicating
 * money. A retry after a terminal failure throws `MoneyFlowTerminalError`
 * (fail closed); a new attempt needs a new key.
 */
export async function transferCharacterCampaignFunds(
  db: Db,
  input: CampaignTransferInput
): Promise<{ duplicate: boolean }> {
  if (!input.senderId || !input.targetId) {
    throw new TypeError("Campaign transfer needs senderId and targetId");
  }
  if (!Number.isInteger(input.amountLocal) || input.amountLocal <= 0) {
    throw new RangeError("Campaign transfer amount must be a positive integer");
  }
  if (!CAMPAIGN_FUNDS_FIELDS.has(input.fundsField)) {
    throw new RangeError("Campaign transfer needs a known funds field");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Campaign transfer idempotency key must be 1-128 characters");
  }

  const characters = await getCharactersCollection(db);
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const fingerprint = `${input.senderId.toHexString()}:${input.targetId.toHexString()}:${input.amountLocal}:${input.fundsField}`;
  const legs: Array<MoneyFlowLeg<Character>> = [
    {
      name: "sender-debit",
      collection: characters,
      docId: input.senderId,
      field: input.fundsField,
      delta: -input.amountLocal,
      minBalance: input.amountLocal,
    },
    {
      name: "target-credit",
      collection: characters,
      docId: input.targetId,
      field: input.fundsField,
      delta: input.amountLocal,
    },
  ];

  return runWithOptionalTransaction(
    async (session) => {
      const claim = await claimMoneyFlowReceipt(receipts, key, fingerprint, {
        session,
      });
      if (claim === "duplicate") return { duplicate: true };
      await runMoneyFlowLegs(receipts, key, legs, mapLegError, { session });
      return { duplicate: claim === "in-progress" };
    },
    async () => {
      const claim = await claimMoneyFlowReceipt(receipts, key, fingerprint);
      if (claim === "duplicate") return { duplicate: true };
      // `in-progress` (crashed first attempt or racing duplicate) takes the
      // same path as `fresh`: legs are keyed, so re-running converges
      // instead of double-applying.
      await runMoneyFlowLegs(receipts, key, legs, mapLegError);
      return { duplicate: claim === "in-progress" };
    }
  );
}
