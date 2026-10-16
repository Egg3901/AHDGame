import { createHash } from "node:crypto";
import { ZOD_CURRENCY_ENUM } from "@/lib/constants/currencies";
import { accountId } from "@/lib/ledger/accounts";
import type { LedgerEntry } from "@/lib/ledger/types";
/** Freeze a complete turn before moving cash, then publish replayable absolute receipts. */
import { ObjectId, type Db } from "mongodb";
import type { CorporateSector } from "@/lib/db/types/corporation";
import { settleTransition } from "@/lib/banking/settlementJournal";
import { encodeReceipt, decodeReceipt, stageReceiptChunks } from "./receiptStorage";
import { verifyOpeningProducerPayables, publishProducerPayables } from "./payablesSettlement";
import { producerPayableReceiptKeys } from "./payablesRules";
import { advanceProducerEconomy } from "./production";
import { producerCashTransition, type ProducerCashBinding } from "./cashSettlementRules";

type EconomyInput = Parameters<typeof advanceProducerEconomy>[0];
type EconomyResult = ReturnType<typeof advanceProducerEconomy>;

export interface ProducerSectorTarget {
  producerId: string;
  sectorId: string;
  corporationId: string;
}

interface FrozenProducerTurn {
  version: 1;
  createdAt: string;
  worldEpoch: string;
  request: EconomyInput;
  bindings: readonly ProducerCashBinding[];
  targets: readonly ProducerSectorTarget[];
  result: EconomyResult;
}

interface ProducerTurnRecord {
  _id: string;
  worldEpoch: string;
  turn: number;
  digest: string;
  payload: string;
  status: "frozen" | "settled";
}

const PUBLICATION_BATCH_SIZE = 128;

async function readFrozen(db: Db, record: ProducerTurnRecord): Promise<FrozenProducerTurn> {
  const payload = (await decodeReceipt(db, record)) as FrozenProducerTurn;
  if (
    payload.version !== 1 ||
    payload.worldEpoch !== record.worldEpoch ||
    payload.request.turn !== record.turn
  )
    throw new Error("Producer receipt identity mismatch");
  return payload;
}

function cashWithLedger(payload: FrozenProducerTurn, receiptDigest: string) {
  const transition = producerCashTransition({
    worldEpoch: payload.worldEpoch,
    turn: payload.request.turn,
    opening: payload.request.accounts,
    closing: payload.result.accounts,
    bindings: payload.bindings,
    receiptDigest,
  });
  const opening = new Map(payload.request.accounts.map((account) => [account.id, account.cash]));
  const closing = new Map(payload.result.accounts.map((account) => [account.id, account.cash]));
  const ledgerLegs: LedgerEntry["legs"] = [];
  for (const binding of payload.bindings) {
    const currency = ZOD_CURRENCY_ENUM.find((code) => code === binding.currency);
    if (!currency) throw new Error("Producer settlement requires a native ledger currency");
    const change = closing.get(binding.accountId)! - opening.get(binding.accountId)!;
    if (change === 0) continue;
    ledgerLegs.push({
      account:
        binding.kind === "corporation"
          ? accountId("corporation", binding.corporationId, currency)
          : accountId("economy_wallet", binding.economyAccountId, currency),
      amount: change * binding.localPerAnchor,
      currencyCode: currency,
      anchorAmount: change,
      role: "primary",
    });
  }
  const bindingsByAccount = new Map(
    payload.bindings.map((binding) => [binding.accountId, binding])
  );
  const payableMeta: Record<string, number | string> = {};
  for (const payment of payload.result.payablePayments) {
    const binding = bindingsByAccount.get(payment.debtorAccountId)!;
    if (binding.kind !== "corporation") continue;
    const keys = producerPayableReceiptKeys(binding.corporationId);
    const paid = Number(payableMeta[keys.amount] ?? 0) + payment.amount * binding.localPerAnchor;
    if (!Number.isFinite(paid)) throw new Error("Producer payable native payment overflow");
    payableMeta[keys.amount] = paid;
    payableMeta[keys.currency] = binding.currency;
  }
  transition.event.meta = { ...transition.event.meta, ...payableMeta };
  const createdAt = new Date(payload.createdAt);
  if (!Number.isFinite(createdAt.getTime())) throw new Error("Invalid producer receipt time");
  if (ledgerLegs.length) {
    const entry: LedgerEntry = {
      _id: new ObjectId(
        createHash("sha256").update(`${transition.key}:ledger`).digest("hex").slice(0, 24)
      ),
      turn: payload.request.turn,
      createdAt,
      txType: "producer_market_settlement",
      legs: ledgerLegs,
      balanced: true,
      emitSite: "producerMarket/settlement",
    };
    transition.projections.push({
      collection: "ledgerEntries",
      insert: { ...entry },
      note: "Complete producer cash witness, all balance changes are primary",
    });
  }
  return transition;
}

function validateTargets(payload: FrozenProducerTurn): void {
  const plans = new Map(payload.request.producers.map((p) => [p.id, p]));
  const bindings = new Map(payload.bindings.map((binding) => [binding.accountId, binding]));
  const sectors = new Set<string>();
  const producers = new Set<string>();
  for (const target of payload.targets) {
    const plan = plans.get(target.producerId);
    const binding = plan && bindings.get(plan.accountId);
    if (
      !plan ||
      !binding ||
      binding.kind !== "corporation" ||
      binding.corporationId !== target.corporationId ||
      !/^[a-f0-9]{24}$/i.test(target.sectorId) ||
      !/^[a-f0-9]{24}$/i.test(target.corporationId) ||
      sectors.has(target.sectorId) ||
      producers.has(target.producerId)
    )
      throw new Error("Invalid producer receipt target");
    sectors.add(target.sectorId);
    producers.add(target.producerId);
  }
  if (producers.size !== plans.size) throw new Error("Missing producer receipt target");
}

async function assertTurnFence(db: Db, worldEpoch: string, turn: number): Promise<void> {
  const state = await db
    .collection<{
      _id: string;
      worldEpochId?: string;
      isProcessing?: boolean;
      processingTargetTurn?: number;
    }>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { worldEpochId: 1, isProcessing: 1, processingTargetTurn: 1 } }
    );
  if (
    state?.worldEpochId !== worldEpoch ||
    state.isProcessing !== true ||
    state.processingTargetTurn !== turn
  )
    throw new Error("Producer settlement requires the matching active turn fence");
}

/**
 * A retry uses the original complete receipt, including its native cash guards.
 * Current prices, policy changes or partially applied cash never re-quote it.
 * This shell is called inside the corporation phase's exclusive turn fence.
 */
export async function settleProducerTurn(
  db: Db,
  input: {
    worldEpoch: string;
    production: EconomyInput;
    bindings: readonly ProducerCashBinding[];
    targets: readonly ProducerSectorTarget[];
  }
): Promise<EconomyResult> {
  const turn = input.production.turn;
  const key = JSON.stringify([input.worldEpoch, turn]);
  await assertTurnFence(db, input.worldEpoch, turn);
  const turns = db.collection<ProducerTurnRecord>("producerEconomyTurns");
  let record = await turns.findOne({ _id: key });
  let claimedPayload: FrozenProducerTurn | undefined;
  if (!record) {
    await verifyOpeningProducerPayables(db, {
      worldEpoch: input.worldEpoch,
      turn,
      bindings: input.bindings,
      payables: input.production.payables ?? [],
    });
    const payload: FrozenProducerTurn = {
      version: 1,
      createdAt: new Date().toISOString(),
      worldEpoch: input.worldEpoch,
      request: input.production,
      bindings: input.bindings,
      targets: input.targets,
      result: advanceProducerEconomy(input.production),
    };
    validateTargets(payload);
    const encoded = encodeReceipt(payload);
    const candidate: ProducerTurnRecord = {
      _id: key,
      worldEpoch: input.worldEpoch,
      turn,
      status: "frozen",
      digest: encoded.digest,
      payload: encoded.payload,
    };
    // Validate native balances and restricted cash targets before claiming any receipt.
    cashWithLedger(payload, candidate.digest);
    await stageReceiptChunks(db, encoded.chunks);
    try {
      await turns.insertOne(candidate);
      record = candidate;
      claimedPayload = payload;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000))
        throw error;
      record = await turns.findOne({ _id: key });
      if (!record) throw new Error("Missing claimed producer receipt");
    }
  }
  const frozen = claimedPayload ?? (await readFrozen(db, record));
  if (
    frozen.worldEpoch !== input.worldEpoch ||
    frozen.request.turn !== turn ||
    (record.status !== "frozen" && record.status !== "settled")
  )
    throw new Error("Invalid frozen producer turn");
  if (record.status === "settled") return frozen.result;
  validateTargets(frozen);
  // One projected read verifies all sector ownership before any cash lands.
  const sectors = db.collection<CorporateSector>("corporateSectors");
  const existing = await sectors
    .find(
      { _id: { $in: frozen.targets.map((t) => new ObjectId(t.sectorId)) } },
      {
        projection: {
          _id: 1,
          corporationId: 1,
          "producerSettlement.worldEpoch": 1,
          "producerSettlement.turn": 1,
        },
      }
    )
    .toArray();
  const byId = new Map(existing.map((sector) => [sector._id.toHexString(), sector]));
  for (const target of frozen.targets) {
    const sector = byId.get(target.sectorId);
    const prior = sector?.producerSettlement;
    if (
      !sector ||
      sector.corporationId.toHexString() !== target.corporationId ||
      (prior && (prior.worldEpoch !== input.worldEpoch || prior.turn > turn))
    )
      throw new Error("Producer ownership or receipt generation changed");
  }
  const cash = cashWithLedger(frozen, record.digest);
  await assertTurnFence(db, frozen.worldEpoch, turn);
  const settled = await settleTransition(db, cash);
  if (settled.status !== "applied" && settled.status !== "replayed")
    throw new Error(settled.error ?? "Producer cash settlement is incomplete");
  await publishProducerPayables(db, {
    worldEpoch: frozen.worldEpoch,
    turn,
    bindings: frozen.bindings,
    openingPayables: frozen.request.payables ?? [],
    closingPayables: frozen.result.payables,
  });
  const results = new Map(frozen.result.producers.map((p) => [p.id, p]));
  // Only turn-owned absolute receipt fields are published here. Replaying a
  // completed batch changes no cash, stock quantity or user command field.
  for (let offset = 0; offset < frozen.targets.length; offset += PUBLICATION_BATCH_SIZE) {
    const targets = frozen.targets.slice(offset, offset + PUBLICATION_BATCH_SIZE);
    const published = await sectors.bulkWrite(
      targets.map((target) => ({
        updateOne: {
          filter: {
            _id: new ObjectId(target.sectorId),
            corporationId: new ObjectId(target.corporationId),
            $or: [
              { producerSettlement: { $exists: false } },
              {
                "producerSettlement.worldEpoch": frozen.worldEpoch,
                "producerSettlement.turn": { $lte: turn },
              },
            ],
          },
          update: {
            $set: {
              producerSettlement: {
                ...results.get(target.producerId)!,
                worldEpoch: frozen.worldEpoch,
                turn,
              },
            },
          },
        },
      }))
    );
    if (published.matchedCount !== targets.length)
      throw new Error("Producer receipt publication lost its target");
  }
  await turns.updateOne(
    { _id: key, digest: record.digest, status: "frozen" },
    { $set: { status: "settled" } }
  );
  return frozen.result;
}
