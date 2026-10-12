vi.mock("@/lib/db/sessionDb", () => ({
  boundSession: () => undefined,
  unboundDb: (db: unknown) => db,
  withSessionDb: (_db: unknown, work: (db: unknown) => Promise<unknown>) => work(_db),
  afterCommit: (_db: unknown, effect: () => Promise<unknown>) => effect(),
}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { requestReferendum } from "./requestReferendum";
import { REQUEST_AP_COST } from "@/lib/constants/referendum";

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

/** Chainable cursor stub whose toArray resolves the given docs. */
function cursorOf<T>(docs: T[]) {
  const cursor = {
    sort: vi.fn(() => cursor),
    limit: vi.fn(() => cursor),
    project: vi.fn(() => cursor),
    toArray: vi.fn().mockResolvedValue(docs),
  };
  return cursor;
}

/** Configure the standard happy-path reads: no active/terminal referendum,
 *  desire + AP as given. */
function seed(db: MockDb, opts: { desire: number; ap: number }) {
  db.collectionMocks["referendums"] = db.collection("referendums");
  db.collectionMocks["referendums"].findOne.mockResolvedValue(null);
  db.collectionMocks["referendums"].find.mockReturnValue(cursorOf([]));
  db.collection("macroMetrics").findOne.mockResolvedValue({
    _id: "SCO",
    independenceDesire: { value: opts.desire, trend: 0 },
  });
  db.collection("governorOfficeState").findOne.mockResolvedValue({
    countryId: "UK",
    stateId: "SCO",
    gubernatorialActions: opts.ap,
  });
}

describe("requestReferendum", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("creates a requested independence referendum and decrements AP when eligible", async () => {
    seed(db, { desire: 70, ap: 5 });
    const r = await requestReferendum(db as unknown as Db, { countryId: "UK", stateId: "SCO" });
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe("independence");
    expect(recordWireEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "requested" })
    );

    const insertArg = db.collectionMocks["referendums"].insertOne.mock.calls[0][0];
    expect(insertArg.status).toBe("requested");
    expect(insertArg.kind).toBe("independence");
    expect(insertArg.targetCountryId).toBeNull();
    expect(insertArg.regionId).toBe("SCO");
    expect(insertArg.yesShare).toBe(70);
    expect(insertArg.campaignBaseYesShare).toBe(70);

    const incArg = db.collectionMocks["governorOfficeState"].updateOne.mock.calls.at(-1)![1];
    expect(incArg.$inc.gubernatorialActions).toBe(-REQUEST_AP_COST);
  });

  it("sets kind=reunification, targetCountryId=IE for NIR", async () => {
    db.collectionMocks["referendums"] = db.collection("referendums");
    db.collectionMocks["referendums"].findOne.mockResolvedValue(null);
    db.collectionMocks["referendums"].find.mockReturnValue(cursorOf([]));
    db.collection("macroMetrics").findOne.mockResolvedValue({
      _id: "NIR",
      independenceDesire: { value: 80, trend: 0 },
    });
    db.collection("governorOfficeState").findOne.mockResolvedValue({
      countryId: "UK",
      stateId: "NIR",
      gubernatorialActions: 5,
    });

    const r = await requestReferendum(db as unknown as Db, { countryId: "UK", stateId: "NIR" });
    expect(r.status).toBe(200);
    const insertArg = db.collectionMocks["referendums"].insertOne.mock.calls[0][0];
    expect(insertArg.kind).toBe("reunification");
    expect(insertArg.targetCountryId).toBe("IE");
  });

  it("rejects non-UK country", async () => {
    const r = await requestReferendum(db as unknown as Db, { countryId: "US", stateId: "SCO" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/UK-only/);
  });

  it("rejects a non-devolution region", async () => {
    const r = await requestReferendum(db as unknown as Db, { countryId: "UK", stateId: "LON" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/cannot hold/i);
  });

  it("rejects below the desire threshold", async () => {
    seed(db, { desire: 40, ap: 5 });
    const r = await requestReferendum(db as unknown as Db, { countryId: "UK", stateId: "SCO" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/desire/i);
  });

  it("rejects a second active referendum for the same region", async () => {
    seed(db, { desire: 70, ap: 5 });
    db.collectionMocks["referendums"].findOne.mockResolvedValue({
      regionId: "SCO",
      status: "granted",
    });
    const r = await requestReferendum(db as unknown as Db, { countryId: "UK", stateId: "SCO" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/in progress/i);
  });

  it("rejects while in cooldown from a prior terminal referendum", async () => {
    seed(db, { desire: 70, ap: 5 });
    db.collectionMocks["referendums"].find.mockReturnValue(
      cursorOf([{ regionId: "SCO", status: "settled", cooldownReadyAtTurn: 500 }])
    );
    const r = await requestReferendum(db as unknown as Db, { countryId: "UK", stateId: "SCO" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/cooldown/i);
  });

  it("rejects insufficient AP", async () => {
    seed(db, { desire: 70, ap: 1 });
    const r = await requestReferendum(db as unknown as Db, { countryId: "UK", stateId: "SCO" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/action point/i);
  });

  it("rejects when the office-state row is missing", async () => {
    seed(db, { desire: 70, ap: 5 });
    db.collection("governorOfficeState").findOne.mockResolvedValue(null);
    const r = await requestReferendum(db as unknown as Db, { countryId: "UK", stateId: "SCO" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Office state row missing/);
  });

  it("adminOverride bypasses desire + AP gates", async () => {
    seed(db, { desire: 10, ap: 0 });
    const r = await requestReferendum(db as unknown as Db, {
      countryId: "UK",
      stateId: "SCO",
      adminOverride: true,
    });
    expect(r.status).toBe(200);
    // AP not decremented on override.
    expect(
      db.collectionMocks["governorOfficeState"].updateOne.mock.calls.every(
        (call) => call[1].$inc?.gubernatorialActions == null
      )
    ).toBe(true);
  });
  it("does not create a referendum when the conditional AP debit fails", async () => {
    seed(db, { desire: 70, ap: 5 });
    db.collection("governorOfficeState")
      .updateOne.mockResolvedValueOnce({ modifiedCount: 1 })
      .mockResolvedValueOnce({ modifiedCount: 0 });
    const result = await requestReferendum(db as unknown as Db, {
      countryId: "UK",
      stateId: "SCO",
    });
    expect(result.status).toBe(400);
    expect(db.collection("referendums").insertOne).not.toHaveBeenCalled();
  });
  it("never lets an admin create a second active referendum", async () => {
    seed(db, { desire: 70, ap: 5 });
    db.collection("referendums").findOne.mockResolvedValue({ status: "campaigning" });
    const result = await requestReferendum(db as unknown as Db, {
      countryId: "UK",
      stateId: "SCO",
      adminOverride: true,
    });
    expect(result.status).toBe(400);
    expect(db.collection("referendums").insertOne).not.toHaveBeenCalled();
  });
});

it("reads constitutional cooldowns independently of later peace ballots", async () => {
  const db = createMockDb();
  seed(db, { desire: 70, ap: 5 });
  db.collectionMocks.referendums.find.mockReturnValue(cursorOf([{ cooldownReadyAtTurn: 580 }]));
  const result = await requestReferendum(db as unknown as Db, { countryId: "UK", stateId: "SCO" });
  expect(result.status).toBe(400);
  expect(db.collectionMocks.referendums.find).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: { $in: ["independence", "reunification"] },
    })
  );
  expect(db.collectionMocks.referendums.insertOne).not.toHaveBeenCalled();
});
