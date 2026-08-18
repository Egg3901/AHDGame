import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";

vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/news", () => ({
  createSystemNewsPost: vi.fn().mockResolvedValue(undefined),
}));

import { processCentralBankChairExecutiveRemoval } from "./centralBankChairExecutiveRemoval";

/** Cursor supporting both `.toArray()` and `.project().toArray()` chains. */
function cursor(rows: unknown[]) {
  const c: Record<string, unknown> = {
    project: () => c,
    sort: () => c,
    limit: () => c,
    skip: () => c,
    toArray: async () => rows,
  };
  return c;
}

interface BankFixture {
  _id: string;
  countryId: string;
  chairCharacterId?: ObjectId | null;
  chairCharacterName?: string | null;
  chairTermExpiresAtTurn?: number | null;
  chairSelectionPending?: Record<string, unknown> | null;
  chairMode?: "character" | "npp";
}

/**
 * Build a mock Db wired for the sweep. `banks` may be a single array (returned
 * every find) or a list of arrays consumed one-per-find call (for idempotency).
 */
function makeDb(opts: {
  banks: BankFixture[] | BankFixture[][];
  characters?: { _id: ObjectId; currentOffice?: unknown }[];
  officials?: { officeType: string; characterId: ObjectId }[];
  chairDoc?: { _id: ObjectId; name: string; userId: ObjectId } | null;
}) {
  const bankFind = vi.fn();
  if (Array.isArray(opts.banks[0])) {
    for (const batch of opts.banks as BankFixture[][]) {
      bankFind.mockReturnValueOnce(cursor(batch));
    }
    bankFind.mockReturnValue(cursor([]));
  } else {
    bankFind.mockReturnValue(cursor(opts.banks as BankFixture[]));
  }

  const bankUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  const charsFindOne = vi.fn().mockResolvedValue(opts.chairDoc ?? null);

  const collections: Record<string, Record<string, unknown>> = {
    centralBanks: { find: bankFind, updateOne: bankUpdateOne },
    characters: {
      find: () => cursor(opts.characters ?? []),
      findOne: charsFindOne,
    },
    electedOfficials: { find: () => cursor(opts.officials ?? []) },
    organizationMemberships: { find: () => cursor([]) },
  };

  const db = {
    collection: vi.fn((name: string) => collections[name] ?? { find: () => cursor([]) }),
    _bankUpdateOne: bankUpdateOne,
  };
  return db;
}

describe("processCentralBankChairExecutiveRemoval", () => {
  const gameNow = new Date("2026-06-01T00:00:00Z");

  beforeEach(() => vi.clearAllMocks());

  it("vacates a chair who has become Prime Minister and flags re-selection", async () => {
    const chairId = new ObjectId();
    const db = makeDb({
      banks: [
        { _id: "UK", countryId: "UK", chairCharacterId: chairId, chairTermExpiresAtTurn: 500 },
      ],
      characters: [{ _id: chairId, currentOffice: { type: "primeMinister" } }],
      chairDoc: { _id: chairId, name: "Chair-Turned-PM", userId: new ObjectId() },
    });

    const result = await processCentralBankChairExecutiveRemoval(db as unknown as Db, 100, gameNow);

    expect(result.chairsRemoved).toBe(1);
    // Two writes: the single-chair mirror is vacated, then the committee's
    // chair seat is emptied so the removed executive stops voting the rate.
    expect(db._bankUpdateOne).toHaveBeenCalledTimes(2);
    const [filter, update] = db._bankUpdateOne.mock.calls[0]!;
    expect(filter).toEqual({ _id: "UK" });
    expect((update as { $set: Record<string, unknown> }).$set.chairCharacterId).toBeNull();
    expect(
      (update as { $set: Record<string, unknown> }).$set.vacancyAwaitingAutomaticSelection
    ).toBe(true);
    const [seatFilter, seatUpdate] = db._bankUpdateOne.mock.calls[1]!;
    expect(seatFilter).toEqual({ _id: "UK", "fomcBoard.isChair": true });
    expect(
      (seatUpdate as { $set: Record<string, unknown> }).$set["fomcBoard.$[chair].occupantType"]
    ).toBe("vacant");
  });

  it("leaves a chair who only holds a legislative seat untouched", async () => {
    const chairId = new ObjectId();
    const db = makeDb({
      banks: [
        { _id: "UK", countryId: "UK", chairCharacterId: chairId, chairTermExpiresAtTurn: 500 },
      ],
      characters: [{ _id: chairId, currentOffice: { type: "commons", state: "ENG" } }],
    });

    const result = await processCentralBankChairExecutiveRemoval(db as unknown as Db, 100, gameNow);

    expect(result.chairsRemoved).toBe(0);
    expect(db._bankUpdateOne).not.toHaveBeenCalled();
  });

  it("vacates a chair who is CN's ceremonial President (electedOfficials only)", async () => {
    const chairId = new ObjectId();
    const db = makeDb({
      banks: [
        { _id: "CN", countryId: "CN", chairCharacterId: chairId, chairTermExpiresAtTurn: 500 },
      ],
      // No executive currentOffice — ceremonial President lives only as an
      // electedOfficials row keyed off the CCP chair.
      characters: [{ _id: chairId, currentOffice: { type: "npcDelegate", state: "BEI" } }],
      officials: [{ officeType: "president", characterId: chairId }],
      chairDoc: { _id: chairId, name: "General Secretary", userId: new ObjectId() },
    });

    const result = await processCentralBankChairExecutiveRemoval(db as unknown as Db, 100, gameNow);

    expect(result.chairsRemoved).toBe(1);
    // Mirror vacate + committee chair-seat vacate.
    expect(db._bankUpdateOne).toHaveBeenCalledTimes(2);
  });

  it("clears a pending proposal whose nominee has become an executive", async () => {
    const nomineeId = new ObjectId();
    const db = makeDb({
      banks: [
        {
          _id: "UK",
          countryId: "UK",
          chairCharacterId: null,
          chairSelectionPending: {
            characterId: nomineeId,
            characterName: "Pending-PM",
            pool: "economic",
          },
        },
      ],
      characters: [{ _id: nomineeId, currentOffice: { type: "primeMinister" } }],
    });

    const result = await processCentralBankChairExecutiveRemoval(db as unknown as Db, 100, gameNow);

    expect(result.pendingCleared).toBe(1);
    expect(db._bankUpdateOne).toHaveBeenCalledTimes(1);
    const [, update] = db._bankUpdateOne.mock.calls[0]!;
    expect((update as { $set: Record<string, unknown> }).$set.chairSelectionPending).toBeNull();
  });

  it("is idempotent — once vacated the bank no longer qualifies and nothing is removed", async () => {
    const chairId = new ObjectId();
    const db = makeDb({
      // First find: the seated bank. Second find (post-removal): no qualifying banks.
      banks: [
        [{ _id: "UK", countryId: "UK", chairCharacterId: chairId, chairTermExpiresAtTurn: 500 }],
        [],
      ],
      characters: [{ _id: chairId, currentOffice: { type: "primeMinister" } }],
      chairDoc: { _id: chairId, name: "Chair-Turned-PM", userId: new ObjectId() },
    });

    const first = await processCentralBankChairExecutiveRemoval(db as unknown as Db, 100, gameNow);
    const second = await processCentralBankChairExecutiveRemoval(db as unknown as Db, 101, gameNow);

    expect(first.chairsRemoved).toBe(1);
    expect(second.chairsRemoved).toBe(0);
    expect(second.banksChecked).toBe(0);
  });

  it("is a no-op for npp chairs even when the chair is nominally seated", async () => {
    const chairId = new ObjectId();
    const db = makeDb({
      banks: [
        {
          _id: "UK",
          countryId: "UK",
          chairCharacterId: chairId,
          chairTermExpiresAtTurn: 500,
          chairMode: "npp",
        },
      ],
      // The character is a PM — which would normally trigger removal — but the
      // npp branch must skip before the executive check runs.
      characters: [{ _id: chairId, currentOffice: { type: "primeMinister" } }],
      chairDoc: { _id: chairId, name: "Technocrat", userId: new ObjectId() },
    });

    const result = await processCentralBankChairExecutiveRemoval(db as unknown as Db, 100, gameNow);

    // Skipped entirely: no chairsChecked, no removals, no pending clears, no writes.
    expect(result.banksChecked).toBe(0);
    expect(result.chairsRemoved).toBe(0);
    expect(result.pendingCleared).toBe(0);
    expect(db._bankUpdateOne).not.toHaveBeenCalled();
  });

  it("still removes a character-mode chair who has taken executive office", async () => {
    const chairId = new ObjectId();
    const db = makeDb({
      banks: [
        {
          _id: "UK",
          countryId: "UK",
          chairCharacterId: chairId,
          chairTermExpiresAtTurn: 500,
          chairMode: "character",
        },
      ],
      characters: [{ _id: chairId, currentOffice: { type: "primeMinister" } }],
      chairDoc: { _id: chairId, name: "Chair-Turned-PM", userId: new ObjectId() },
    });

    const result = await processCentralBankChairExecutiveRemoval(db as unknown as Db, 100, gameNow);

    expect(result.chairsRemoved).toBe(1);
    // Mirror vacate + committee chair-seat vacate.
    expect(db._bankUpdateOne).toHaveBeenCalledTimes(2);
  });
});
