/**
 * End-to-end coverage of vote suppression in the wave that decides real
 * results.
 *
 * The helper itself is unit-tested in `electionEngine/stateAttackMultiplier`;
 * what this file covers is the wiring, which is where the equivalent phase-1
 * defect lived: the favourability drain was correct in isolation and applied in
 * the wrong scope, so it was multiplied by the size of the field. Nothing but a
 * run of the real function catches that class of bug.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import * as primaryProjection from "@/lib/primaryProjection";
import { runPrimaryStaggerWaveIfDue } from "./primaryStaggerPhase";
import { invalidateDemographicCategoryCache } from "@/lib/demographics/categoryCatalog";
import type { Election } from "@/lib/db/types";

// `fetchEnrichedCandidates` reaches for its own handle rather than taking the
// one the stagger was given, so the stub has to be installed here too.
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const ELECTION_ID = new ObjectId();
const TARGET_ROW = new ObjectId();
const RIVAL_ROW = new ObjectId();
const TARGET_CHAR = new ObjectId();
const RIVAL_CHAR = new ObjectId();

/** Wave 0 of the compressed calendar is Iowa at turnsRemaining 5. */
const CURRENT_TURN = 10;
const PRIMARY_END_TURN = CURRENT_TURN + 5;

const ELECTION = {
  _id: ELECTION_ID,
  electionType: "president",
  countryId: "US",
  status: "active",
  primaryEndTurn: PRIMARY_END_TURN,
} as unknown as Election;

function candidateRow(id: ObjectId, characterId: ObjectId, name: string) {
  return {
    _id: id,
    electionId: ELECTION_ID,
    characterId,
    characterName: name,
    party: "1",
    status: "active",
    isNPP: false,
  };
}

function characterDoc(id: ObjectId, name: string, economic: number) {
  return {
    _id: id,
    name,
    homeState: "OH",
    policies: { economic, social: -1 },
    nationalInfluence: 50,
    partyInfluence: 10,
    favorability: 50,
    politicalInfluence: 50,
  };
}

function suppressionRow(over: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    electionId: ELECTION_ID,
    actorCandidateId: RIVAL_ROW,
    targetCandidateId: TARGET_ROW,
    targetCharacterId: TARGET_CHAR,
    stateId: "IA",
    kind: "voteSuppression",
    magnitude: 2.5,
    shieldApplied: 0,
    appliedTurn: CURRENT_TURN - 1,
    expiresTurn: CURRENT_TURN + 8,
    createdAt: new Date(),
    ...over,
  };
}

/**
 * Run one Iowa wave and return the per-candidate votes the stagger persisted.
 */
async function runIowaWave(
  primaryStateActions: Record<string, unknown>[],
  campaignAds = false
): Promise<Record<string, number>> {
  invalidateDemographicCategoryCache();

  const tallyUpdate = vi.fn().mockResolvedValue({ modifiedCount: 1 });

  const cursor = (docs: unknown[]) => {
    const c = {
      toArray: vi.fn().mockResolvedValue(docs),
      project: vi.fn(() => c),
      sort: vi.fn(() => c),
      limit: vi.fn(() => c),
      next: vi.fn().mockResolvedValue(docs[0] ?? null),
    };
    return c;
  };

  const rows: Record<string, unknown[]> = {
    electionCandidates: [
      {
        ...candidateRow(TARGET_ROW, TARGET_CHAR, "Target"),
        ...(campaignAds
          ? {
              targetedAds: [
                {
                  stateId: "IA",
                  dimension: "race",
                  bucket: "white",
                  exposure: 3,
                  lastPurchaseTurn: CURRENT_TURN,
                  throughTurn: CURRENT_TURN + 2,
                },
              ],
            }
          : {}),
      },
      candidateRow(RIVAL_ROW, RIVAL_CHAR, "Rival"),
    ],
    politicalParties: [
      {
        _id: new ObjectId(),
        countryId: "US",
        sequentialId: 1,
        name: "Democratic Party",
        economicPosition: -2,
        socialPosition: -2,
      },
    ],
    states: [{ _id: "IA", countryId: "US", name: "Iowa", population: 3_000_000 }],
    stateDemographics: [
      {
        _id: "IA",
        countryId: "US",
        categoryWeights: { voterGroups: 100 },
        groups: {
          all: { population: 3_000_000, economicLean: -1, socialLean: -1, turnout: 60 },
        },
        lastUpdated: new Date(),
      },
    ],
    demographicCategories: [
      {
        _id: "voterGroups",
        name: "Voter Groups",
        defaultWeight: 100,
        groups: [
          {
            id: "all",
            name: "All voters",
            defaultEconomicLean: -1,
            defaultSocialLean: -1,
            defaultTurnout: 60,
          },
        ],
      },
    ],
    characters: [characterDoc(TARGET_CHAR, "Target", -2), characterDoc(RIVAL_CHAR, "Rival", 1)],
    primaryStateActions,
  };

  const db = {
    collection: vi.fn((name: string) => {
      if (name === "electionVoteTallies") {
        return {
          findOne: vi.fn().mockResolvedValue({
            _id: new ObjectId(),
            electionId: ELECTION_ID,
            primaryWaveHistory: [],
            primaryStaggerWavesRun: 0,
            primaryStateVotes: {},
            primaryDelegates: {},
          }),
          updateOne: tallyUpdate,
        };
      }
      return {
        find: vi.fn(() => cursor(rows[name] ?? [])),
        findOne: vi
          .fn()
          .mockResolvedValue(
            name === "gameState" ? { _id: "current" } : ((rows[name] ?? [])[0] ?? null)
          ),
        updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        bulkWrite: vi.fn().mockResolvedValue({}),
        insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
      };
    }),
  } as unknown as Db;

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db);

  const result = await runPrimaryStaggerWaveIfDue(
    db,
    campaignAds
      ? {
          ...ELECTION,
          campaignRulesVersion: 1,
          rulesetVersion: 3,
          primaryEndTurn: CURRENT_TURN + 40,
        }
      : ELECTION,
    new Date(),
    CURRENT_TURN
  );
  expect(result).not.toBeNull();
  expect(result?.statesProcessed).toContain("IA");

  const setDoc = tallyUpdate.mock.calls[0][1].$set as {
    primaryStateVotes: Record<string, Record<string, Record<string, number>>>;
  };
  return setDoc.primaryStateVotes["1"].IA;
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateDemographicCategoryCache();
});

describe("vote suppression in the primary wave", () => {
  it("counts paid ads once in both expectations and live votes, even with the old admin gate absent", async () => {
    const projection = vi.spyOn(primaryProjection, "projectPrimaryByState");
    try {
      const votes = await runIowaWave([], true);
      expect(projection).toHaveBeenCalledWith(
        expect.objectContaining({
          campaignContext: expect.objectContaining({
            campaignRulesVersion: 1,
            currentTurn: CURRENT_TURN,
          }),
        })
      );
      const expected = projection.mock.results[0].value.byState.IA;
      const share = (values: Record<string, number>) =>
        values[TARGET_ROW.toString()] / Object.values(values).reduce((a, b) => a + b, 0);
      expect(share(votes)).toBeCloseTo(share(expected), 5);
      const input = projection.mock.calls[0][0];
      const noAds = primaryProjection.projectPrimaryByState({
        ...input,
        candidates: input.candidates.map((candidate) => ({ ...candidate, targetedAds: undefined })),
      });
      expect(share(votes)).toBeGreaterThan(share(noAds.byState.IA));
    } finally {
      projection.mockRestore();
    }
  });

  it("removes the suppressed candidate's slice of the state", async () => {
    const clean = await runIowaWave([]);
    const hit = await runIowaWave([suppressionRow()]);
    expect(hit[TARGET_ROW.toString()]).toBeLessThan(clean[TARGET_ROW.toString()]);
    expect(hit[TARGET_ROW.toString()] / clean[TARGET_ROW.toString()]).toBeCloseTo(0.975, 2);
  });

  it("leaves the attacker's own vote alone", async () => {
    const clean = await runIowaWave([]);
    const hit = await runIowaWave([suppressionRow()]);
    expect(hit[RIVAL_ROW.toString()]).toBe(clean[RIVAL_ROW.toString()]);
  });

  it("applies the hit once, not once per candidate in the field", async () => {
    // The phase-1 favourability drain was correct in isolation and applied in
    // the wrong scope, so it scaled with the size of the field. One row must
    // move the target by its own magnitude and no more.
    const clean = await runIowaWave([]);
    const hit = await runIowaWave([suppressionRow()]);
    const ratio = hit[TARGET_ROW.toString()] / clean[TARGET_ROW.toString()];
    expect(ratio).toBeGreaterThan(0.97);
    expect(ratio).toBeLessThan(0.98);
  });

  it("applies a favourability attack bought in this state", async () => {
    const clean = await runIowaWave([]);
    const hit = await runIowaWave([suppressionRow({ kind: "localFavorability", magnitude: 6 })]);
    expect(hit[TARGET_ROW.toString()]).toBeLessThan(clean[TARGET_ROW.toString()]);
  });

  it("ignores a favourability attack bought somewhere else", async () => {
    // It used to drain the national scalar, so a purchase in New Hampshire
    // moved Iowa too. Scoped now.
    const clean = await runIowaWave([]);
    const hit = await runIowaWave([
      suppressionRow({ kind: "localFavorability", magnitude: 6, stateId: "NH" }),
    ]);
    expect(hit[TARGET_ROW.toString()]).toBe(clean[TARGET_ROW.toString()]);
  });

  it("ignores a row aimed at another state", async () => {
    const clean = await runIowaWave([]);
    const hit = await runIowaWave([suppressionRow({ stateId: "NH" })]);
    expect(hit[TARGET_ROW.toString()]).toBe(clean[TARGET_ROW.toString()]);
  });

  it("is a strict no-op for a race with no live rows", async () => {
    const a = await runIowaWave([]);
    const b = await runIowaWave([]);
    expect(a).toEqual(b);
  });
});
