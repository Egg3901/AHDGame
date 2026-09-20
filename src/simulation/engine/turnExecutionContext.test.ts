import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types";
import { getCharactersCollection } from "@/lib/db/collections";
import { buildTurnExecutionContext } from "./turnExecutionContext";

vi.mock("@/lib/db/collections", () => ({
  getCharactersCollection: vi.fn(),
}));

/**
 * Regression for #2166: turn initialization loaded every character and every
 * state document in full (`find({}).toArray()` with no projection), churning
 * Node memory and V8 GC at the start of every turn.
 *
 * Consumer audit (fields the turn actually reads from these snapshots):
 * - characters -> processActionRefresh (actionRefresh.ts): _id,
 *   currentOffice, countryId, actions, stats.energy, politicalInfluence,
 *   nationalInfluence, infamy, favorability, stats, statXp, debateDecayAnchor,
 *   party
 * - characters -> processFundGeneration (fundGeneration.ts): _id, homeState,
 *   donorBaseLevel, currentOffice, countryId, politicalInfluence, party, name
 * - characters -> processPartyInfluenceTurn (partyInfluenceTurn.ts): _id,
 *   countryId, party, policies.economic, policies.social, partyInfluence,
 *   infamy, stats.energy
 * - states/stateMap -> processFundGeneration: population, gdp, countryId
 * - states/stateMap -> processNppFundGeneration (nppFundGeneration.ts):
 *   population, countryId
 * - states/stateMap -> processPartyGOTV (demographicTurnoutTurn.ts):
 *   population, gdp, votingEligiblePopulation
 * - turnSystem.ts logging: characters.length only
 * Nothing else on the turn path reads context.characters, context.states, or
 * context.stateMap.
 */
const REQUIRED_CHARACTER_FIELDS = [
  "countryId",
  "homeState",
  "name",
  "party",
  "donorBaseLevel",
  "currentOffice",
  "politicalInfluence",
  "nationalInfluence",
  "partyInfluence",
  "favorability",
  "infamy",
  "actions",
  "stats",
  "statXp",
  "debateDecayAnchor",
  "policies",
];

const REQUIRED_STATE_FIELDS = ["countryId", "population", "gdp", "votingEligiblePopulation"];

function makeGameState(): GameState {
  return {
    currentTurn: 41,
    lastTurnProcessed: null,
    fastMode: false,
  } as unknown as GameState;
}

describe("buildTurnExecutionContext reads", () => {
  const charactersFind = vi.fn();
  const statesFind = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    charactersFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    statesFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    vi.mocked(getCharactersCollection).mockResolvedValue({
      find: charactersFind,
    } as never);
  });

  function makeDb(): Db {
    return {
      collection: vi.fn().mockReturnValue({ find: statesFind }),
    } as unknown as Db;
  }

  it("projects the character read to the fields turn phases consume", async () => {
    const context = await buildTurnExecutionContext({
      db: makeDb(),
      gameState: makeGameState(),
      config: null,
      warnings: [],
      phaseStatuses: {},
      startTimeMs: 0,
    });

    expect(charactersFind).toHaveBeenCalledTimes(1);
    expect(charactersFind.mock.calls[0][0]).toEqual({});
    const options = charactersFind.mock.calls[0][1] as
      { projection?: Record<string, number> } | undefined;
    expect(options?.projection, "characters find must carry a projection").toBeDefined();
    for (const field of REQUIRED_CHARACTER_FIELDS) {
      expect(options?.projection?.[field]).toBe(1);
    }
    expect(context.characters).toEqual([]);
  });

  it("projects the state read to the fields turn phases consume", async () => {
    const states = [
      { _id: "CA", countryId: "US", population: 1000, gdp: 50, votingEligiblePopulation: 700 },
    ];
    statesFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue(states) });

    const context = await buildTurnExecutionContext({
      db: makeDb(),
      gameState: makeGameState(),
      config: null,
      warnings: [],
      phaseStatuses: {},
      startTimeMs: 0,
    });

    expect(statesFind).toHaveBeenCalledTimes(1);
    const options = statesFind.mock.calls[0][1] as
      { projection?: Record<string, number> } | undefined;
    expect(options?.projection, "states find must carry a projection").toBeDefined();
    for (const field of REQUIRED_STATE_FIELDS) {
      expect(options?.projection?.[field]).toBe(1);
    }
    expect(context.states).toEqual(states);
    expect(context.stateMap.get("CA")).toEqual(states[0]);
  });

  it("exposes the founding-adjusted canonical calendar turn and year", async () => {
    const context = await buildTurnExecutionContext({
      db: makeDb(),
      gameState: {
        ...makeGameState(),
        currentTurn: 87,
        startingYear: 1953,
        preIteration: { active: false },
        preIterationTurns: 48,
      } as GameState,
      config: null,
      warnings: [],
      phaseStatuses: {},
      startTimeMs: 0,
    });

    expect(context.newTurn).toBe(88);
    expect(context.calendarTurn).toBe(40);
    expect(context.currentYear).toBe(1953);
  });
});
