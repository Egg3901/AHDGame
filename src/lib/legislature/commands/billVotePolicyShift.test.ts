/**
 * Vote → ideology shift wiring.
 *
 * `policyShift.test.ts` proves the arithmetic in isolation and the congress
 * route test mocks `applyBillVotePolicyShift` out entirely, so nothing checked
 * that a cast vote actually reaches the character document. These run the
 * REAL shift helper through both vote commands and assert the `characters`
 * write that the profile compass reads back.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { AuthUser, AuthUserWithCharacter } from "@/lib/auth";
import type { Bill, Character, StateBill } from "@/lib/db/types";

vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 5 }),
}));
vi.mock("@/lib/countryState", () => ({
  getCountryState: vi.fn().mockResolvedValue({ governmentType: "republic" }),
}));
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/news", () => ({
  generateBillSignedNews: vi.fn().mockResolvedValue(undefined),
  generateBillVetoedNews: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/billLifecycle/regionalEngine", () => ({
  finalizeStateBillEnactment: vi.fn().mockResolvedValue({ enacted: true }),
}));

import { performNationalBillAction } from "./nationalBillActions";
import { castStateBillVote } from "./stateBillActions";

const characterId = new ObjectId();

function makeCharacter(policies: { economic: number; social: number }): Character {
  return {
    _id: characterId,
    name: "Rep Voter",
    party: undefined,
    policies,
  } as unknown as Character;
}

/** The `$set` body of the shift write on `characters`, or null when none fired. */
function characterShift(db: MockDb): Record<string, unknown> | null {
  const calls = db.collectionMocks["characters"]?.updateOne.mock.calls ?? [];
  if (calls.length === 0) return null;
  expect(calls).toHaveLength(1);
  const [filter, update] = calls[0]! as [
    Record<string, unknown>,
    { $set: Record<string, unknown> },
  ];
  expect(filter).toEqual({ _id: characterId });
  return update.$set;
}

/** The ledger entry written for this voter on the bill collection, or null when none. */
function ledgerWrite(db: MockDb, collection: "bills" | "stateBills") {
  const key = `policyShiftLedger.${characterId.toString()}`;
  const calls = db.collectionMocks[collection]?.updateOne.mock.calls ?? [];
  const writes = calls.filter((call) => {
    const update = call[1] as { $set?: Record<string, unknown> } | unknown[];
    return !Array.isArray(update) && update.$set !== undefined && key in update.$set;
  });
  if (writes.length === 0) return null;
  expect(writes).toHaveLength(1);
  return (writes[0]![1] as { $set: Record<string, unknown> }).$set[key];
}

describe("national bill vote → policy shift", () => {
  let db: MockDb;
  const authUser = { userId: new ObjectId().toString(), isAdmin: false } as AuthUser;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("electedOfficials").findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId,
      countryId: "US",
      officeType: "house",
      seatsHeld: 1,
    });
    db.collection("bills").updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  });

  function usBill(overrides: Partial<Bill> = {}): Bill {
    return {
      _id: new ObjectId(),
      title: "Public Works Act",
      summary: "Summary",
      originChamber: "house",
      currentChamber: "house",
      sponsorId: new ObjectId(),
      sponsorName: "Sponsor",
      status: "active",
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: {},
      countryId: "US",
      votingEndsOnTurn: 999,
      proposedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      provisions: [
        { legislationTypeId: "lt-1", effectDirection: 1, economic: -3, social: 2 },
      ] as Bill["provisions"],
      ...overrides,
    } as Bill;
  }

  it("an Aye moves both axes one 0.25 step toward the bill", async () => {
    const result = await performNationalBillAction(db as unknown as Db, {
      authUser,
      character: makeCharacter({ economic: 1, social: -1 }),
      bill: usBill(),
      countryId: "US",
      input: { action: "vote", vote: "for" },
    });
    expect(result.status).toBe(200);
    expect(characterShift(db)).toMatchObject({
      "policies.economic": 0.75,
      "policies.social": -0.75,
    });
  });

  it("a Nay moves both axes one 0.25 step away from the bill", async () => {
    const result = await performNationalBillAction(db as unknown as Db, {
      authUser,
      character: makeCharacter({ economic: 1, social: -1 }),
      bill: usBill(),
      countryId: "US",
      input: { action: "vote", vote: "against" },
    });
    expect(result.status).toBe(200);
    expect(characterShift(db)).toMatchObject({
      "policies.economic": 1.25,
      "policies.social": -1.25,
    });
  });

  it("an abstention records the vote but leaves the character untouched", async () => {
    const result = await performNationalBillAction(db as unknown as Db, {
      authUser,
      character: makeCharacter({ economic: 1, social: -1 }),
      bill: usBill(),
      countryId: "US",
      input: { action: "vote", vote: "abstain" },
    });
    expect(result.status).toBe(200);
    expect(characterShift(db)).toBeNull();
  });

  it("a first Aye records the voter's baseline and applied step on the bill", async () => {
    await performNationalBillAction(db as unknown as Db, {
      authUser,
      character: makeCharacter({ economic: 1, social: -1 }),
      bill: usBill(),
      countryId: "US",
      input: { action: "vote", vote: "for" },
    });
    expect(ledgerWrite(db, "bills")).toEqual({
      baseline: { economic: 1, social: -1 },
      applied: { economic: -0.25, social: 0.25 },
    });
  });

  it("switching Aye to Nay lands one step the other side of the baseline, never two from current", async () => {
    const result = await performNationalBillAction(db as unknown as Db, {
      authUser,
      // Baseline was 1 / -1; the Aye already moved them to 0.75 / -0.75.
      character: makeCharacter({ economic: 0.75, social: -0.75 }),
      bill: usBill({
        votes: { [characterId.toString()]: "for" },
        policyShiftLedger: {
          [characterId.toString()]: {
            baseline: { economic: 1, social: -1 },
            applied: { economic: -0.25, social: 0.25 },
          },
        },
      }),
      countryId: "US",
      input: { action: "vote", vote: "against" },
    });
    expect(result.status).toBe(200);
    expect(characterShift(db)).toMatchObject({
      "policies.economic": 1.25,
      "policies.social": -1.25,
    });
    expect(ledgerWrite(db, "bills")).toEqual({
      baseline: { economic: 1, social: -1 },
      applied: { economic: 0.25, social: -0.25 },
    });
  });

  it("switching to Abstain reverts what this bill applied", async () => {
    const result = await performNationalBillAction(db as unknown as Db, {
      authUser,
      character: makeCharacter({ economic: 0.75, social: -0.75 }),
      bill: usBill({
        votes: { [characterId.toString()]: "for" },
        policyShiftLedger: {
          [characterId.toString()]: {
            baseline: { economic: 1, social: -1 },
            applied: { economic: -0.25, social: 0.25 },
          },
        },
      }),
      countryId: "US",
      input: { action: "vote", vote: "abstain" },
    });
    expect(result.status).toBe(200);
    expect(characterShift(db)).toMatchObject({
      "policies.economic": 1,
      "policies.social": -1,
    });
  });

  it("changing a legacy vote with no ledger entry does not shift", async () => {
    const result = await performNationalBillAction(db as unknown as Db, {
      authUser,
      character: makeCharacter({ economic: 1, social: -1 }),
      bill: usBill({ votes: { [characterId.toString()]: "for" } }),
      countryId: "US",
      input: { action: "vote", vote: "against" },
    });
    expect(result.status).toBe(200);
    expect(characterShift(db)).toBeNull();
    expect(ledgerWrite(db, "bills")).toBeNull();
  });

  it("a vote a whip imposed on an unvoted member does not block their first personal vote", async () => {
    const result = await performNationalBillAction(db as unknown as Db, {
      authUser,
      character: makeCharacter({ economic: 1, social: -1 }),
      bill: usBill({
        votes: { [characterId.toString()]: "for" },
        whippedFromVote: { [characterId.toString()]: "unvoted" },
      }),
      countryId: "US",
      input: { action: "vote", vote: "against" },
    });
    expect(result.status).toBe(200);
    expect(characterShift(db)).toMatchObject({
      "policies.economic": 1.25,
      "policies.social": -1.25,
    });
    expect(ledgerWrite(db, "bills")).toEqual({
      baseline: { economic: 1, social: -1 },
      applied: { economic: 0.25, social: -0.25 },
    });
  });

  it("a whip override of a legacy personal vote still does not grant a free step", async () => {
    const result = await performNationalBillAction(db as unknown as Db, {
      authUser,
      character: makeCharacter({ economic: 1, social: -1 }),
      bill: usBill({
        votes: { [characterId.toString()]: "for" },
        // They had personally voted Nay before the ledger existed; the whip flipped it.
        whippedFromVote: { [characterId.toString()]: "against" },
      }),
      countryId: "US",
      input: { action: "vote", vote: "against" },
    });
    expect(result.status).toBe(200);
    expect(characterShift(db)).toBeNull();
  });

  it("reads the upper chamber's own ledger under a concurrent vote", async () => {
    db.collection("electedOfficials").findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId,
      countryId: "US",
      officeType: "senate",
      seatsHeld: 1,
    });
    const result = await performNationalBillAction(db as unknown as Db, {
      authUser,
      character: makeCharacter({ economic: 0.75, social: -0.75 }),
      bill: usBill({
        status: "active_both",
        otherChamberVotes: { [characterId.toString()]: "for" },
        otherChamberVotingEndsOnTurn: 999,
        policyShiftLedger: {
          [characterId.toString()]: {
            baseline: { economic: 1, social: -1 },
            applied: { economic: -0.25, social: 0.25 },
          },
        },
      }),
      countryId: "US",
      input: { action: "vote", vote: "against" },
    });
    expect(result.status).toBe(200);
    expect(characterShift(db)).toMatchObject({
      "policies.economic": 1.25,
      "policies.social": -1.25,
    });
  });

  it("provisions that take no stance (omitted or 0) do not move the voter", async () => {
    const result = await performNationalBillAction(db as unknown as Db, {
      authUser,
      character: makeCharacter({ economic: 1, social: -1 }),
      bill: usBill({
        provisions: [
          { legislationTypeId: "lt-1", effectDirection: 1, economic: 0, social: 0 },
          { legislationTypeId: "lt-2", effectDirection: 1 },
        ] as Bill["provisions"],
      }),
      countryId: "US",
      input: { action: "vote", vote: "for" },
    });
    expect(result.status).toBe(200);
    expect(characterShift(db)).toBeNull();
  });

  it("tariff and subsidy provisions carry no ideology and are ignored", async () => {
    const result = await performNationalBillAction(db as unknown as Db, {
      authUser,
      character: makeCharacter({ economic: 1, social: -1 }),
      bill: usBill({
        provisions: [
          { type: "tariff", economic: 3 },
          { type: "subsidy", social: 3 },
        ] as unknown as Bill["provisions"],
      }),
      countryId: "US",
      input: { action: "vote", vote: "for" },
    });
    expect(result.status).toBe(200);
    expect(characterShift(db)).toBeNull();
  });
});

describe("state bill vote → policy shift", () => {
  let db: MockDb;
  const user = {
    userId: new ObjectId().toString(),
    character: makeCharacter({ economic: 0, social: 0 }),
  } as unknown as AuthUserWithCharacter;

  function txBill(overrides: Partial<StateBill> = {}): StateBill {
    return {
      _id: new ObjectId(),
      stateId: "TX",
      countryId: "US",
      title: "School Funding Act",
      status: "active",
      sponsorId: null,
      sponsorName: "NPP",
      votes: {},
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      votingEndsOnTurn: 999,
      provisions: [{ legislationTypeId: "lt-1", effectDirection: 1, economic: 2, social: -2 }],
      ...overrides,
    } as unknown as StateBill;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("electedOfficials").findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId,
      countryId: "US",
      officeType: "stateSenate",
      state: "TX",
      seatsHeld: 2,
    });
    db.collection("gameState").findOne.mockResolvedValue({ _id: "current", currentTurn: 5 });
    db.collection("stateBills").updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  });

  it("an Aye moves both axes one 0.25 step toward the bill", async () => {
    const bill = txBill();
    db.collection("stateBills").findOne.mockResolvedValue(bill);
    const result = await castStateBillVote(
      db as unknown as Db,
      "US",
      "tx",
      bill._id.toString(),
      user,
      "for"
    );
    expect(result.status).toBe(200);
    expect(characterShift(db)).toMatchObject({
      "policies.economic": 0.25,
      "policies.social": -0.25,
    });
  });

  it("a Nay moves both axes one 0.25 step away from the bill", async () => {
    const bill = txBill();
    db.collection("stateBills").findOne.mockResolvedValue(bill);
    const result = await castStateBillVote(
      db as unknown as Db,
      "US",
      "TX",
      bill._id.toString(),
      user,
      "against"
    );
    expect(result.status).toBe(200);
    expect(characterShift(db)).toMatchObject({
      "policies.economic": -0.25,
      "policies.social": 0.25,
    });
  });

  it("a first Aye records the ledger entry on the state bill", async () => {
    const bill = txBill();
    db.collection("stateBills").findOne.mockResolvedValue(bill);
    await castStateBillVote(db as unknown as Db, "US", "TX", bill._id.toString(), user, "for");
    expect(ledgerWrite(db, "stateBills")).toEqual({
      baseline: { economic: 0, social: 0 },
      applied: { economic: 0.25, social: -0.25 },
    });
  });

  it("switching Nay to Aye lands one step the other side of the baseline", async () => {
    const bill = txBill({
      votes: { [characterId.toString()]: "against" },
      policyShiftLedger: {
        [characterId.toString()]: {
          baseline: { economic: 0, social: 0 },
          applied: { economic: -0.25, social: 0.25 },
        },
      },
    });
    db.collection("stateBills").findOne.mockResolvedValue(bill);
    const result = await castStateBillVote(
      db as unknown as Db,
      "US",
      "TX",
      bill._id.toString(),
      { ...user, character: makeCharacter({ economic: -0.25, social: 0.25 }) },
      "for"
    );
    expect(result.status).toBe(200);
    expect(characterShift(db)).toMatchObject({
      "policies.economic": 0.25,
      "policies.social": -0.25,
    });
  });

  it("changing a legacy vote with no ledger entry does not shift", async () => {
    const bill = txBill({ votes: { [characterId.toString()]: "against" } });
    db.collection("stateBills").findOne.mockResolvedValue(bill);
    const result = await castStateBillVote(
      db as unknown as Db,
      "US",
      "TX",
      bill._id.toString(),
      user,
      "for"
    );
    expect(result.status).toBe(200);
    expect(characterShift(db)).toBeNull();
    expect(ledgerWrite(db, "stateBills")).toBeNull();
  });
});
