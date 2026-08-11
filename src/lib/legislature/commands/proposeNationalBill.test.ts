import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { AuthUser } from "@/lib/auth";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 5 }),
}));
vi.mock("@/lib/countryState", () => ({
  getCountryState: vi.fn().mockResolvedValue({ governmentType: "onePartyState" }),
}));
vi.mock("@/lib/countryAccess", () => ({
  getEnabledCountryIds: vi.fn().mockResolvedValue(["CN", "US"]),
}));

import { proposeNationalBill } from "./proposeNationalBill";

/**
 * Regression guard for Bug #0734: a seated CN delegate's bill was stored with
 * `currentChamber`/`originChamber` set to the *office type* ("npcDelegate")
 * instead of the *chamber key* ("npc"). Because every read path (bills list,
 * active-bill guard, turn lifecycle) keys on the chamber key, the bill became
 * invisible on the NPC page, blocked the sponsor from proposing another, and
 * never resolved. CN is the only country where officeType ≠ chamberKey.
 */
describe("proposeNationalBill — origin/current chamber storage", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  function seatDelegate(opts: { countryId: string; officeType: string; party?: string }): {
    authUser: AuthUser;
    charId: ObjectId;
  } {
    const charId = new ObjectId();
    const userId = new ObjectId();
    db.collection("characters").findOne.mockResolvedValue({
      _id: charId,
      name: "Test Delegate",
      userId,
      party: opts.party,
      actions: 10,
      nationalInfluence: 100,
    });
    db.collection("electedOfficials").findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId: charId,
      officeType: opts.officeType,
      countryId: opts.countryId,
    });
    // No pre-existing active bill for this sponsor.
    db.collection("bills").findOne.mockResolvedValue(null);
    return {
      authUser: { userId: userId.toString(), isAdmin: false } as AuthUser,
      charId,
    };
  }

  function insertedBill(): Record<string, unknown> {
    const call = db.collectionMocks.bills!.insertOne.mock.calls[0];
    expect(call).toBeDefined();
    return call![0] as Record<string, unknown>;
  }

  it("stores a CN delegate's bill under chamber key 'npc', not office type 'npcDelegate'", async () => {
    const { authUser } = seatDelegate({ countryId: "CN", officeType: "npcDelegate" });

    const result = await proposeNationalBill(db as unknown as Db, "CN", authUser, {
      title: "Public Security and Criminal Justice Reform Act",
      summary: "A test bill.",
      chamber: "npc",
      category: "general",
      provisions: [],
    });

    expect(result.status).toBe(201);
    const bill = insertedBill();
    expect(bill.originChamber).toBe("npc");
    expect(bill.currentChamber).toBe("npc");
  });

  it("leaves a US House member's bill under chamber key 'house' (identity mapping unchanged)", async () => {
    const { authUser } = seatDelegate({ countryId: "US", officeType: "house" });

    const result = await proposeNationalBill(db as unknown as Db, "US", authUser, {
      title: "A US Bill",
      summary: "A test bill.",
      chamber: "house",
      category: "general",
      provisions: [],
    });

    expect(result.status).toBe(201);
    const bill = insertedBill();
    expect(bill.originChamber).toBe("house");
    expect(bill.currentChamber).toBe("house");
  });
});

describe("proposeNationalBill — custom (flavor) bills", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  function seat(): AuthUser {
    const charId = new ObjectId();
    const userId = new ObjectId();
    db.collection("characters").findOne.mockResolvedValue({
      _id: charId,
      name: "Rep",
      userId,
      actions: 10,
      nationalInfluence: 100,
    });
    db.collection("electedOfficials").findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId: charId,
      officeType: "house",
      countryId: "US",
    });
    db.collection("bills").findOne.mockResolvedValue(null);
    return { userId: userId.toString(), isAdmin: false } as AuthUser;
  }

  function inserted(): Record<string, unknown> {
    const call = db.collectionMocks.bills!.insertOne.mock.calls[0];
    expect(call).toBeDefined();
    return call![0] as Record<string, unknown>;
  }

  it("stores a custom bill with empty provisions and no NPI cost", async () => {
    const authUser = seat();
    const result = await proposeNationalBill(db as unknown as Db, "US", authUser, {
      title: "Declaration of Friendship",
      summary: "We hereby declare eternal friendship.",
      chamber: "house",
      category: "custom",
      provisions: [],
    });
    expect(result.status).toBe(201);
    const bill = inserted();
    expect(bill.category).toBe("custom");
    expect(bill.provisions).toEqual([]);
    expect(bill.proposalNpiCost).toBeUndefined();
  });

  it("strips any provisions a client smuggles into a custom bill", async () => {
    const authUser = seat();
    const result = await proposeNationalBill(db as unknown as Db, "US", authUser, {
      title: "Sneaky Bill",
      summary: "Pretends to be flavor.",
      chamber: "house",
      category: "custom",
      provisions: [{ legislationTypeId: "some-real-effect", effectDirection: 1 }],
    });
    expect(result.status).toBe(201);
    expect(inserted().provisions).toEqual([]);
  });
});

/**
 * Suggestion #77: bicameral legislatures free the first chamber for a new
 * proposal once the sponsor's bill has cleared it (passed_origin / active_other
 * = now in the second chamber). Asserted at the query level — the active-bill
 * guard's status filter widens for bicameral countries only.
 */
describe("proposeNationalBill — bicameral proposal relief (#77)", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  function seatMember(countryId: string, officeType: string): AuthUser {
    const charId = new ObjectId();
    const userId = new ObjectId();
    db.collection("characters").findOne.mockResolvedValue({
      _id: charId,
      name: "Member",
      userId,
      actions: 10,
      nationalInfluence: 100,
    });
    db.collection("electedOfficials").findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId: charId,
      officeType,
      countryId,
    });
    db.collection("bills").findOne.mockResolvedValue(null);
    return { userId: userId.toString(), isAdmin: false } as AuthUser;
  }

  /** The active-bill guard's findOne — the one keyed on sponsorId + a status $nin. */
  function guardStatusNin(): string[] | undefined {
    const call = db.collectionMocks.bills!.findOne.mock.calls.find((c) => {
      const f = c[0] as { sponsorId?: unknown; status?: { $nin?: string[] } };
      return f?.sponsorId != null && Array.isArray(f?.status?.$nin);
    });
    return call ? (call[0] as { status: { $nin: string[] } }).status.$nin : undefined;
  }

  it("widens the bicameral (US) guard so second-chamber bills no longer block", async () => {
    const authUser = seatMember("US", "house");
    const result = await proposeNationalBill(db as unknown as Db, "US", authUser, {
      title: "US Bill",
      summary: "A test bill.",
      chamber: "house",
      category: "custom",
      provisions: [],
    });
    expect(result.status).toBe(201);
    expect(guardStatusNin()).toEqual(expect.arrayContaining(["active_other", "passed_origin"]));
  });

  it("keeps the strict one-at-a-time guard for unicameral (CN)", async () => {
    const authUser = seatMember("CN", "npcDelegate");
    const result = await proposeNationalBill(db as unknown as Db, "CN", authUser, {
      title: "CN Bill",
      summary: "A test bill.",
      chamber: "npc",
      category: "custom",
      provisions: [],
    });
    expect(result.status).toBe(201);
    expect(guardStatusNin()).not.toContain("active_other");
  });
});
