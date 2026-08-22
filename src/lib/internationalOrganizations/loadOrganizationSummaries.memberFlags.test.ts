import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

/**
 * Membership is entity-wide, so a member row alone says nothing about whether
 * that member votes or has a treasury. The summary has to answer both, because
 * the vote rosters and the aid recipient list are built from it — and getting
 * either wrong is silent: a roster that awaits a ballot nobody can cast, or a
 * payment offered to an entity with nowhere to receive it.
 */
describe("loadOrganizationSummaries — member vote and country flags", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    db.collection("gameState").findOne.mockResolvedValue({
      currentYear: 1980,
      preset: "1979-default",
    });
    db.collection("organizationMemberships").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { organizationId: "NATO", countryId: "UK", status: "founding", joinedTurn: 0 },
        { organizationId: "NATO", countryId: "TR", status: "active", joinedTurn: 0 },
        { organizationId: "NATO", countryId: "JO", status: "active", joinedTurn: 0 },
      ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    // UK is player-enabled; TR is a modelled country an admin has not enabled.
    // JO is macro-tier and absent from the table entirely.
    db.collection("countryGameStates").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "UK", enabledForPlayers: true },
        { _id: "TR", enabledForPlayers: false },
      ]),
    });
  });

  const nato = async () => {
    const { loadOrganizationSummaries } = await import("./service");
    const summaries = await loadOrganizationSummaries(db as unknown as Db);
    const org = summaries.find((s) => s.id === "NATO")!;
    return new Map(org.members.map((m) => [m.countryId, m]));
  };

  it("marks only the player-enabled member as a voter", async () => {
    const members = await nato();
    expect(members.get("UK")?.hasVote).toBe(true);
    expect(members.get("TR")?.hasVote).toBe(false);
    expect(members.get("JO")?.hasVote).toBe(false);
  });

  it("marks modelled countries apart from macro-tier entities", async () => {
    // TR cannot vote but does have a treasury, so it can still receive aid —
    // the two flags are genuinely independent and neither implies the other.
    const members = await nato();
    expect(members.get("TR")?.isCountry).toBe(true);
    expect(members.get("JO")?.isCountry).toBe(false);
  });

  it("still lists every member, whatever its flags", async () => {
    const members = await nato();
    expect([...members.keys()].sort()).toEqual(["JO", "TR", "UK"]);
  });

  it("gives roster entities a real flag rather than the white placeholder", async () => {
    const members = await nato();
    expect(members.get("UK")?.flagEmoji).toBe("🇬🇧");
    expect(members.get("TR")?.flagEmoji).toBe("🇹🇷");
    expect(members.get("JO")?.flagEmoji).toBe("🇯🇴");
  });
});
