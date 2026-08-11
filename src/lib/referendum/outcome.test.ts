import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { applyReferendumOutcome } from "./outcome";
import { SETTLED_COOLDOWN_TURNS, SETTLED_DESIRE_TARGET } from "@/lib/constants/referendum";
import type { Referendum } from "@/lib/db/types/referendum";

vi.mock("@/lib/referendum/referendumWebhooks", () => ({
  announceReferendumRequested: vi.fn().mockResolvedValue(undefined),
  announceReferendumDecision: vi.fn().mockResolvedValue(undefined),
  announceReferendumVoteResult: vi.fn().mockResolvedValue(undefined),
  announceConsentBillResolved: vi.fn().mockResolvedValue(undefined),
  announceReunificationComplete: vi.fn().mockResolvedValue(undefined),
  announceSecessionComplete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/referendum/wire", () => ({ recordWireEvent: vi.fn().mockResolvedValue(undefined) }));
import { recordWireEvent } from "@/lib/referendum/wire";

function refDoc(over: Partial<Referendum> = {}): Referendum {
  return {
    _id: "507f1f77bcf86cd799439011" as unknown as Referendum["_id"],
    countryId: "UK",
    regionId: "SCO",
    kind: "independence",
    targetCountryId: null,
    status: "polling",
    requestedTurn: 100,
    grantedTurn: 110,
    campaignOpenTurn: 110,
    campaignCloseTurn: 158,
    yesShare: 60,
    campaignBaseYesShare: 60,
    campaignSpendUnits: { yes: 0, no: 0 },
    conversionDeadlineTurn: null,
    westminsterBillId: null,
    dailBillId: null,
    result: null,
    cooldownReadyAtTurn: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function lastSet(db: MockDb, collection: string) {
  const calls = db.collectionMocks[collection].updateOne.mock.calls;
  return calls[calls.length - 1][1].$set;
}

describe("applyReferendumOutcome", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("YES → actuating, stamps the result, records a referendum_passed event", async () => {
    await applyReferendumOutcome(
      db as unknown as Db,
      refDoc(),
      { finalYesShare: 60, turnout: 61, passed: true },
      159
    );
    const set = lastSet(db, "referendums");
    expect(set.status).toBe("actuating");
    expect(set.result.passed).toBe(true);
    expect(set.result.resolvedTurn).toBe(159);
    expect(recordWireEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "vote" })
    );

    const event = db.collectionMocks["countryHistory"].insertOne.mock.calls[0][0];
    expect(event.eventType).toBe("referendum_passed");
    expect(event.countryId).toBe("UK");
    expect(event.details.regionId).toBe("SCO");
  });

  it("reunification YES uses rejoin-Ireland wording, opens a Dáil bill + conversion window", async () => {
    await applyReferendumOutcome(
      db as unknown as Db,
      refDoc({ regionId: "NIR", kind: "reunification", targetCountryId: "IE" }),
      { finalYesShare: 55, turnout: 60, passed: true },
      200
    );
    const event = db.collectionMocks["countryHistory"].insertOne.mock.calls[0][0];
    expect(event.title).toMatch(/rejoin Ireland/i);
    expect(event.details.targetCountryId).toBe("IE");

    // Two consent bills (Westminster + Dáil) are created and linked; the window opens.
    expect(db.collectionMocks["bills"].insertOne).toHaveBeenCalledTimes(2);
    const set = lastSet(db, "referendums");
    expect(set.status).toBe("actuating");
    expect(set.conversionDeadlineTurn).toBeGreaterThan(200);
    expect(set.westminsterBillId).toBeTruthy();
    expect(set.dailBillId).toBeTruthy();
  });

  it("independence YES opens a single Westminster consent bill + conversion deadline", async () => {
    await applyReferendumOutcome(
      db as unknown as Db,
      refDoc({ regionId: "SCO", kind: "independence", targetCountryId: null }),
      { finalYesShare: 60, turnout: 65, passed: true },
      200
    );
    // One Westminster consent bill (UK releases the region); no Dáil counterpart.
    expect(db.collectionMocks["bills"]?.insertOne).toHaveBeenCalledTimes(1);
    const set = lastSet(db, "referendums");
    expect(set.conversionDeadlineTurn).toBeGreaterThan(200);
    expect(set.westminsterBillId).toBeTruthy();
    expect(set.dailBillId).toBeNull();
  });

  it("NO → settled with cooldown, dampened desire, referendum_failed event", async () => {
    await applyReferendumOutcome(
      db as unknown as Db,
      refDoc({ yesShare: 40 }),
      { finalYesShare: 40, turnout: 58, passed: false },
      159
    );
    const set = lastSet(db, "referendums");
    expect(set.status).toBe("settled");
    expect(set.cooldownReadyAtTurn).toBe(159 + SETTLED_COOLDOWN_TURNS);

    const metricSet = lastSet(db, "macroMetrics");
    expect(metricSet.independenceDesire.value).toBe(SETTLED_DESIRE_TARGET);

    const event = db.collectionMocks["countryHistory"].insertOne.mock.calls[0][0];
    expect(event.eventType).toBe("referendum_failed");
  });
});
