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

  it("founds the EU in a 1979 game once the live year reaches 1993", async () => {
    gameState({ currentYear: 1993, preset: "1979-default" });
    const { foundDueOrganizations } = await import("./internationalOrganizationsPhase");
    const founded = await foundDueOrganizations(db as unknown as Db, 700);

    expect(founded).toBe(1);
    const leadershipInserts = db.collectionMocks.organizationLeadership!.insertOne.mock.calls.map(
      (c) => c[0] as { organizationId: string; holderCharacterId: unknown }
    );
    expect(leadershipInserts).toEqual([
      expect.objectContaining({ organizationId: "EU", holderCharacterId: null }),
    ]);
    // No memberships were created — orgs found EMPTY.
    expect(db.collectionMocks.organizationMemberships?.insertOne).toBeUndefined();
    // Broadcast: one countryHistory event per player-enabled country.
    expect(db.collectionMocks.countryHistory!.insertOne).toHaveBeenCalledTimes(2);
  });

  it("does nothing before the founding year", async () => {
    gameState({ currentYear: 1992, preset: "1979-default" });
    const { foundDueOrganizations } = await import("./internationalOrganizationsPhase");
    expect(await foundDueOrganizations(db as unknown as Db, 650)).toBe(0);
    expect(db.collectionMocks.organizationLeadership!.insertOne).not.toHaveBeenCalled();
  });

  it("is idempotent — an existing leadership row means already founded", async () => {
    gameState({ currentYear: 1994, preset: "1979-default" });
    db.collection("organizationLeadership").findOne.mockResolvedValue({ organizationId: "EU" });
    const { foundDueOrganizations } = await import("./internationalOrganizationsPhase");
    expect(await foundDueOrganizations(db as unknown as Db, 750)).toBe(0);
    expect(db.collectionMocks.organizationLeadership!.insertOne).not.toHaveBeenCalled();
  });

  it("never auto-founds a dissolved org (1991 game reaching 2000)", async () => {
    gameState({ currentYear: 2000, preset: "1991-default" });
    const { foundDueOrganizations } = await import("./internationalOrganizationsPhase");
    // EU founds (1993 ≤ 2000); WARSAW_PACT must not — its window closed in
    // 1991 (and its foundedYear predates the preset start anyway).
    const founded = await foundDueOrganizations(db as unknown as Db, 500);
    expect(founded).toBe(1);
    const rows = db.collectionMocks.organizationLeadership!.insertOne.mock.calls.map(
      (c) => c[0] as { organizationId: string }
    );
    expect(rows.some((r) => r.organizationId === "WARSAW_PACT")).toBe(false);
    expect(rows.some((r) => r.organizationId === "COMMONWEALTH")).toBe(false); // seeded at reset
  });

  it("skips orgs the reset already seeded (2019 preset) and legacy gameState", async () => {
    const { foundDueOrganizations } = await import("./internationalOrganizationsPhase");
    gameState({ currentYear: 2019, preset: "2019-default" });
    expect(await foundDueOrganizations(db as unknown as Db, 10)).toBe(0);
    gameState(null);
    expect(await foundDueOrganizations(db as unknown as Db, 10)).toBe(0);
    expect(db.collectionMocks.organizationLeadership!.insertOne).not.toHaveBeenCalled();
  });

  it("founds the Non-Aligned Movement in a 1953 game once the live year reaches 1961", async () => {
    gameState({ currentYear: 1961, preset: "1953-default" });
    const { foundDueOrganizations } = await import("./internationalOrganizationsPhase");
    const founded = await foundDueOrganizations(db as unknown as Db, 400);

    expect(founded).toBe(1);
    const leadershipInserts = db.collectionMocks.organizationLeadership!.insertOne.mock.calls.map(
      (c) => c[0] as { organizationId: string; holderCharacterId: unknown }
    );
    expect(leadershipInserts).toEqual([
      expect.objectContaining({ organizationId: "NON_ALIGNED", holderCharacterId: null }),
    ]);
    // Founds EMPTY — membership is never automatic.
    expect(db.collectionMocks.organizationMemberships?.insertOne).toBeUndefined();
  });

  it("does not auto-found the Non-Aligned Movement in a 1979 game — it was seeded at reset", async () => {
    gameState({ currentYear: 1985, preset: "1979-default" });
    const { foundDueOrganizations } = await import("./internationalOrganizationsPhase");
    expect(await foundDueOrganizations(db as unknown as Db, 700)).toBe(0);
  });
});
