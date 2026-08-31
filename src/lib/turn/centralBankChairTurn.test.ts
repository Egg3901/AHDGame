import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

// Mock countries config
// Partial mock: only COUNTRY_CONFIGS is stubbed, everything else falls through
// to the real module. A bare factory silently drops every other export, which
// broke this file when `getCountryDisplayName` was added and picked up by
// `worldEntityManifest` (#3745).
vi.mock("@/lib/constants/countries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/constants/countries")>();
  return {
    ...actual,
    // Override only the US central-bank shape this suite asserts on. The other
    // countries stay real: a bare factory dropped every other export (breaking
    // this file when `getCountryDisplayName` was added, #3745), and replacing
    // COUNTRY_CONFIGS wholesale desynced it from the real COUNTRY_ORDER that
    // `worldEntityManifest` walks.
    COUNTRY_CONFIGS: {
      ...actual.COUNTRY_CONFIGS,
      US: {
        ...actual.COUNTRY_CONFIGS.US,
        id: "US",
        governmentType: "presidential",
        centralBank: { name: "Federal Reserve", defaultPrimeRate: 2.5 },
      },
    },
  };
});

vi.mock("@/lib/constants/nationalScope", () => ({
  getNationalDocId: (countryId: string) =>
    countryId === "US" ? "federal" : `${countryId.toLowerCase()}_national`,
}));

// Spy on the NPP auto-rate module so we can assert it is invoked for npp chairs
// and NOT invoked for character chairs.
const processNppChairAutoRateMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/nppAutonomy/nppChairAutoRate", () => ({
  processNppChairAutoRate: processNppChairAutoRateMock,
}));

describe("processCentralBankChairTurn", () => {
  const chairCharacterId = new ObjectId();

  let testBanks: unknown[] = [];
  let testBudgetInflation = 2.0;
  let testGdpGrowth = 2.0;

  const collectionMocks = new Map<
    string,
    {
      find: ReturnType<typeof vi.fn>;
      findOne: ReturnType<typeof vi.fn>;
      updateOne: ReturnType<typeof vi.fn>;
      bulkWrite: ReturnType<typeof vi.fn>;
    }
  >();

  function getCollectionMock(name: string) {
    if (!collectionMocks.has(name)) {
      collectionMocks.set(name, {
        find: vi.fn(),
        findOne: vi.fn().mockResolvedValue(null),
        updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        bulkWrite: vi.fn().mockResolvedValue({ ok: 1 }),
      });
    }
    return collectionMocks.get(name)!;
  }

  let mockDb: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    collectionMocks.clear();
    processNppChairAutoRateMock.mockResolvedValue(undefined);
    testBudgetInflation = 2.0;
    testGdpGrowth = 2.0;
    testBanks = [
      {
        _id: "US",
        countryId: "US",
        chairCharacterId,
        chairCharacterName: "Test Chair",
        primeRate: 3.0,
        chairInfamy: 0,
      },
    ];

    getCollectionMock("centralBanks").find.mockImplementation((filter: Record<string, unknown>) => {
      if (Object.keys(filter).length === 0) {
        return { project: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue(testBanks) };
      }
      return { project: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) };
    });
    getCollectionMock("centralBanks").bulkWrite.mockImplementation((ops: Array<unknown>) =>
      Promise.resolve({ ok: 1, matchedCount: ops.length, modifiedCount: ops.length })
    );
    getCollectionMock("characters").bulkWrite.mockImplementation((ops: Array<unknown>) =>
      Promise.resolve({ ok: 1, matchedCount: ops.length, modifiedCount: ops.length })
    );

    getCollectionMock("federalBudget").find.mockImplementation(
      (filter: Record<string, unknown>) => {
        if (filter._id && typeof filter._id === "object" && "$in" in filter._id) {
          const ids = (filter._id as { $in: string[] }).$in;
          if (ids.includes("federal")) {
            return {
              toArray: vi
                .fn()
                .mockResolvedValue([
                  { _id: "federal", economicFactors: { inflationRate: testBudgetInflation } },
                ]),
            };
          }
        }
        return { toArray: vi.fn().mockResolvedValue([]) };
      }
    );

    // SP5: national economic rollups are read from macroMetrics.
    getCollectionMock("macroMetrics").find.mockImplementation((filter: Record<string, unknown>) => {
      if (filter._id && typeof filter._id === "object" && "$in" in filter._id) {
        const ids = (filter._id as { $in: string[] }).$in;
        if (ids.some((id) => id === "federal" || id.endsWith("_national"))) {
          return {
            toArray: vi
              .fn()
              .mockResolvedValue([
                { _id: "federal", economic: { gdpGrowth: { value: testGdpGrowth } } },
              ]),
          };
        }
      }
      return { toArray: vi.fn().mockResolvedValue([]) };
    });

    mockDb = {
      collection: vi.fn().mockImplementation((name: string) => getCollectionMock(name)),
    };
  });

  it("does not change infamy at target inflation and target growth", async () => {
    const { processCentralBankChairTurn } = await import("./centralBankChairTurn");
    const result = await processCentralBankChairTurn(mockDb as never, 100);

    expect(result.banksProcessed).toBe(1);
    expect(result.chairsPenalized).toBe(0);
    expect(result.bankWritesMatched).toBe(1);
    expect(result.bankWritesModified).toBe(1);

    const centralBanksMock = getCollectionMock("centralBanks");
    expect(centralBanksMock.bulkWrite).toHaveBeenCalledTimes(1);
    const [bankOps] = centralBanksMock.bulkWrite.mock.calls[0] as [
      Array<{ updateOne: { filter: { _id: string }; update: { $set: { chairInfamy: number } } } }>,
    ];
    const bankUpdate = bankOps[0].updateOne;
    expect(bankUpdate.filter._id).toBe("US");
    expect(bankUpdate.update.$set.chairInfamy).toBeCloseTo(0, 2);

    const charMock = getCollectionMock("characters");
    expect(charMock.bulkWrite).toHaveBeenCalledTimes(1);
    const [charOps] = charMock.bulkWrite.mock.calls[0] as [
      Array<{ updateOne: { update: { $inc: { nationalInfluence: number; actions?: number } } } }>,
    ];
    const charUpdate = charOps[0].updateOne;
    expect(charUpdate.update.$inc.nationalInfluence).toBe(0.5);
    expect(charUpdate.update.$inc.actions).toBeUndefined();
  });

  it("increases infamy with high inflation", async () => {
    testBudgetInflation = 8.0;

    const { processCentralBankChairTurn } = await import("./centralBankChairTurn");
    await processCentralBankChairTurn(mockDb as never, 100);

    // delta = (8-2)*0.5 + (2-2)*0.5 = 3.0
    const centralBanksMock = getCollectionMock("centralBanks");
    const [bankOps] = centralBanksMock.bulkWrite.mock.calls[0] as [
      Array<{ updateOne: { update: { $set: { chairInfamy: number } } } }>,
    ];
    expect(bankOps[0].updateOne.update.$set.chairInfamy).toBeCloseTo(3.0, 1);
  });

  it("increases infamy with low growth", async () => {
    testGdpGrowth = -1.0;

    const { processCentralBankChairTurn } = await import("./centralBankChairTurn");
    await processCentralBankChairTurn(mockDb as never, 100);

    // delta = (2-2)*0.5 + (2-(-1))*0.5 = 1.5
    const centralBanksMock = getCollectionMock("centralBanks");
    const [bankOps] = centralBanksMock.bulkWrite.mock.calls[0] as [
      Array<{ updateOne: { update: { $set: { chairInfamy: number } } } }>,
    ];
    expect(bankOps[0].updateOne.update.$set.chairInfamy).toBeCloseTo(1.5, 1);
  });

  it("halves bonuses when infamy > 25", async () => {
    testBanks = [
      {
        _id: "US",
        countryId: "US",
        chairCharacterId,
        chairCharacterName: "Test Chair",
        primeRate: 3.0,
        chairInfamy: 30,
      },
    ];

    const { processCentralBankChairTurn } = await import("./centralBankChairTurn");
    const result = await processCentralBankChairTurn(mockDb as never, 100);

    // After decay: 30 * 0.95 = 28.5 (still > 25), so penalty applies
    expect(result.chairsPenalized).toBe(1);

    const charMock = getCollectionMock("characters");
    const [charOps] = charMock.bulkWrite.mock.calls[0] as [
      Array<{ updateOne: { update: { $inc: { nationalInfluence: number; actions: number } } } }>,
    ];
    expect(charOps[0].updateOne.update.$inc.nationalInfluence).toBe(0.25);
    expect(charOps[0].updateOne.update.$inc.actions).toBe(-1.5);
  });

  it("decreases infamy with low inflation and high growth", async () => {
    testBanks = [
      {
        _id: "US",
        countryId: "US",
        chairCharacterId,
        chairCharacterName: "Test Chair",
        primeRate: 3.0,
        chairInfamy: 20,
      },
    ];

    testBudgetInflation = 1.0;
    testGdpGrowth = 4.0;

    const { processCentralBankChairTurn } = await import("./centralBankChairTurn");
    await processCentralBankChairTurn(mockDb as never, 100);

    // decay: 20 * 0.95 = 19
    // raw delta: (1-2)*0.5 + (2-4)*0.5 = -0.5 + -1.0 = -1.5
    // dampener: max(0.1, 1 - 20/150) = 0.8667
    // dampened delta: -1.5 * 0.8667 = -1.3
    // new: 19 - 1.3 = 17.7
    const centralBanksMock = getCollectionMock("centralBanks");
    const [bankOps] = centralBanksMock.bulkWrite.mock.calls[0] as [
      Array<{ updateOne: { update: { $set: { chairInfamy: number } } } }>,
    ];
    expect(bankOps[0].updateOne.update.$set.chairInfamy).toBeCloseTo(17.7, 1);
  });

  it("clamps infamy to 0-100", async () => {
    testBanks = [
      {
        _id: "US",
        countryId: "US",
        chairCharacterId,
        chairCharacterName: "Test Chair",
        primeRate: 3.0,
        chairInfamy: 1,
      },
    ];

    testBudgetInflation = 0.5;
    testGdpGrowth = 5.0;

    const { processCentralBankChairTurn } = await import("./centralBankChairTurn");
    await processCentralBankChairTurn(mockDb as never, 100);

    // decay: 1 * 0.95 = 0.95
    // delta: (0.5-2)*0.5 + (2-5)*0.5 = -0.75 + -1.5 = -2.25
    // new: max(0, 0.95 - 2.25) = 0
    const centralBanksMock = getCollectionMock("centralBanks");
    const [bankOps] = centralBanksMock.bulkWrite.mock.calls[0] as [
      Array<{ updateOne: { update: { $set: { chairInfamy: number } } } }>,
    ];
    expect(bankOps[0].updateOne.update.$set.chairInfamy).toBe(0);
  });

  it("records high-scrutiny diagnostics and decays 100 when net delta is below decay", async () => {
    testBanks = [
      {
        _id: "US",
        countryId: "US",
        chairCharacterId,
        chairCharacterName: "Test Chair",
        primeRate: 3.0,
        chairInfamy: 100,
      },
    ];
    testBudgetInflation = 1.95;
    testGdpGrowth = 0.483;

    const { processCentralBankChairTurn } = await import("./centralBankChairTurn");
    const result = await processCentralBankChairTurn(mockDb as never, 100);

    const centralBanksMock = getCollectionMock("centralBanks");
    const [bankOps] = centralBanksMock.bulkWrite.mock.calls[0] as [
      Array<{ updateOne: { update: { $set: { chairInfamy: number } } } }>,
    ];
    expect(bankOps[0].updateOne.update.$set.chairInfamy).toBeCloseTo(95.7335, 4);
    expect(result.highScrutinyDiagnostics).toEqual([
      expect.objectContaining({
        bankId: "US",
        countryId: "US",
        previousInfamy: 100,
        newInfamy: expect.closeTo(95.7335, 4),
        inflationRate: 1.95,
        targetInflation: 2,
        gdpGrowth: 0.483,
        scrutinyDelta: expect.closeTo(0.7335, 4),
      }),
    ]);
  });

  it("decays from the 100 cap when stored scrutiny is over cap", async () => {
    testBanks = [
      {
        _id: "US",
        countryId: "US",
        chairCharacterId,
        chairCharacterName: "Test Chair",
        primeRate: 3.0,
        chairInfamy: 115,
      },
    ];
    testBudgetInflation = 2.0;
    testGdpGrowth = 2.0;

    const { processCentralBankChairTurn } = await import("./centralBankChairTurn");
    await processCentralBankChairTurn(mockDb as never, 100);

    const centralBanksMock = getCollectionMock("centralBanks");
    const [bankOps] = centralBanksMock.bulkWrite.mock.calls[0] as [
      Array<{ updateOne: { update: { $set: { chairInfamy: number } } } }>,
    ];
    expect(bankOps[0].updateOne.update.$set.chairInfamy).toBeCloseTo(95, 2);
  });

  it("can score scrutiny against a country-specific inflation target", async () => {
    const { computeScrutinyDelta } = await import("./centralBankChairTurn");

    expect(computeScrutinyDelta(6.0, 2.0, 0, 6.0)).toBeCloseTo(0, 6);
    expect(computeScrutinyDelta(22.0, 2.0, 0, 6.0)).toBeGreaterThan(0);
  });

  it("skips banks without a chair", async () => {
    testBanks = [
      {
        _id: "US",
        countryId: "US",
        chairCharacterId: null,
        chairCharacterName: null,
        primeRate: 3.0,
        chairInfamy: 10,
      },
    ];

    const { processCentralBankChairTurn } = await import("./centralBankChairTurn");
    const result = await processCentralBankChairTurn(mockDb as never, 100);

    expect(result.banksProcessed).toBe(1);
    // Only bank update, no character update
    const centralBanksMock = getCollectionMock("centralBanks");
    expect(centralBanksMock.bulkWrite).toHaveBeenCalledTimes(1);
    const charMock = getCollectionMock("characters");
    expect(charMock.bulkWrite).toHaveBeenCalledTimes(0);
  });

  it("runs the NPP auto-rate for npp chairs and skips the character NPI/debit path", async () => {
    testBanks = [
      {
        _id: "US",
        countryId: "US",
        // NPP technocrat: no character chair, chairMode === "npp"
        chairCharacterId: null,
        chairCharacterName: null,
        chairMode: "npp",
        primeRate: 3.0,
        lastRateChangeTurn: 50,
        chairInfamy: 10,
      },
    ];

    const { processCentralBankChairTurn } = await import("./centralBankChairTurn");
    const result = await processCentralBankChairTurn(mockDb as never, 100);

    expect(result.banksProcessed).toBe(1);
    // chairInfamy is still decayed + written for display transparency.
    const centralBanksMock = getCollectionMock("centralBanks");
    expect(centralBanksMock.bulkWrite).toHaveBeenCalledTimes(1);
    const [bankOps] = centralBanksMock.bulkWrite.mock.calls[0] as [
      Array<{ updateOne: { filter: { _id: string }; update: { $set: { chairInfamy: number } } } }>,
    ];
    expect(bankOps[0].updateOne.filter._id).toBe("US");

    // NPP auto-rate invoked with (db, bank, countryId, currentTurn).
    expect(processNppChairAutoRateMock).toHaveBeenCalledTimes(1);
    const [dbArg, bankArg, countryArg, turnArg] = processNppChairAutoRateMock.mock.calls[0] as [
      unknown,
      { _id: string; chairMode: string },
      string,
      number,
    ];
    expect(dbArg).toBe(mockDb);
    expect(bankArg._id).toBe("US");
    expect(bankArg.chairMode).toBe("npp");
    expect(countryArg).toBe("US");
    expect(turnArg).toBe(100);

    // Character-side NPI bonus / action debit MUST NOT run.
    const charMock = getCollectionMock("characters");
    expect(charMock.bulkWrite).toHaveBeenCalledTimes(0);
  });

  it("does not invoke the NPP auto-rate for character-mode chairs", async () => {
    testBanks = [
      {
        _id: "US",
        countryId: "US",
        chairCharacterId,
        chairCharacterName: "Test Chair",
        chairMode: "character",
        primeRate: 3.0,
        chairInfamy: 0,
      },
    ];

    const { processCentralBankChairTurn } = await import("./centralBankChairTurn");
    await processCentralBankChairTurn(mockDb as never, 100);

    // Existing character-chair path runs (characters.bulkWrite called once).
    const charMock = getCollectionMock("characters");
    expect(charMock.bulkWrite).toHaveBeenCalledTimes(1);
    // NPP auto-rate NOT invoked.
    expect(processNppChairAutoRateMock).not.toHaveBeenCalled();
  });

  it("runs the NPP auto-rate on a committee board too vacant to carry a motion", async () => {
    // Ticket #1238 follow-up: with the board decayed below the carry-a-motion
    // threshold the committee owns nothing, so an autonomous (NPP) chair holds
    // the rate directly via the single-chair setter.
    testBanks = [
      {
        _id: "US",
        countryId: "US",
        chairCharacterId: null,
        chairCharacterName: null,
        chairMode: "npp",
        primeRate: 3.0,
        lastRateChangeTurn: 50,
        chairInfamy: 10,
        // 1 of 7 seated (chair only): the rest vacant.
        fomcBoard: [
          { seatId: "seat-1", isChair: true, occupantType: "npp", nppId: new ObjectId() },
          { seatId: "seat-2", occupantType: "vacant" },
          { seatId: "seat-3", occupantType: "vacant" },
          { seatId: "seat-4", occupantType: "vacant" },
          { seatId: "seat-5", occupantType: "vacant" },
          { seatId: "seat-6", occupantType: "vacant" },
          { seatId: "seat-7", occupantType: "vacant" },
        ],
      },
    ];

    const { processCentralBankChairTurn } = await import("./centralBankChairTurn");
    await processCentralBankChairTurn(mockDb as never, 100);

    expect(processNppChairAutoRateMock).toHaveBeenCalledTimes(1);
    const charMock = getCollectionMock("characters");
    expect(charMock.bulkWrite).toHaveBeenCalledTimes(0);
  });

  it("skips the NPP auto-rate on a committee that can still carry a motion", async () => {
    testBanks = [
      {
        _id: "US",
        countryId: "US",
        chairCharacterId: null,
        chairCharacterName: null,
        chairMode: "npp",
        primeRate: 3.0,
        lastRateChangeTurn: 50,
        chairInfamy: 10,
        // 4 of 7 seated: the committee is functional and owns the rate.
        fomcBoard: [
          { seatId: "seat-1", isChair: true, occupantType: "npp", nppId: new ObjectId() },
          { seatId: "seat-2", occupantType: "npp", nppId: new ObjectId() },
          { seatId: "seat-3", occupantType: "npp", nppId: new ObjectId() },
          { seatId: "seat-4", occupantType: "npp", nppId: new ObjectId() },
          { seatId: "seat-5", occupantType: "vacant" },
          { seatId: "seat-6", occupantType: "vacant" },
          { seatId: "seat-7", occupantType: "vacant" },
        ],
      },
    ];

    const { processCentralBankChairTurn } = await import("./centralBankChairTurn");
    await processCentralBankChairTurn(mockDb as never, 100);

    expect(processNppChairAutoRateMock).not.toHaveBeenCalled();
  });

  it("treats absent chairMode as the character path (backward-compatible)", async () => {
    testBanks = [
      {
        _id: "US",
        countryId: "US",
        chairCharacterId,
        chairCharacterName: "Test Chair",
        // chairMode omitted — must fall through to the character path
        primeRate: 3.0,
        chairInfamy: 0,
      },
    ];

    const { processCentralBankChairTurn } = await import("./centralBankChairTurn");
    await processCentralBankChairTurn(mockDb as never, 100);

    const charMock = getCollectionMock("characters");
    expect(charMock.bulkWrite).toHaveBeenCalledTimes(1);
    expect(processNppChairAutoRateMock).not.toHaveBeenCalled();
  });
});
