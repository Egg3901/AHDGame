import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Character } from "@/lib/db/types";
import {
  weightedRandomPick,
  isNominationWindowOpen,
  CHAIR_TERM_TURNS,
  NOMINATION_WINDOW_TURNS,
  CHAIR_ACCEPTANCE_WINDOW_TURNS,
} from "./centralBankChairSelection";

// ─── Pure helper tests (no DB mocking needed) ────────────────────────────────

describe("weightedRandomPick", () => {
  it("returns null for empty array", () => {
    expect(weightedRandomPick([])).toBeNull();
  });

  it("returns the only candidate when pool has one", () => {
    const candidate = {
      characterId: new ObjectId(),
      characterName: "Solo",
      lobbyingTotal: 0,
    };
    const result = weightedRandomPick([candidate], () => 0.5);
    expect(result).toBe(candidate);
  });

  it("weights candidates by lobbying total", () => {
    const low = { characterId: new ObjectId(), characterName: "Low", lobbyingTotal: 0 };
    const high = {
      characterId: new ObjectId(),
      characterName: "High",
      lobbyingTotal: 500_000,
    };
    // low weight = 1, high weight = 2, total = 3
    // rng = 0 → roll = 0 → picks low (roll - 1 = -1 ≤ 0)
    expect(weightedRandomPick([low, high], () => 0)?.characterName).toBe("Low");
    // rng = 0.99 → roll ≈ 2.97 → picks high
    expect(weightedRandomPick([low, high], () => 0.99)?.characterName).toBe("High");
  });

  it("handles large lobbying amounts", () => {
    const bigSpender = {
      characterId: new ObjectId(),
      characterName: "BigSpender",
      lobbyingTotal: 5_000_000,
    };
    const nobody = {
      characterId: new ObjectId(),
      characterName: "Nobody",
      lobbyingTotal: 0,
    };
    // bigSpender weight = 11, nobody weight = 1, total = 12
    // With rng=0.5, roll = 6 → first candidate (nobody) has weight 1, 6-1=5 > 0
    //   then bigSpender has weight 11, 5-11=-6 ≤ 0 → picks bigSpender
    expect(weightedRandomPick([nobody, bigSpender], () => 0.5)?.characterName).toBe("BigSpender");
  });
});

describe("isNominationWindowOpen", () => {
  it("returns true when chair is vacant and no term set", () => {
    expect(
      isNominationWindowOpen({ chairCharacterId: null, chairTermExpiresAtTurn: null }, 100)
    ).toBe(true);
  });

  it("returns false when not within nomination window", () => {
    expect(
      isNominationWindowOpen({ chairCharacterId: new ObjectId(), chairTermExpiresAtTurn: 300 }, 200)
    ).toBe(false);
  });

  it("returns true when within nomination window", () => {
    // 300 - 48 = 252, currentTurn 260 >= 252
    expect(
      isNominationWindowOpen({ chairCharacterId: new ObjectId(), chairTermExpiresAtTurn: 300 }, 260)
    ).toBe(true);
  });

  it("returns true at exact window boundary", () => {
    // 300 - 48 = 252, currentTurn 252 >= 252
    expect(
      isNominationWindowOpen({ chairCharacterId: new ObjectId(), chairTermExpiresAtTurn: 300 }, 252)
    ).toBe(true);
  });

  it("returns true when term has expired", () => {
    expect(
      isNominationWindowOpen({ chairCharacterId: new ObjectId(), chairTermExpiresAtTurn: 100 }, 200)
    ).toBe(true);
  });

  it("returns true when vacant but term is set (window open)", () => {
    expect(
      isNominationWindowOpen({ chairCharacterId: null, chairTermExpiresAtTurn: 110 }, 100)
    ).toBe(true);
  });

  it("returns true for an NPP-chaired bank mid-term", () => {
    // A technocrat is a caretaker, not an incumbent. Prod shape: every bank sat
    // at chairMode npp with a term running to 411, which held the window shut
    // until turn 363 and left countries with no way to put a name forward.
    expect(
      isNominationWindowOpen(
        { chairCharacterId: null, chairTermExpiresAtTurn: 411, chairMode: "npp" },
        221
      )
    ).toBe(true);
  });

  it("still returns false for a seated player chair mid-term", () => {
    expect(
      isNominationWindowOpen(
        { chairCharacterId: new ObjectId(), chairTermExpiresAtTurn: 411, chairMode: "character" },
        221
      )
    ).toBe(false);
  });
});

describe("constants", () => {
  it("CHAIR_TERM_TURNS is 192 (4 years × 48 turns)", () => {
    expect(CHAIR_TERM_TURNS).toBe(192);
  });

  it("NOMINATION_WINDOW_TURNS is 48 (1 game year)", () => {
    expect(NOMINATION_WINDOW_TURNS).toBe(48);
  });

  it("CHAIR_ACCEPTANCE_WINDOW_TURNS is 24 (turns a nominee has to accept)", () => {
    expect(CHAIR_ACCEPTANCE_WINDOW_TURNS).toBe(24);
  });
});

describe("processCentralBankChairSelection", () => {
  const chairId = new ObjectId();
  const candidateId = new ObjectId();
  const candidateUserId = new ObjectId();
  const executiveId = new ObjectId();
  const executiveUserId = new ObjectId();
  const gameNow = new Date("2024-01-01");

  const mockUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  const mockFindOne = vi.fn();
  const mockFind = vi.fn();

  let mockDb: Record<string, unknown>;

  function createMockDb() {
    return {
      collection: vi.fn((name: string) => {
        if (name === "centralBanks") {
          return {
            find: mockFind,
            findOne: mockFindOne,
            updateOne: mockUpdateOne,
          };
        }
        if (name === "characters") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([
                  {
                    _id: candidateId,
                    userId: candidateUserId,
                    name: "Wealthy Player",
                    cashOnHand: 5_000_000,
                  },
                ]),
              }),
            }),
            findOne: mockFindOne,
            updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
          };
        }
        if (name === "users") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([
                  { _id: candidateUserId, isBanned: false },
                  { _id: executiveUserId, isBanned: false },
                ]),
              }),
            }),
          };
        }
        if (name === "corporations") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([]),
              }),
            }),
          };
        }
        if (name === "bonds") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([]),
              }),
            }),
          };
        }
        return {
          find: vi.fn().mockReturnValue({
            project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          findOne: vi.fn().mockResolvedValue(null),
          updateOne: mockUpdateOne,
        };
      }),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();

    // Default: vacant bank with no term (bootstrap)
    mockFind.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "US",
          countryId: "US",
          chairCharacterId: null,
          chairCharacterName: null,
          chairTermExpiresAtTurn: null,
          nominations: [],
          lobbyingPool: [],
          chairInfamy: 0,
        },
      ]),
    });

    // Character queries
    mockFindOne.mockImplementation((filter: Record<string, unknown>) => {
      if (filter["currentOffice.type"] === "president") {
        return Promise.resolve({
          _id: executiveId,
          userId: executiveUserId,
          name: "The President",
          countryId: "US",
        });
      }
      if (filter._id?.toString() === candidateId.toString()) {
        return Promise.resolve({
          _id: candidateId,
          userId: candidateUserId,
          name: "Wealthy Player",
          countryId: "US",
        });
      }
      return Promise.resolve(null);
    });
  });

  it("skips countries where term is not expired", async () => {
    mockFind.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "US",
          countryId: "US",
          chairCharacterId: chairId,
          chairTermExpiresAtTurn: 300,
          nominations: [],
          lobbyingPool: [],
        },
      ]),
    });

    const { processCentralBankChairSelection } = await import("./centralBankChairSelection");
    const result = await processCentralBankChairSelection(mockDb as any, 100, gameNow);
    expect(result.selectionsTriggered).toBe(0);
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  it("triggers selection for a bootstrap vacancy (null chair + null term)", async () => {
    mockFind.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "US",
          countryId: "US",
          chairCharacterId: null,
          chairCharacterName: null,
          chairTermExpiresAtTurn: null,
          nominations: [],
          lobbyingPool: [],
          chairInfamy: 0,
        },
      ]),
    });

    const { processCentralBankChairSelection } = await import("./centralBankChairSelection");
    const result = await processCentralBankChairSelection(mockDb as any, 10, gameNow);
    expect(result.selectionsTriggered).toBe(1);
    expect(mockUpdateOne).toHaveBeenCalled();
  });

  it("does not trigger selection for a vacant seat with no term set when bootstrap is handled", async () => {
    // This test is kept for backward compatibility; bootstrap vacancies now trigger.
    const { processCentralBankChairSelection } = await import("./centralBankChairSelection");
    const result = await processCentralBankChairSelection(mockDb as any, 10, gameNow);
    expect(result.selectionsTriggered).toBe(1);
  });

  it("triggers selection when vacancyAwaitingAutomaticSelection is set (e.g. after chair resign)", async () => {
    mockFind.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "US",
          countryId: "US",
          chairCharacterId: null,
          chairCharacterName: null,
          chairTermExpiresAtTurn: null,
          vacancyAwaitingAutomaticSelection: true,
          nominations: [],
          lobbyingPool: [],
          chairInfamy: 0,
        },
      ]),
    });

    const { processCentralBankChairSelection } = await import("./centralBankChairSelection");
    const result = await processCentralBankChairSelection(mockDb as any, 10, gameNow);
    expect(result.selectionsTriggered).toBe(1);
    expect(mockUpdateOne).toHaveBeenCalled();
  });

  it("triggers selection when term expires", async () => {
    mockFind.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "US",
          countryId: "US",
          chairCharacterId: chairId,
          chairTermExpiresAtTurn: 192,
          nominations: [],
          lobbyingPool: [],
        },
      ]),
    });

    const { processCentralBankChairSelection } = await import("./centralBankChairSelection");
    const result = await processCentralBankChairSelection(mockDb as any, 192, gameNow);
    expect(result.selectionsTriggered).toBe(1);
  });

  it("does not consider banned users for economic picks", async () => {
    mockDb = {
      collection: vi.fn((name: string) => {
        if (name === "centralBanks") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([
                {
                  _id: "US",
                  countryId: "US",
                  chairCharacterId: chairId,
                  chairTermExpiresAtTurn: 50,
                  nominations: [],
                  lobbyingPool: [],
                },
              ]),
            }),
            findOne: mockFindOne,
            updateOne: mockUpdateOne,
          };
        }
        if (name === "characters") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([
                  {
                    _id: candidateId,
                    userId: candidateUserId,
                    name: "Banned Wealthy Player",
                    cashOnHand: 5_000_000,
                  },
                ]),
              }),
            }),
            findOne: mockFindOne,
            updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
          };
        }
        if (name === "users") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([{ _id: candidateUserId, isBanned: true }]),
              }),
            }),
          };
        }
        if (name === "corporations") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([]),
              }),
            }),
          };
        }
        if (name === "bonds") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([]),
              }),
            }),
          };
        }
        return {
          find: vi.fn().mockReturnValue({
            project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          findOne: vi.fn().mockResolvedValue(null),
          updateOne: mockUpdateOne,
        };
      }),
    };

    const { processCentralBankChairSelection } = await import("./centralBankChairSelection");
    const result = await processCentralBankChairSelection(mockDb as any, 50, gameNow);
    expect(result.selectionsTriggered).toBe(1);
    expect(result.vacanciesRemaining).toBe(1);
    expect(mockUpdateOne).toHaveBeenCalled();
  });

  it("creates chairSelectionPending (awaiting accept) instead of immediate appointment", async () => {
    mockFind.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "US",
          countryId: "US",
          chairCharacterId: chairId,
          chairTermExpiresAtTurn: 50,
          nominations: [],
          lobbyingPool: [],
          chairInfamy: 0,
        },
      ]),
    });
    const { processCentralBankChairSelection } = await import("./centralBankChairSelection");
    await processCentralBankChairSelection(mockDb as any, 50, gameNow);

    const updateCall = mockUpdateOne.mock.calls.find(
      (call: unknown[]) => (call[0] as Record<string, unknown>)?._id === "US"
    );
    if (updateCall) {
      const setFields = (updateCall[1] as Record<string, Record<string, unknown>>).$set;
      expect(setFields.chairSelectionPending).toBeDefined();
      expect(setFields.chairCharacterId).toBeNull();
      expect(setFields.chairTermExpiresAtTurn).toBeNull();
      // Scrutiny is institutional and survives the chair: the vacancy decays it
      // multiplicatively rather than zeroing it, so churning chairs cannot be
      // used to erase a bad record.
      expect(setFields.chairInfamy).toBeUndefined();
      expect(setFields.resolveStreak).toBe(0);
      const mulFields = (updateCall[1] as Record<string, Record<string, unknown>>).$mul;
      expect(mulFields.chairInfamy).toBeGreaterThan(0);
      expect(mulFields.chairInfamy).toBeLessThan(1);
      expect(setFields.nominations).toBeUndefined();
    }
  });

  it("reports vacancy when both pools are empty", async () => {
    // Empty country — no characters; use expired term to trigger selection
    mockDb = {
      collection: vi.fn((name: string) => {
        if (name === "centralBanks") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([
                {
                  _id: "US",
                  countryId: "US",
                  chairCharacterId: chairId,
                  chairTermExpiresAtTurn: 10,
                  nominations: [],
                  lobbyingPool: [],
                },
              ]),
            }),
            updateOne: mockUpdateOne,
          };
        }
        if (name === "characters") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([]),
              }),
            }),
            findOne: vi.fn().mockResolvedValue(null),
            updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
          };
        }
        return {
          find: vi.fn().mockReturnValue({
            project: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([]),
            }),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          // NPP autonomy fallback (Task 7) probes gameState/countryGameStates
          // on the null-candidate path; default to autonomy inactive so the
          // existing persistVacancy shape is preserved.
          findOne: vi.fn().mockResolvedValue(null),
          updateOne: mockUpdateOne,
        };
      }),
    };

    const { processCentralBankChairSelection } = await import("./centralBankChairSelection");
    const result = await processCentralBankChairSelection(mockDb as any, 10, gameNow);
    expect(result.vacanciesRemaining).toBe(1);
    expect(result.politicalPicks).toBe(0);
    expect(result.economicPicks).toBe(0);
  });

  it("excludes a sitting executive (e.g. Vice President) from the candidate pools", async () => {
    // Only active player in the country is a sitting Vice President. Under the
    // old first-executive-only filter a deputy was still eligible; now every
    // national executive is excluded, so both pools are empty → vacancy.
    const vpId = new ObjectId();
    const vpUserId = new ObjectId();
    mockDb = {
      collection: vi.fn((name: string) => {
        if (name === "centralBanks") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([
                {
                  _id: "US",
                  countryId: "US",
                  chairCharacterId: chairId,
                  chairTermExpiresAtTurn: 10,
                  nominations: [],
                  lobbyingPool: [],
                },
              ]),
            }),
            findOne: vi.fn().mockResolvedValue(null),
            updateOne: mockUpdateOne,
          };
        }
        if (name === "characters") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([
                  {
                    _id: vpId,
                    userId: vpUserId,
                    name: "Sitting Veep",
                    cashOnHand: 9_000_000,
                    currentOffice: { type: "vicePresident" },
                  },
                ]),
              }),
            }),
            findOne: vi.fn().mockResolvedValue(null),
            updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
          };
        }
        if (name === "users") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([{ _id: vpUserId, isBanned: false }]),
              }),
            }),
          };
        }
        return {
          find: vi.fn().mockReturnValue({
            project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          findOne: vi.fn().mockResolvedValue(null),
          updateOne: mockUpdateOne,
        };
      }),
    };

    const { processCentralBankChairSelection } = await import("./centralBankChairSelection");
    const result = await processCentralBankChairSelection(mockDb as any, 10, gameNow);
    expect(result.economicPicks).toBe(0);
    expect(result.politicalPicks).toBe(0);
    expect(result.vacanciesRemaining).toBe(1);
  });
});

describe("processCentralBankChairSelection — pending appointment timeout", () => {
  const lapsedId = new ObjectId();
  const candidateId = new ObjectId();
  const candidateUserId = new ObjectId();
  const executiveId = new ObjectId();
  const executiveUserId = new ObjectId();
  const gameNow = new Date("2024-01-01");

  const mockUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  const mockFindOne = vi.fn();
  const mockFind = vi.fn();

  function pendingBank(proposedAtTurn: number | undefined) {
    return {
      _id: "US",
      countryId: "US",
      chairCharacterId: null,
      chairCharacterName: null,
      chairTermExpiresAtTurn: null,
      nominations: [
        {
          characterId: candidateId,
          characterName: "Wealthy Player",
          nominatedBy: executiveId,
          nominatedByName: "The President",
          nominatedAt: gameNow,
        },
      ],
      lobbyingPool: [],
      chairInfamy: 0,
      chairSelectionPending: {
        characterId: lapsedId,
        characterName: "Lapsed Nominee",
        pool: "economic" as const,
        proposedAt: gameNow,
        ...(proposedAtTurn === undefined ? {} : { proposedAtTurn }),
        appointedByExecutiveId: null,
        declinedCharacterIds: [],
      },
    };
  }

  function createMockDb() {
    return {
      collection: vi.fn((name: string) => {
        if (name === "centralBanks") {
          return { find: mockFind, findOne: mockFindOne, updateOne: mockUpdateOne };
        }
        if (name === "characters") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([
                  {
                    _id: candidateId,
                    userId: candidateUserId,
                    name: "Wealthy Player",
                    cashOnHand: 5_000_000,
                  },
                ]),
              }),
            }),
            findOne: mockFindOne,
            updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
          };
        }
        if (name === "users") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([
                  { _id: candidateUserId, isBanned: false },
                  { _id: executiveUserId, isBanned: false },
                ]),
              }),
            }),
          };
        }
        if (name === "corporations" || name === "bonds") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            }),
          };
        }
        return {
          find: vi.fn().mockReturnValue({
            project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          findOne: vi.fn().mockResolvedValue(null),
          updateOne: mockUpdateOne,
        };
      }),
    } as Record<string, unknown>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindOne.mockImplementation((filter: Record<string, unknown>) => {
      if (filter["currentOffice.type"] === "president") {
        return Promise.resolve({
          _id: executiveId,
          userId: executiveUserId,
          name: "The President",
          countryId: "US",
        });
      }
      if (filter._id?.toString() === candidateId.toString()) {
        return Promise.resolve({
          _id: candidateId,
          userId: candidateUserId,
          name: "Wealthy Player",
          countryId: "US",
        });
      }
      return Promise.resolve(null);
    });
  });

  function setBankPending(proposedAtTurn: number | undefined) {
    mockFind.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([pendingBank(proposedAtTurn)]),
    });
  }

  it("does NOT re-select while the acceptance window is still open (< 24 turns)", async () => {
    setBankPending(100);
    const mockDb = createMockDb();
    const { processCentralBankChairSelection } = await import("./centralBankChairSelection");
    // 123 - 100 = 23 turns elapsed, still within the 24-turn window
    const result = await processCentralBankChairSelection(mockDb as any, 123, gameNow);
    expect(result.selectionsTriggered).toBe(0);
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  it("re-selects once the acceptance window lapses (>= 24 turns), excluding the lapsed nominee", async () => {
    setBankPending(100);
    const mockDb = createMockDb();
    const { processCentralBankChairSelection } = await import("./centralBankChairSelection");
    // 124 - 100 = 24 turns elapsed → window lapsed
    const result = await processCentralBankChairSelection(mockDb as any, 124, gameNow);

    expect(result.selectionsTriggered).toBe(1);

    // The reselect first atomically claims the lapse (clears the pending pick to
    // null), then persists the fresh pick — grab the persist call.
    const updateCall = mockUpdateOne.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>)?._id === "US" &&
        !!(call[1] as Record<string, Record<string, any>>)?.$set?.chairSelectionPending
    );
    expect(updateCall).toBeDefined();
    const setFields = (updateCall![1] as Record<string, Record<string, any>>).$set;
    const newPending = setFields.chairSelectionPending;
    expect(newPending).toBeDefined();
    // Lapsed nominee carried into the per-cycle decline list...
    const declined = (newPending.declinedCharacterIds as ObjectId[]).map((id) => id.toString());
    expect(declined).toContain(lapsedId.toString());
    // ...and the fresh pick is someone else.
    expect(newPending.characterId.toString()).not.toBe(lapsedId.toString());
    // Fresh acceptance clock starts now.
    expect(newPending.proposedAtTurn).toBe(124);
  });

  it("treats a pending pick with no proposedAtTurn as fresh (no lapse)", async () => {
    setBankPending(undefined);
    const mockDb = createMockDb();
    const { processCentralBankChairSelection } = await import("./centralBankChairSelection");
    // Even far in the future, a missing proposedAtTurn must not instantly lapse.
    const result = await processCentralBankChairSelection(mockDb as any, 9999, gameNow);
    expect(result.selectionsTriggered).toBe(0);
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });
});

describe("lapsePendingCentralBankChairSelection", () => {
  const lapsedId = new ObjectId();
  const candidateId = new ObjectId();
  const candidateUserId = new ObjectId();
  const executiveId = new ObjectId();
  const executiveUserId = new ObjectId();
  const gameNow = new Date("2024-01-01");

  const mockBankUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  const mockBankFindOne = vi.fn();
  const mockCharFindOne = vi.fn();

  function bankDoc(pending: unknown) {
    return {
      _id: "US",
      countryId: "US",
      chairCharacterId: null,
      chairCharacterName: null,
      chairTermExpiresAtTurn: null,
      nominations: [
        {
          characterId: candidateId,
          characterName: "Wealthy Player",
          nominatedBy: executiveId,
          nominatedByName: "The President",
          nominatedAt: gameNow,
        },
      ],
      lobbyingPool: [],
      chairInfamy: 0,
      chairSelectionPending: pending,
    };
  }

  function createMockDb() {
    return {
      collection: vi.fn((name: string) => {
        if (name === "centralBanks") {
          return { findOne: mockBankFindOne, updateOne: mockBankUpdateOne };
        }
        if (name === "characters") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([
                  {
                    _id: candidateId,
                    userId: candidateUserId,
                    name: "Wealthy Player",
                    cashOnHand: 5_000_000,
                  },
                ]),
              }),
            }),
            findOne: mockCharFindOne,
            updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
          };
        }
        if (name === "users") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([
                  { _id: candidateUserId, isBanned: false },
                  { _id: executiveUserId, isBanned: false },
                ]),
              }),
            }),
          };
        }
        if (name === "corporations" || name === "bonds") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            }),
          };
        }
        return {
          find: vi.fn().mockReturnValue({
            project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          findOne: vi.fn().mockResolvedValue(null),
          updateOne: mockBankUpdateOne,
        };
      }),
    } as Record<string, unknown>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockCharFindOne.mockImplementation((filter: Record<string, unknown>) => {
      if (filter["currentOffice.type"] === "president") {
        return Promise.resolve({
          _id: executiveId,
          userId: executiveUserId,
          name: "The President",
          countryId: "US",
        });
      }
      if (filter._id?.toString() === candidateId.toString()) {
        return Promise.resolve({
          _id: candidateId,
          userId: candidateUserId,
          name: "Wealthy Player",
          countryId: "US",
        });
      }
      if (filter._id?.toString() === lapsedId.toString()) {
        return Promise.resolve({ _id: lapsedId, userId: new ObjectId(), name: "Lapsed Nominee" });
      }
      return Promise.resolve(null);
    });
  });

  it("returns an error when there is no pending appointment", async () => {
    mockBankFindOne.mockResolvedValue(bankDoc(null));
    const mockDb = createMockDb();
    const { lapsePendingCentralBankChairSelection } = await import("./centralBankChairSelection");
    const result = await lapsePendingCentralBankChairSelection(
      mockDb as any,
      "US" as any,
      gameNow,
      200
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no pending/i);
    expect(mockBankUpdateOne).not.toHaveBeenCalled();
  });

  it("re-selects excluding the lapsed nominee and persists a fresh pending pick", async () => {
    mockBankFindOne.mockResolvedValue(
      bankDoc({
        characterId: lapsedId,
        characterName: "Lapsed Nominee",
        pool: "economic",
        proposedAt: gameNow,
        proposedAtTurn: 100,
        appointedByExecutiveId: null,
        declinedCharacterIds: [],
      })
    );
    const mockDb = createMockDb();
    const { lapsePendingCentralBankChairSelection } = await import("./centralBankChairSelection");
    const result = await lapsePendingCentralBankChairSelection(
      mockDb as any,
      "US" as any,
      gameNow,
      200
    );

    expect(result.ok).toBe(true);

    // The reselect first atomically claims the lapse (clears the pending pick to
    // null), then persists the fresh pick — grab the persist call.
    const updateCall = mockBankUpdateOne.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>)?._id === "US" &&
        !!(call[1] as Record<string, Record<string, any>>)?.$set?.chairSelectionPending
    );
    expect(updateCall).toBeDefined();
    const setFields = (updateCall![1] as Record<string, Record<string, any>>).$set;
    const newPending = setFields.chairSelectionPending;
    expect(newPending).toBeDefined();
    const declined = (newPending.declinedCharacterIds as ObjectId[]).map((id) => id.toString());
    expect(declined).toContain(lapsedId.toString());
    expect(newPending.characterId.toString()).not.toBe(lapsedId.toString());
    expect(newPending.proposedAtTurn).toBe(200);
  });

  it("no-ops when another worker already claimed the lapse (atomic claim lost)", async () => {
    mockBankFindOne.mockResolvedValue(
      bankDoc({
        characterId: lapsedId,
        characterName: "Lapsed Nominee",
        pool: "economic",
        proposedAt: gameNow,
        proposedAtTurn: 100,
        appointedByExecutiveId: null,
        declinedCharacterIds: [],
      })
    );
    // The atomic claim matches zero documents — the pending was already handled.
    mockBankUpdateOne.mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0 });
    const mockDb = createMockDb();
    const { lapsePendingCentralBankChairSelection } = await import("./centralBankChairSelection");
    const result = await lapsePendingCentralBankChairSelection(
      mockDb as any,
      "US" as any,
      gameNow,
      200
    );

    expect(result).toEqual({ ok: true, vacancy: false });
    // No fresh pending pick is persisted by the loser.
    const persisted = mockBankUpdateOne.mock.calls.find(
      (call: unknown[]) =>
        !!(call[1] as Record<string, Record<string, any>>)?.$set?.chairSelectionPending
    );
    expect(persisted).toBeUndefined();
  });
});

describe("acceptCentralBankChairSelection — executive guard", () => {
  const gameNow = new Date("2024-01-01");

  it("rejects acceptance when the accepting character holds an executive office", async () => {
    const acceptingId = new ObjectId();
    const seatUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const db = {
      collection: vi.fn((name: string) => {
        if (name === "centralBanks") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: "US",
              countryId: "US",
              chairCharacterId: null,
              chairSelectionPending: {
                characterId: acceptingId,
                characterName: "Veep Nominee",
                pool: "political",
                appointedByExecutiveId: null,
                declinedCharacterIds: [],
              },
            }),
            updateOne: seatUpdateOne,
          };
        }
        if (name === "characters") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: acceptingId,
              userId: new ObjectId(),
              name: "Veep Nominee",
              currentOffice: { type: "president" },
            }),
            updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
          };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
          updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        };
      }),
    };

    const { acceptCentralBankChairSelection } = await import("./centralBankChairSelection");
    const result = await acceptCentralBankChairSelection(
      db as any,
      "US" as any,
      acceptingId,
      gameNow,
      100
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/executive/i);
    // The chair must NOT have been seated on the central bank.
    expect(seatUpdateOne).not.toHaveBeenCalled();
  });
});

// ─── NPP autonomy fallback (Task 7) ──────────────────────────────────────────
//
// When selectChairCandidate returns null and NPP autonomy is active (flag on +
// country not enabled for players), the selection falls back to appointNppChair
// (writes chairMode "npp") instead of persistVacancy. When autonomy is inactive,
// the existing persistVacancy shape is preserved (chairCharacterId: null +
// vacancyAwaitingAutomaticSelection: true).

describe("processCentralBankChairSelection — NPP autonomy fallback", () => {
  const gameNow = new Date("2024-01-01");
  const bankId = "US";

  /**
   * Build a mock db where both candidate pools are empty (no player characters
   * with a userId), so selectChairCandidate returns null. gameState and
   * countryGameStates are parameterized per case; npps is mocked so appointNppChair
   * can spawn a technocrat; centralBanks.updateOne is captured.
   */
  function createNoCandidateMockDb(opts: {
    nppAutonomyEnabled: boolean;
    enabledForPlayers: boolean;
  }) {
    const updateOneCalls: unknown[][] = [];
    const nppInsertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });

    const db = {
      collection: vi.fn((name: string) => {
        if (name === "centralBanks") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([
                {
                  _id: bankId,
                  countryId: "US",
                  chairCharacterId: new ObjectId(), // non-null so vacate is exercised
                  chairCharacterName: "Outgoing Chair",
                  chairTermExpiresAtTurn: 10, // expired at currentTurn=10
                  nominations: [],
                  lobbyingPool: [],
                  chairInfamy: 0,
                },
              ]),
            }),
            updateOne: vi.fn((...args: unknown[]) => {
              updateOneCalls.push(args);
              return Promise.resolve({ modifiedCount: 1 });
            }),
          };
        }
        if (name === "characters") {
          // No player characters (empty find cursor) → empty candidate pools.
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([]),
              }),
            }),
            findOne: vi.fn().mockResolvedValue(null),
            updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
          };
        }
        if (name === "electedOfficials") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([]),
              }),
            }),
          };
        }
        if (name === "users") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([]),
              }),
            }),
          };
        }
        if (name === "gameState") {
          return {
            findOne: vi
              .fn()
              .mockResolvedValue(
                opts.nppAutonomyEnabled
                  ? { _id: "current", nppAutonomyEnabled: true }
                  : { _id: "current", nppAutonomyEnabled: false }
              ),
          };
        }
        if (name === "countryGameStates") {
          return {
            findOne: vi
              .fn()
              .mockResolvedValue({ _id: "US", enabledForPlayers: opts.enabledForPlayers }),
          };
        }
        if (name === "npps") {
          return {
            findOne: vi.fn().mockResolvedValue(null), // no existing technocrat
            insertOne: nppInsertOne,
          };
        }
        if (name === "corporations" || name === "bonds") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            }),
          };
        }
        return {
          find: vi.fn().mockReturnValue({
            project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          findOne: vi.fn().mockResolvedValue(null),
          updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        };
      }),
    };

    return { db: db as any, updateOneCalls, nppInsertOne };
  }

  it("seats a technocrat NPP chair (chairMode: npp) when autonomy is active and no player candidates exist", async () => {
    const { db, updateOneCalls, nppInsertOne } = createNoCandidateMockDb({
      nppAutonomyEnabled: true,
      enabledForPlayers: false,
    });

    const { processCentralBankChairSelection } = await import("./centralBankChairSelection");
    const result = await processCentralBankChairSelection(db, 10, gameNow);

    // Selection ran, no player pick was possible → vacancy counter still increments.
    expect(result.selectionsTriggered).toBe(1);
    // NPP technocrat seated → not a vacancy; counter is autonomy-aware.
    expect(result.vacanciesRemaining).toBe(0);

    // A technocrat NPP was spawned (no existing one to reuse).
    expect(nppInsertOne).toHaveBeenCalledTimes(1);

    // The bank updateOne wrote the NPP appointment shape — chairMode "npp".
    const bankUpdate = updateOneCalls.find(
      (args: unknown[]) => (args[0] as Record<string, unknown>)?._id === bankId
    );
    expect(bankUpdate).toBeDefined();
    const $set = (bankUpdate![1] as Record<string, Record<string, unknown>>).$set;
    expect($set.chairMode).toBe("npp");
    expect($set.chairNppId).toBeDefined();
    expect($set.vacancyAwaitingAutomaticSelection).toBe(false);
    // A technocrat taking the chair must ALSO clear any outgoing player from
    // the mirror. Leaving it behind produced prod banks that carried a player
    // `chairCharacterId` and an NPP `chairNppId` at the same time.
    expect($set.chairCharacterId).toBeNull();
    expect($set.chairCharacterName).toBeNull();
  });

  it("seats a technocrat in a player-enabled country when autonomy is globally enabled but no human candidate exists", async () => {
    const { db, updateOneCalls, nppInsertOne } = createNoCandidateMockDb({
      nppAutonomyEnabled: true,
      enabledForPlayers: true,
    });

    const { processCentralBankChairSelection } = await import("./centralBankChairSelection");
    const result = await processCentralBankChairSelection(db, 10, gameNow);

    expect(result.selectionsTriggered).toBe(1);
    expect(result.vacanciesRemaining).toBe(0);

    expect(nppInsertOne).toHaveBeenCalledTimes(1);

    const bankUpdate = updateOneCalls.find(
      (args: unknown[]) => (args[0] as Record<string, unknown>)?._id === bankId
    );
    expect(bankUpdate).toBeDefined();
    const $set = (bankUpdate![1] as Record<string, Record<string, unknown>>).$set;
    expect($set.chairMode).toBe("npp");
    expect($set.chairNppId).toBeDefined();
    expect($set.vacancyAwaitingAutomaticSelection).toBe(false);
  });

  it("preserves the existing vacancy when autonomy is globally disabled", async () => {
    const { db, updateOneCalls, nppInsertOne } = createNoCandidateMockDb({
      nppAutonomyEnabled: false,
      enabledForPlayers: true,
    });

    const { processCentralBankChairSelection } = await import("./centralBankChairSelection");
    const result = await processCentralBankChairSelection(db, 10, gameNow);

    expect(result.vacanciesRemaining).toBe(1);
    expect(nppInsertOne).not.toHaveBeenCalled();
    const bankUpdate = updateOneCalls.find(
      (args: unknown[]) => (args[0] as Record<string, unknown>)?._id === bankId
    );
    const $set = (bankUpdate![1] as Record<string, Record<string, unknown>>).$set;
    expect($set.chairCharacterId).toBeNull();
    expect($set.vacancyAwaitingAutomaticSelection).toBe(true);
  });
});
