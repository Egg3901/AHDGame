import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/headOfGovernment", () => ({ getHeadOfGovernmentCharacterId: vi.fn() }));

const { getHeadOfGovernmentCharacterId } = await import("@/lib/api/headOfGovernment");

describe("permanent leadership derivation in loadOrganizationSummaries", () => {
  let db: MockDb;
  const hogId = new ObjectId();

  function membershipRows(rows: { organizationId: string; countryId: string }[]) {
    db.collection("organizationMemberships").find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue(rows.map((r) => ({ ...r, status: "founding", joinedTurn: 0 }))),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    db.collection("gameState").findOne.mockResolvedValue({
      currentYear: 2019,
      preset: "2019-default",
    });
    db.collection("characters").findOne.mockResolvedValue({ _id: hogId, name: "PM Example" });
  });

  it("derives the Commonwealth holder from the UK head of government", async () => {
    membershipRows([
      { organizationId: "COMMONWEALTH", countryId: "UK" },
      { organizationId: "COMMONWEALTH", countryId: "NG" },
    ]);
    vi.mocked(getHeadOfGovernmentCharacterId).mockResolvedValue(hogId);

    const { loadOrganizationSummaries } = await import("./service");
    const summaries = await loadOrganizationSummaries(db as unknown as Db);
    const cw = summaries.find((s) => s.id === "COMMONWEALTH");
    expect(cw?.leadership?.holderCharacterName).toBe("PM Example");
    expect(cw?.leadership?.holderCountryId).toBe("UK");
  });

  it("renders vacant when the leader country is not a member", async () => {
    membershipRows([{ organizationId: "COMMONWEALTH", countryId: "NG" }]);
    vi.mocked(getHeadOfGovernmentCharacterId).mockResolvedValue(hogId);

    const { loadOrganizationSummaries } = await import("./service");
    const summaries = await loadOrganizationSummaries(db as unknown as Db);
    const cw = summaries.find((s) => s.id === "COMMONWEALTH");
    expect(cw?.leadership?.holderCharacterId ?? null).toBeNull();
  });

  it("renders vacant when the leader country has no sitting head of government", async () => {
    membershipRows([{ organizationId: "COMMONWEALTH", countryId: "UK" }]);
    vi.mocked(getHeadOfGovernmentCharacterId).mockResolvedValue(null);

    const { loadOrganizationSummaries } = await import("./service");
    const summaries = await loadOrganizationSummaries(db as unknown as Db);
    const cw = summaries.find((s) => s.id === "COMMONWEALTH");
    expect(cw?.leadership?.holderCharacterId ?? null).toBeNull();
  });
});

describe("loadOrganizationLeadershipCandidates — permanent orgs", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("returns an empty candidate list for a permanent-leadership org", async () => {
    const { loadOrganizationLeadershipCandidates } = await import("./queries/leadershipCandidates");
    const result = await loadOrganizationLeadershipCandidates({
      db: db as unknown as Db,
      orgId: "COMMONWEALTH",
    });
    expect(result.ok).toBe(true);
    // Match the query's success contract: the route returns `detail.body`.
    expect((result as { body: { candidates: unknown[] } }).body.candidates).toEqual([]);
  });
});
