import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { grantReferendum } from "./grantReferendum";
import {
  CAMPAIGN_WINDOW_TURNS,
  DECLINE_COOLDOWN_TURNS,
  DECLINE_DESIRE_BUMP,
} from "@/lib/constants/referendum";

vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: vi.fn().mockResolvedValue(100),
}));

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

const REF_ID = "507f1f77bcf86cd799439011";

function setRef(db: MockDb, doc: unknown) {
  db.collectionMocks["referendums"] = db.collection("referendums");
  db.collectionMocks["referendums"].findOne.mockResolvedValue(doc);
}

describe("grantReferendum", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("macroMetrics").findOne.mockResolvedValue({
      _id: "SCO",
      independenceDesire: { value: 64, trend: 0 },
    });
  });

  it("the PM grants a requested referendum → granted + campaign window, baseline from desire", async () => {
    setRef(db, { _id: REF_ID, status: "requested", regionId: "SCO" });
    const r = await grantReferendum(db as unknown as Db, {
      countryId: "UK",
      referendumId: REF_ID,
      isPM: true,
      action: "grant",
    });
    expect(r.status).toBe(200);
    expect(recordWireEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "granted" })
    );
    expect(r.body.campaignCloseTurn).toBe(100 + CAMPAIGN_WINDOW_TURNS);
    const set = db.collectionMocks["referendums"].updateOne.mock.calls[0][1].$set;
    expect(set.status).toBe("granted");
    expect(set.campaignBaseYesShare).toBe(64);
    expect(set.yesShare).toBe(64);
  });

  it("the PM declines a requested referendum → declined + cooldown + desire bump", async () => {
    setRef(db, { _id: REF_ID, status: "requested", regionId: "SCO" });
    const r = await grantReferendum(db as unknown as Db, {
      countryId: "UK",
      referendumId: REF_ID,
      isPM: true,
      action: "decline",
    });
    expect(r.status).toBe(200);
    expect(r.body.declined).toBe(true);
    const set = db.collectionMocks["referendums"].updateOne.mock.calls[0][1].$set;
    expect(set.status).toBe("declined");
    expect(set.cooldownReadyAtTurn).toBe(100 + DECLINE_COOLDOWN_TURNS);
    // Declining stokes the cause: desire 64 → 64 + DECLINE_DESIRE_BUMP.
    const metricSet = db.collectionMocks["macroMetrics"].updateOne.mock.calls[0][1].$set;
    expect(metricSet["independenceDesire.value"]).toBe(64 + DECLINE_DESIRE_BUMP);
  });

  it("a decline near the ceiling clamps desire to 100", async () => {
    db.collection("macroMetrics").findOne.mockResolvedValue({
      _id: "SCO",
      independenceDesire: { value: 98, trend: 0 },
    });
    setRef(db, { _id: REF_ID, status: "requested", regionId: "SCO" });
    await grantReferendum(db as unknown as Db, {
      countryId: "UK",
      referendumId: REF_ID,
      isPM: true,
      action: "decline",
    });
    const metricSet = db.collectionMocks["macroMetrics"].updateOne.mock.calls[0][1].$set;
    expect(metricSet["independenceDesire.value"]).toBe(100);
  });

  it("a non-PM cannot decide", async () => {
    setRef(db, { _id: REF_ID, status: "requested", regionId: "SCO" });
    const r = await grantReferendum(db as unknown as Db, {
      countryId: "UK",
      referendumId: REF_ID,
      isPM: false,
      action: "grant",
    });
    expect(r.status).toBe(403);
  });

  it("admin override can decide without being PM", async () => {
    setRef(db, { _id: REF_ID, status: "requested", regionId: "SCO" });
    const r = await grantReferendum(db as unknown as Db, {
      countryId: "UK",
      referendumId: REF_ID,
      isPM: false,
      action: "grant",
      adminOverride: true,
    });
    expect(r.status).toBe(200);
  });

  it("cannot decide a referendum that is not awaiting a decision", async () => {
    setRef(db, { _id: REF_ID, status: "campaigning", regionId: "SCO" });
    const r = await grantReferendum(db as unknown as Db, {
      countryId: "UK",
      referendumId: REF_ID,
      isPM: true,
      action: "grant",
    });
    expect(r.status).toBe(400);
  });
});
