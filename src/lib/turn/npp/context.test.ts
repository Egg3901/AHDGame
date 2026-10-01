import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("loadNPPContext", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("uses billDeadlineNow for bill voting window filters when provided", async () => {
    const gameNow = new Date("2026-04-29T15:00:00.000Z");
    const billDeadlineNow = new Date("2026-04-29T22:00:00.000Z");

    const { loadNPPContext } = await import("./context");
    await loadNPPContext(gameNow, { billDeadlineNow });

    const filter = db.collectionMocks["bills"]!.find.mock.calls[0][0] as {
      $or: Array<Record<string, unknown>>;
    };

    expect(filter.$or[0]).toEqual({ status: "active", votingEndsAt: { $gt: billDeadlineNow } });
    expect(filter.$or[1]).toEqual({
      status: "active_other",
      otherChamberVotingEndsAt: { $gt: billDeadlineNow },
    });
    expect(filter.$or[2]).toEqual({
      status: "veto_override",
      overrideVotingEndsAt: { $gt: billDeadlineNow },
    });
    expect(filter.$or[3]).toEqual({
      status: "override_shugiin",
      votingEndsAt: { $gt: billDeadlineNow },
    });
  });

  it("tracks NPP candidacies across ALL elections (incl. upcoming), not just active-status elections", async () => {
    // The unique partial index allows one active candidacy per character across
    // ANY election phase. nppCandidacies must mirror that, or Phase-1 incumbent
    // defense double-inserts and throws E11000. So the candidacy query must NOT
    // be scoped to active-status elections.
    const gameNow = new Date("2026-04-29T15:00:00.000Z");

    const { loadNPPContext } = await import("./context");
    await loadNPPContext(gameNow);

    const candidacyCalls = (
      db.collectionMocks["electionCandidates"]!.find.mock.calls as Array<
        [Record<string, unknown> | undefined]
      >
    )
      .map((c) => c[0])
      .filter(
        (f): f is Record<string, unknown> => !!f && f.isNPP === true && f.status === "active"
      );

    expect(candidacyCalls.length).toBeGreaterThan(0);
    for (const filter of candidacyCalls) {
      expect(filter).not.toHaveProperty("electionId");
    }
  });

  it("falls back to game-time now when billDeadlineNow is omitted", async () => {
    const gameNow = new Date("2026-04-29T15:00:00.000Z");

    const { loadNPPContext } = await import("./context");
    await loadNPPContext(gameNow);

    const filter = db.collectionMocks["bills"]!.find.mock.calls[0][0] as {
      $or: Array<Record<string, unknown>>;
    };

    expect(filter.$or[0]).toEqual({ status: "active", votingEndsAt: { $gt: gameNow } });
    expect(filter.$or[1]).toEqual({
      status: "active_other",
      otherChamberVotingEndsAt: { $gt: gameNow },
    });
  });
});

describe("Russian NPC context constitution snapshot", () => {
  it("reads one projected marker snapshot for multiple bills and hydrates only current deputies", async () => {
    const db = createMockDb();
    const { loadNPPContext } = await import("./context");
    const nppId = new ObjectId();
    const obsoleteId = new ObjectId();
    db.collection("gameState").findOne.mockResolvedValue({
      currentTurn: 50,
      preset: "1991-default",
    });
    db.collection("countryGameStates").findOne.mockResolvedValue({
      _id: "RU",
      ruSovietSuccessionSinceTurn: 24,
    });
    db.collection("bills")
      .find()
      .toArray.mockResolvedValue(
        [1, 2].map(() => ({
          _id: new ObjectId(),
          countryId: "RU",
          status: "active",
          currentChamber: "congressOfPeoplesDeputies",
          legislationTypeId: "tax.income",
          votes: {},
        }))
      );
    db.collection("electedOfficials")
      .find()
      .toArray.mockResolvedValue([
        { _id: new ObjectId(), countryId: "RU", officeType: "congressDeputy", nppId },
        {
          _id: new ObjectId(),
          countryId: "RU",
          officeType: "unionCongressDeputy",
          nppId: obsoleteId,
        },
      ]);
    db.collection("npps")
      .find()
      .toArray.mockResolvedValue(
        [nppId, obsoleteId].map((_id) => ({ _id, policies: { economic: 0, social: 0 } }))
      );
    db.collection("npps")
      .aggregate()
      .toArray.mockResolvedValue([{ _id: nppId, domainPositions: { "tax.income": 30 } }]);
    const ctx = await loadNPPContext(new Date(0), { db: db as unknown as Db });
    expect(db.collectionMocks.countryGameStates.findOne).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.countryGameStates.findOne).toHaveBeenCalledWith(
      { _id: "RU" },
      expect.objectContaining({
        projection: expect.objectContaining({
          ruSovietSuccessionSinceTurn: 1,
          ruFederalAssemblySinceTurn: 1,
        }),
      })
    );
    expect(ctx.runtimeCountryOffices?.get("RU")?.lowerOfficeType).toBe("congressDeputy");
    const aggregateCalls = db.collectionMocks.npps.aggregate.mock.calls.filter(
      ([pipeline]) => pipeline !== undefined
    );
    expect(aggregateCalls).toHaveLength(1);
    expect(aggregateCalls[0][0][0]).toEqual({ $match: { _id: { $in: [nppId] } } });
    expect(ctx.nppMap.get(nppId.toString())?.policies.domainPositions).toEqual({
      "tax.income": 30,
    });
    expect(ctx.nppMap.get(obsoleteId.toString())?.policies.domainPositions).toBeUndefined();
  });
});
