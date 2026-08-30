import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import {
  billPositionTargets,
  computeVoteShift,
  previewVoteShift,
  shouldApplyVoteShift,
  applyBillVotePolicyShift,
  type PolicyShiftLedgerEntry,
} from "./policyShift";

// ── billPositionTargets (pure) ──────────────────────────────────────────────

describe("billPositionTargets", () => {
  it("averages every provision that takes a stance on an axis", () => {
    expect(billPositionTargets([{ economic: -3 }, { economic: 1 }])).toEqual({ economic: -1 });
  });

  it("leaves an axis without a target when no provision takes a stance on it", () => {
    expect(billPositionTargets([{ economic: 2 }, { economic: 2, social: 0 }])).toEqual({
      economic: 2,
    });
  });

  it("excludes silent (omitted or 0) provisions from the average instead of recentring it", () => {
    // Ticket #1116: 0 is "no stance", never a centre target. -3 alone averages to -3.
    expect(billPositionTargets([{ economic: -3 }, { economic: 0 }, {}])).toEqual({
      economic: -3,
    });
  });

  it("handles the two axes independently", () => {
    expect(billPositionTargets([{ economic: 3, social: -1 }, { social: -3 }])).toEqual({
      economic: 3,
      social: -2,
    });
  });

  it("returns no targets for an empty bill", () => {
    expect(billPositionTargets([])).toEqual({});
  });
});

// ── computeVoteShift (pure) ─────────────────────────────────────────────────

describe("computeVoteShift", () => {
  const at = (economic: number, social: number) => ({ economic, social });

  it("is zero for an abstention", () => {
    expect(computeVoteShift(at(0, 0), { economic: 3, social: 3 }, "abstain")).toEqual(at(0, 0));
  });

  it("is zero on an axis with no target", () => {
    expect(computeVoteShift(at(1, 1), { economic: 3 }, "for")).toEqual(at(0.25, 0));
  });

  it("is zero when the voter already sits on the bill's position", () => {
    expect(computeVoteShift(at(2, -1), { economic: 2, social: -1 }, "for")).toEqual(at(0, 0));
    expect(computeVoteShift(at(2, -1), { economic: 2, social: -1 }, "against")).toEqual(at(0, 0));
  });

  it("an Aye moves 0.25 toward the bill on each axis", () => {
    expect(computeVoteShift(at(0, 0), { economic: 3, social: -3 }, "for")).toEqual(at(0.25, -0.25));
  });

  it("an Aye never overshoots: it moves only as far as the bill's position", () => {
    expect(computeVoteShift(at(1.9, 0), { economic: 2 }, "for")).toEqual(at(0.1, 0));
  });

  it("an Aye toward a fractional average lands on the 0.05 grid", () => {
    // Target 1.333.. from a voter at 1.2: distance 0.133 snaps to 0.15.
    expect(computeVoteShift(at(1.2, 0), { economic: 4 / 3 }, "for")).toEqual(at(0.15, 0));
  });

  it("a Nay moves the full 0.25 away from the bill on each axis", () => {
    expect(computeVoteShift(at(0, 0), { economic: 3, social: -3 }, "against")).toEqual(
      at(-0.25, 0.25)
    );
  });

  it("a Nay from just past the bill still moves away by 0.25", () => {
    expect(computeVoteShift(at(2.1, 0), { economic: 2 }, "against")).toEqual(at(0.25, 0));
  });

  it("clamps so the position stays within the -5..+5 range", () => {
    expect(computeVoteShift(at(-4.9, 4.9), { economic: 3, social: -3 }, "against")).toEqual(
      at(-0.1, 0.1)
    );
    expect(computeVoteShift(at(5, 0), { economic: 5 }, "for")).toEqual(at(0, 0));
  });
});

// ── previewVoteShift (pure) ─────────────────────────────────────────────────

describe("previewVoteShift", () => {
  it("previews both options from the current position when nothing has been applied yet", () => {
    expect(previewVoteShift({ economic: 1, social: 0 }, { economic: 3 }, undefined)).toEqual({
      current: { economic: 1, social: 0 },
      aye: { economic: 0.25, social: 0 },
      nay: { economic: -0.25, social: 0 },
    });
  });

  it("previews the move from the current position once a shift has been applied", () => {
    // Voter started at 1, an Aye already moved them to 1.25. Switching to Nay must
    // land at 0.75 (baseline minus 0.25), so the move from where they are is -0.5.
    const entry: PolicyShiftLedgerEntry = {
      baseline: { economic: 1, social: 0 },
      applied: { economic: 0.25, social: 0 },
    };
    expect(previewVoteShift({ economic: 1.25, social: 0 }, { economic: 3 }, entry)).toEqual({
      current: { economic: 1.25, social: 0 },
      aye: { economic: 0, social: 0 },
      nay: { economic: -0.5, social: 0 },
    });
  });
});

// ── shouldApplyVoteShift (pure) ─────────────────────────────────────────────

describe("shouldApplyVoteShift", () => {
  const entry: PolicyShiftLedgerEntry = {
    baseline: { economic: 0, social: 0 },
    applied: { economic: 0.25, social: 0 },
  };

  it("applies on a first vote", () => {
    expect(shouldApplyVoteShift(undefined, undefined)).toBe(true);
  });

  it("applies when changing a vote that has a ledger entry", () => {
    expect(shouldApplyVoteShift("for", entry)).toBe(true);
  });

  it("applies after a prior abstention even without a ledger entry", () => {
    expect(shouldApplyVoteShift("abstain", undefined)).toBe(true);
  });

  it("does not apply when changing a legacy vote that predates the ledger", () => {
    // Nothing recorded what that vote moved, so a re-vote could only grant a free step.
    expect(shouldApplyVoteShift("for", undefined)).toBe(false);
    expect(shouldApplyVoteShift("against", undefined)).toBe(false);
  });
});

// ── applyBillVotePolicyShift (DB writes) ────────────────────────────────────

function makeMockDb() {
  const characters = { updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }) };
  const bills = { updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }) };
  const db = {
    collection: vi.fn((name: string) => (name === "characters" ? characters : bills)),
  };
  return { db, characters, bills };
}

const characterId = new ObjectId();
const billId = new ObjectId();

function characterSet(characters: { updateOne: ReturnType<typeof vi.fn> }) {
  const calls = characters.updateOne.mock.calls;
  if (calls.length === 0) return null;
  expect(calls).toHaveLength(1);
  expect(calls[0]![0]).toEqual({ _id: characterId });
  return (calls[0]![1] as { $set: Record<string, unknown> }).$set;
}

function ledgerWrite(bills: { updateOne: ReturnType<typeof vi.fn> }) {
  const calls = bills.updateOne.mock.calls;
  if (calls.length === 0) return null;
  expect(calls).toHaveLength(1);
  expect(calls[0]![0]).toEqual({ _id: billId });
  return (calls[0]![1] as { $set: Record<string, unknown> }).$set[
    `policyShiftLedger.${characterId.toString()}`
  ] as PolicyShiftLedgerEntry;
}

describe("applyBillVotePolicyShift", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes nothing for a first-time abstention", async () => {
    const { db, characters, bills } = makeMockDb();
    await applyBillVotePolicyShift(db as never, {
      collection: "bills",
      billId,
      characterId,
      provisions: [{ economic: 3 }],
      vote: "abstain",
      currentPolicies: { economic: 0, social: 0 },
      ledgerEntry: undefined,
    });
    expect(characters.updateOne).not.toHaveBeenCalled();
    expect(bills.updateOne).not.toHaveBeenCalled();
  });

  it("a first Aye shifts the character and records baseline plus applied delta on the bill", async () => {
    const { db, characters, bills } = makeMockDb();
    await applyBillVotePolicyShift(db as never, {
      collection: "bills",
      billId,
      characterId,
      provisions: [{ economic: -3, social: 2 }],
      vote: "for",
      currentPolicies: { economic: 1, social: -1 },
      ledgerEntry: undefined,
    });
    expect(characterSet(characters)).toMatchObject({
      "policies.economic": 0.75,
      "policies.social": -0.75,
    });
    expect(ledgerWrite(bills)).toEqual({
      baseline: { economic: 1, social: -1 },
      applied: { economic: -0.25, social: 0.25 },
    });
  });

  it("uses the average of the provisions, not each provision in turn", async () => {
    const { db, characters } = makeMockDb();
    await applyBillVotePolicyShift(db as never, {
      collection: "bills",
      billId,
      characterId,
      // Average economic is -1, which a voter at -1 already matches: no move.
      provisions: [{ economic: -3 }, { economic: 1 }],
      vote: "for",
      currentPolicies: { economic: -1, social: 0 },
      ledgerEntry: undefined,
    });
    expect(characters.updateOne).not.toHaveBeenCalled();
  });

  it("switching Aye to Nay lands at the baseline minus one step, not two steps from current", async () => {
    const { db, characters, bills } = makeMockDb();
    await applyBillVotePolicyShift(db as never, {
      collection: "bills",
      billId,
      characterId,
      provisions: [{ economic: 3 }],
      vote: "against",
      currentPolicies: { economic: 1.25, social: 0 },
      ledgerEntry: {
        baseline: { economic: 1, social: 0 },
        applied: { economic: 0.25, social: 0 },
      },
    });
    expect(characterSet(characters)).toMatchObject({ "policies.economic": 0.75 });
    expect(ledgerWrite(bills)).toEqual({
      baseline: { economic: 1, social: 0 },
      applied: { economic: -0.25, social: 0 },
    });
  });

  it("switching to Abstain reverts the applied shift", async () => {
    const { db, characters, bills } = makeMockDb();
    await applyBillVotePolicyShift(db as never, {
      collection: "bills",
      billId,
      characterId,
      provisions: [{ economic: 3 }],
      vote: "abstain",
      currentPolicies: { economic: 0.75, social: 0 },
      ledgerEntry: {
        baseline: { economic: 1, social: 0 },
        applied: { economic: -0.25, social: 0 },
      },
    });
    expect(characterSet(characters)).toMatchObject({ "policies.economic": 1 });
    expect(ledgerWrite(bills)).toEqual({
      baseline: { economic: 1, social: 0 },
      applied: { economic: 0, social: 0 },
    });
  });

  it("preserves movement from other bills by adjusting the current position, not resetting to baseline", async () => {
    const { db, characters } = makeMockDb();
    // Baseline 1, this bill applied +0.25, then another bill moved them another +0.5 to 1.75.
    await applyBillVotePolicyShift(db as never, {
      collection: "bills",
      billId,
      characterId,
      provisions: [{ economic: 3 }],
      vote: "against",
      currentPolicies: { economic: 1.75, social: 0 },
      ledgerEntry: {
        baseline: { economic: 1, social: 0 },
        applied: { economic: 0.25, social: 0 },
      },
    });
    // -0.25 (new) minus +0.25 (applied) = -0.5 from where they are now.
    expect(characterSet(characters)).toMatchObject({ "policies.economic": 1.25 });
  });

  it("repeating the same vote changes nothing", async () => {
    const { db, characters, bills } = makeMockDb();
    await applyBillVotePolicyShift(db as never, {
      collection: "bills",
      billId,
      characterId,
      provisions: [{ economic: 3 }],
      vote: "for",
      currentPolicies: { economic: 1.25, social: 0 },
      ledgerEntry: {
        baseline: { economic: 1, social: 0 },
        applied: { economic: 0.25, social: 0 },
      },
    });
    expect(characters.updateOne).not.toHaveBeenCalled();
    expect(bills.updateOne).not.toHaveBeenCalled();
  });

  it("writes the ledger for state bills to the stateBills collection", async () => {
    const { db, bills } = makeMockDb();
    await applyBillVotePolicyShift(db as never, {
      collection: "stateBills",
      billId,
      characterId,
      provisions: [{ social: 3 }],
      vote: "for",
      currentPolicies: { economic: 0, social: 0 },
      ledgerEntry: undefined,
    });
    expect(db.collection).toHaveBeenCalledWith("stateBills");
    expect(ledgerWrite(bills)).toEqual({
      baseline: { economic: 0, social: 0 },
      applied: { economic: 0, social: 0.25 },
    });
  });

  it("records a ledger entry even when a first Aye moves nothing, so later re-votes stay capped", async () => {
    const { db, characters, bills } = makeMockDb();
    await applyBillVotePolicyShift(db as never, {
      collection: "bills",
      billId,
      characterId,
      provisions: [{ economic: 2 }],
      vote: "for",
      currentPolicies: { economic: 2, social: 0 },
      ledgerEntry: undefined,
    });
    expect(characters.updateOne).not.toHaveBeenCalled();
    expect(ledgerWrite(bills)).toEqual({
      baseline: { economic: 2, social: 0 },
      applied: { economic: 0, social: 0 },
    });
  });
});
