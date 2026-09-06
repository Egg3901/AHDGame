/**
 * Unit tests for processActionRefresh.
 * Mocks DB; verifies update logic for actions, influence, infamy, favorability.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Character, GameConfig } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));
vi.mock("@/lib/api/headOfGovernment", () => ({
  getHeadOfGovernmentCharacterId: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/countryState", () => ({
  getCountryState: vi.fn(async (_db: unknown, countryId: string) => ({
    governmentType:
      countryId === "DD" || countryId === "RU" ? "parliamentaryRepublic" : "presidential",
  })),
}));

describe("processActionRefresh", () => {
  const mockBulkWrite = vi.fn();
  let chairRows: { chairCharacterId: unknown }[] = [];
  let cabinetRows: { characterId: unknown; countryId: string }[] = [];
  let electedRows: {
    characterId: unknown;
    officeType: string;
    countryId: string;
    party?: string;
  }[] = [];
  let nppRows: {
    _id: unknown;
    countryId?: string;
    party?: string;
    politicalInfluence: number;
    favorability: number;
  }[] = [];
  let governmentFormationRows: Record<string, unknown>[] = [];
  let governmentApprovalRows: Record<string, unknown>[] = [];
  let seatedJusticeRows: { justiceCharacterId: unknown }[] = [];
  let persistFixture = false;
  let characterRows: Character[] = [];
  const mockNppBulkWrite = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    chairRows = [];
    cabinetRows = [];
    electedRows = [];
    nppRows = [];
    governmentFormationRows = [];
    governmentApprovalRows = [];
    seatedJusticeRows = [];
    persistFixture = false;
    characterRows = [];
    mockBulkWrite.mockImplementation(async (ops: unknown[]) => {
      if (persistFixture) {
        for (const op of ops as {
          updateOne: { filter: { _id: unknown }; update: { $set: Partial<Character> } };
        }[]) {
          const row = characterRows.find((candidate) => candidate._id === op.updateOne.filter._id);
          if (row) Object.assign(row, op.updateOne.update.$set);
        }
      }
      return { modifiedCount: ops.length };
    });
    mockNppBulkWrite.mockImplementation(async (ops: unknown[]) => {
      if (persistFixture) {
        for (const op of ops as {
          updateOne: { filter: { _id: unknown }; update: { $set: Record<string, unknown> } };
        }[]) {
          const row = nppRows.find((candidate) => candidate._id === op.updateOne.filter._id);
          if (row) Object.assign(row, op.updateOne.update.$set);
        }
      }
      return { modifiedCount: ops.length };
    });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "npps") {
          return {
            // Yield whatever NPP rows the test queued (empty by default).
            find: vi.fn().mockImplementation(() => ({
              toArray: vi.fn().mockResolvedValue(nppRows),
              [Symbol.asyncIterator]: async function* () {
                for (const npp of nppRows) yield npp;
              },
            })),
            bulkWrite: mockNppBulkWrite,
          };
        }
        if (name === "governmentFormations" || name === "parliamentaryGovernments") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue(governmentFormationRows),
            }),
            bulkWrite: mockBulkWrite,
          };
        }
        if (name === "governmentApprovals") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue(governmentApprovalRows),
            }),
            bulkWrite: mockBulkWrite,
          };
        }
        if (name === "characters") {
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(characterRows) }),
            bulkWrite: mockBulkWrite,
          };
        }
        if (name === "centralBanks") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue(chairRows),
            }),
          };
        }
        if (name === "congressLeaders") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([]),
            }),
          };
        }
        if (name === "politicalParties") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([]),
            }),
          };
        }
        if (name === "cabinetMembers") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue(cabinetRows),
            }),
          };
        }
        if (name === "electedOfficials") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue(electedRows),
            }),
          };
        }
        if (name === "supremeCourtSeats") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue(seatedJusticeRows),
            }),
          };
        }
        return {
          bulkWrite: mockBulkWrite,
          findOne: vi.fn().mockResolvedValue(null),
          insertOne: vi.fn().mockResolvedValue(undefined),
        };
      }),
    } as never);
  });

  it("updates character with base actions only", async () => {
    const { processActionRefresh } = await import("./actionRefresh");
    const char: Character = {
      _id: "char1" as never,
      userId: "user1" as never,
      name: "Test",
      countryId: "US",
      homeState: "CA",
      policies: { economic: 0, social: 0 },
      actions: 5,
      funds: 100000,
      favorability: 50,
      politicalInfluence: 10,
      nationalInfluence: 0,
      donorBaseLevel: 0,
      infamy: 0,
      party: "independent",
      currentOffice: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Character;

    const config: GameConfig = {
      _id: "default",
      baseActionsPerTurn: 4,
      officeActionBonus: {},
      chairActionBonus: 3,
    } as GameConfig;

    await processActionRefresh([char], config, new Date());

    expect(mockBulkWrite).toHaveBeenCalledTimes(1);
    const [ops] = mockBulkWrite.mock.calls[0];
    expect(ops).toHaveLength(1);
    const op = ops[0];
    expect(op.updateOne.filter).toMatchObject({
      _id: "char1",
      actions: 5,
      politicalInfluence: 10,
      nationalInfluence: 0,
    });
    const update = op.updateOne.update.$set as Record<string, unknown>;
    expect(update.actions).toBe(9); // 5 + 4 base
    // politicalInfluence starts at 10, decays by 10 * 0.0075 = 0.075
    expect(update.politicalInfluence).toBeCloseTo(9.925, 5);
    // nationalInfluence starts at 0, gains state influence / 100 = 10/100 = 0.1
    expect(update.nationalInfluence).toBeCloseTo(0.1, 5);
    expect(update.infamy).toBeDefined();
    expect(update.favorability).toBeDefined();
  });

  it("applies hoarding penalty when actions > 100", async () => {
    const { processActionRefresh } = await import("./actionRefresh");
    const char: Character = {
      _id: "char2" as never,
      userId: "user2" as never,
      name: "Hoarder",
      countryId: "US",
      homeState: "TX",
      policies: { economic: 0, social: 0 },
      actions: 105,
      funds: 100000,
      favorability: 50,
      politicalInfluence: 0,
      nationalInfluence: 0,
      donorBaseLevel: 0,
      infamy: 0,
      party: "independent",
      currentOffice: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Character;

    const config: GameConfig = {
      _id: "default",
      baseActionsPerTurn: 4,
      officeActionBonus: {},
      chairActionBonus: 3,
    } as GameConfig;

    await processActionRefresh([char], config, new Date());

    const [ops] = mockBulkWrite.mock.calls[0];
    const update = ops[0].updateOne.update.$set as Record<string, unknown>;
    // 105 - 4 (penalty) + 4 (base) = 105
    expect(update.actions).toBe(105);
  });

  it("applies the advertised infamy favorability drain above 20 infamy", async () => {
    const { processActionRefresh } = await import("./actionRefresh");
    const char: Character = {
      _id: "charInfamy" as never,
      userId: "userInfamy" as never,
      name: "Notorious",
      countryId: "US",
      homeState: "TX",
      policies: { economic: 0, social: 0 },
      actions: 5,
      funds: 100000,
      favorability: 50,
      politicalInfluence: 0,
      nationalInfluence: 0,
      donorBaseLevel: 0,
      infamy: 60,
      party: "independent",
      currentOffice: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Character;

    const config: GameConfig = {
      _id: "default",
      baseActionsPerTurn: 4,
      officeActionBonus: {},
      chairActionBonus: 3,
    } as GameConfig;

    await processActionRefresh([char], config, new Date());

    const [ops] = mockBulkWrite.mock.calls[0];
    const update = ops[0].updateOne.update.$set as Record<string, unknown>;
    // (60 - 20) x 0.05 = 2.0 favorability drain; fav 50 is below the
    // above-threshold penalty, so the drain is the only change.
    expect(update.favorability).toBeCloseTo(48, 5);
    // Infamy still decays 5% on top of the drain it caused.
    expect(update.infamy).toBeCloseTo(57, 5);
  });

  it("does not drain favorability at or below 20 infamy and clamps at the 0 floor", async () => {
    const { processActionRefresh } = await import("./actionRefresh");
    const base = {
      userId: "u" as never,
      name: "X",
      countryId: "US",
      homeState: "TX",
      policies: { economic: 0, social: 0 },
      actions: 5,
      funds: 100000,
      politicalInfluence: 0,
      nationalInfluence: 0,
      donorBaseLevel: 0,
      party: "independent",
      currentOffice: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const mild: Character = {
      ...base,
      _id: "charMild" as never,
      favorability: 50,
      infamy: 20,
    } as Character;
    const doomed: Character = {
      ...base,
      _id: "charDoomed" as never,
      favorability: 1,
      infamy: 100,
    } as Character;

    const config: GameConfig = {
      _id: "default",
      baseActionsPerTurn: 4,
      officeActionBonus: {},
      chairActionBonus: 3,
    } as GameConfig;

    await processActionRefresh([mild, doomed], config, new Date());

    const [ops] = mockBulkWrite.mock.calls[0];
    const byId = Object.fromEntries(
      (
        ops as {
          updateOne: { filter: { _id: string }; update: { $set: Record<string, unknown> } };
        }[]
      ).map((op) => [op.updateOne.filter._id, op.updateOne.update.$set])
    );
    // At exactly 20 infamy: no drain.
    expect(byId.charMild.favorability).toBeCloseTo(50, 5);
    // 100 infamy drains 4/turn but favorability clamps at the 0 floor.
    expect(byId.charDoomed.favorability).toBe(0);
  });

  it("stacks chair bonus on top of elected-office bonus when character is central bank chair", async () => {
    // Regression: John Blackthorne (sangiin + BoJ chair) was only getting sangiin
    // bonus because chair status lived on currentOffice and got clobbered each
    // election. Chair bonus now comes from centralBanks.chairCharacterId and
    // stacks with whatever elected seat is in currentOffice.
    const { processActionRefresh } = await import("./actionRefresh");
    const charId = "chair-char" as never;
    chairRows = [{ chairCharacterId: { toString: () => "chair-char" } }];

    const char: Character = {
      _id: charId,
      userId: "user1" as never,
      name: "Chair + Legislator",
      countryId: "JP",
      homeState: "KAN",
      policies: { economic: 0, social: 0 },
      actions: 10,
      funds: 100000,
      favorability: 50,
      politicalInfluence: 0,
      nationalInfluence: 0,
      donorBaseLevel: 0,
      infamy: 0,
      party: "cdp",
      currentOffice: { type: "sangiin", state: "KAN", seatsHeld: 11, chamberClass: 1 },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Character;

    const config = {
      _id: "default",
      baseActionsPerTurn: 4,
      officeActionBonus: { sangiin: 1 } as Record<string, number>,
      chairActionBonus: 3,
    } as GameConfig;

    await processActionRefresh([char], config, new Date());

    const [ops] = mockBulkWrite.mock.calls[0];
    const update = ops[0].updateOne.update.$set as Record<string, unknown>;
    // 10 + base 4 + sangiin 1 + chair 3 = 18
    expect(update.actions).toBe(18);
  });

  it("grants only the chair bonus when chair holds no elected office", async () => {
    const { processActionRefresh } = await import("./actionRefresh");
    const charId = "chair-only" as never;
    chairRows = [{ chairCharacterId: { toString: () => "chair-only" } }];

    const char: Character = {
      _id: charId,
      userId: "user1" as never,
      name: "Chair only",
      countryId: "US",
      homeState: "NY",
      policies: { economic: 0, social: 0 },
      actions: 0,
      funds: 100000,
      favorability: 50,
      politicalInfluence: 0,
      nationalInfluence: 0,
      donorBaseLevel: 0,
      infamy: 0,
      party: "democrat",
      currentOffice: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Character;

    const config: GameConfig = {
      _id: "default",
      baseActionsPerTurn: 4,
      officeActionBonus: {},
      chairActionBonus: 3,
    } as GameConfig;

    await processActionRefresh([char], config, new Date());

    const [ops] = mockBulkWrite.mock.calls[0];
    const update = ops[0].updateOne.update.$set as Record<string, unknown>;
    // 0 + base 4 + chair 3 = 7
    expect(update.actions).toBe(7);
  });

  it("grants the Justice NI bonus (#3598) on top of an elected-office NI bonus, stacked like the chair bonus", async () => {
    // A seated Justice is stored on supremeCourtSeats.justiceCharacterId, not
    // character.currentOffice — mirrors the central bank chair bonus stacking
    // pattern above, not the chairRows one (different collection/field).
    const { processActionRefresh } = await import("./actionRefresh");
    const charId = "justice-char" as never;
    seatedJusticeRows = [{ justiceCharacterId: { toString: () => "justice-char" } }];

    const char: Character = {
      _id: charId,
      userId: "user1" as never,
      name: "Justice + Senator",
      countryId: "US",
      homeState: "NY",
      policies: { economic: 0, social: 0 },
      actions: 0,
      funds: 100000,
      favorability: 50,
      politicalInfluence: 0,
      nationalInfluence: 0,
      donorBaseLevel: 0,
      infamy: 0,
      party: "democrat",
      currentOffice: { type: "senate", state: "NY", senateClass: 1 },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Character;

    const config: GameConfig = {
      _id: "default",
      baseActionsPerTurn: 4,
      officeActionBonus: {},
      chairActionBonus: 3,
    } as GameConfig;

    await processActionRefresh([char], config, new Date());

    const [ops] = mockBulkWrite.mock.calls[0];
    const update = ops[0].updateOne.update.$set as Record<string, unknown>;
    // Senate's own OFFICE_NI_BONUS tier is 1.0; Justice's is 2.0 — the higher
    // of the two wins (Math.max stacking, same as party-chair/leader tiers).
    expect(update.nationalInfluence).toBeGreaterThanOrEqual(2.0);
  });

  it("stacks the cabinet bonus on the legislative seat for a cabinet minister", async () => {
    // Bug #0758: a DE minister's currentOffice is overwritten to
    // parliamentaryCabinet on appointment, but they still hold their bundestag
    // seat in electedOfficials. The office bonus must be seat + cabinet, not 0.
    const { processActionRefresh } = await import("./actionRefresh");
    const charId = "de-minister" as never;
    cabinetRows = [{ characterId: { toString: () => "de-minister" }, countryId: "DE" }];
    electedRows = [
      { characterId: { toString: () => "de-minister" }, officeType: "bundestag", countryId: "DE" },
    ];

    const char: Character = {
      _id: charId,
      userId: "user1" as never,
      name: "Roman Herzog",
      countryId: "DE",
      homeState: "NI",
      policies: { economic: 0, social: 0 },
      actions: 0,
      funds: 100000,
      favorability: 50,
      politicalInfluence: 0,
      nationalInfluence: 0,
      donorBaseLevel: 0,
      infamy: 0,
      party: "2",
      currentOffice: { type: "parliamentaryCabinet", positionId: "defense_minister" },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Character;

    const config = {
      _id: "default",
      baseActionsPerTurn: 4,
      officeActionBonus: { bundestag: 1, parliamentaryCabinet: 1 } as Record<string, number>,
      chairActionBonus: 3,
    } as GameConfig;

    await processActionRefresh([char], config, new Date());

    const [ops] = mockBulkWrite.mock.calls[0];
    const update = ops[0].updateOne.update.$set as Record<string, unknown>;
    // 0 + base 4 + bundestag seat 1 + cabinet 1 = 6
    expect(update.actions).toBe(6);
  });

  it("caps actions at 200", async () => {
    const { processActionRefresh } = await import("./actionRefresh");
    const char: Character = {
      _id: "char3" as never,
      userId: "user3" as never,
      name: "Capped",
      countryId: "US",
      homeState: "NY",
      policies: { economic: 0, social: 0 },
      actions: 201, // 201 - 4 (hoard) + 3 (base) = 200
      funds: 100000,
      favorability: 50,
      politicalInfluence: 0,
      nationalInfluence: 0,
      donorBaseLevel: 0,
      infamy: 0,
      party: "independent",
      currentOffice: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Character;

    const config: GameConfig = {
      _id: "default",
      baseActionsPerTurn: 4,
      officeActionBonus: {},
      chairActionBonus: 3,
    } as GameConfig;

    await processActionRefresh([char], config, new Date());

    const [ops] = mockBulkWrite.mock.calls[0];
    const update = ops[0].updateOne.update.$set as Record<string, unknown>;
    expect(update.actions).toBeLessThanOrEqual(200);
    expect(update.actions).toBe(200); // capped
  });

  it("clamps over-cap player influence and favorability back to 100", async () => {
    const { processActionRefresh } = await import("./actionRefresh");
    const char: Character = {
      _id: "char4" as never,
      userId: "user4" as never,
      name: "Overcapped",
      countryId: "US",
      homeState: "FL",
      policies: { economic: 0, social: 0 },
      actions: 10,
      funds: 100000,
      favorability: 125,
      politicalInfluence: 140,
      nationalInfluence: 0,
      donorBaseLevel: 0,
      infamy: 0,
      party: "independent",
      currentOffice: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Character;

    const config: GameConfig = {
      _id: "default",
      baseActionsPerTurn: 4,
      officeActionBonus: {},
      chairActionBonus: 3,
    } as GameConfig;

    await processActionRefresh([char], config, new Date());

    const [ops] = mockBulkWrite.mock.calls[0];
    const update = ops[0].updateOne.update.$set as Record<string, unknown>;
    expect(update.politicalInfluence).toBe(100);
    expect(update.favorability).toBe(100);
  });

  it("barriers NPP influence decay at 10 while players still decay below it", async () => {
    const { processActionRefresh } = await import("./actionRefresh");

    // A player sitting exactly on the NPP floor must keep decaying (floor 0).
    const player: Character = {
      _id: "playerLow" as never,
      userId: "userLow" as never,
      name: "LowPlayer",
      countryId: "US",
      homeState: "CA",
      policies: { economic: 0, social: 0 },
      actions: 5,
      funds: 100000,
      favorability: 50,
      politicalInfluence: 10,
      nationalInfluence: 0,
      donorBaseLevel: 0,
      infamy: 0,
      party: "independent",
      currentOffice: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Character;

    // NPPs: one on the floor (stays), one above (decays), one shell below the
    // floor (held in place, NOT inflated up to 10).
    nppRows = [
      { _id: "nppOnFloor", politicalInfluence: 10, favorability: 50 },
      { _id: "nppAbove", politicalInfluence: 30, favorability: 72 },
      { _id: "nppShell", politicalInfluence: 1, favorability: 50 },
    ];

    const config: GameConfig = {
      _id: "default",
      baseActionsPerTurn: 4,
      officeActionBonus: {},
      chairActionBonus: 3,
    } as GameConfig;

    await processActionRefresh([player], config, new Date());

    // Player still decays below 10 (floor 0).
    const playerUpdate = mockBulkWrite.mock.calls[0][0][0].updateOne.update.$set as Record<
      string,
      unknown
    >;
    expect(playerUpdate.politicalInfluence).toBeCloseTo(9.925, 5);

    // NPP ops go through the dedicated npp bulkWrite.
    const nppOps = mockNppBulkWrite.mock.calls[0][0] as {
      updateOne: { filter: { _id: string }; update: { $set: Record<string, number> } };
    }[];
    const byId = Object.fromEntries(
      nppOps.map((op) => [op.updateOne.filter._id, op.updateOne.update.$set])
    );
    expect(byId.nppOnFloor.politicalInfluence).toBe(10);
    expect(byId.nppAbove.politicalInfluence).toBeCloseTo(30 - 30 * 0.0075, 5);
    expect(byId.nppShell.politicalInfluence).toBe(1);
  });

  it("applies the government approval drain to an NPP head of government", async () => {
    const { processActionRefresh } = await import("./actionRefresh");
    const pmNppId = "nppExecutive" as never;
    nppRows = [
      {
        _id: pmNppId,
        countryId: "DD",
        party: "sed",
        politicalInfluence: 10,
        favorability: 50,
      },
    ];
    governmentFormationRows = [
      { _id: "DD", countryId: "DD", status: "formed", pmCharacterId: null, pmNppId },
    ];
    governmentApprovalRows = [{ _id: "DD", approvalRating: 20 }];

    await processActionRefresh([], null, new Date());

    const update = mockNppBulkWrite.mock.calls.at(-1)![0][0].updateOne.update.$set;
    expect(update.favorability).toBeCloseTo(49.85, 5);
  });

  it("applies accountability in an in-memory persisted fixture while excluding a ceremonial president", async () => {
    const { processActionRefresh } = await import("./actionRefresh");
    const config = {
      _id: "default",
      baseActionsPerTurn: 4,
      officeActionBonus: {},
      chairActionBonus: 3,
    } as GameConfig;

    const makeCharacter = (id: string, countryId: string, party: string): Character =>
      ({
        _id: id as never,
        userId: `user-${id}` as never,
        name: id,
        countryId,
        homeState: "NATIONAL",
        policies: { economic: 0, social: 0 },
        actions: 5,
        funds: 0,
        favorability: 50,
        politicalInfluence: 10,
        nationalInfluence: 0,
        donorBaseLevel: 0,
        infamy: 0,
        party,
        currentOffice: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }) as Character;

    const runFixture = async (approvalRating: number) => {
      const usMember = makeCharacter("us-member", "US", "democrat");
      const usPartyMember = makeCharacter("us-party-member", "US", "democrat");
      const ruPm = makeCharacter("ru-pm", "RU", "communist");
      const ceremonialPresident = makeCharacter("ru-president", "RU", "ceremonial");
      usMember.favorability = 49;
      usMember.infamy = 40;
      const nppExecutive = {
        _id: "dd-npp-executive" as never,
        countryId: "DD",
        party: "sed",
        politicalInfluence: 10,
        favorability: 50,
      };
      characterRows = [usMember, usPartyMember, ruPm, ceremonialPresident];
      nppRows = [nppExecutive];
      electedRows = [
        { characterId: usMember._id, officeType: "president", countryId: "US" },
        {
          characterId: ceremonialPresident._id,
          officeType: "president",
          countryId: "RU",
          party: "ceremonial",
        },
      ];
      governmentFormationRows = [
        {
          _id: "RU",
          countryId: "RU",
          status: "formed",
          pmCharacterId: ruPm._id,
          pmNppId: null,
        },
        {
          _id: "DD",
          countryId: "DD",
          status: "formed",
          pmCharacterId: null,
          pmNppId: nppExecutive._id,
        },
      ];
      governmentApprovalRows = [
        { _id: "US", approvalRating },
        { _id: "RU", approvalRating },
        { _id: "DD", approvalRating },
      ];
      persistFixture = true;

      await processActionRefresh(characterRows, config, new Date());
      return { usMember, usPartyMember, ruPm, ceremonialPresident, nppExecutive };
    };

    const accountable = await runFixture(20);
    const control = await runFixture(50);

    // The US executive also takes the ordinary 1-point infamy drain (40 - 20) *
    // 0.05, so the persisted fixture still exposes the exact 0.15 delta.
    expect(accountable.usMember.favorability).toBeCloseTo(47.85, 5);
    expect(accountable.usPartyMember.favorability).toBeCloseTo(49.85, 5);
    expect(accountable.ruPm.favorability).toBeCloseTo(49.85, 5);
    expect(accountable.nppExecutive.favorability).toBeCloseTo(49.85, 5);
    expect(accountable.ceremonialPresident.favorability).toBeCloseTo(50, 5);
    expect(control.usMember.favorability).toBeCloseTo(48, 5);
    expect(control.usPartyMember.favorability).toBeCloseTo(50, 5);
    expect(control.ruPm.favorability).toBeCloseTo(50, 5);
    expect(control.nppExecutive.favorability).toBeCloseTo(50, 5);
    expect(control.ceremonialPresident.favorability).toBeCloseTo(50, 5);
    expect(control.usMember.favorability - accountable.usMember.favorability).toBeCloseTo(0.15, 5);
    expect(control.nppExecutive.favorability - accountable.nppExecutive.favorability).toBeCloseTo(
      0.15,
      5
    );
  });

  it("grants a DD Volkskammer deputy the same seat generation a US member gets (ticket #974)", async () => {
    const { processActionRefresh } = await import("./actionRefresh");
    // The live gameConfig map has no key for any non-US-vocabulary office, so
    // the registry fallback is what has to supply the bonus here.
    const config: GameConfig = {
      _id: "default",
      baseActionsPerTurn: 4,
      officeActionBonus: { house: 1, senate: 2 },
      chairActionBonus: 3,
    } as unknown as GameConfig;

    const deputy: Character = {
      _id: "ddDeputy" as never,
      userId: "userDD" as never,
      name: "Deputy",
      countryId: "DD",
      homeState: "TH",
      policies: { economic: 0, social: 0 },
      actions: 5,
      funds: 0,
      favorability: 50,
      politicalInfluence: 0,
      nationalInfluence: 0,
      donorBaseLevel: 0,
      infamy: 0,
      party: "independent",
      currentOffice: { type: "volkskammerDeputy", state: "TH" },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Character;

    const rep: Character = {
      ...deputy,
      _id: "usRep" as never,
      countryId: "US",
      homeState: "CA",
      currentOffice: { type: "house", state: "CA" },
    } as unknown as Character;

    await processActionRefresh([deputy, rep], config, new Date());

    const [ops] = mockBulkWrite.mock.calls[0];
    const byId = Object.fromEntries(
      (
        ops as {
          updateOne: { filter: { _id: string }; update: { $set: Record<string, number> } };
        }[]
      ).map((op) => [op.updateOne.filter._id, op.updateOne.update.$set])
    );
    // 5 + 4 base + 1 seat bonus — identical to the US representative.
    expect(byId.ddDeputy.actions).toBe(10);
    expect(byId.usRep.actions).toBe(10);
    // Rank-and-file legislator NI tier, also identical.
    expect(byId.ddDeputy.nationalInfluence).toBeCloseTo(1.0, 5);
    expect(byId.usRep.nationalInfluence).toBeCloseTo(1.0, 5);
  });
});
