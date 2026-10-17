/** Synthetic load qualification. No database connection or live-world data. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { advanceProducerEconomy } from "../../src/lib/market/producerMarket/production";
import { producerCashTransition } from "../../src/lib/market/producerMarket/cashSettlementRules";
import { encodeReceipt } from "../../src/lib/market/producerMarket/receiptStorage";
import { makeProducerRecipeFixture } from "../sim/fixtures/producerEconomy";

const countIndex = process.argv.indexOf("--producers");
const count = countIndex < 0 ? 7755 : Number(process.argv[countIndex + 1]);
if (!Number.isSafeInteger(count) || count < 1 || count > 20000)
  throw new Error("Synthetic producer count must be an integer from 1 to 20000");
const fixtures = makeProducerRecipeFixture("1991-default");
const producers = Array.from({ length: count }, (_, i) => ({
  ...fixtures[i % fixtures.length],
  id: `site:${i}`,
  accountId: `corp:${i}`,
}));
const accounts = [
  ...producers.map((plan) => ({ id: plan.accountId, cash: 1000000 })),
  { id: "households", cash: 0 },
  { id: "operating-payee", cash: 0 },
];
const start = performance.now();
const result = advanceProducerEconomy({ turn: 1, producers, accounts });
const clearingMilliseconds = performance.now() - start;
const encodingStart = performance.now();
const encoded = encodeReceipt({ version: 1, request: { turn: 1, producers, accounts }, result });
const receiptEncodingMilliseconds = performance.now() - encodingStart;
const cashTransition = producerCashTransition({
  worldEpoch: "synthetic-load",
  turn: 1,
  opening: accounts,
  closing: result.accounts,
  receiptDigest: encoded.digest,
  bindings: accounts.map((account, i) => ({
    accountId: account.id,
    currency: "USD",
    localPerAnchor: 1,
    openingCashLocal: account.cash,
    ...(i < count
      ? { kind: "corporation" as const, corporationId: (i + 1).toString(16).padStart(24, "0") }
      : { kind: "economyAccount" as const, economyAccountId: account.id }),
  })),
});
const bytes = (value: string) => Buffer.byteLength(value);
const receiptDocumentBytes = bytes(encoded.payload);
const maxChunkDocumentBytes = Math.max(0, ...encoded.chunks.map((chunk) => bytes(chunk.payload)));
const openingCash = accounts.reduce((sum, account) => sum + account.cash, 0);
const closingCash = result.accounts.reduce((sum, account) => sum + account.cash, 0);
assert(Math.abs(closingCash - openingCash) <= openingCash * 1e-12);
assert(receiptDocumentBytes < 12 * 1024 * 1024);
assert(maxChunkDocumentBytes < 12 * 1024 * 1024);
assert(result.tradeReceipt.fills.length < result.tradeReceipt.tradeCount);
const report = {
  status: "passed",
  fixture: "1991 synthetic recipe portfolio",
  producerCount: count,
  logicalTradeCount: result.tradeReceipt.tradeCount,
  cashSettlementLegCount: cashTransition.legs.length,
  clearingFillCount: result.tradeReceipt.fills.length,
  producedUnits: result.producers.reduce((sum, producer) => sum + producer.producedUnits, 0),
  cashDrift: closingCash - openingCash,
  clearingMilliseconds,
  receiptEncodingMilliseconds,
  receiptDocumentBytes,
  receiptChunkCount: encoded.chunks.length,
  maxChunkDocumentBytes,
  totalEncodedBytes:
    receiptDocumentBytes + encoded.chunks.reduce((sum, chunk) => sum + bytes(chunk.payload), 0),
  heapUsedBytes: process.memoryUsage().heapUsed,
  liveRolloutQualified: false,
  limitations: [
    "Synthetic capacities, wages and cash; no actual-world balance qualification.",
    "One turn, not a full turn-engine, database, migration or route qualification.",
    "Timing and heap measurements depend on host load and runtime.",
  ],
};
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
