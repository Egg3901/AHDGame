import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { computePolicyShift, applyBillVotePolicyShift } from "./policyShift";

// ── computePolicyShift (pure, no DB) ────────────────────────────────────────

describe("computePolicyShift", () => {
  it("returns 0 for abstain", () => {
    expect(computePolicyShift(0, 3, "abstain")).toBe(0);
  });

  it("returns 0 when provision value is undefined", () => {
    expect(computePolicyShift(0, undefined, "for")).toBe(0);
  });

  it("returns 0 when character is already at provision value", () => {
    expect(computePolicyShift(2, 2, "for")).toBe(0);
    expect(computePolicyShift(2, 2, "against")).toBe(0);
  });

  it("shifts +0.25 toward bill when voting for (character left of bill)", () => {
    expect(computePolicyShift(0, 3, "for")).toBe(0.25);
  });

  it("shifts -0.25 toward bill when voting for (character right of bill)", () => {
    expect(computePolicyShift(2, -1, "for")).toBe(-0.25);
  });

  it("shifts -0.25 away from bill when voting against (character left of bill)", () => {
    expect(computePolicyShift(0, 3, "against")).toBe(-0.25);
  });

  it("shifts +0.25 away from bill when voting against (character right of bill)", () => {
    expect(computePolicyShift(2, -1, "against")).toBe(0.25);
  });
});

// ── applyBillVotePolicyShift (DB write) ─────────────────────────────────────

function makeMockDb() {
  const characterCol = {
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const db = {
    collection: vi.fn().mockReturnValue(characterCol),
  };
  return { db, characterCol };
}

describe("applyBillVotePolicyShift", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does nothing for abstain votes", async () => {
    const { db, characterCol } = makeMockDb();
    await applyBillVotePolicyShift(db as any, new ObjectId(), [{ economic: 3 }], "abstain", {
      economic: 0,
      social: 0,
    });
    expect(characterCol.updateOne).not.toHaveBeenCalled();
  });

  it("does nothing when provisions array is empty", async () => {
    const { db, characterCol } = makeMockDb();
    await applyBillVotePolicyShift(db as any, new ObjectId(), [], "for", {
      economic: 0,
      social: 0,
    });
    expect(characterCol.updateOne).not.toHaveBeenCalled();
  });

  it("ignores provisions with no axis values", async () => {
    const { db, characterCol } = makeMockDb();
    await applyBillVotePolicyShift(db as any, new ObjectId(), [{}], "for", {
      economic: 1,
      social: 1,
    });
    expect(characterCol.updateOne).not.toHaveBeenCalled();
  });

  it("shifts economic axis toward bill on 'for' vote", async () => {
    const { db, characterCol } = makeMockDb();
    await applyBillVotePolicyShift(db as any, new ObjectId(), [{ economic: 2 }], "for", {
      economic: 0,
      social: 0,
    });
    const setArg = characterCol.updateOne.mock.calls[0][1].$set;
    expect(setArg["policies.economic"]).toBe(0.25);
    expect(setArg["policies.social"]).toBe(0);
  });

  it("shifts economic axis away from bill on 'against' vote", async () => {
    const { db, characterCol } = makeMockDb();
    await applyBillVotePolicyShift(db as any, new ObjectId(), [{ economic: 2 }], "against", {
      economic: 0,
      social: 0,
    });
    const setArg = characterCol.updateOne.mock.calls[0][1].$set;
    expect(setArg["policies.economic"]).toBe(-0.25);
  });

  it("shifts both axes independently", async () => {
    const { db, characterCol } = makeMockDb();
    await applyBillVotePolicyShift(
      db as any,
      new ObjectId(),
      [{ economic: 3, social: -2 }],
      "for",
      { economic: 0, social: 0 }
    );
    const setArg = characterCol.updateOne.mock.calls[0][1].$set;
    expect(setArg["policies.economic"]).toBe(0.25);
    expect(setArg["policies.social"]).toBe(-0.25);
  });

  it("accumulates shifts across multiple provisions", async () => {
    const { db, characterCol } = makeMockDb();
    await applyBillVotePolicyShift(
      db as any,
      new ObjectId(),
      [{ economic: 2 }, { economic: 3 }],
      "for",
      { economic: 0, social: 0 }
    );
    const setArg = characterCol.updateOne.mock.calls[0][1].$set;
    expect(setArg["policies.economic"]).toBeCloseTo(0.5);
  });

  it("clamps at +5", async () => {
    const { db, characterCol } = makeMockDb();
    await applyBillVotePolicyShift(db as any, new ObjectId(), [{ economic: 5 }], "for", {
      economic: 4.9,
      social: 0,
    });
    const setArg = characterCol.updateOne.mock.calls[0][1].$set;
    expect(setArg["policies.economic"]).toBe(5);
  });

  it("clamps at -5", async () => {
    const { db, characterCol } = makeMockDb();
    await applyBillVotePolicyShift(db as any, new ObjectId(), [{ economic: 5 }], "against", {
      economic: -4.9,
      social: 0,
    });
    const setArg = characterCol.updateOne.mock.calls[0][1].$set;
    expect(setArg["policies.economic"]).toBe(-5);
  });

  it("does nothing when all shifts are zero (already aligned)", async () => {
    const { db, characterCol } = makeMockDb();
    await applyBillVotePolicyShift(db as any, new ObjectId(), [{ economic: 2 }], "for", {
      economic: 2,
      social: 0,
    });
    expect(characterCol.updateOne).not.toHaveBeenCalled();
  });

  it("snaps the stored position to the 0.05 grid", async () => {
    const { db, characterCol } = makeMockDb();
    // current -0.76 (off-grid) + 0.25 "for" toward bill = -0.51 → snaps to -0.50.
    await applyBillVotePolicyShift(db as any, new ObjectId(), [{ economic: 5 }], "for", {
      economic: -0.76,
      social: 0,
    });
    const setArg = characterCol.updateOne.mock.calls[0][1].$set;
    expect(setArg["policies.economic"]).toBeCloseTo(-0.5, 5);
  });
});
