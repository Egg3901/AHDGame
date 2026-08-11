import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("commitInfluencePlay", () => {
  let db: MockDb;

  const base = {
    organizationId: "NATO" as const,
    sponsorCountryId: "US" as const,
    targetEntityId: "YU",
    amountLocal: 900_000_000,
    turn: 10,
    year: 1953,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 1953,
      intOrgAlignmentEnabled: true,
    });
    // Yugoslavia: contested, well below the locked gate.
    db.collection("countryAlignments").findOne.mockResolvedValue({
      entityId: "YU",
      shares: { WEST: 22, EAST: 50 },
      nonAligned: 28,
    });
    db.collection("organizationFunds").updateOne.mockResolvedValue({ modifiedCount: 1 });
    // Influence is priced against the target's economy, so YU needs one. It is
    // macro-tier, hence sector capacity rather than regional GDP: 125 a turn
    // annualises to 6,000 USD millions, i.e. a $6bn economy.
    db.collection("states").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collection("macroCountries").find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { entityId: "YU", sectors: { agriculture: { capacity: 75 }, retail: { capacity: 50 } } },
        ]),
    });
  });

  it("refuses a target whose economy is not on record rather than pricing it free", async () => {
    db.collection("macroCountries").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    const { commitInfluencePlay } = await import("./commitInfluencePlay");
    const r = await commitInfluencePlay({ db: db as unknown as Db, ...base });

    expect(r).toEqual({ ok: false, reason: "unknown-target-economy" });
    // Refused before any money moves — the fund is untouched.
    expect(db.collection("organizationFunds").updateOne).not.toHaveBeenCalled();
    expect(db.collection("alignmentPlays").insertOne).not.toHaveBeenCalled();
  });

  it("debits the fund and queues the play", async () => {
    const { commitInfluencePlay } = await import("./commitInfluencePlay");
    const r = await commitInfluencePlay({ db: db as unknown as Db, ...base });

    expect(r.ok).toBe(true);
    const doc = db.collection("alignmentPlays").insertOne.mock.calls[0]![0] as {
      resolvedTurn: unknown;
      appliedPoints: unknown;
      targetEntityId: string;
      organizationId: string;
      amountUsd: number;
    };
    expect(doc.resolvedTurn).toBeNull();
    expect(doc.appliedPoints).toBeNull();
    expect(doc.targetEntityId).toBe("YU");
    expect(doc.organizationId).toBe("NATO");
    expect(doc.amountUsd).toBeGreaterThan(0);
  });

  it("refuses a locked target instead of taking the money for nothing", async () => {
    db.collection("countryAlignments").findOne.mockResolvedValue({
      entityId: "PL",
      shares: { WEST: 2, EAST: 90 }, // lead 88, past the locked gate
      nonAligned: 8,
    });
    const { commitInfluencePlay } = await import("./commitInfluencePlay");
    const r = await commitInfluencePlay({ db: db as unknown as Db, ...base, targetEntityId: "PL" });

    expect(r).toEqual({ ok: false, reason: "target-locked" });
    expect(db.collection("organizationFunds").updateOne).not.toHaveBeenCalled();
    expect(db.collection("alignmentPlays").insertOne).not.toHaveBeenCalled();
  });

  it("refuses when the gate is off", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 1953,
      intOrgAlignmentEnabled: false,
    });
    const { commitInfluencePlay } = await import("./commitInfluencePlay");
    const r = await commitInfluencePlay({ db: db as unknown as Db, ...base });

    expect(r).toEqual({ ok: false, reason: "gate-off" });
    expect(db.collection("organizationFunds").updateOne).not.toHaveBeenCalled();
  });

  it("refuses an org with no channel in this era", async () => {
    const { commitInfluencePlay } = await import("./commitInfluencePlay");
    // The EU carries influence only from 1991; it has no 1953 channel.
    const r = await commitInfluencePlay({
      db: db as unknown as Db,
      ...base,
      organizationId: "EU" as never,
    });

    expect(r).toEqual({ ok: false, reason: "no-channel" });
    expect(db.collection("organizationFunds").updateOne).not.toHaveBeenCalled();
  });

  it("refuses an unknown target", async () => {
    db.collection("countryAlignments").findOne.mockResolvedValue(null);
    const { commitInfluencePlay } = await import("./commitInfluencePlay");
    const r = await commitInfluencePlay({ db: db as unknown as Db, ...base });

    expect(r).toEqual({ ok: false, reason: "unknown-target" });
    expect(db.collection("organizationFunds").updateOne).not.toHaveBeenCalled();
  });

  it("reports insufficient funds from the atomic debit rather than pre-reading", async () => {
    // disburseFromOrganizationFund guards with balanceLocal: { $gte: amount },
    // so a short fund shows up as modifiedCount 0 — never as a stale read.
    db.collection("organizationFunds").updateOne.mockResolvedValue({ modifiedCount: 0 });
    const { commitInfluencePlay } = await import("./commitInfluencePlay");
    const r = await commitInfluencePlay({ db: db as unknown as Db, ...base });

    expect(r).toEqual({ ok: false, reason: "insufficient-funds" });
    expect(db.collection("alignmentPlays").insertOne).not.toHaveBeenCalled();
  });

  it("refuses a non-positive amount without touching the fund", async () => {
    const { commitInfluencePlay } = await import("./commitInfluencePlay");
    const r = await commitInfluencePlay({ db: db as unknown as Db, ...base, amountLocal: 0 });

    expect(r).toEqual({ ok: false, reason: "insufficient-funds" });
    expect(db.collection("organizationFunds").updateOne).not.toHaveBeenCalled();
  });
});
