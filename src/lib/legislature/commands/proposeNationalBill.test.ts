import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { AuthUser } from "@/lib/auth";
import { RESET_V2_SEED_REVISION } from "@/lib/resetVersions/rules";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
const checkBillSponsoredAchievements = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/achievements/triggers", () => ({ checkBillSponsoredAchievements }));
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

  it.each([
    ["SCO", "holyrood"],
    ["WAL", "senedd"],
  ] as const)("allows a seated %s member to propose a national bill", async (country, chamber) => {
    const { authUser } = seatDelegate({ countryId: country, officeType: chamber });
    const result = await proposeNationalBill(db as unknown as Db, country, authUser, {
      title: "Successor Country Bill",
      summary: "Synthetic qualification bill",
      chamber,
      category: "custom",
      provisions: [],
    });
    expect(result.status).toBe(201);
    expect(insertedBill()).toMatchObject({
      countryId: country,
      originChamber: chamber,
      currentChamber: chamber,
    });
  });

  it("persists an eligible euro adoption provision and charges its legislative cost", async () => {
    db.collection("gameState").findOne.mockResolvedValue({ currentYear: 1999 });
    db.collection("organizationMemberships").find.mockReturnValue({
      toArray: async () => [{ countryId: "DE" }],
    });
    const { getEnabledCountryIds } = await import("@/lib/countryAccess");
    vi.mocked(getEnabledCountryIds).mockResolvedValueOnce(["DE"]);
    const { authUser } = seatDelegate({ countryId: "DE", officeType: "bundestag" });
    const result = await proposeNationalBill(db as unknown as Db, "DE", authUser, {
      title: "Euro Adoption Act",
      summary: "Approve participation in euro adoption.",
      chamber: "bundestag",
      category: "economy",
      provisions: [{ type: "euro_adoption" }],
    });
    expect(result.status).toBe(201);
    expect(insertedBill().provisions).toEqual([{ type: "euro_adoption" }]);
    const debit = db.collectionMocks.characters!.updateOne.mock.calls.find(
      (call) => call[1]?.$inc?.nationalInfluence < 0
    );
    expect(debit).toBeDefined();
  });

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

  it("keeps a landed bill and its cost when the achievement check throws", async () => {
    const { authUser } = seatDelegate({ countryId: "CN", officeType: "npcDelegate" });
    checkBillSponsoredAchievements.mockRejectedValueOnce(new Error("achievements down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await proposeNationalBill(db as unknown as Db, "CN", authUser, {
      title: "Public Security and Criminal Justice Reform Act",
      summary: "A test bill.",
      chamber: "npc",
      category: "general",
      provisions: [],
    });

    expect(result.status).toBe(201);
    expect(insertedBill()).toBeDefined();
    // No refund: the only character write is the proposal's own debit.
    const refunds = db.collectionMocks.characters.updateOne.mock.calls.filter(([, update]) => {
      const inc = (update as { $inc?: { actions?: number } }).$inc;
      return typeof inc?.actions === "number" && inc.actions > 0;
    });
    expect(refunds).toHaveLength(0);
    errors.mockRestore();
  });

  it("checks the first-bill achievement for a non-US sponsor (ticket 1387)", async () => {
    const { authUser, charId } = seatDelegate({ countryId: "CN", officeType: "npcDelegate" });

    const result = await proposeNationalBill(db as unknown as Db, "CN", authUser, {
      title: "Public Security and Criminal Justice Reform Act",
      summary: "A test bill.",
      chamber: "npc",
      category: "general",
      provisions: [],
    });

    expect(result.status).toBe(201);
    expect(checkBillSponsoredAchievements).toHaveBeenCalledTimes(1);
    expect(checkBillSponsoredAchievements.mock.calls[0]![1]).toEqual(charId);
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

  it("preserves the US joint-bill lane when using the shared national command", async () => {
    const { authUser } = seatDelegate({ countryId: "US", officeType: "senate" });

    const result = await proposeNationalBill(db as unknown as Db, "US", authUser, {
      title: "A Joint US Bill",
      summary: "A test bill.",
      chamber: "joint",
      category: "custom",
      provisions: [],
    });

    expect(result.status).toBe(201);
    expect(insertedBill()).toMatchObject({ originChamber: "joint", currentChamber: "house" });
  });

  it("does not let a US member originate a bill in the other chamber", async () => {
    const { authUser } = seatDelegate({ countryId: "US", officeType: "house" });

    const result = await proposeNationalBill(db as unknown as Db, "US", authUser, {
      title: "Wrong Chamber",
      summary: "A test bill.",
      chamber: "senate",
      category: "custom",
      provisions: [],
    });

    expect(result.status).toBe(403);
    expect(db.collectionMocks.bills!.insertOne).not.toHaveBeenCalled();
  });
  it.each([
    [{}, "unionCongressDeputy", "unionCongress"],
    [{ ruSovietSuccessionSinceTurn: 4 }, "congressDeputy", "congressOfPeoplesDeputies"],
    [{ ruSovietSuccessionSinceTurn: 4, ruFederalAssemblySinceTurn: 4 }, "dumaDeputy", "stateDuma"],
  ] as const)(
    "lets the active Russian deputy propose under %s",
    async (markers, officeType, chamber) => {
      const { getGameState } = await import("@/lib/gameState");
      vi.mocked(getGameState).mockResolvedValue({
        currentTurn: 5,
        preset: "1991-default",
      } as never);
      db.collection("countryGameStates").findOne.mockResolvedValue({ _id: "RU", ...markers });
      const { authUser } = seatDelegate({ countryId: "RU", officeType });
      const result = await proposeNationalBill(db as unknown as Db, "RU", authUser, {
        title: "Russian mandate",
        summary: "Test",
        chamber,
        category: "custom",
        provisions: [],
      });
      expect(result.status).toBe(201);
      expect(insertedBill()).toMatchObject({ originChamber: chamber, currentChamber: chamber });
      expect(db.collectionMocks.electedOfficials!.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ officeType: { $in: expect.arrayContaining([officeType]) } })
      );
      vi.mocked(getGameState).mockResolvedValue({ currentTurn: 5 } as never);
    }
  );
  it("refuses new bills in a dissolved Russian Congress even for admins", async () => {
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 5, preset: "1991-default" } as never);
    db.collection("countryGameStates").findOne.mockResolvedValue({
      _id: "RU",
      ruCongressDissolvedSinceTurn: 4,
    });
    const result = await proposeNationalBill(
      db as unknown as Db,
      "RU",
      { userId: new ObjectId().toString(), isAdmin: true } as AuthUser,
      {
        title: "Closed Congress",
        summary: "Test",
        chamber: "congressOfPeoplesDeputies",
        category: "custom",
        provisions: [],
      }
    );
    expect(result.status).toBe(409);
    expect(db.collection("bills").insertOne).not.toHaveBeenCalled();
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 5 } as never);
  });
});

describe("proposeNationalBill — custom (flavor) bills", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 5 } as never);
    db = createMockDb();
  });

  function seat(countryId = "US", officeType = "house"): AuthUser {
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
      officeType,
      countryId,
    });
    db.collection("bills").findOne.mockResolvedValue(null);
    return { userId: userId.toString(), isAdmin: false } as AuthUser;
  }

  function inserted(): Record<string, unknown> {
    const call = db.collectionMocks.bills!.insertOne.mock.calls[0];
    expect(call).toBeDefined();
    return call![0] as Record<string, unknown>;
  }

  it.each([
    ["legacy", "US", "house"],
    ["v2", "US", "house"],
    ["v2", "UK", "commons"],
    ["v2", "JP", "shugiin"],
  ] as const)(
    "stores a %s %s custom bill with empty provisions and no NPI cost",
    async (version, countryId, chamber) => {
      const { getGameState } = await import("@/lib/gameState");
      const state = {
        currentTurn: 5,
        ...(version === "v2"
          ? {
              resetWorldId: "test-world",
              startingYear: 1991,
              metricsSystemVersion: "v2",
              legislationSystemVersion: "v2",
              resetVersionSeeds: Object.fromEntries(
                (["metrics", "legislation"] as const).map((system) => [
                  system,
                  {
                    worldId: "test-world",
                    revision: RESET_V2_SEED_REVISION[system],
                    sourceTurn: 1,
                    completedAt: "2026-10-11T00:00:00.000Z",
                    verificationHash: system,
                  },
                ])
              ),
            }
          : {}),
      };
      vi.mocked(getGameState).mockResolvedValue(state as never);
      db.collection("gameState").findOne.mockResolvedValue(state);
      const authUser = seat(countryId, chamber);
      const result = await proposeNationalBill(db as unknown as Db, countryId, authUser, {
        title: "Declaration of Friendship",
        summary: "We hereby declare eternal friendship.",
        chamber,
        category: "custom",
        provisions: [],
      });
      expect(result.status).toBe(201);
      const bill = inserted();
      expect(bill.category).toBe("custom");
      expect(bill.provisions).toEqual([]);
      expect(bill.proposalNpiCost).toBeUndefined();
      expect(bill.legislationTypeId).toBeUndefined();
      expect(bill.effectDirection).toBeUndefined();
    }
  );

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

describe("proposeNationalBill — countries with no bill lifecycle (#806)", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  const input = {
    title: "A Bill",
    summary: "Does something",
    chamber: "holyrood",
    provisions: [],
  };

  it("refuses to mint a bill for a legislature no turn phase walks", async () => {
    // An unregistered country has no engine to advance or close its bills.
    const res = await proposeNationalBill(
      db as unknown as Db,
      "JO" as never,
      { userId: new ObjectId().toString() } as AuthUser,
      input as never
    );

    expect(res.status).toBe(400);
    expect(String((res.body as { error?: string }).error)).toMatch(
      /does not process national bills/i
    );
  });

  it("rejects before touching the database, so no partial bill is written", async () => {
    await proposeNationalBill(
      db as unknown as Db,
      "JO" as never,
      { userId: new ObjectId().toString() } as AuthUser,
      input as never
    );

    // The mock only materializes a collection once something asks for it, so
    // an untouched map proves the guard returned before any DB access.
    expect(Object.keys(db.collectionMocks)).toHaveLength(0);
  });

  it("does not block a country that DOES have a lifecycle", async () => {
    // The guard must be the only thing that changed for supported countries:
    // US has no COUNTRY_BILL_PHASES entry but does have an engine, so a bare
    // table lookup here would wrongly refuse the game's main legislature.
    const res = await proposeNationalBill(
      db as unknown as Db,
      "US" as never,
      { userId: new ObjectId().toString() } as AuthUser,
      { ...input, chamber: "house" } as never
    );

    expect(String((res.body as { error?: string }).error ?? "")).not.toMatch(
      /does not process national bills/i
    );
  });
});
