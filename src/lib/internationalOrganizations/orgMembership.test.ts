import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/countryAccess", () => ({ getAllCountryAccess: vi.fn() }));

const { getAllCountryAccess } = await import("@/lib/countryAccess");

describe("org membership", () => {
  let db: MockDb;

  const members = (ids: string[]) =>
    db.collection("organizationMemberships").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(ids.map((countryId) => ({ countryId }))),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    // US enabled; TR a real country an admin has NOT enabled; JO macro-tier and
    // absent from the access table entirely.
    vi.mocked(getAllCountryAccess).mockResolvedValue({
      US: { enabledForPlayers: true },
      TR: { enabledForPlayers: false },
    } as never);
  });

  it("lets only player-enabled countries vote", async () => {
    members(["US", "TR", "JO"]);
    const { votingMembers } = await import("./orgMembership");
    expect(await votingMembers(db as unknown as Db, "NATO")).toEqual(["US"]);
  });

  it("treats an entity absent from the access table as not enabled", async () => {
    // Macro entities never appear there; fail-closed keeps them silent without
    // needing a special case anywhere.
    members(["JO"]);
    const { votingMembers } = await import("./orgMembership");
    expect(await votingMembers(db as unknown as Db, "NATO")).toEqual([]);
  });

  it("bills everyone who cannot vote", async () => {
    members(["US", "TR", "JO"]);
    const { tributeMembers } = await import("./orgMembership");
    expect(await tributeMembers(db as unknown as Db, "NATO")).toEqual(["TR", "JO"]);
  });

  it("splits the roll with no member counted twice or lost", async () => {
    // This is the invariant that stops anyone being billed both dues and
    // tribute, or neither.
    const roll = ["US", "TR", "JO"];
    members(roll);
    const { votingMembers, tributeMembers } = await import("./orgMembership");
    const voters = await votingMembers(db as unknown as Db, "NATO");
    const payers = await tributeMembers(db as unknown as Db, "NATO");
    expect([...voters, ...payers].sort()).toEqual([...roll].sort());
  });

  it("returns nothing for an organisation with no members", async () => {
    members([]);
    const { votingMembers, tributeMembers } = await import("./orgMembership");
    expect(await votingMembers(db as unknown as Db, "NATO")).toEqual([]);
    expect(await tributeMembers(db as unknown as Db, "NATO")).toEqual([]);
  });

  describe("isVotingMember", () => {
    const membershipRow = (row: unknown) =>
      db.collection("organizationMemberships").findOne.mockResolvedValue(row);

    it("admits a ballot from a player-enabled member", async () => {
      membershipRow({ organizationId: "NATO", countryId: "US" });
      const { isVotingMember } = await import("./orgMembership");
      expect(await isVotingMember(db as unknown as Db, "NATO", "US")).toBe(true);
    });

    it("refuses a ballot from a member that is not player-enabled", async () => {
      // The row exists — TR really is a member — but membership alone no longer
      // carries a vote, and refusing here is what stops the resolver silently
      // discarding a ballot the player was told had been recorded.
      membershipRow({ organizationId: "NATO", countryId: "TR" });
      const { isVotingMember } = await import("./orgMembership");
      expect(await isVotingMember(db as unknown as Db, "NATO", "TR")).toBe(false);
    });

    it("refuses a ballot from a non-member", async () => {
      membershipRow(null);
      const { isVotingMember } = await import("./orgMembership");
      expect(await isVotingMember(db as unknown as Db, "NATO", "US")).toBe(false);
    });
  });
});
