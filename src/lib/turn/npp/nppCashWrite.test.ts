import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { NppCorpDecision } from "./corpDecisionTypes";
import { buildNppCorpUpdateOp } from "./nppCashWrite";

function decision(overrides: Partial<NppCorpDecision> = {}): NppCorpDecision {
  return {
    corpId: new ObjectId(),
    updates: {},
    sectorUpdates: [],
    liquidCapitalDelta: 0,
    ...overrides,
  } as NppCorpDecision;
}

describe("buildNppCorpUpdateOp", () => {
  it("emits spending as a relative cash update", () => {
    const op = buildNppCorpUpdateOp(decision({ liquidCapitalDelta: -3_092 }));

    expect(op?.update).toEqual({ $inc: { liquidCapital: -3_092 } });
  });

  it("keeps cash out of the absolute field update", () => {
    const op = buildNppCorpUpdateOp(
      decision({ updates: { marketingBudget: 42 }, liquidCapitalDelta: -500 })
    );

    expect(op?.update.$set).toEqual({ marketingBudget: 42 });
    expect(op?.update.$set).not.toHaveProperty("liquidCapital");
  });

  it("preserves a spend-only decision", () => {
    expect(buildNppCorpUpdateOp(decision({ liquidCapitalDelta: -1_200 }))).toMatchObject({
      update: { $inc: { liquidCapital: -1_200 } },
    });
  });

  it("returns null when there is nothing to write", () => {
    expect(buildNppCorpUpdateOp(decision())).toBeNull();
  });

  it("does not write a non-finite cash delta", () => {
    const op = buildNppCorpUpdateOp(
      decision({ updates: { marketingBudget: 3 }, liquidCapitalDelta: Number.NaN })
    );

    expect(op?.update.$inc).toBeUndefined();
    expect(op?.update.$set).toEqual({ marketingBudget: 3 });
  });
});
