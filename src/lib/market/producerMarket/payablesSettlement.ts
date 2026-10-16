/** Verify opening liabilities and publish their frozen absolute closing balances. */
import { ObjectId, type Db } from "mongodb";
import type { ProducerPayablesState } from "@/lib/db/types/producerEconomy";
import type { ProducerCashBinding } from "./cashSettlementRules";
import type { ProducerPayable } from "./payablesRules";

function snapshot(claims: readonly ProducerPayable[]): string {
  return JSON.stringify(
    [...claims]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((claim) => ({
        id: claim.id,
        debtorAccountId: claim.debtorAccountId,
        creditorAccountId: claim.creditorAccountId,
        producerId: claim.producerId,
        kind: claim.kind,
        amount: claim.amount,
      }))
  );
}

export async function verifyOpeningProducerPayables(
  db: Db,
  input: {
    worldEpoch: string;
    turn: number;
    bindings: readonly ProducerCashBinding[];
    payables: readonly ProducerPayable[];
  }
): Promise<void> {
  const corporations = input.bindings.filter((binding) => binding.kind === "corporation");
  const wallets = input.bindings.filter((binding) => binding.kind === "economyAccount");
  const [corpRows, walletRows] = await Promise.all([
    corporations.length
      ? db
          .collection<{ _id: ObjectId; producerPayables?: ProducerPayablesState }>("corporations")
          .find(
            { _id: { $in: corporations.map((binding) => new ObjectId(binding.corporationId)) } },
            { projection: { producerPayables: 1 } }
          )
          .toArray()
      : [],
    wallets.length
      ? db
          .collection<{ _id: string; producerPayables?: ProducerPayablesState }>(
            "producerEconomyAccounts"
          )
          .find(
            {
              _id: { $in: wallets.map((binding) => binding.economyAccountId) },
              worldEpoch: input.worldEpoch,
            },
            { projection: { producerPayables: 1 } }
          )
          .toArray()
      : [],
  ]);
  const byCorporation = new Map(corpRows.map((row) => [row._id.toHexString(), row]));
  const byWallet = new Map(walletRows.map((row) => [row._id, row]));
  const expected: ProducerPayable[] = [];
  for (const binding of input.bindings) {
    const row =
      binding.kind === "corporation"
        ? byCorporation.get(binding.corporationId)
        : byWallet.get(binding.economyAccountId);
    if (!row) throw new Error("Missing producer payable account");
    const state = row.producerPayables;
    if (!state) continue;
    if (
      state.worldEpoch !== input.worldEpoch ||
      !Number.isSafeInteger(state.turn) ||
      state.turn < 0 ||
      state.turn >= input.turn ||
      state.claims.some((claim) => claim.debtorAccountId !== binding.accountId)
    )
      throw new Error("Invalid opening producer payable generation");
    expected.push(...state.claims);
  }
  if (snapshot(expected) !== snapshot(input.payables))
    throw new Error("Producer opening payables changed or were omitted");
}

export async function publishProducerPayables(
  db: Db,
  input: {
    worldEpoch: string;
    turn: number;
    bindings: readonly ProducerCashBinding[];
    openingPayables: readonly ProducerPayable[];
    closingPayables: readonly ProducerPayable[];
  }
): Promise<void> {
  const debtors = new Set(
    [...input.openingPayables, ...input.closingPayables].map((claim) => claim.debtorAccountId)
  );
  const closing = new Map<string, ProducerPayable[]>();
  for (const claim of input.closingPayables) {
    const rows = closing.get(claim.debtorAccountId) ?? [];
    rows.push(claim);
    closing.set(claim.debtorAccountId, rows);
  }
  const bindings = input.bindings.filter((binding) => debtors.has(binding.accountId));
  if (bindings.length !== debtors.size)
    throw new Error("Missing producer payable publication target");
  for (const kind of ["corporation", "economyAccount"] as const) {
    const targets = bindings.filter((binding) => binding.kind === kind);
    const collection = kind === "corporation" ? "corporations" : "producerEconomyAccounts";
    for (let offset = 0; offset < targets.length; offset += 128) {
      const batch = targets.slice(offset, offset + 128);
      const result = await db
        .collection<{
          _id: string | ObjectId;
          worldEpoch?: string;
          producerPayables?: ProducerPayablesState;
        }>(collection)
        .bulkWrite(
          batch.map((binding) => ({
            updateOne: {
              filter: {
                _id:
                  binding.kind === "corporation"
                    ? new ObjectId(binding.corporationId)
                    : binding.economyAccountId,
                ...(binding.kind === "economyAccount" ? { worldEpoch: input.worldEpoch } : {}),
                $or: [
                  { producerPayables: { $exists: false } },
                  {
                    "producerPayables.worldEpoch": input.worldEpoch,
                    "producerPayables.turn": { $lte: input.turn },
                  },
                ],
              },
              update: {
                $set: {
                  producerPayables: {
                    worldEpoch: input.worldEpoch,
                    turn: input.turn,
                    claims: closing.get(binding.accountId) ?? [],
                  },
                },
              },
            },
          }))
        );
      if (result.matchedCount !== batch.length)
        throw new Error("Producer payable publication lost its generation guard");
    }
  }
}
