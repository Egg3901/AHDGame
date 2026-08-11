/**
 * Tests for partyInfluenceTurn pure helpers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Character } from "@/lib/db/types";
import type { PoliticalParty } from "@/lib/db/types/party";
import { ObjectId } from "mongodb";
import { ACTION_CAP } from "@/lib/actions/recommendationsConstants";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("computeClosenessScalar", () => {
  it("returns 1.0 when positions are identical", async () => {
    const { computeClosenessScalar } = await import("./partyInfluenceTurn");
    expect(computeClosenessScalar(0, 0, 0, 0)).toBeCloseTo(1.0, 5);
  });

  it("returns 0 when at maximum possible distance", async () => {
    const { computeClosenessScalar } = await import("./partyInfluenceTurn");
    // Max diff per axis is 10 (range -5 to 5), so max dist = sqrt(200)
    expect(computeClosenessScalar(-5, -5, 5, 5)).toBeCloseTo(0, 5);
  });

  it("returns partial scalar for moderate divergence", async () => {
    const { computeClosenessScalar } = await import("./partyInfluenceTurn");
    const scalar = computeClosenessScalar(0, 0, 5, 0); // dist = 5, maxDist ≈ 14.14
    expect(scalar).toBeGreaterThan(0);
    expect(scalar).toBeLessThan(1);
    expect(scalar).toBeCloseTo(1 - 5 / Math.sqrt(200), 5);
  });

  it("never returns below 0", async () => {
    const { computeClosenessScalar } = await import("./partyInfluenceTurn");
    // Positions far beyond typical range
    expect(computeClosenessScalar(-100, -100, 100, 100)).toBe(0);
  });
});

describe("computeInfamyPenalty", () => {
  it("returns 0 at zero infamy", async () => {
    const { computeInfamyPenalty } = await import("./partyInfluenceTurn");
    expect(computeInfamyPenalty(0, 4)).toBe(0);
  });

  it("returns maxPenalty at INFAMY_REFERENCE (300)", async () => {
    const { computeInfamyPenalty } = await import("./partyInfluenceTurn");
    expect(computeInfamyPenalty(300, 4)).toBeCloseTo(4, 5);
  });

  it("caps at maxPenalty beyond INFAMY_REFERENCE", async () => {
    const { computeInfamyPenalty } = await import("./partyInfluenceTurn");
    expect(computeInfamyPenalty(1000, 4)).toBe(4);
  });

  it("grows logarithmically between 0 and reference", async () => {
    const { computeInfamyPenalty } = await import("./partyInfluenceTurn");
    const low = computeInfamyPenalty(10, 4);
    const mid = computeInfamyPenalty(100, 4);
    const high = computeInfamyPenalty(300, 4);
    // Each step should be smaller than the previous (logarithmic, not linear)
    expect(mid - low).toBeLessThan(high - mid + (mid - low));
    expect(low).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
  });
});

describe("computeLeadershipBonus", () => {
  it("returns 0 for a regular member", async () => {
    const { computeLeadershipBonus } = await import("./partyInfluenceTurn");
    const charId = new ObjectId();
    const party = {
      chairId: new ObjectId(),
      viceChairId: new ObjectId(),
      treasurerId: new ObjectId(),
      committeeIds: [],
    } as unknown as PoliticalParty;
    expect(computeLeadershipBonus(charId, party)).toBe(0);
  });

  it("returns +5 for the chair", async () => {
    const { computeLeadershipBonus } = await import("./partyInfluenceTurn");
    const charId = new ObjectId();
    const party = {
      chairId: charId,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
    } as unknown as PoliticalParty;
    expect(computeLeadershipBonus(charId, party)).toBe(5);
  });

  it("returns +2 for the vice chair", async () => {
    const { computeLeadershipBonus } = await import("./partyInfluenceTurn");
    const charId = new ObjectId();
    const party = {
      chairId: null,
      viceChairId: charId,
      treasurerId: null,
      committeeIds: [],
    } as unknown as PoliticalParty;
    expect(computeLeadershipBonus(charId, party)).toBe(2);
  });

  it("returns +2 for the treasurer", async () => {
    const { computeLeadershipBonus } = await import("./partyInfluenceTurn");
    const charId = new ObjectId();
    const party = {
      chairId: null,
      viceChairId: null,
      treasurerId: charId,
      committeeIds: [],
    } as unknown as PoliticalParty;
    expect(computeLeadershipBonus(charId, party)).toBe(2);
  });

  it("returns +1 for a committee member", async () => {
    const { computeLeadershipBonus } = await import("./partyInfluenceTurn");
    const charId = new ObjectId();
    const party = {
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [charId],
    } as unknown as PoliticalParty;
    expect(computeLeadershipBonus(charId, party)).toBe(1);
  });

  it("stacks all bonuses when holding multiple roles (e.g. chair + committee)", async () => {
    const { computeLeadershipBonus } = await import("./partyInfluenceTurn");
    const charId = new ObjectId();
    const party = {
      chairId: charId,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [charId],
    } as unknown as PoliticalParty;
    expect(computeLeadershipBonus(charId, party)).toBe(6); // 5 + 1
  });

  it("adds state chair / vice chair bonuses from options", async () => {
    const { computeLeadershipBonus } = await import("./partyInfluenceTurn");
    const charId = new ObjectId();
    const party = {
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
    } as unknown as PoliticalParty;
    expect(computeLeadershipBonus(charId, party, { isStateChair: true })).toBe(2);
    expect(computeLeadershipBonus(charId, party, { isStateViceChair: true })).toBe(1);
    expect(
      computeLeadershipBonus(charId, party, { isStateChair: true, isStateViceChair: true })
    ).toBe(3);
  });

  it("stacks national chair with state chair", async () => {
    const { computeLeadershipBonus } = await import("./partyInfluenceTurn");
    const charId = new ObjectId();
    const party = {
      chairId: charId,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
    } as unknown as PoliticalParty;
    expect(computeLeadershipBonus(charId, party, { isStateChair: true })).toBe(7); // 5 + 2
  });

  it("adds caucus chair / vice chair bonuses from options", async () => {
    const { computeLeadershipBonus } = await import("./partyInfluenceTurn");
    const charId = new ObjectId();
    const party = {
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
    } as unknown as PoliticalParty;
    expect(computeLeadershipBonus(charId, party, { isCaucusChair: true })).toBe(2);
    expect(computeLeadershipBonus(charId, party, { isCaucusViceChair: true })).toBe(1);
    expect(
      computeLeadershipBonus(charId, party, { isCaucusChair: true, isCaucusViceChair: true })
    ).toBe(3);
  });

  it("stacks national chair with caucus chair", async () => {
    const { computeLeadershipBonus } = await import("./partyInfluenceTurn");
    const charId = new ObjectId();
    const party = {
      chairId: charId,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
    } as unknown as PoliticalParty;
    expect(computeLeadershipBonus(charId, party, { isCaucusChair: true })).toBe(7); // 5 + 2
  });

  it("handles null leadership IDs safely", async () => {
    const { computeLeadershipBonus } = await import("./partyInfluenceTurn");
    const charId = new ObjectId();
    const party = {
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
    } as unknown as PoliticalParty;
    expect(computeLeadershipBonus(charId, party)).toBe(0);
  });
});

describe("computeTurnGain", () => {
  it("combines all components correctly", async () => {
    const { computeTurnGain } = await import("./partyInfluenceTurn");
    // closeness=1.0, baseRate=3 → base=3; leadership=2; infamy=1 → gain = 3+2-1 = 4
    expect(computeTurnGain(1.0, 2, 1, 3)).toBeCloseTo(4, 5);
  });

  it("can be negative when infamy penalty exceeds base + leadership", async () => {
    const { computeTurnGain } = await import("./partyInfluenceTurn");
    // closeness=0, baseRate=3 → base=0; leadership=0; infamy=4 → gain = -4
    expect(computeTurnGain(0, 0, 4, 3)).toBeCloseTo(-4, 5);
  });
});

describe("computeNewInfluence", () => {
  it("applies decay and adds gain", async () => {
    const { computeNewInfluence } = await import("./partyInfluenceTurn");
    // current=100, decayRate=0.04 → after decay=96, +turnGain=3 → 99
    expect(computeNewInfluence(100, 3, 0.04)).toBeCloseTo(99, 5);
  });

  it("floors at 0 when gain cannot overcome decay", async () => {
    const { computeNewInfluence } = await import("./partyInfluenceTurn");
    // current=1, decayRate=0.04 → after decay=0.96, turnGain=-4 → -3.04 → floored to 0
    expect(computeNewInfluence(1, -4, 0.04)).toBe(0);
  });

  it("grows from 0 with positive gain", async () => {
    const { computeNewInfluence } = await import("./partyInfluenceTurn");
    expect(computeNewInfluence(0, 3, 0.04)).toBeCloseTo(3, 5);
  });
});

describe("computeBonusActions", () => {
  it("returns 0 when totalInfluence is 0 (avoids divide-by-zero)", async () => {
    const { computeBonusActions } = await import("./partyInfluenceTurn");
    expect(computeBonusActions(0, 0, 15, 1.0, 3)).toBe(0);
  });

  it("distributes proportionally and floors result", async () => {
    const { computeBonusActions } = await import("./partyInfluenceTurn");
    // 10 players → pool=15; member has 20% of influence → rawShare=3; closeness=1.0 → floor(3)=3
    expect(computeBonusActions(20, 100, 15, 1.0, 3)).toBe(3);
  });

  it("caps at maxBonus", async () => {
    const { computeBonusActions } = await import("./partyInfluenceTurn");
    // 50% share of pool=15 → rawShare=7.5 → floor=7, but capped at 3
    expect(computeBonusActions(50, 100, 15, 1.0, 3)).toBe(3);
  });

  it("scales down by closeness scalar", async () => {
    const { computeBonusActions } = await import("./partyInfluenceTurn");
    // 100% share of pool=3 → rawShare=3; closeness=0.5 → floor(1.5)=1
    expect(computeBonusActions(100, 100, 3, 0.5, 3)).toBe(1);
  });

  it("returns 0 for member with zero influence", async () => {
    const { computeBonusActions } = await import("./partyInfluenceTurn");
    expect(computeBonusActions(0, 100, 15, 1.0, 3)).toBe(0);
  });
});

describe("processPartyInfluenceTurn", () => {
  const mockBulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  const mockPartiesFind = vi.fn();
  const mockStatePartyOrgFind = vi.fn();
  const mockCaucusesFind = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockStatePartyOrgFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    mockCaucusesFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "statePartyOrg") {
          return { find: mockStatePartyOrgFind, bulkWrite: mockBulkWrite };
        }
        if (name === "caucuses") {
          return { find: mockCaucusesFind, bulkWrite: mockBulkWrite };
        }
        return { find: mockPartiesFind, bulkWrite: mockBulkWrite };
      }),
    } as never);
  });

  function makeChar(overrides: Partial<Character> = {}): Character {
    return {
      _id: new ObjectId(),
      userId: new ObjectId(),
      name: "Test Player",
      countryId: "US",
      homeState: "CA",
      party: "1", // sequentialId as string
      policies: { economic: 0, social: 0 },
      actions: 10,
      funds: 0,
      favorability: 50,
      politicalInfluence: 0,
      nationalInfluence: 0,
      donorBaseLevel: 0,
      infamy: 0,
      partyInfluence: 0,
      currentOffice: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as Character;
  }

  function makeParty(overrides: Partial<PoliticalParty> = {}): PoliticalParty {
    return {
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Test Party",
      abbreviation: "TP",
      color: "#ff0000",
      economicPosition: 0,
      socialPosition: 0,
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
      memberCount: 1,
      isDefault: false,
      createdBy: null,
      treasury: 0,
      nationalTaxRate: 0,
      politicalStrength: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as PoliticalParty;
  }

  it("skips characters whose party is not in the party map", async () => {
    mockPartiesFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }); // no parties
    const char = makeChar();
    const { processPartyInfluenceTurn } = await import("./partyInfluenceTurn");
    await processPartyInfluenceTurn([char], null, new Date());
    expect(mockBulkWrite).not.toHaveBeenCalled();
  });

  it("writes partyInfluence update for a perfectly aligned member", async () => {
    const party = makeParty({
      sequentialId: 1,
      countryId: "US",
      economicPosition: 0,
      socialPosition: 0,
    });
    mockPartiesFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue([party]) });

    const char = makeChar({ party: "1", countryId: "US", partyInfluence: 0, infamy: 0 });
    const { processPartyInfluenceTurn } = await import("./partyInfluenceTurn");
    await processPartyInfluenceTurn([char], null, new Date());

    expect(mockBulkWrite).toHaveBeenCalledTimes(1);
    const [ops] = mockBulkWrite.mock.calls[0];
    expect(ops).toHaveLength(1);
    const update = ops[0].updateOne.update;
    // Perfect alignment: closeness=1.0, baseRate=3, no infamy → turnGain=3; decay on 0 = 0 → newInfluence=3
    expect(update.$set.partyInfluence).toBeCloseTo(3, 5);
    // partyInfluence was 0 → no bonus actions → no $inc
    expect(update.$inc).toBeUndefined();
  });

  it("awards bonus actions proportional to influence share", async () => {
    const party = makeParty({ sequentialId: 1, countryId: "US" });
    mockPartiesFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue([party]) });

    // Two members: char1 has 80 influence, char2 has 20
    // totalInfluence=100, totalPool=3*2=6
    // char1 rawShare = 0.8*6=4.8 → floor(4.8*1.0)=4 bonus actions
    // char2 rawShare = 0.2*6=1.2 → floor(1.2*1.0)=1 bonus action
    const char1 = makeChar({ party: "1", countryId: "US", partyInfluence: 80 });
    const char2 = makeChar({ party: "1", countryId: "US", partyInfluence: 20 });

    const { processPartyInfluenceTurn } = await import("./partyInfluenceTurn");
    await processPartyInfluenceTurn([char1, char2], null, new Date());

    const [ops] = mockBulkWrite.mock.calls[0];
    expect(ops).toHaveLength(2);

    const op1 = ops.find((o: { updateOne: { filter: { _id: ObjectId } } }) =>
      o.updateOne.filter._id.equals(char1._id)
    );
    const op2 = ops.find((o: { updateOne: { filter: { _id: ObjectId } } }) =>
      o.updateOne.filter._id.equals(char2._id)
    );

    const up1 = op1.updateOne.update as unknown as { $set: Record<string, unknown> }[];
    const up2 = op2.updateOne.update as unknown as { $set: Record<string, unknown> }[];
    expect(up1[0].$set.actions).toEqual({
      $min: [ACTION_CAP, { $add: [{ $ifNull: ["$actions", 0] }, 4] }],
    });
    expect(up2[0].$set.actions).toEqual({
      $min: [ACTION_CAP, { $add: [{ $ifNull: ["$actions", 0] }, 1] }],
    });
  });

  it("clamps bonus actions at each member's Energy-scaled cap, not the static 200", async () => {
    const party = makeParty({ sequentialId: 1, countryId: "US" });
    mockPartiesFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue([party]) });

    // char1 has max Energy (10 → cap 250); char2 is unmigrated (no stats → cap 200).
    const char1 = makeChar({
      party: "1",
      countryId: "US",
      partyInfluence: 80,
      stats: { energy: 10 } as Character["stats"],
    });
    const char2 = makeChar({ party: "1", countryId: "US", partyInfluence: 20 });

    const { processPartyInfluenceTurn } = await import("./partyInfluenceTurn");
    await processPartyInfluenceTurn([char1, char2], null, new Date());

    const [ops] = mockBulkWrite.mock.calls[0];
    const op1 = ops.find((o: { updateOne: { filter: { _id: ObjectId } } }) =>
      o.updateOne.filter._id.equals(char1._id)
    );
    const op2 = ops.find((o: { updateOne: { filter: { _id: ObjectId } } }) =>
      o.updateOne.filter._id.equals(char2._id)
    );
    const up1 = op1.updateOne.update as unknown as { $set: Record<string, unknown> }[];
    const up2 = op2.updateOne.update as unknown as { $set: Record<string, unknown> }[];
    // Max-Energy member clamps at 250; unmigrated member stays at the 200 baseline.
    expect(up1[0].$set.actions).toEqual({
      $min: [250, { $add: [{ $ifNull: ["$actions", 0] }, 4] }],
    });
    expect(up2[0].$set.actions).toEqual({
      $min: [ACTION_CAP, { $add: [{ $ifNull: ["$actions", 0] }, 1] }],
    });
  });

  it("applies leadership bonus to partyInfluence gain", async () => {
    const charId = new ObjectId();
    const party = makeParty({ sequentialId: 1, countryId: "US", chairId: charId });
    mockPartiesFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue([party]) });

    const char = makeChar({
      _id: charId,
      party: "1",
      countryId: "US",
      partyInfluence: 0,
      infamy: 0,
    });
    const { processPartyInfluenceTurn } = await import("./partyInfluenceTurn");
    await processPartyInfluenceTurn([char], null, new Date());

    const [ops] = mockBulkWrite.mock.calls[0];
    const update = ops[0].updateOne.update;
    // closeness=1.0, baseRate=3, chairBonus=5, infamy=0 → turnGain=8; newInfluence=8
    expect(update.$set.partyInfluence).toBeCloseTo(8, 5);
  });

  it("applies state chair bonus to partyInfluence gain", async () => {
    const charId = new ObjectId();
    const party = makeParty({ sequentialId: 1, countryId: "US", chairId: null });
    mockPartiesFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue([party]) });
    mockStatePartyOrgFind.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ chairId: charId, viceChairId: null }]),
    });

    const char = makeChar({
      _id: charId,
      party: "1",
      countryId: "US",
      partyInfluence: 0,
      infamy: 0,
    });
    const { processPartyInfluenceTurn } = await import("./partyInfluenceTurn");
    await processPartyInfluenceTurn([char], null, new Date());

    const [ops] = mockBulkWrite.mock.calls[0];
    const update = ops[0].updateOne.update;
    // closeness=1.0, baseRate=3, stateChairBonus=2 → turnGain=5
    expect(update.$set.partyInfluence).toBeCloseTo(5, 5);
  });

  it("applies caucus chair bonus to partyInfluence gain", async () => {
    const charId = new ObjectId();
    const party = makeParty({ sequentialId: 1, countryId: "US", chairId: null });
    mockPartiesFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue([party]) });
    mockCaucusesFind.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ chairId: charId, viceChairId: null }]),
    });

    const char = makeChar({
      _id: charId,
      party: "1",
      countryId: "US",
      partyInfluence: 0,
      infamy: 0,
    });
    const { processPartyInfluenceTurn } = await import("./partyInfluenceTurn");
    await processPartyInfluenceTurn([char], null, new Date());

    const [ops] = mockBulkWrite.mock.calls[0];
    const update = ops[0].updateOne.update;
    // closeness=1.0, baseRate=3, caucusChairBonus=2 → turnGain=5
    expect(update.$set.partyInfluence).toBeCloseTo(5, 5);
  });

  it("does not write if characters array is empty", async () => {
    mockPartiesFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    const { processPartyInfluenceTurn } = await import("./partyInfluenceTurn");
    await processPartyInfluenceTurn([], null, new Date());
    expect(mockBulkWrite).not.toHaveBeenCalled();
  });
});
