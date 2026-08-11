import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { spendGroundGame } from "./groundGame";

vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(140) }));

const psMock = vi.fn();
vi.mock("@/lib/parties/commands/spendPoliticalStrength", () => ({
  spendPoliticalStrength: (...args: unknown[]) => psMock(...args),
}));

vi.mock("@/lib/referendum/wire", () => ({ recordWireEvent: vi.fn().mockResolvedValue(undefined) }));
import { recordWireEvent } from "@/lib/referendum/wire";

const REF_ID = "507f1f77bcf86cd799439011";
const CHAR = new ObjectId();

const cohortBaseline = [
  { groupId: "a", share: 0.5, turnout: 60, yesLean: 70 },
  { groupId: "b", share: 0.5, turnout: 60, yesLean: 30 },
];

function setRef(db: MockDb, over: Record<string, unknown> = {}) {
  db.collectionMocks["referendums"] = db.collection("referendums");
  db.collectionMocks["referendums"].findOne.mockResolvedValue({
    _id: REF_ID,
    countryId: "UK",
    regionId: "NIR",
    status: "campaigning",
    yesShare: 50,
    campaignBaseYesShare: 50,
    campaignSpendUnits: { yes: 0, no: 0 },
    cohortBaseline,
    cohortModifiers: [],
    groundGameUnits: [],
    ...over,
  });
}
function lastSet(db: MockDb) {
  const calls = db.collectionMocks["referendums"].updateOne.mock.calls;
  return calls[calls.length - 1][1].$set;
}

const official = {
  referendumId: REF_ID,
  side: "yes" as const,
  presetId: "mass_rally",
  target: "whole" as const,
  mode: "official" as const,
  characterId: CHAR,
  partyId: "8",
  countryId: "UK" as const,
  actorName: "SF",
};

describe("spendGroundGame", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    psMock.mockResolvedValue({ ok: true, effectiveCost: 12 });
  });

  it("400s an unknown preset", async () => {
    setRef(db);
    const r = await spendGroundGame(db as unknown as Db, { ...official, presetId: "nope" });
    expect(r.status).toBe(400);
  });

  it("404s a missing referendum", async () => {
    db.collection("referendums").findOne.mockResolvedValue(null);
    const r = await spendGroundGame(db as unknown as Db, official);
    expect(r.status).toBe(404);
  });

  it("400s off-campaign", async () => {
    setRef(db, { status: "polling" });
    const r = await spendGroundGame(db as unknown as Db, official);
    expect(r.status).toBe(400);
  });

  it("400s an unknown target cohort", async () => {
    setRef(db);
    const r = await spendGroundGame(db as unknown as Db, {
      ...official,
      target: { groupId: "zzz" },
    });
    expect(r.status).toBe(400);
  });

  it("whole-electorate mobilize turns out aligned cohorts only (Yes raises Yes-leaners)", async () => {
    setRef(db);
    const r = await spendGroundGame(db as unknown as Db, official); // mass_rally, side yes, whole
    expect(r.status).toBe(200);
    const mods = lastSet(db).cohortModifiers;
    // a leans Yes (70) → turned out; b leans No (30) → not turned out for a Yes mobilize
    expect(
      mods.find((m: { groupId: string; turnoutMod: number }) => m.groupId === "a").turnoutMod
    ).toBeGreaterThan(0);
    expect(
      mods.find((m: { groupId: string; turnoutMod: number }) => m.groupId === "b").turnoutMod
    ).toBe(0);
  });

  it("a tapped cohort persuade shifts only that cohort's lean", async () => {
    setRef(db);
    const r = await spendGroundGame(db as unknown as Db, {
      ...official,
      presetId: "broadcast_ads",
      side: "no",
      target: { groupId: "a" },
    });
    expect(r.status).toBe(200);
    const mods = lastSet(db).cohortModifiers;
    expect(mods.find((m: { groupId: string }) => m.groupId === "a").leanMod).toBeLessThan(0);
    expect(mods.find((m: { groupId: string }) => m.groupId === "b")).toBeUndefined();
  });

  it("official mode debits PS; a failed PS spend → 400 and no write", async () => {
    setRef(db);
    psMock.mockResolvedValue({ ok: false, reason: "insufficient" });
    const r = await spendGroundGame(db as unknown as Db, official);
    expect(r.status).toBe(400);
    expect(db.collectionMocks["referendums"].updateOne).not.toHaveBeenCalled();
  });

  it("volunteer mode atomically debits the preset's actions + funds; insufficient → 400", async () => {
    setRef(db);
    db.collection("characters").updateOne.mockResolvedValue({ modifiedCount: 0 });
    const r = await spendGroundGame(db as unknown as Db, {
      ...official,
      mode: "volunteer",
      partyId: undefined,
    });
    expect(r.status).toBe(400);
    expect(db.collectionMocks["referendums"].updateOne).not.toHaveBeenCalled();
  });

  it("records a 'ground' wire event with a numeric delta naming the preset", async () => {
    setRef(db);
    const r = await spendGroundGame(db as unknown as Db, official);
    expect(r.status).toBe(200);
    expect(recordWireEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: "ground",
        delta: expect.any(Number),
        summary: expect.stringContaining("Mass rally"),
      })
    );
  });
});
