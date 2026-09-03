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

  it("keeps a member with no NPP government off the majority roll too", async () => {
    // Nothing has said TR is NPP-run, and the rollout is not active, so the two
    // rolls coincide: a plain unenabled member is silent on every ballot.
    const members = await nato();
    expect(members.get("TR")?.hasPolicyVote).toBe(false);
    expect(members.get("UK")?.hasPolicyVote).toBe(true);
  });

  it("seats an NPP-governed member on the wider roll but not on an admission", async () => {
    // Ticket #1257. TR is not player-enabled, so it never holds a ballot on an
    // admission — a silence there is a veto and an NPP government plans once
    // every six turns. It DOES hold one on ordinary majority business, where a
    // silence merely costs a yes. The panels render whichever flag matches the
    // ballot, which is how they stay in step with the resolver.
    db.collection("gameState").findOne.mockResolvedValue({
      currentYear: 1980,
      preset: "1979-default",
      nppForeignPolicyMode: "active",
    });
    db.collection("governmentFormations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "TR", countryId: "TR" }]),
      project: vi.fn().mockReturnThis(),
    });

    const members = await nato();
    expect(members.get("TR")?.hasVote).toBe(false);
    expect(members.get("TR")?.hasPolicyVote).toBe(true);
    // JO is macro-tier: no config, no legislature, no ballot of either kind.
    expect(members.get("JO")?.hasPolicyVote).toBe(false);
  });

  it("keeps the majority roll narrow while the rollout is not active", async () => {
    // Shadow and off preserve the player-only baseline for every ballot. TR has
    // a formed NPP government here and still holds no vote of either kind,
    // because the widening is a property of the ACTIVE rollout, not of the
    // government — get this wrong and a shadow world silently resolves ballots
    // against a roll the panels never show.
    db.collection("gameState").findOne.mockResolvedValue({
      currentYear: 1980,
      preset: "1979-default",
      nppForeignPolicyMode: "shadow",
    });
    db.collection("governmentFormations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "TR", countryId: "TR" }]),
    });

    const members = await nato();
    expect(members.get("TR")?.hasVote).toBe(false);
    expect(members.get("TR")?.hasPolicyVote).toBe(false);
    expect(members.get("UK")?.hasPolicyVote).toBe(true);
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

  /**
   * The roster named every member from its COMPILED config, so it was the one
   * country surface that never saw a runtime event. A reunified Germany sat in
   * the Warsaw Pact still billed as "East Germany", and in a 1979 world the
   * USSR sat in it as "Russia" — its era alias was ignored too.
   */
  describe("runtime identity", () => {
    /** Seat one extra member alongside the three the suite already seats. */
    const alsoSeat = (countryId: string) =>
      db.collection("organizationMemberships").find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { organizationId: "NATO", countryId: "UK", status: "founding", joinedTurn: 0 },
          { organizationId: "NATO", countryId: "JO", status: "active", joinedTurn: 0 },
          { organizationId: "NATO", countryId, status: "active", joinedTurn: 0 },
        ]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });

    const runtimeState = (docs: object[]) => {
      db.collection("countryState").find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue(docs),
        project: vi.fn().mockReturnThis(),
      });
      db.collection("countryState").findOne.mockImplementation(async (q: { _id: string }) =>
        docs.find((d) => (d as { _id: string })._id === q._id)
      );
    };

    it("names a member by its runtime rename rather than its compiled config", async () => {
      alsoSeat("DD");
      runtimeState([
        {
          _id: "DD",
          countryId: "DD",
          governmentType: "onePartyState",
          displayNameOverride: "Germany",
        },
      ]);
      const members = await nato();
      expect(members.get("DD")?.countryName).toBe("Germany");
    });

    it("shows the flag a runtime event put on a country, not its compiled one", async () => {
      alsoSeat("DD");
      runtimeState([
        {
          _id: "DD",
          countryId: "DD",
          governmentType: "onePartyState",
          displayNameOverride: "Germany",
          flagEmojiOverride: "🇩🇪",
        },
      ]);
      const members = await nato();
      expect(members.get("DD")?.flagEmoji).toBe("🇩🇪");
    });

    it("honours the era alias for a country nothing has renamed", async () => {
      // The 1979 preset calls RU "Soviet Union". Reading the compiled config
      // alone printed "Russia" into a Cold War bloc roster.
      alsoSeat("RU");
      runtimeState([]);
      const members = await nato();
      expect(members.get("RU")?.countryName).toBe("Soviet Union");
    });

    it("keeps the compiled name when no runtime event has touched the country", async () => {
      alsoSeat("DD");
      runtimeState([]);
      const members = await nato();
      expect(members.get("DD")?.countryName).toBe("East Germany");
    });

    it("still names and flags an entity that has no country config at all", async () => {
      // Jordan is roster-only: it has no CountryConfig and no countryState row,
      // so the identity resolver cannot answer for it and the roster fallback
      // has to. Wiring the resolver in must not blank these out.
      alsoSeat("DD");
      runtimeState([]);
      const members = await nato();
      expect(members.get("JO")?.countryName).toBe("Jordan");
      expect(members.get("JO")?.flagEmoji).toBe("🇯🇴");
    });
  });
});
