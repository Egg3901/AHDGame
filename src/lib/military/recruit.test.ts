import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { MoneyFlowKeyConflictError, MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";

vi.mock("./recruitSpend", async () => {
  const actual = await vi.importActual<typeof import("./recruitSpend")>("./recruitSpend");
  return { ...actual, applyMilitaryRecruitSpend: vi.fn() };
});

import { applyMilitaryRecruit, type MilitaryRecruitInput } from "./recruit";
import {
  buildMilitaryRecruitFingerprint,
  MILITARY_RECRUIT_ACTION,
  MILITARY_RECRUIT_APPROPRIATION,
  MILITARY_RECRUIT_MANPOWER,
  MILITARY_RECRUIT_UNIT,
} from "./recruitSpend";

const PRICE = 4_160_000_000;
const PERSONNEL = 12_000;

describe("applyMilitaryRecruit — validation order", () => {
  let db: MockDb;
  let memberId: ObjectId;
  let characterId: ObjectId;
  let manpowerDocId: ObjectId;
  let arsenalDocId: ObjectId;

  const spendOutcome = {
    duplicate: false,
    outcome: {
      price: PRICE,
      actionsRemaining: 1,
      manpowerRemaining: 488_000,
      appropriationRemaining: 10_000_000_000 - PRICE,
      unitIdHex: new ObjectId().toHexString(),
    },
  };

  function baseInput(overrides: Partial<MilitaryRecruitInput> = {}): MilitaryRecruitInput {
    return {
      countryId: "US",
      positionId: "secretary_of_defense",
      branchId: "army",
      type: "Infantry Division",
      name: "3rd Vanguard",
      actorCharacterId: characterId.toHexString(),
      isAdmin: false,
      liveYear: null,
      currentTurn: 42,
      preset: "2019-default",
      idempotencyKey: "test-key-1",
      ...overrides,
    };
  }

  function budgetDoc(overrides: Record<string, unknown> = {}) {
    return {
      _id: "federal",
      countryId: "US",
      treasuryBalance: 10_000_000_000,
      gdp: 387_000_000_000,
      debt: { principal: 0, ceiling: 0 },
      ...overrides,
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    memberId = new ObjectId();
    characterId = new ObjectId();
    manpowerDocId = new ObjectId();
    arsenalDocId = new ObjectId();

    db.collection("cabinetMembers");
    db.collection("states");
    db.collection("federalBudget");
    db.collection("nationalManpower");
    db.collection("nationalArsenal");
    db.collection("nonAtomicMoneyFlowReceipts");

    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: memberId,
      countryId: "US",
      positionId: "secretary_of_defense",
      characterId,
      ministerialActions: 2,
    });
    db.collectionMocks.states.findOne.mockResolvedValue({ _id: "US-CA" });
    db.collectionMocks.federalBudget.findOne.mockResolvedValue(budgetDoc());
    db.collectionMocks.nationalManpower.findOne.mockResolvedValue({
      _id: manpowerDocId,
      countryId: "US",
      pool: 500_000,
      mode: "trained",
    });
    db.collectionMocks.nationalArsenal.findOne.mockResolvedValue({
      _id: arsenalDocId,
      countryId: "US",
      stock: { ground: 9_999, naval: 0, air: 0, rocket: 0, space: 0, marine: 0 },
      grade: { ground: 2, naval: 0, air: 0, rocket: 0, space: 0, marine: 0 },
    });
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockResolvedValue(null);

    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    vi.mocked(applyMilitaryRecruitSpend).mockResolvedValue(spendOutcome);
  });

  it("rejects an unknown branch before reading the member row", async () => {
    const result = await applyMilitaryRecruit(db as unknown as Db, baseInput({ branchId: "nope" }));

    expect(result).toEqual({ error: "Invalid branch", status: 400 });
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    expect(applyMilitaryRecruitSpend).not.toHaveBeenCalled();
  });

  it("rejects an unknown type for the branch", async () => {
    const result = await applyMilitaryRecruit(db as unknown as Db, baseInput({ type: "nope" }));

    expect(result).toEqual({ error: "Invalid unit type for this branch", status: 400 });
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    expect(applyMilitaryRecruitSpend).not.toHaveBeenCalled();
  });

  it("rejects a branch whose establishedYear is after the live game year", async () => {
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: memberId,
      countryId: "DE",
      positionId: "defense_minister",
      characterId,
      ministerialActions: 2,
    });
    const result = await applyMilitaryRecruit(
      db as unknown as Db,
      baseInput({
        countryId: "DE",
        positionId: "defense_minister",
        branchId: "heer",
        liveYear: 1953,
        preset: "1953-default",
      })
    );

    expect(result).toEqual({ error: "Branch is not available in 1953", status: 400 });
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    expect(applyMilitaryRecruitSpend).not.toHaveBeenCalled();
  });

  it("rejects a non-holder non-admin before spending", async () => {
    const result = await applyMilitaryRecruit(
      db as unknown as Db,
      baseInput({ actorCharacterId: new ObjectId().toHexString() })
    );

    expect(result).toEqual({ error: "Only the defence minister may recruit units.", status: 403 });
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    expect(applyMilitaryRecruitSpend).not.toHaveBeenCalled();
  });

  it("throws for an admin with no member row (legacy 500 shape via the route handler)", async () => {
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue(null);

    await expect(
      applyMilitaryRecruit(db as unknown as Db, baseInput({ isAdmin: true }))
    ).rejects.toThrow(TypeError);
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    expect(applyMilitaryRecruitSpend).not.toHaveBeenCalled();
  });

  it("backfills a legacy member missing the action fields and proceeds", async () => {
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: memberId,
      countryId: "US",
      positionId: "secretary_of_defense",
      characterId,
    });

    const result = await applyMilitaryRecruit(db as unknown as Db, baseInput());

    expect(result).toEqual({
      success: true,
      actionsRemaining: 1,
      price: PRICE,
      appropriationRemaining: 10_000_000_000 - PRICE,
      manpowerRemaining: 488_000,
    });
    expect(db.collectionMocks.cabinetMembers.updateOne).toHaveBeenCalledWith(
      { _id: memberId },
      { $set: { ministerialActions: 2 } }
    );
  });

  it("refuses with 400 when no actions remain, ahead of the region gate", async () => {
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: memberId,
      countryId: "US",
      positionId: "secretary_of_defense",
      characterId,
      ministerialActions: 0,
    });
    db.collectionMocks.states.findOne.mockResolvedValue(null);

    const result = await applyMilitaryRecruit(db as unknown as Db, baseInput());

    expect(result).toEqual({ error: "No ministerial actions remaining", status: 400 });
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    expect(applyMilitaryRecruitSpend).not.toHaveBeenCalled();
  });

  it("refuses with 400 when no region is available, ahead of the budget gate", async () => {
    db.collectionMocks.states.findOne.mockResolvedValue(null);
    db.collectionMocks.federalBudget.findOne.mockResolvedValue(null);

    const result = await applyMilitaryRecruit(db as unknown as Db, baseInput());

    expect(result).toEqual({ error: "No region available to station the unit", status: 400 });
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    expect(applyMilitaryRecruitSpend).not.toHaveBeenCalled();
  });

  it("refuses with 409 when no budget can be healed", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue(null);
    // Genuinely no seed for this preset so ensureFederalBudget cannot heal.
    vi.doMock("@/lib/seeds/reference/budgets", () => ({
      getInitialNationalBudgetsForPreset: () => [],
    }));
    try {
      const result = await applyMilitaryRecruit(db as unknown as Db, baseInput());

      expect(result).toEqual({
        error: "This country has no usable national budget — procurement is unavailable",
        status: 409,
      });
      const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
      expect(applyMilitaryRecruitSpend).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("@/lib/seeds/reference/budgets");
    }
  });

  it("refuses with 409 when the healed budget belongs to a different country", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue(
      budgetDoc({ _id: "US", countryId: "GB" })
    );

    const result = await applyMilitaryRecruit(db as unknown as Db, baseInput());

    expect(result).toEqual({
      error: "This country has no usable national budget — procurement is unavailable",
      status: 409,
    });
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    expect(applyMilitaryRecruitSpend).not.toHaveBeenCalled();
  });

  it("refuses with 400 when the pool is short, ahead of the GDP gate", async () => {
    db.collectionMocks.nationalManpower.findOne.mockResolvedValue({
      _id: manpowerDocId,
      countryId: "US",
      pool: 10,
      mode: "trained",
    });
    db.collectionMocks.federalBudget.findOne.mockResolvedValue(budgetDoc({ gdp: 0 }));

    const result = await applyMilitaryRecruit(db as unknown as Db, baseInput());

    expect(result.status).toBe(400);
    expect(result).toMatchObject({ error: expect.stringMatching(/insufficient manpower/i) });
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    expect(applyMilitaryRecruitSpend).not.toHaveBeenCalled();
  });

  it("refuses with 409 when the manpower row vanishes between heal and read", async () => {
    // ensureManpowerPool heals from the states scan, then the row read misses.
    db.collectionMocks.nationalManpower.findOne
      .mockResolvedValueOnce({
        _id: manpowerDocId,
        countryId: "US",
        pool: 500_000,
        mode: "trained",
      })
      .mockResolvedValueOnce(null);

    const result = await applyMilitaryRecruit(db as unknown as Db, baseInput());

    expect(result).toEqual({
      error: "Manpower was drawn by another order — try again",
      status: 409,
    });
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    expect(applyMilitaryRecruitSpend).not.toHaveBeenCalled();
  });

  it("refuses with 409 when the budget has no usable GDP", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue(budgetDoc({ gdp: 0 }));

    const result = await applyMilitaryRecruit(db as unknown as Db, baseInput());

    expect(result).toEqual({
      error: "This country has no usable GDP figure — procurement is unavailable",
      status: 409,
    });
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    expect(applyMilitaryRecruitSpend).not.toHaveBeenCalled();
  });

  it("throws on an empty or over-long idempotency key", async () => {
    await expect(
      applyMilitaryRecruit(db as unknown as Db, baseInput({ idempotencyKey: "" }))
    ).rejects.toThrow(RangeError);
    await expect(
      applyMilitaryRecruit(db as unknown as Db, baseInput({ idempotencyKey: "k".repeat(129) }))
    ).rejects.toThrow(RangeError);
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    expect(applyMilitaryRecruitSpend).not.toHaveBeenCalled();
  });
});

describe("applyMilitaryRecruit — key and fingerprint forwarding", () => {
  let db: MockDb;
  let memberId: ObjectId;
  let characterId: ObjectId;
  let manpowerDocId: ObjectId;
  let arsenalDocId: ObjectId;

  const spendOutcome = {
    duplicate: false,
    outcome: {
      price: PRICE,
      actionsRemaining: 1,
      manpowerRemaining: 488_000,
      appropriationRemaining: 10_000_000_000 - PRICE,
      unitIdHex: new ObjectId().toHexString(),
    },
  };

  function baseInput(overrides: Partial<MilitaryRecruitInput> = {}): MilitaryRecruitInput {
    return {
      countryId: "US",
      positionId: "secretary_of_defense",
      branchId: "army",
      type: "Infantry Division",
      name: "3rd Vanguard",
      actorCharacterId: characterId.toHexString(),
      isAdmin: false,
      liveYear: null,
      currentTurn: 42,
      preset: "2019-default",
      idempotencyKey: "caller-key-1",
      ...overrides,
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    memberId = new ObjectId();
    characterId = new ObjectId();
    manpowerDocId = new ObjectId();
    arsenalDocId = new ObjectId();

    db.collection("cabinetMembers");
    db.collection("states");
    db.collection("federalBudget");
    db.collection("nationalManpower");
    db.collection("nationalArsenal");
    db.collection("nonAtomicMoneyFlowReceipts");

    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: memberId,
      countryId: "US",
      positionId: "secretary_of_defense",
      characterId,
      ministerialActions: 2,
    });
    db.collectionMocks.states.findOne.mockResolvedValue({ _id: "US-CA" });
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "federal",
      countryId: "US",
      treasuryBalance: 10_000_000_000,
      gdp: 387_000_000_000,
      debt: { principal: 0, ceiling: 0 },
    });
    db.collectionMocks.nationalManpower.findOne.mockResolvedValue({
      _id: manpowerDocId,
      countryId: "US",
      pool: 500_000,
      mode: "trained",
    });
    db.collectionMocks.nationalArsenal.findOne.mockResolvedValue({
      _id: arsenalDocId,
      countryId: "US",
      stock: { ground: 9_999, naval: 0, air: 0, rocket: 0, space: 0, marine: 0 },
      grade: { ground: 2, naval: 0, air: 0, rocket: 0, space: 0, marine: 0 },
    });
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockResolvedValue(null);

    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    vi.mocked(applyMilitaryRecruitSpend).mockResolvedValue(spendOutcome);
  });

  it("forwards the caller key and the priced fingerprint to the spend primitive", async () => {
    const result = await applyMilitaryRecruit(db as unknown as Db, baseInput());

    expect(result).toEqual({
      success: true,
      actionsRemaining: 1,
      price: PRICE,
      appropriationRemaining: 10_000_000_000 - PRICE,
      manpowerRemaining: 488_000,
    });
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    expect(applyMilitaryRecruitSpend).toHaveBeenCalledTimes(1);
    expect(vi.mocked(applyMilitaryRecruitSpend).mock.calls[0]![1]).toEqual({
      countryId: "US",
      memberId,
      actionsBefore: 2,
      manpowerDocId,
      poolBefore: 500_000,
      personnel: PERSONNEL,
      budgetId: "federal",
      price: PRICE,
      domain: "ground",
      arsenalDocId,
      neededLots: 4,
      plannedDrawn: 4,
      arsenalGrade: 2,
      unit: {
        branchId: "army",
        name: "3rd Vanguard",
        type: "Infantry Division",
        icon: "soldier",
        basePower: 48,
        upkeepBase: 70,
      },
      createdTurn: 42,
      readyAtTurn: 48,
      fingerprint: buildMilitaryRecruitFingerprint({
        countryId: "US",
        memberId,
        branchId: "army",
        type: "Infantry Division",
        name: "3rd Vanguard",
        createdTurn: 42,
        personnel: PERSONNEL,
        price: PRICE,
      }),
      idempotencyKey: "caller-key-1",
    });
  });

  it("trims the unit name in both the fingerprint and the unit input", async () => {
    await applyMilitaryRecruit(db as unknown as Db, baseInput({ name: "  3rd Vanguard  " }));

    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    const input = vi.mocked(applyMilitaryRecruitSpend).mock.calls[0]![1];
    expect(input.unit.name).toBe("3rd Vanguard");
    expect(input.fingerprint).toBe(
      buildMilitaryRecruitFingerprint({
        countryId: "US",
        memberId,
        branchId: "army",
        type: "Infantry Division",
        name: "3rd Vanguard",
        createdTurn: 42,
        personnel: PERSONNEL,
        price: PRICE,
      })
    );
  });

  it("gives a carrier strike group the longer build duration", async () => {
    db.collectionMocks.nationalArsenal.findOne.mockResolvedValue({
      _id: arsenalDocId,
      countryId: "US",
      stock: { ground: 0, naval: 9_999, air: 0, rocket: 0, space: 0, marine: 0 },
      grade: { ground: 0, naval: 3, air: 0, rocket: 0, space: 0, marine: 0 },
    });

    const result = await applyMilitaryRecruit(
      db as unknown as Db,
      baseInput({ branchId: "navy", type: "Carrier Strike Group", name: "CVN-80" })
    );

    expect(result).toMatchObject({ success: true });
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    const input = vi.mocked(applyMilitaryRecruitSpend).mock.calls[0]![1];
    expect(input.domain).toBe("naval");
    expect(input.personnel).toBe(7500);
    expect(input.readyAtTurn).toBe(52);
    expect(input.unit).toMatchObject({ icon: "carrier", basePower: 99, upkeepBase: 620 });
  });

  it("mints a distinct key per call when the caller supplies none", async () => {
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    const { idempotencyKey: _omit, ...withoutKey } = baseInput();
    await applyMilitaryRecruit(db as unknown as Db, withoutKey);
    await applyMilitaryRecruit(db as unknown as Db, withoutKey);

    const keys = vi
      .mocked(applyMilitaryRecruitSpend)
      .mock.calls.map((call) => call[1].idempotencyKey);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe("applyMilitaryRecruit — fresh-vs-replay gates and stored plans", () => {
  let db: MockDb;
  let memberId: ObjectId;
  let characterId: ObjectId;
  let manpowerDocId: ObjectId;
  let arsenalDocId: ObjectId;

  function baseInput(overrides: Partial<MilitaryRecruitInput> = {}): MilitaryRecruitInput {
    return {
      countryId: "US",
      positionId: "secretary_of_defense",
      branchId: "army",
      type: "Infantry Division",
      name: "3rd Vanguard",
      actorCharacterId: characterId.toHexString(),
      isAdmin: false,
      liveYear: null,
      currentTurn: 42,
      preset: "2019-default",
      idempotencyKey: "retry-key-1",
      ...overrides,
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    memberId = new ObjectId();
    characterId = new ObjectId();
    manpowerDocId = new ObjectId();
    arsenalDocId = new ObjectId();

    db.collection("cabinetMembers");
    db.collection("states");
    db.collection("federalBudget");
    db.collection("nationalManpower");
    db.collection("nationalArsenal");
    db.collection("nonAtomicMoneyFlowReceipts");

    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: memberId,
      countryId: "US",
      positionId: "secretary_of_defense",
      characterId,
      ministerialActions: 2,
    });
    db.collectionMocks.states.findOne.mockResolvedValue({ _id: "US-CA" });
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "federal",
      countryId: "US",
      treasuryBalance: 10_000_000_000,
      gdp: 387_000_000_000,
      debt: { principal: 0, ceiling: 0 },
    });
    db.collectionMocks.nationalManpower.findOne.mockResolvedValue({
      _id: manpowerDocId,
      countryId: "US",
      pool: 500_000,
      mode: "trained",
    });
    db.collectionMocks.nationalArsenal.findOne.mockResolvedValue({
      _id: arsenalDocId,
      countryId: "US",
      stock: { ground: 9_999, naval: 0, air: 0, rocket: 0, space: 0, marine: 0 },
      grade: { ground: 2, naval: 0, air: 0, rocket: 0, space: 0, marine: 0 },
    });
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockResolvedValue(null);
  });

  it("skips the action and manpower gates on a key already on file", async () => {
    // Post-debit reads: the spent action and drawn pool would fail fresh gates.
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: memberId,
      countryId: "US",
      positionId: "secretary_of_defense",
      characterId,
      ministerialActions: 0,
    });
    db.collectionMocks.nationalManpower.findOne.mockResolvedValue({
      _id: manpowerDocId,
      countryId: "US",
      pool: 5,
      mode: "trained",
    });
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockResolvedValue({
      _id: "retry-key-1",
      status: "in_progress",
      fingerprint: "military-recruit:US",
    });
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    vi.mocked(applyMilitaryRecruitSpend).mockResolvedValue({
      duplicate: true,
      outcome: {
        price: PRICE,
        actionsRemaining: 1,
        manpowerRemaining: 488_000,
        appropriationRemaining: 10_000_000_000 - PRICE,
        unitIdHex: new ObjectId().toHexString(),
      },
    });

    const result = await applyMilitaryRecruit(db as unknown as Db, baseInput());

    expect(result).toMatchObject({ success: true, price: PRICE });
    expect(applyMilitaryRecruitSpend).toHaveBeenCalledTimes(1);
  });

  it("reports the stored outcome verbatim on a duplicate delivery", async () => {
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockResolvedValue({
      _id: "retry-key-1",
      status: "completed",
      fingerprint: "military-recruit:US",
    });
    const stored = {
      price: PRICE,
      actionsRemaining: 1,
      manpowerRemaining: 488_000,
      appropriationRemaining: 10_000_000_000 - PRICE,
      unitIdHex: "stored-unit-id",
    };
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    vi.mocked(applyMilitaryRecruitSpend).mockResolvedValue({ duplicate: true, outcome: stored });

    const result = await applyMilitaryRecruit(db as unknown as Db, baseInput());

    expect(result).toEqual({
      success: true,
      actionsRemaining: 1,
      price: PRICE,
      appropriationRemaining: 10_000_000_000 - PRICE,
      manpowerRemaining: 488_000,
    });
    expect(result).not.toHaveProperty("duplicate");
  });

  it("pins the hollow plan when no arsenal document exists", async () => {
    db.collectionMocks.nationalArsenal.findOne.mockResolvedValue(null);
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    vi.mocked(applyMilitaryRecruitSpend).mockResolvedValue({
      duplicate: false,
      outcome: {
        price: PRICE,
        actionsRemaining: 1,
        manpowerRemaining: 488_000,
        appropriationRemaining: 10_000_000_000 - PRICE,
        unitIdHex: new ObjectId().toHexString(),
      },
    });

    const result = await applyMilitaryRecruit(db as unknown as Db, baseInput());

    expect(result).toMatchObject({ success: true });
    const input = vi.mocked(applyMilitaryRecruitSpend).mock.calls[0]![1];
    expect(input.arsenalDocId).toBeNull();
    expect(input.plannedDrawn).toBe(0);
    expect(input.arsenalGrade).toBe(0);
  });

  it("pins a partial fill from live stock so a retry cannot recalculate it", async () => {
    db.collectionMocks.nationalArsenal.findOne.mockResolvedValue({
      _id: arsenalDocId,
      countryId: "US",
      stock: { ground: 2, naval: 0, air: 0, rocket: 0, space: 0, marine: 0 },
      grade: { ground: 1, naval: 0, air: 0, rocket: 0, space: 0, marine: 0 },
    });
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    vi.mocked(applyMilitaryRecruitSpend).mockResolvedValue({
      duplicate: false,
      outcome: {
        price: PRICE,
        actionsRemaining: 1,
        manpowerRemaining: 488_000,
        appropriationRemaining: 10_000_000_000 - PRICE,
        unitIdHex: new ObjectId().toHexString(),
      },
    });

    await applyMilitaryRecruit(db as unknown as Db, baseInput());

    const input = vi.mocked(applyMilitaryRecruitSpend).mock.calls[0]![1];
    expect(input.neededLots).toBe(4);
    expect(input.plannedDrawn).toBe(2);
    expect(input.arsenalGrade).toBe(1);
    expect(input.arsenalDocId).toEqual(arsenalDocId);
  });
});

describe("applyMilitaryRecruit — spend error parity", () => {
  let db: MockDb;
  let memberId: ObjectId;
  let characterId: ObjectId;

  function baseInput(overrides: Partial<MilitaryRecruitInput> = {}): MilitaryRecruitInput {
    return {
      countryId: "US",
      positionId: "secretary_of_defense",
      branchId: "army",
      type: "Infantry Division",
      name: "3rd Vanguard",
      actorCharacterId: characterId.toHexString(),
      isAdmin: false,
      liveYear: null,
      currentTurn: 42,
      preset: "2019-default",
      idempotencyKey: "race-key-1",
      ...overrides,
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    memberId = new ObjectId();
    characterId = new ObjectId();

    db.collection("cabinetMembers");
    db.collection("states");
    db.collection("federalBudget");
    db.collection("nationalManpower");
    db.collection("nationalArsenal");
    db.collection("nonAtomicMoneyFlowReceipts");

    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: memberId,
      countryId: "US",
      positionId: "secretary_of_defense",
      characterId,
      ministerialActions: 2,
    });
    db.collectionMocks.states.findOne.mockResolvedValue({ _id: "US-CA" });
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "federal",
      countryId: "US",
      treasuryBalance: 10_000_000_000,
      gdp: 387_000_000_000,
      debt: { principal: 0, ceiling: 0 },
    });
    db.collectionMocks.nationalManpower.findOne.mockResolvedValue({
      _id: new ObjectId(),
      countryId: "US",
      pool: 500_000,
      mode: "trained",
    });
    db.collectionMocks.nationalArsenal.findOne.mockResolvedValue(null);
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockResolvedValue(null);
  });

  it("maps a lost action race to the historical no-actions 409", async () => {
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    vi.mocked(applyMilitaryRecruitSpend).mockRejectedValue(
      new Error(`${MILITARY_RECRUIT_ACTION}:guard-rejected`)
    );

    const result = await applyMilitaryRecruit(db as unknown as Db, baseInput());

    expect(result).toEqual({ error: "No ministerial actions remaining", status: 409 });
  });

  it("maps a lost manpower race to the historical try-again 409", async () => {
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    vi.mocked(applyMilitaryRecruitSpend).mockRejectedValue(
      new Error(`${MILITARY_RECRUIT_MANPOWER}:guard-rejected`)
    );

    const result = await applyMilitaryRecruit(db as unknown as Db, baseInput());

    expect(result).toEqual({
      error: "Manpower was drawn by another order — try again",
      status: 409,
    });
  });

  it("maps a short appropriation to the 409 shortfall with the live balance", async () => {
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    vi.mocked(applyMilitaryRecruitSpend).mockRejectedValue(
      new Error(`${MILITARY_RECRUIT_APPROPRIATION}:guard-rejected`)
    );
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "federal",
      countryId: "US",
      treasuryBalance: 10_000_000_000,
      gdp: 387_000_000_000,
      debt: { principal: 0, ceiling: 0 },
      defenseAppropriation: { balance: 1_000, accruedThroughTurn: 0, arrearsRatio: 0 },
    });

    const result = await applyMilitaryRecruit(db as unknown as Db, baseInput());

    expect(result).toEqual({
      error: `Defence appropriation is short — ${PRICE.toLocaleString("en-US")} required, 1,000 available`,
      status: 409,
    });
  });

  it("rethrows the compensated insert failure for the route 500 path", async () => {
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    vi.mocked(applyMilitaryRecruitSpend).mockRejectedValue(
      new Error(`${MILITARY_RECRUIT_UNIT}:guard-rejected`)
    );

    await expect(applyMilitaryRecruit(db as unknown as Db, baseInput())).rejects.toThrow(
      new RegExp(`^${MILITARY_RECRUIT_UNIT}:`)
    );
  });

  it("rethrows settled-key and key-conflict errors for the route 409 mappers", async () => {
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    vi.mocked(applyMilitaryRecruitSpend).mockRejectedValue(
      new MoneyFlowTerminalError("race-key-1", "compensated")
    );
    await expect(applyMilitaryRecruit(db as unknown as Db, baseInput())).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );

    vi.mocked(applyMilitaryRecruitSpend).mockRejectedValue(
      new MoneyFlowKeyConflictError("race-key-1")
    );
    await expect(applyMilitaryRecruit(db as unknown as Db, baseInput())).rejects.toBeInstanceOf(
      MoneyFlowKeyConflictError
    );
  });

  it("rethrows unexpected spend failures instead of shaping them", async () => {
    const { applyMilitaryRecruitSpend } = await import("./recruitSpend");
    vi.mocked(applyMilitaryRecruitSpend).mockRejectedValue(new Error("mongo exploded"));

    await expect(applyMilitaryRecruit(db as unknown as Db, baseInput())).rejects.toThrow(
      "mongo exploded"
    );
  });
});
