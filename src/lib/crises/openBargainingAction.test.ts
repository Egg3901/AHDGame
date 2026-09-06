import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Crisis, CrisisDecisionOption, CrisisInteraction } from "@/lib/db/types/crisis";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/wireEvent", () => ({ logWireEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/unions/commands/bargaining", () => ({
  persistBargainingMediationAction: vi.fn().mockResolvedValue({ ok: true }),
  openBargainingCampaignFromLiveConditions: vi.fn(),
}));

const { runCrisisOptionAction } = await import("./optionActions");
const { persistBargainingMediationAction, openBargainingCampaignFromLiveConditions } =
  await import("@/lib/unions/commands/bargaining");

const UNION_ID = new ObjectId();
const EMPLOYER_ID = new ObjectId();
const DISPUTE_TURN = 100;

function offer(proposedBy: "union" | "employer", wageLevel: number) {
  return {
    revision: proposedBy === "union" ? 1 : 2,
    proposedBy,
    wageLevel,
    agreementDurationTurns: 24,
    noStrikeTurns: 0,
    proposedAtTurn: DISPUTE_TURN,
    proposedAt: new Date(),
  };
}

/** A campaign fresh from the opener: negotiating, one union offer. */
function openedCampaign(id: ObjectId) {
  return {
    _id: id,
    unionId: UNION_ID,
    countryId: "US",
    sectorType: "manufacturing",
    employerCorporationId: EMPLOYER_ID,
    sectorIds: [],
    status: "negotiating",
    escalationLevel: "none",
    mandate: { lawSupport: 60 },
    currentOffer: offer("union", 1.12),
    offers: [offer("union", 1.12)],
    startedAtTurn: DISPUTE_TURN,
    deadlineTurn: DISPUTE_TURN + 20,
    lastActionTurn: DISPUTE_TURN,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function ctxFor(db: MockDb) {
  return {
    db: db as unknown as Db,
    crisis: {} as Crisis,
    interaction: {} as CrisisInteraction,
    option: {
      optionId: "response_bargain",
      action: { kind: "openBargaining", sectorType: "manufacturing" },
    } as CrisisDecisionOption,
    characterId: new ObjectId(),
    countryId: "US",
    currentTurn: DISPUTE_TURN,
  };
}

describe("crisis openBargaining action (#127)", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("unions");
    db.collection("bargainingCampaigns");
    db.collection("corporateSectors");

    db.collectionMocks.unions.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: UNION_ID, countryId: "US", sectorType: "manufacturing" }]),
    });
    db.collectionMocks.corporateSectors.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi
        .fn()
        .mockResolvedValue([{ corporationId: EMPLOYER_ID, workers: 40_000, wageLevel: 1 }]),
    });
    db.collectionMocks.bargainingCampaigns.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
  });

  it("mediates an existing dispute without opening another campaign", async () => {
    const existing = {
      ...openedCampaign(new ObjectId()),
      status: "dispute",
      disputeStartedAtTurn: DISPUTE_TURN,
      offers: [offer("union", 1.12), offer("employer", 1.03)],
      currentOffer: offer("employer", 1.03),
    };
    db.collectionMocks.bargainingCampaigns.findOne.mockResolvedValue(existing);

    await runCrisisOptionAction(ctxFor(db));

    expect(openBargainingCampaignFromLiveConditions).not.toHaveBeenCalled();
    expect(persistBargainingMediationAction).toHaveBeenCalledTimes(1);
  });

  // The defect: a scripted nationwide strike has no player/NPP dispute, so the
  // most diplomatic path used to log and return while still paying its
  // approval effect.
  it("opens a dispute to broker when none exists, then mediates it", async () => {
    const newId = new ObjectId();
    db.collectionMocks.bargainingCampaigns.findOne
      .mockResolvedValueOnce(null) // no existing dispute
      .mockResolvedValueOnce(openedCampaign(newId)); // re-read after opening
    vi.mocked(openBargainingCampaignFromLiveConditions).mockResolvedValue({
      ok: true,
      status: 200,
      campaignId: newId.toString(),
    } as never);

    await runCrisisOptionAction(ctxFor(db));

    expect(openBargainingCampaignFromLiveConditions).toHaveBeenCalledTimes(1);
    // Persisted in `dispute` with both packages on the table, or mediation
    // could not have been requested against it.
    const replaced = db.collectionMocks.bargainingCampaigns.replaceOne.mock.calls[0]?.[1];
    expect(replaced.status).toBe("dispute");
    expect(replaced.offers.map((o: { proposedBy: string }) => o.proposedBy)).toEqual([
      "union",
      "employer",
    ]);
    expect(persistBargainingMediationAction).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the struck sector has no union", async () => {
    db.collectionMocks.unions.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });

    await runCrisisOptionAction(ctxFor(db));

    expect(openBargainingCampaignFromLiveConditions).not.toHaveBeenCalled();
    expect(persistBargainingMediationAction).not.toHaveBeenCalled();
  });

  it("skips an employer already tied up in an open campaign", async () => {
    db.collectionMocks.bargainingCampaigns.findOne.mockResolvedValue(null);
    db.collectionMocks.bargainingCampaigns.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ employerCorporationId: EMPLOYER_ID }]),
    });

    await runCrisisOptionAction(ctxFor(db));

    expect(openBargainingCampaignFromLiveConditions).not.toHaveBeenCalled();
    expect(persistBargainingMediationAction).not.toHaveBeenCalled();
  });
});
