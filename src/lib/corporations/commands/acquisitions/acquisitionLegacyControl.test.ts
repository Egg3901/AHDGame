/**
 * Negative control for issue #2017: the pre-settlement payout shape double-pays.
 *
 * This replicates the legacy `executeAgreedAcquisition` sequence with plain
 * unstamped writes (full debit, unrecorded holder credits, a throw before
 * teardown, a FULL refund, offer back to `pending`, then a sanctioned retry):
 * every holder ends up paid twice while the acquirer only lost one price.
 * It uses no implementation code on purpose: it proves the harness and the
 * world helper can observe the bug class the settlement exists to prevent,
 * so the exactly-once assertions elsewhere are not vacuous.
 */

import { describe, it, expect } from "vitest";
import {
  buildAcquisitionWorld,
  defaultSlices,
  readBalances,
  ACQUIRER_CASH,
  type AcquisitionWorld,
} from "./acquisitionSettlementWorld";

/** One legacy run: debit, pay every holder bucket, no per-leg record. */
async function legacyPayHolders(w: AcquisitionWorld): Promise<void> {
  const slices = defaultSlices(w.price);
  await w.memory
    .collection("corporations")
    .updateOne({ _id: w.acq }, { $inc: { liquidCapital: -w.price } });
  await w.memory
    .collection("characters")
    .updateOne({ _id: w.charA }, { $inc: { cashOnHand: slices.charA } });
  await w.memory
    .collection("characters")
    .updateOne({ _id: w.charB }, { $inc: { cashOnHand: slices.charB } });
  await w.memory
    .collection("imperialCharacters")
    .updateOne({ _id: w.imperial }, { $inc: { cashOnHand: slices.imperial } });
  await w.memory
    .collection("corporations")
    .updateOne({ _id: w.corpHolder }, { $inc: { liquidCapital: slices.corp } });
  await w.memory
    .collection("indexFunds")
    .updateOne({ _id: w.fund }, { $inc: { cashAnchor: slices.fund } });
  await w.memory
    .collection("federalBudget")
    .updateOne({ countryId: "US" }, { $inc: { treasuryBalance: slices.float } });
}

describe("legacy payout shape (negative control)", () => {
  it("a full refund plus a pending reset double-pays holders on retry", async () => {
    const w = buildAcquisitionWorld({});
    const slices = defaultSlices(w.price);

    // First attempt: debit lands, holders are paid, then a throw before
    // teardown. The catch refunds the FULL debit; the offer resets to pending.
    await legacyPayHolders(w);
    await w.memory
      .collection("corporations")
      .updateOne({ _id: w.acq }, { $inc: { liquidCapital: w.price } });

    // Sanctioned recovery: re-accept debits the full price and pays everyone.
    await legacyPayHolders(w);

    const b = await readBalances(w);
    expect(b.charA).toBe(2 * slices.charA);
    expect(b.charB).toBe(2 * slices.charB);
    expect(b.imperial).toBe(2 * slices.imperial);
    expect(b.corpHolder).toBe(1_000 + 2 * slices.corp);
    expect(b.fundCash).toBe(2 * slices.fund);
    expect(b.treasury).toBe(2 * slices.float);
    // Conservation is broken: holders absorbed two prices, the acquirer lost one.
    const inflow =
      b.charA + b.charB + b.imperial + (b.corpHolder - 1_000) + b.fundCash + b.treasury;
    expect(inflow).toBe(2 * w.price);
    expect(ACQUIRER_CASH - b.acquirer).toBe(w.price);
  });
});
