import { foundDueOrganizations } from "./internationalOrganizationsPhase";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("foundDueOrganizations", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    db.collection("organizationLeadership").findOne.mockResolvedValue(null);
    // Two player-enabled countries receive the founding broadcast.
    db.collection("countryGameStates").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ _id: "US" }, { _id: "UK" }]),
    });
  });

  function gameState(gs: object | null) {
    db.collection("gameState").findOne.mockResolvedValue(gs);
  }

  it("does not enact Maastricht merely because a Community world reaches 1993", async () => {
    gameState({ currentYear: 1993, currentTurn: 700, preset: "1979-default" });
    expect(await foundDueOrganizations(db as unknown as Db, 700)).toBe(0);
    expect(db.collectionMocks.organizationLeadership!.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.countryHistory?.insertOne).toBeUndefined();
  });

  it("does nothing before the founding year", async () => {
    gameState({ currentYear: 1992, preset: "1979-default" });
    expect(await foundDueOrganizations(db as unknown as Db, 650)).toBe(0);
    expect(db.collectionMocks.organizationLeadership!.insertOne).not.toHaveBeenCalled();
  });

  it("is idempotent — an existing leadership row means already founded", async () => {
    gameState({ currentYear: 1994, preset: "1979-default" });
    db.collection("organizationLeadership").findOne.mockResolvedValue({ organizationId: "EU" });
    expect(await foundDueOrganizations(db as unknown as Db, 750)).toBe(0);
    expect(db.collectionMocks.organizationLeadership!.insertOne).not.toHaveBeenCalled();
  });

  it("never auto-founds a dissolved org (1991 game reaching 2000)", async () => {
    gameState({ currentYear: 2000, preset: "1991-default" });
    // Neither the calendar nor an empty membership list ratifies Maastricht.
    const founded = await foundDueOrganizations(db as unknown as Db, 500);
    expect(founded).toBe(0);
    const rows = db.collectionMocks.organizationLeadership!.insertOne.mock.calls.map(
      (c) => c[0] as { organizationId: string }
    );
    expect(rows.some((r) => r.organizationId === "WARSAW_PACT")).toBe(false);
    expect(rows.some((r) => r.organizationId === "COMMONWEALTH")).toBe(false); // seeded at reset
  });

  it("skips orgs the reset already seeded (2019 preset) and legacy gameState", async () => {
    gameState({ currentYear: 2019, preset: "2019-default" });
    expect(await foundDueOrganizations(db as unknown as Db, 10)).toBe(0);
    gameState(null);
    expect(await foundDueOrganizations(db as unknown as Db, 10)).toBe(0);
    expect(db.collectionMocks.organizationLeadership!.insertOne).not.toHaveBeenCalled();
  });

  it("opens empty Community and Non-Aligned forums after their availability dates", async () => {
    gameState({ currentYear: 1961, preset: "1953-default" });
    const founded = await foundDueOrganizations(db as unknown as Db, 400);

    expect(founded).toBe(2);
    const leadershipInserts = db.collectionMocks.organizationLeadership!.insertOne.mock.calls.map(
      (c) => c[0] as { organizationId: string; holderCharacterId: unknown }
    );
    expect(leadershipInserts).toEqual([
      expect.objectContaining({ organizationId: "EU", holderCharacterId: null }),
      expect.objectContaining({ organizationId: "NON_ALIGNED", holderCharacterId: null }),
    ]);
    // Founds EMPTY — membership is never automatic.
    expect(db.collectionMocks.organizationMemberships.insertOne).not.toHaveBeenCalled();
  });

  it("does not auto-found the Non-Aligned Movement in a 1979 game — it was seeded at reset", async () => {
    gameState({ currentYear: 1985, preset: "1979-default" });
    expect(await foundDueOrganizations(db as unknown as Db, 700)).toBe(0);
  });
});
