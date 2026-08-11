import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("./transferRegion", () => ({
  transferRegion: vi.fn().mockResolvedValue({ ok: true, report: { x: 1 } }),
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

import { actuateReferendumTransfer } from "./actuateReferendum";
import { transferRegion } from "./transferRegion";

const REF_ID = "507f1f77bcf86cd799439011";

function setRef(db: MockDb, doc: unknown) {
  db.collectionMocks["referendums"] = db.collection("referendums");
  db.collectionMocks["referendums"].findOne.mockResolvedValue(doc);
}

const reunification = {
  _id: REF_ID,
  status: "actuating",
  kind: "reunification",
  regionId: "NIR",
  countryId: "UK",
  targetCountryId: "IE",
};

describe("actuateReferendumTransfer", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("resolve: transfers the region and marks the referendum completed", async () => {
    setRef(db, reunification);
    const res = await actuateReferendumTransfer(db as unknown as Db, {
      referendumId: REF_ID,
      currentTurn: 300,
      action: "resolve",
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(transferRegion).mock.calls[0][1]).toMatchObject({
      regionId: "NIR",
      fromCountryId: "UK",
      toCountryId: "IE",
      province: "Ulster",
    });
    expect(db.collectionMocks["referendums"].updateOne.mock.calls[0][1].$set.status).toBe(
      "completed"
    );
    expect(recordWireEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "reunified" })
    );
  });

  it("block: cancels the conversion without transferring, sets a cooldown", async () => {
    setRef(db, reunification);
    const res = await actuateReferendumTransfer(db as unknown as Db, {
      referendumId: REF_ID,
      currentTurn: 300,
      action: "block",
    });
    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
    expect(transferRegion).not.toHaveBeenCalled();
    const set = db.collectionMocks["referendums"].updateOne.mock.calls[0][1].$set;
    expect(set.status).toBe("cancelled");
    expect(set.cooldownReadyAtTurn).toBeGreaterThan(300);
  });

  it("rejects an action when the referendum is not in the conversion window", async () => {
    setRef(db, { ...reunification, status: "campaigning" });
    const res = await actuateReferendumTransfer(db as unknown as Db, {
      referendumId: REF_ID,
      currentTurn: 300,
      action: "resolve",
    });
    expect(res.status).toBe(400);
    expect(transferRegion).not.toHaveBeenCalled();
  });

  it("gates an independence referendum on the signed Westminster consent bill", async () => {
    setRef(db, {
      _id: REF_ID,
      status: "actuating",
      kind: "independence",
      regionId: "SCO",
      countryId: "UK",
      targetCountryId: null,
      // no westminsterBillId / unsigned → secession must not run
    });
    const res = await actuateReferendumTransfer(db as unknown as Db, {
      referendumId: REF_ID,
      currentTurn: 300,
      action: "resolve",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not signed/i);
    expect(transferRegion).not.toHaveBeenCalled();
  });

  it("returns 404 when the referendum is missing", async () => {
    setRef(db, null);
    const res = await actuateReferendumTransfer(db as unknown as Db, {
      referendumId: REF_ID,
      currentTurn: 300,
      action: "resolve",
    });
    expect(res.status).toBe(404);
  });

  it("completes idempotently when the region was already transferred", async () => {
    vi.mocked(transferRegion).mockResolvedValueOnce({ ok: true, skipped: "already-transferred" });
    setRef(db, reunification);
    const res = await actuateReferendumTransfer(db as unknown as Db, {
      referendumId: REF_ID,
      currentTurn: 300,
      action: "resolve",
    });
    expect(res.status).toBe(200);
    expect(db.collectionMocks["referendums"].updateOne.mock.calls[0][1].$set.status).toBe(
      "completed"
    );
  });
});
