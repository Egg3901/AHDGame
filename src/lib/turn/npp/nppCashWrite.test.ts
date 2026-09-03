import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { NppCorpDecision } from "./corpDecisionTypes";
import { buildNppCorpUpdateOp } from "./nppCashWrite";

/**
 * Ticket #1260 root cause.
 *
 * `liquidCapital` is written TWICE per turn into the same ordered bulkWrite:
 * sectorCalculations pushes `$inc: { liquidCapital: incomeForBalance }` (the
 * turn's operating income), and index.ts then APPENDS the NPP decision's ops.
 * The NPP decision used to carry `$set: { liquidCapital: cashLocal }`, where
 * `cashLocal` was seeded from the balance read BEFORE the credit — so the $set
 * landed last and overwrote the income with a pre-income figure.
 *
 * Proven on live Value Mart (IT #80): across turns 555-582, 21 of 28 turns
 * reconcile to the lira as `close == open + late-phase flows`, with the whole
 * ~£11M of operating income absent; 0 of 28 reconcile if the income landed.
 * A £221 maintenance build was enough to destroy £11,000,000 of income,
 * because ANY placed build triggered the $set.
 *
 * The fix is to make the NPP's cash write RELATIVE. A `$inc` of what the corp
 * actually spent composes with the income credit and with every other phase,
 * instead of racing them. This mirrors the tech-unlock path in the same file,
 * which already used `$inc: { liquidCapital: -cashCost }` correctly.
 */

const CORP_ID = new ObjectId();

function decision(overrides: Partial<NppCorpDecision> = {}): NppCorpDecision {
  return {
    corpId: CORP_ID,
    updates: { updatedAt: new Date("2026-09-02T22:00:00Z") },
    sectorUpdates: [],
    liquidCapitalDelta: 0,
    ...overrides,
  } as NppCorpDecision;
}

describe("buildNppCorpUpdateOp — the NPP cash write is relative, never absolute", () => {
  it("emits spending as a negative $inc so it composes with the income credit", () => {
    const op = buildNppCorpUpdateOp(decision({ liquidCapitalDelta: -3092 }));

    expect(op).not.toBeNull();
    expect(op!.update.$inc).toEqual({ liquidCapital: -3092 });
  });

  it("never writes liquidCapital through $set", () => {
    const op = buildNppCorpUpdateOp(
      decision({
        liquidCapitalDelta: -500,
        updates: { updatedAt: new Date(), marketingBudget: 42 },
      })
    );

    expect(op!.update.$set).not.toHaveProperty("liquidCapital");
    expect(op!.update.$set).toMatchObject({ marketingBudget: 42 });
  });

  it("omits the $inc entirely when the corp spent nothing", () => {
    const op = buildNppCorpUpdateOp(
      decision({ liquidCapitalDelta: 0, updates: { marketingBudget: 7 } })
    );

    expect(op!.update.$inc).toBeUndefined();
    expect(op!.update.$set).toMatchObject({ marketingBudget: 7 });
  });

  it("still emits the op when the ONLY change is a cash spend", () => {
    // Pre-fix the caller gated the whole op on `Object.keys(updates).length > 0`.
    // With cash moved out of `updates`, a spend-only decision must not be dropped.
    const op = buildNppCorpUpdateOp(decision({ updates: {}, liquidCapitalDelta: -1200 }));

    expect(op).not.toBeNull();
    expect(op!.update.$inc).toEqual({ liquidCapital: -1200 });
  });

  it("returns null when there is genuinely nothing to write", () => {
    expect(buildNppCorpUpdateOp(decision({ updates: {}, liquidCapitalDelta: 0 }))).toBeNull();
  });

  it("rounds the delta so it cannot write a fractional currency amount", () => {
    const op = buildNppCorpUpdateOp(decision({ liquidCapitalDelta: -1200.6 }));

    expect(op!.update.$inc).toEqual({ liquidCapital: -1201 });
  });

  it("ignores a non-finite delta rather than corrupting the balance", () => {
    // A NaN reaching `$inc` sets the field to NaN and poisons every later read;
    // sectorCalculations has a guard comment about exactly this class of write.
    const op = buildNppCorpUpdateOp(
      decision({ liquidCapitalDelta: NaN, updates: { marketingBudget: 3 } })
    );

    expect(op!.update.$inc).toBeUndefined();
    expect(op!.update.$set).toMatchObject({ marketingBudget: 3 });
  });
});
