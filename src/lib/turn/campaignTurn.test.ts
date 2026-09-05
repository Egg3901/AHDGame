import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { processCampaignTurn } from "./campaignTurn";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

describe("processCampaignTurn", () => {
  const mockUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  const mockBulkWrite = vi.fn().mockResolvedValue({});
  const mockFind = vi.fn();
  const mockFindOne = vi.fn();
  const mockCountDocuments = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
  });

  it("processes campaign turn with income and maintenance", async () => {
    const { getDb } = await import("@/lib/mongodb");

    // Use real ObjectIds so the source can call new ObjectId(candidateId) safely
    const candidateObjectId = new ObjectId();

    const mockCampaign = {
      _id: new ObjectId(),
      electionId: "election1",
      candidateId: candidateObjectId,
      candidateIsNPP: false,
      party: "democrat",
      funds: 50000,
      actions: 10,
      fundraisingLevel: 1,
      oppositionResearchLevel: 0,
      groundGameLevel: 1,
      mediaSpendingLevel: 1,
      oppositionTargetId: null,
      totalFundsGenerated: 0,
      totalActionsGenerated: 0,
    };

    const mockCharacter = {
      _id: candidateObjectId,
      politicalInfluence: 50,
      funds: 100000,
      favorability: 50,
    };

    mockFind.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([mockCampaign]),
    });
    mockFindOne.mockResolvedValueOnce(mockCharacter);
    mockCountDocuments.mockResolvedValue(4); // 4 endorsements = 6 actions

    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn((name: string) => {
        if (name === "elections") {
          // Return a matching active election so campaignTurn fetches campaigns for it
          return {
            find: vi
              .fn()
              .mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ _id: "election1" }]) }),
          };
        }
        if (name === "campaigns") {
          return { find: mockFind, updateOne: mockUpdateOne, bulkWrite: mockBulkWrite };
        }
        if (name === "characters") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([mockCharacter]),
            }),
            findOne: mockFindOne,
            updateOne: mockUpdateOne,
            bulkWrite: mockBulkWrite,
            countDocuments: vi.fn().mockResolvedValue(0),
          };
        }
        if (name === "npps") {
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            bulkWrite: mockBulkWrite,
            countDocuments: vi.fn().mockResolvedValue(0),
          };
        }
        if (name === "nppEndorsements") {
          return {
            countDocuments: mockCountDocuments,
            aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          };
        }
        if (name === "playerEndorsements") {
          return {
            countDocuments: mockCountDocuments,
            aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          };
        }
        if (name === "electionCandidates") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            }),
          };
        }
        // Fallback: includes `find` and `aggregate` so processCampaignTurn's
        // governorEndorsements aggregate query and loadFxRatesByCurrency resolve.
        return {
          findOne: mockFindOne,
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          updateOne: mockUpdateOne,
          bulkWrite: mockBulkWrite,
          aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        };
      }),
    } as never);

    await processCampaignTurn(5);

    // Should update campaign with income and actions via bulkWrite
    expect(mockBulkWrite).toHaveBeenCalled();
  });
});

// ─── Campaign-Fund De-Forex (static INITIAL_RATES scale) ────────────────────

describe("campaign fund de-forex", () => {
  // Captures incomeLocal ($inc.totalFundsGenerated) for one player campaign whose
  // election is in `countryId`. A live NGN rate of 9999 is seeded into
  // exchangeRates on purpose: campaign funds must ignore it and use the frozen
  // INITIAL_RATES scale (NG ×1550) instead.
  async function captureIncomeLocal(countryId: string): Promise<number> {
    const { getDb } = await import("@/lib/mongodb");
    const candidateId = new ObjectId();
    const campaign = {
      _id: new ObjectId(),
      electionId: "e1",
      candidateId,
      candidateIsNPP: false,
      party: "democrat",
      funds: 5_000_000, // high enough to avoid insolvency auto-downgrade
      actions: 10,
      fundraisingLevel: 3,
      oppositionResearchLevel: 0,
      groundGameLevel: 1,
      mediaSpendingLevel: 1,
      oppositionTargetId: null,
      totalFundsGenerated: 0,
      totalActionsGenerated: 0,
    };
    const character = { _id: candidateId, politicalInfluence: 50, funds: 100000, favorability: 50 };
    const campaignBulkWrite = vi.fn().mockResolvedValue({});
    const endTime = new Date(Date.now() + 100 * 60 * 60 * 1000);

    const db = {
      collection: vi.fn((name: string) => {
        if (name === "elections") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi
                .fn()
                .mockResolvedValue([{ _id: "e1", countryId, electionType: "senate", endTime }]),
            }),
          };
        }
        if (name === "campaigns") {
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([campaign]) }),
            bulkWrite: campaignBulkWrite,
          };
        }
        if (name === "characters") {
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([character]) }),
            findOne: vi.fn().mockResolvedValue(character),
            bulkWrite: vi.fn().mockResolvedValue({}),
          };
        }
        if (name === "exchangeRates") {
          // Sentinel live rate that must be IGNORED by campaign funds.
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([{ currencyCode: "NGN", rate: 9999 }]),
            }),
          };
        }
        if (name === "electionCandidates") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            }),
          };
        }
        if (name === "gameConfig") {
          return { findOne: vi.fn().mockResolvedValue(null) };
        }
        return {
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          findOne: vi.fn().mockResolvedValue(null),
          aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          bulkWrite: vi.fn().mockResolvedValue({}),
        };
      }),
    };

    vi.mocked(getDb).mockResolvedValue(db as never);
    await processCampaignTurn(1);

    const ops = campaignBulkWrite.mock.calls[0]?.[0] as
      { updateOne: { update: { $inc: { totalFundsGenerated: number } } } }[] | undefined;
    return ops![0]!.updateOne.update.$inc.totalFundsGenerated;
  }

  it("scales fundraise income by the frozen local rate, ignoring live forex (NG ×1550)", async () => {
    const usIncome = await captureIncomeLocal("US");
    const ngIncome = await captureIncomeLocal("NG");

    expect(usIncome).toBeGreaterThan(0);
    // NG income is the same anchor income denominated at the frozen NG rate
    // (1550) — NOT the seeded live rate (9999), and NOT unscaled (×1).
    expect(ngIncome).toBe(usIncome * 1550);
  });
});

// ─── Season Multiplier & Endorsement Filter Tests ───────────────────────────

/**
 * Builds a minimal mock DB that captures the characters bulkWrite calls so we
 * can inspect what favorability increments were written.
 */
function buildMockDb(opts: {
  electionId: ObjectId;
  electionType: string;
  endTime: Date;
  candidateId: ObjectId;
  targetId: ObjectId;
  mediaSpendingLevel: number;
  oppositionResearchLevel: number;
  nppEndorsementCount: number;
  playerEndorsementCount: number;
  /** Nominee's own campaign travel state (flat +1 presence). */
  travelState?: string;
  /** Ticket's running-mate surrogate travel state (ruleset-weighted presence). */
  runningMateTravelState?: string;
  /** Frozen ruleset stamp for the race (governs vpTravelPresenceWeight). */
  rulesetVersion?: number;
}) {
  const {
    electionId,
    electionType,
    endTime,
    candidateId,
    targetId,
    mediaSpendingLevel,
    oppositionResearchLevel,
    nppEndorsementCount,
    playerEndorsementCount,
    travelState,
    runningMateTravelState,
    rulesetVersion,
  } = opts;

  const campaign = {
    _id: new ObjectId(),
    electionId,
    candidateId,
    candidateIsNPP: false,
    party: "democrat",
    funds: 50000,
    actions: 0,
    fundraisingLevel: 0,
    groundGameLevel: 0,
    mediaSpendingLevel,
    oppositionResearchLevel,
    oppositionTargetId: oppositionResearchLevel > 0 ? targetId : null,
    totalFundsGenerated: 0,
    totalActionsGenerated: 0,
  };

  const character = { _id: candidateId, favorability: 50 };
  const targetCharacter = { _id: targetId, favorability: 60 };

  const charBulkWrite = vi.fn().mockResolvedValue({});
  const nppBulkWrite = vi.fn().mockResolvedValue({});
  const campaignBulkWrite = vi.fn().mockResolvedValue({});
  // playerEndorsements.candidateId is the electionCandidates row _id, not the
  // character identity id (ticket #868) — model that distinction here.
  const candidateRowId = new ObjectId();

  const db = {
    collection: vi.fn((name: string) => {
      if (name === "elections") {
        return {
          find: vi.fn().mockReturnValue({
            // Phase 5.5: isCampaignEligibleElection requires both countryId and
            // electionType. Default test fixtures to US so the eligibility
            // check passes for the race types being exercised.
            toArray: vi
              .fn()
              .mockResolvedValue([
                { _id: electionId, endTime, electionType, countryId: "US", rulesetVersion },
              ]),
          }),
        };
      }
      if (name === "campaigns") {
        return {
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([campaign]) }),
          bulkWrite: campaignBulkWrite,
        };
      }
      if (name === "characters") {
        return {
          find: vi.fn((filter?: { _id?: { $in?: ObjectId[] } }) => {
            // For the unknownTargets resolution query, return targets that are characters
            const ids: ObjectId[] = filter?._id?.$in ?? [];
            const all = [character, targetCharacter];
            const matched =
              ids.length > 0
                ? all.filter((c) => ids.some((id) => id.toString() === c._id.toString()))
                : all;
            return { toArray: vi.fn().mockResolvedValue(matched) };
          }),
          bulkWrite: charBulkWrite,
        };
      }
      if (name === "npps") {
        return {
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          bulkWrite: nppBulkWrite,
        };
      }
      if (name === "nppEndorsements") {
        if (nppEndorsementCount > 0) {
          return {
            aggregate: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([
                {
                  _id: { electionId, candidateId },
                  count: nppEndorsementCount,
                },
              ]),
            }),
          };
        }
        return {
          aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        };
      }
      if (name === "playerEndorsements") {
        if (playerEndorsementCount > 0) {
          return {
            aggregate: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([
                {
                  _id: { electionId, candidateId: candidateRowId },
                  count: playerEndorsementCount,
                },
              ]),
            }),
          };
        }
        return {
          aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        };
      }
      if (name === "electionCandidates") {
        return {
          find: vi.fn().mockReturnValue({
            project: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([
                {
                  _id: candidateRowId,
                  electionId,
                  characterId: candidateId,
                  travelState,
                  runningMateTravelState,
                },
              ]),
            }),
          }),
        };
      }
      if (name === "gameConfig") {
        return { findOne: vi.fn().mockResolvedValue(null) };
      }
      // Fallback for unrecognized collections (e.g. governorEndorsements which
      // processCampaignTurn aggregates against — these tests don't model
      // governor endorsements, so an empty result is correct).
      return {
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        findOne: vi.fn().mockResolvedValue(null),
        aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        bulkWrite: vi.fn().mockResolvedValue({}),
      };
    }),
  };

  return { db, charBulkWrite, campaignBulkWrite };
}

function extractPipelineFavorabilityDelta(update: unknown): number | undefined {
  return (
    (
      (update as { 0?: { $set?: { favorability?: { $min?: unknown[] } } } })?.[0]?.$set
        ?.favorability?.$min?.[1] as { $max?: unknown[] } | undefined
    )?.$max?.[1] as
      | {
          $add?: unknown[];
        }
      | undefined
  )?.$add?.[1] as number | undefined;
}

function pipelineHasFavorabilityCap(update: unknown): boolean {
  return (
    ((update as { 0?: { $set?: { favorability?: { $min?: unknown[] } } } })?.[0]?.$set?.favorability
      ?.$min?.[0] as number | undefined) === 100
  );
}

describe("season multiplier", () => {
  it("doubles media spending and opposition research favorability in the final 4 hours", async () => {
    const { getDb } = await import("@/lib/mongodb");

    const electionId = new ObjectId();
    const candidateId = new ObjectId();
    const targetId = new ObjectId();

    // endTime is 2 hours from now → hoursRemaining = 2 ≤ 4 → multiplier = 2
    const endTime = new Date(Date.now() + 2 * 60 * 60 * 1000);

    const { db, charBulkWrite } = buildMockDb({
      electionId,
      electionType: "president",
      endTime,
      candidateId,
      targetId,
      mediaSpendingLevel: 2,
      oppositionResearchLevel: 1,
      nppEndorsementCount: 0,
      playerEndorsementCount: 0,
    });

    vi.mocked(getDb).mockResolvedValue(db as never);

    await processCampaignTurn(1);

    expect(charBulkWrite).toHaveBeenCalled();
    const ops: { updateOne: { filter: { _id: ObjectId }; update: unknown } }[] =
      charBulkWrite.mock.calls[0][0];

    // Media spending: 2 levels × 0.5 × 2 = 2.0 for candidateId
    const candidateOp = ops.find(
      (o) => o.updateOne.filter._id.toString() === candidateId.toString()
    );
    expect(pipelineHasFavorabilityCap(candidateOp?.updateOne.update)).toBe(true);
    expect(extractPipelineFavorabilityDelta(candidateOp?.updateOne.update)).toBe(2.0);

    // Opposition research: 1 level × (-0.5) × 2 = -1.0 for targetId
    const targetOp = ops.find((o) => o.updateOne.filter._id.toString() === targetId.toString());
    expect(pipelineHasFavorabilityCap(targetOp?.updateOne.update)).toBe(true);
    expect(extractPipelineFavorabilityDelta(targetOp?.updateOne.update)).toBe(-1.0);
  });

  it("uses 1× multiplier when more than 4 hours remain", async () => {
    const { getDb } = await import("@/lib/mongodb");

    const electionId = new ObjectId();
    const candidateId = new ObjectId();
    const targetId = new ObjectId();

    // endTime is 10 hours from now → hoursRemaining = 10 > 4 → multiplier = 1
    const endTime = new Date(Date.now() + 10 * 60 * 60 * 1000);

    const { db, charBulkWrite } = buildMockDb({
      electionId,
      electionType: "president",
      endTime,
      candidateId,
      targetId,
      mediaSpendingLevel: 2,
      oppositionResearchLevel: 1,
      nppEndorsementCount: 0,
      playerEndorsementCount: 0,
    });

    vi.mocked(getDb).mockResolvedValue(db as never);

    await processCampaignTurn(1);

    expect(charBulkWrite).toHaveBeenCalled();
    const ops: { updateOne: { filter: { _id: ObjectId }; update: unknown } }[] =
      charBulkWrite.mock.calls[0][0];

    // Media spending: 2 levels × 0.5 × 1 = 1.0 for candidateId
    const candidateOp = ops.find(
      (o) => o.updateOne.filter._id.toString() === candidateId.toString()
    );
    expect(pipelineHasFavorabilityCap(candidateOp?.updateOne.update)).toBe(true);
    expect(extractPipelineFavorabilityDelta(candidateOp?.updateOne.update)).toBe(1.0);

    // Opposition research: 1 level × (-0.5) × 1 = -0.5 for targetId
    const targetOp = ops.find((o) => o.updateOne.filter._id.toString() === targetId.toString());
    expect(pipelineHasFavorabilityCap(targetOp?.updateOne.update)).toBe(true);
    expect(extractPipelineFavorabilityDelta(targetOp?.updateOne.update)).toBe(-0.5);
  });

  it("suppresses media and opposition favorability effects for non-eligible campaigns (Phase 5.5 D4 deferred countries)", async () => {
    const { getDb } = await import("@/lib/mongodb");

    const electionId = new ObjectId();
    const candidateId = new ObjectId();
    const targetId = new ObjectId();

    // Phase 5.5 widened Campaign Manager eligibility to US senate / governor /
    // house / state-senate (D2). Non-US races stay deferred per D4 (UK / JP /
    // DE / IE country-specific finance models). This test exercises the
    // non-eligible path using UK commons — the levels are set but the passive
    // favorability effects must NOT fire because the country lacks the
    // campaignManagerNonPresidentialEnabled flag.
    const endTime = new Date(Date.now() + 10 * 60 * 60 * 1000);

    const { db, charBulkWrite } = buildMockDb({
      electionId,
      electionType: "commons",
      endTime,
      candidateId,
      targetId,
      mediaSpendingLevel: 5,
      oppositionResearchLevel: 5,
      nppEndorsementCount: 0,
      playerEndorsementCount: 0,
    });

    // Override the elections collection mock to set countryId: 'UK' so the
    // race is non-eligible per Phase 5.5 D4. buildMockDb defaults countryId
    // to 'US' which would make commons still ineligible (UK-only race type
    // outside the US race-family set), but for the test to exercise the
    // intended path we explicitly set UK.
    const originalCollection = db.collection as unknown as (name: string) => unknown;
    db.collection = vi.fn((name: string) => {
      if (name === "elections") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi
              .fn()
              .mockResolvedValue([
                { _id: electionId, endTime, electionType: "commons", countryId: "UK" },
              ]),
          }),
        };
      }
      return originalCollection(name);
    }) as typeof db.collection;

    vi.mocked(getDb).mockResolvedValue(db as never);

    await processCampaignTurn(1);

    // No favorability writes should have been queued. UK commons (non-eligible
    // per D4) must not see passive media / opposition-research effects fire,
    // even if a stray Campaign doc somehow exists.
    expect(charBulkWrite).not.toHaveBeenCalled();
  });
});

describe("running-mate surrogate travel presence", () => {
  it("adds the ruleset's vpTravelPresenceWeight to the ticket favorability when the running mate is traveling", async () => {
    const { getDb } = await import("@/lib/mongodb");

    const electionId = new ObjectId();
    const candidateId = new ObjectId();
    const targetId = new ObjectId();
    // >4h out so the season multiplier is 1 (travel presence is a flat add
    // regardless, but this keeps the arithmetic unambiguous).
    const endTime = new Date(Date.now() + 10 * 60 * 60 * 1000);

    const { db, charBulkWrite } = buildMockDb({
      electionId,
      electionType: "president",
      endTime,
      candidateId,
      targetId,
      mediaSpendingLevel: 0,
      oppositionResearchLevel: 0,
      nppEndorsementCount: 0,
      playerEndorsementCount: 0,
      runningMateTravelState: "PA",
      rulesetVersion: 3,
    });

    vi.mocked(getDb).mockResolvedValue(db as never);

    await processCampaignTurn(1);

    expect(charBulkWrite).toHaveBeenCalled();
    const ops: { updateOne: { filter: { _id: ObjectId }; update: unknown } }[] =
      charBulkWrite.mock.calls[0][0];
    const candidateOp = ops.find(
      (o) => o.updateOne.filter._id.toString() === candidateId.toString()
    );
    // v3 vpTravelPresenceWeight identity = 1 → +1.0 on the ticket favorability.
    expect(extractPipelineFavorabilityDelta(candidateOp?.updateOne.update)).toBe(1.0);
  });

  it("stacks the nominee's own travel presence and the running mate's", async () => {
    const { getDb } = await import("@/lib/mongodb");

    const electionId = new ObjectId();
    const candidateId = new ObjectId();
    const targetId = new ObjectId();
    const endTime = new Date(Date.now() + 10 * 60 * 60 * 1000);

    const { db, charBulkWrite } = buildMockDb({
      electionId,
      electionType: "president",
      endTime,
      candidateId,
      targetId,
      mediaSpendingLevel: 0,
      oppositionResearchLevel: 0,
      nppEndorsementCount: 0,
      playerEndorsementCount: 0,
      travelState: "OH",
      runningMateTravelState: "PA",
      rulesetVersion: 3,
    });

    vi.mocked(getDb).mockResolvedValue(db as never);

    await processCampaignTurn(1);

    const ops: { updateOne: { filter: { _id: ObjectId }; update: unknown } }[] =
      charBulkWrite.mock.calls[0][0];
    const candidateOp = ops.find(
      (o) => o.updateOne.filter._id.toString() === candidateId.toString()
    );
    // Nominee travel (+1.0) + running-mate travel (weight 1 × 1.0) = +2.0.
    expect(extractPipelineFavorabilityDelta(candidateOp?.updateOne.update)).toBe(2.0);
  });

  it("does not add a running-mate bonus when the running mate has not traveled", async () => {
    const { getDb } = await import("@/lib/mongodb");

    const electionId = new ObjectId();
    const candidateId = new ObjectId();
    const targetId = new ObjectId();
    const endTime = new Date(Date.now() + 10 * 60 * 60 * 1000);

    const { db, charBulkWrite } = buildMockDb({
      electionId,
      electionType: "president",
      endTime,
      candidateId,
      targetId,
      mediaSpendingLevel: 0,
      oppositionResearchLevel: 0,
      nppEndorsementCount: 0,
      playerEndorsementCount: 0,
      rulesetVersion: 3,
    });

    vi.mocked(getDb).mockResolvedValue(db as never);

    await processCampaignTurn(1);

    // No media, no oppo, no travel → no favorability write at all.
    expect(charBulkWrite).not.toHaveBeenCalled();
  });
});

describe("auto-downgrade on insolvency", () => {
  it("demotes groundGame/mediaSpending when projected funds can't cover maintenance", async () => {
    const { getDb } = await import("@/lib/mongodb");

    const electionId = new ObjectId();
    const candidateId = new ObjectId();
    const endTime = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Deprince-shaped campaign: L5 ground + L5 media, no fundraising, deep
    // negative funds — the auto-downgrade should drop both tiers to 0 and the
    // maintenance applied this turn should be 0.
    const campaign = {
      _id: new ObjectId(),
      electionId,
      candidateId,
      candidateIsNPP: false,
      party: "republican",
      funds: -3_000_000,
      actions: 100,
      fundraisingLevel: 5,
      oppositionResearchLevel: 4,
      groundGameLevel: 5,
      mediaSpendingLevel: 5,
      oppositionTargetId: null,
      totalFundsGenerated: 0,
      totalActionsGenerated: 0,
    };

    const character = { _id: candidateId, favorability: 50 };

    const campaignBulkWrite = vi.fn().mockResolvedValue({});

    const db = {
      collection: vi.fn((name: string) => {
        if (name === "elections") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi
                .fn()
                .mockResolvedValue([
                  { _id: electionId, endTime, electionType: "president", countryId: "US" },
                ]),
            }),
          };
        }
        if (name === "campaigns") {
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([campaign]) }),
            bulkWrite: campaignBulkWrite,
          };
        }
        if (name === "characters") {
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([character]) }),
            bulkWrite: vi.fn().mockResolvedValue({}),
          };
        }
        if (name === "npps") {
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            bulkWrite: vi.fn().mockResolvedValue({}),
          };
        }
        if (name === "nppEndorsements" || name === "playerEndorsements") {
          return {
            aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          };
        }
        if (name === "electionCandidates") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            }),
            bulkWrite: vi.fn().mockResolvedValue({}),
          };
        }
        if (name === "gameConfig") {
          return { findOne: vi.fn().mockResolvedValue(null) };
        }
        // Fallback (includes governorEndorsements aggregate).
        return {
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          findOne: vi.fn().mockResolvedValue(null),
          aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          bulkWrite: vi.fn().mockResolvedValue({}),
        };
      }),
    };

    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await processCampaignTurn(999);

    expect(result.campaignsAutoDowngraded).toBe(1);
    expect(campaignBulkWrite).toHaveBeenCalled();

    const ops: {
      updateOne: {
        filter: { _id: ObjectId };
        update: {
          $inc: { funds: number };
          $set: Record<string, unknown>;
          $push?: Record<string, unknown>;
        };
      };
    }[] = campaignBulkWrite.mock.calls[0][0];

    const op = ops[0];
    // L5 fundraising income = $200k, post-downgrade maintenance = $0 →
    // funds delta should be +$200k, not -$455.5k.
    expect(op.updateOne.update.$inc.funds).toBe(200_000);
    expect(op.updateOne.update.$set.groundGameLevel).toBe(0);
    expect(op.updateOne.update.$set.mediaSpendingLevel).toBe(0);
    expect(op.updateOne.update.$push).toBeDefined();
  });

  it("leaves solvent campaigns untouched", async () => {
    const { getDb } = await import("@/lib/mongodb");

    const electionId = new ObjectId();
    const candidateId = new ObjectId();
    const endTime = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const campaign = {
      _id: new ObjectId(),
      electionId,
      candidateId,
      candidateIsNPP: false,
      party: "democrat",
      funds: 1_000_000,
      actions: 10,
      fundraisingLevel: 5,
      oppositionResearchLevel: 0,
      groundGameLevel: 2,
      mediaSpendingLevel: 2,
      oppositionTargetId: null,
      totalFundsGenerated: 0,
      totalActionsGenerated: 0,
    };

    const character = { _id: candidateId, favorability: 50 };

    const campaignBulkWrite = vi.fn().mockResolvedValue({});

    const db = {
      collection: vi.fn((name: string) => {
        if (name === "elections") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi
                .fn()
                .mockResolvedValue([
                  { _id: electionId, endTime, electionType: "president", countryId: "US" },
                ]),
            }),
          };
        }
        if (name === "campaigns") {
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([campaign]) }),
            bulkWrite: campaignBulkWrite,
          };
        }
        if (name === "characters") {
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([character]) }),
            bulkWrite: vi.fn().mockResolvedValue({}),
          };
        }
        if (name === "npps") {
          return {
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            bulkWrite: vi.fn().mockResolvedValue({}),
          };
        }
        if (name === "nppEndorsements" || name === "playerEndorsements") {
          return {
            aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          };
        }
        if (name === "electionCandidates") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            }),
            bulkWrite: vi.fn().mockResolvedValue({}),
          };
        }
        if (name === "gameConfig") {
          return { findOne: vi.fn().mockResolvedValue(null) };
        }
        // Fallback (includes governorEndorsements aggregate).
        return {
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          findOne: vi.fn().mockResolvedValue(null),
          aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          bulkWrite: vi.fn().mockResolvedValue({}),
        };
      }),
    };

    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await processCampaignTurn(1);

    expect(result.campaignsAutoDowngraded).toBe(0);
    const ops: {
      updateOne: {
        filter: { _id: ObjectId };
        update: { $set: Record<string, unknown>; $push?: Record<string, unknown> };
      };
    }[] = campaignBulkWrite.mock.calls[0][0];
    expect(ops[0].updateOne.update.$set.groundGameLevel).toBeUndefined();
    expect(ops[0].updateOne.update.$push).toBeUndefined();
  });
});

describe("endorsement filter", () => {
  it("uses only NPP endorsements for action calculation in non-presidential elections", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const { calculateCampaignActions } = await import("@/lib/campaigns/actions");

    const electionId = new ObjectId();
    const candidateId = new ObjectId();
    const targetId = new ObjectId();
    const endTime = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const { db, campaignBulkWrite } = buildMockDb({
      electionId,
      electionType: "senate", // non-presidential
      endTime,
      candidateId,
      targetId,
      mediaSpendingLevel: 0,
      oppositionResearchLevel: 0,
      nppEndorsementCount: 4,
      playerEndorsementCount: 9, // player endorsements should be ignored
    });

    vi.mocked(getDb).mockResolvedValue(db as never);

    await processCampaignTurn(1);

    expect(campaignBulkWrite).toHaveBeenCalled();
    const ops: {
      updateOne: { filter: { _id: ObjectId }; update: { $inc: { actions: number } } };
    }[] = campaignBulkWrite.mock.calls[0][0];

    const campaignOp = ops[0];
    // Only 4 NPP endorsements should count. Baseline defaults to 4 per turn
    // (player base action gain) when no gameConfig doc is present in the test.
    const expectedActions = calculateCampaignActions(4, 4);
    expect(campaignOp.updateOne.update.$inc.actions).toBe(expectedActions);
  });

  it("uses both NPP and player endorsements for presidential elections", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const { calculateCampaignActions } = await import("@/lib/campaigns/actions");

    const electionId = new ObjectId();
    const candidateId = new ObjectId();
    const targetId = new ObjectId();
    const endTime = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const { db, campaignBulkWrite } = buildMockDb({
      electionId,
      electionType: "president", // presidential — both counts effective
      endTime,
      candidateId,
      targetId,
      mediaSpendingLevel: 0,
      oppositionResearchLevel: 0,
      nppEndorsementCount: 4,
      playerEndorsementCount: 9,
    });

    vi.mocked(getDb).mockResolvedValue(db as never);

    await processCampaignTurn(1);

    expect(campaignBulkWrite).toHaveBeenCalled();
    const ops: {
      updateOne: { filter: { _id: ObjectId }; update: { $inc: { actions: number } } };
    }[] = campaignBulkWrite.mock.calls[0][0];

    const campaignOp = ops[0];
    // Both 4 NPP + 9 player = 13 total. Baseline 4 (player base action gain)
    // since no gameConfig doc exists in the test mock.
    const expectedActions = calculateCampaignActions(13, 4);
    expect(campaignOp.updateOne.update.$inc.actions).toBe(expectedActions);
  });
});

// ─── Primary state attacks ──────────────────────────────────────────────────

describe("primary state attacks", () => {
  const TARGET_ROW = new ObjectId();
  const TARGET_CHARACTER = new ObjectId();
  const ACTOR_ROW = new ObjectId();

  /**
   * Run one campaign turn with `campaignCount` campaigns in the pass and one
   * live attack, and return the favorability delta written for the target.
   *
   * The delta is read out of the clamped update pipeline
   * `[{ $set: { favorability: { $min: [100, { $max: [0, { $add: [ifNull, amt] }] }] } } }]`.
   */
  async function drainForTarget(campaignCount: number): Promise<number | null> {
    const { getDb } = await import("@/lib/mongodb");

    const campaigns = Array.from({ length: campaignCount }, () => ({
      _id: new ObjectId(),
      electionId: "e1",
      candidateId: new ObjectId(),
      candidateIsNPP: false,
      party: "democrat",
      funds: 5_000_000,
      actions: 10,
      fundraisingLevel: 0,
      oppositionResearchLevel: 0,
      groundGameLevel: 0,
      mediaSpendingLevel: 0,
      oppositionTargetId: null,
      totalFundsGenerated: 0,
      totalActionsGenerated: 0,
    }));
    // The target holds no campaign, so nothing else in the pass touches their
    // favorability and the delta below is the attack alone.
    const characters = [
      ...campaigns.map((c) => ({
        _id: c.candidateId,
        politicalInfluence: 50,
        funds: 100_000,
        favorability: 50,
      })),
      { _id: TARGET_CHARACTER, politicalInfluence: 50, funds: 100_000, favorability: 50 },
    ];

    const attack = {
      _id: new ObjectId(),
      electionId: "e1",
      actorCandidateId: ACTOR_ROW,
      targetCandidateId: TARGET_ROW,
      targetCharacterId: TARGET_CHARACTER,
      stateId: "IA",
      kind: "localFavorability",
      magnitude: 0.4,
      shieldApplied: 0,
      appliedTurn: 4,
      expiresTurn: 12,
      createdAt: new Date(),
    };

    const characterBulkWrite = vi.fn().mockResolvedValue({});
    const cursor = (docs: unknown[]) => {
      const c = {
        toArray: vi.fn().mockResolvedValue(docs),
        project: vi.fn(() => c),
        sort: vi.fn(() => c),
        limit: vi.fn(() => c),
      };
      return c;
    };

    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn((name: string) => {
        if (name === "elections") {
          return {
            find: vi.fn(() =>
              cursor([
                {
                  _id: "e1",
                  countryId: "US",
                  electionType: "president",
                  endTurn: 100,
                  endTime: new Date(Date.now() + 1000 * 60 * 60 * 100),
                },
              ])
            ),
          };
        }
        if (name === "campaigns") {
          return { find: vi.fn(() => cursor(campaigns)), bulkWrite: vi.fn().mockResolvedValue({}) };
        }
        if (name === "characters") {
          return {
            find: vi.fn(() => cursor(characters)),
            findOne: vi.fn().mockResolvedValue(characters[0]),
            bulkWrite: characterBulkWrite,
            countDocuments: vi.fn().mockResolvedValue(0),
          };
        }
        if (name === "primaryStateActions") {
          return { find: vi.fn(() => cursor([attack])) };
        }
        if (name === "electionCandidates") {
          return {
            find: vi.fn(() =>
              cursor([{ _id: TARGET_ROW, electionId: "e1", characterId: TARGET_CHARACTER }])
            ),
            bulkWrite: vi.fn().mockResolvedValue({}),
          };
        }
        return {
          find: vi.fn(() => cursor([])),
          findOne: vi.fn().mockResolvedValue(null),
          bulkWrite: vi.fn().mockResolvedValue({}),
          updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
          countDocuments: vi.fn().mockResolvedValue(0),
          aggregate: vi.fn(() => cursor([])),
        };
      }),
    } as never);

    await processCampaignTurn(5);

    for (const call of characterBulkWrite.mock.calls) {
      for (const op of (call[0] ?? []) as {
        updateOne?: { filter: { _id: ObjectId }; update: unknown[] };
      }[]) {
        if (op.updateOne?.filter._id?.toString() !== TARGET_CHARACTER.toString()) continue;
        const pipeline = op.updateOne.update as {
          $set: {
            favorability: { $min: [number, { $max: [number, { $add: [unknown, number] }] }] };
          };
        }[];
        return pipeline[0].$set.favorability.$min[1].$max[1].$add[1];
      }
    }
    return null;
  }

  it("drains the target by the attack's rate", async () => {
    expect(await drainForTarget(1)).toBeCloseTo(-0.4, 6);
  });

  it("applies the drain once for the pass, not once per campaign in it", async () => {
    // The drain belongs to the attack row, not to any campaign being iterated.
    // Folded into each campaign's passive map it was summed once per campaign,
    // so a field of eight candidates took eight times the advertised rate.
    expect(await drainForTarget(6)).toBeCloseTo(-0.4, 6);
  });
});
