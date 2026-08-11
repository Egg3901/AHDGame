import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";

// `WithPowers`, not the plain loader: the powers gate needs the world's
// EFFECTIVE category, since a 1953 NATO is a bloc rather than its security
// archetype. The plain loader deliberately skips that resolution because it runs
// inside turn-phase loops.
vi.mock("@/lib/internationalOrganizations/service", () => ({
  loadOrganizationDefWithPowers: vi.fn(),
  getMembers: vi.fn(),
  recordOrgHistoryEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(200) }));

const { loadOrganizationDefWithPowers, getMembers } =
  await import("@/lib/internationalOrganizations/service");
const { proposeOrganizationLegislation } = await import("./proposeLegislation");

function dbCapturingLegislation(): { db: Db; inserted: Record<string, unknown>[] } {
  const inserted: Record<string, unknown>[] = [];
  const db = {
    collection: () => ({
      insertOne: async (doc: Record<string, unknown>) => {
        inserted.push(doc);
        return { insertedId: doc._id };
      },
    }),
  } as unknown as Db;
  return { db, inserted };
}

const actor = { characterId: new ObjectId(), characterName: "Klaus FM" };

beforeEach(() => vi.clearAllMocks());

describe("proposeOrganizationLegislation — sanctions + category gate", () => {
  it("an economic org member can table per-commodity sanctions", async () => {
    vi.mocked(loadOrganizationDefWithPowers).mockResolvedValue({
      shortName: "EU",
      category: "economic",
    } as never);
    vi.mocked(getMembers).mockResolvedValue(["DE", "IE"]);
    const { db, inserted } = dbCapturingLegislation();

    const res = await proposeOrganizationLegislation({
      db,
      countryId: "DE",
      orgId: "EU",
      actor,
      input: { type: "sanctions", targetCountryId: "BR", commodity: "steel" },
    });

    expect(res.ok).toBe(true);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      type: "sanctions",
      sanctionsTargetCountryId: "BR",
      sanctionsCommodity: "steel",
      parties: [],
    });
  });

  it("a political org cannot table sanctions (not in its category powers)", async () => {
    vi.mocked(loadOrganizationDefWithPowers).mockResolvedValue({
      shortName: "UN",
      category: "political",
    } as never);
    vi.mocked(getMembers).mockResolvedValue(["US", "UK"]);
    const { db, inserted } = dbCapturingLegislation();

    const res = await proposeOrganizationLegislation({
      db,
      countryId: "US",
      orgId: "UN",
      actor,
      input: { type: "sanctions", targetCountryId: "BR", commodity: "steel" },
    });

    expect(res.ok).toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it("tables an aid package between two members", async () => {
    vi.mocked(loadOrganizationDefWithPowers).mockResolvedValue({
      shortName: "EU",
      category: "economic",
    } as never);
    vi.mocked(getMembers).mockResolvedValue(["DE", "IE"]);
    const { db, inserted } = dbCapturingLegislation();

    const res = await proposeOrganizationLegislation({
      db,
      countryId: "DE",
      orgId: "EU",
      actor,
      input: {
        type: "aid_package",
        recipientCountryId: "IE",
        amount: 5_000_000,
      },
    });

    expect(res.ok).toBe(true);
    expect(inserted[0]).toMatchObject({
      type: "aid_package",
      aidRecipientCountryId: "IE",
      aidAmount: 5_000_000,
    });
  });

  it("rejects aid to a non-member recipient", async () => {
    vi.mocked(loadOrganizationDefWithPowers).mockResolvedValue({
      shortName: "EU",
      category: "economic",
    } as never);
    vi.mocked(getMembers).mockResolvedValue(["DE", "IE"]);
    const { db, inserted } = dbCapturingLegislation();

    const res = await proposeOrganizationLegislation({
      db,
      countryId: "DE",
      orgId: "EU",
      actor,
      input: {
        type: "aid_package",
        recipientCountryId: "BR",
        amount: 5_000_000,
      },
    });

    expect(res.ok).toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it("an economic org member can table a catalog directive", async () => {
    vi.mocked(loadOrganizationDefWithPowers).mockResolvedValue({
      shortName: "EU",
      category: "economic",
    } as never);
    vi.mocked(getMembers).mockResolvedValue(["DE", "IE"]);
    const { db, inserted } = dbCapturingLegislation();

    const res = await proposeOrganizationLegislation({
      db,
      countryId: "DE",
      orgId: "EU",
      actor,
      input: { type: "directive", directiveKey: "productivity_compact" },
    });

    expect(res.ok).toBe(true);
    expect(inserted[0]).toMatchObject({
      type: "directive",
      directiveKey: "productivity_compact",
      parties: [],
    });
  });

  it("rejects an unknown directive key", async () => {
    vi.mocked(loadOrganizationDefWithPowers).mockResolvedValue({
      shortName: "EU",
      category: "economic",
    } as never);
    vi.mocked(getMembers).mockResolvedValue(["DE", "IE"]);
    const { db, inserted } = dbCapturingLegislation();

    const res = await proposeOrganizationLegislation({
      db,
      countryId: "DE",
      orgId: "EU",
      actor,
      input: { type: "directive", directiveKey: "totally_made_up" },
    });

    expect(res.ok).toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it("a development org cannot table a directive (not in its powers)", async () => {
    vi.mocked(loadOrganizationDefWithPowers).mockResolvedValue({
      shortName: "WB",
      category: "development",
    } as never);
    vi.mocked(getMembers).mockResolvedValue(["DE", "IE"]);
    const { db, inserted } = dbCapturingLegislation();

    const res = await proposeOrganizationLegislation({
      db,
      countryId: "DE",
      orgId: "WB",
      actor,
      input: { type: "directive", directiveKey: "productivity_compact" },
    });

    expect(res.ok).toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it("a political org member can table a joint statement about any country", async () => {
    vi.mocked(loadOrganizationDefWithPowers).mockResolvedValue({
      shortName: "UN",
      category: "political",
    } as never);
    vi.mocked(getMembers).mockResolvedValue(["US", "UK"]);
    const { db, inserted } = dbCapturingLegislation();

    const res = await proposeOrganizationLegislation({
      db,
      countryId: "US",
      orgId: "UN",
      actor,
      input: { type: "joint_statement", subjectCountryId: "BR", stance: "condemn" },
    });

    expect(res.ok).toBe(true);
    expect(inserted[0]).toMatchObject({
      type: "joint_statement",
      jointStatementSubjectCountryId: "BR",
      jointStatementStance: "condemn",
      parties: [],
    });
  });

  it("an economic org cannot table a joint statement (not in its powers)", async () => {
    vi.mocked(loadOrganizationDefWithPowers).mockResolvedValue({
      shortName: "EU",
      category: "economic",
    } as never);
    vi.mocked(getMembers).mockResolvedValue(["DE", "IE"]);
    const { db, inserted } = dbCapturingLegislation();

    const res = await proposeOrganizationLegislation({
      db,
      countryId: "DE",
      orgId: "EU",
      actor,
      input: { type: "joint_statement", subjectCountryId: "BR", stance: "endorse" },
    });

    expect(res.ok).toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it("a security org member can table an alert-posture change", async () => {
    vi.mocked(loadOrganizationDefWithPowers).mockResolvedValue({
      shortName: "NATO",
      category: "security",
    } as never);
    vi.mocked(getMembers).mockResolvedValue(["US", "UK"]);
    const { db, inserted } = dbCapturingLegislation();

    const res = await proposeOrganizationLegislation({
      db,
      countryId: "US",
      orgId: "NATO",
      actor,
      input: { type: "set_posture", posture: "heightened" },
    });

    expect(res.ok).toBe(true);
    expect(inserted[0]).toMatchObject({
      type: "set_posture",
      postureValue: "heightened",
      parties: [],
    });
  });

  it("a political org cannot table an alert-posture change (not in its powers)", async () => {
    vi.mocked(loadOrganizationDefWithPowers).mockResolvedValue({
      shortName: "UN",
      category: "political",
    } as never);
    vi.mocked(getMembers).mockResolvedValue(["US", "UK"]);
    const { db, inserted } = dbCapturingLegislation();

    const res = await proposeOrganizationLegislation({
      db,
      countryId: "US",
      orgId: "UN",
      actor,
      input: { type: "set_posture", posture: "heightened" },
    });

    expect(res.ok).toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it("a political org member can fund a catalog agency", async () => {
    vi.mocked(loadOrganizationDefWithPowers).mockResolvedValue({
      shortName: "UN",
      category: "political",
    } as never);
    vi.mocked(getMembers).mockResolvedValue(["US", "UK"]);
    const { db, inserted } = dbCapturingLegislation();

    const res = await proposeOrganizationLegislation({
      db,
      countryId: "US",
      orgId: "UN",
      actor,
      input: { type: "fund_agency", agencyKey: "humanitarian_relief" },
    });

    expect(res.ok).toBe(true);
    expect(inserted[0]).toMatchObject({
      type: "fund_agency",
      agencyKey: "humanitarian_relief",
      parties: [],
    });
  });

  it("a security org cannot fund an agency (not in its powers)", async () => {
    vi.mocked(loadOrganizationDefWithPowers).mockResolvedValue({
      shortName: "NATO",
      category: "security",
    } as never);
    vi.mocked(getMembers).mockResolvedValue(["US", "UK"]);
    const { db, inserted } = dbCapturingLegislation();

    const res = await proposeOrganizationLegislation({
      db,
      countryId: "US",
      orgId: "NATO",
      actor,
      input: { type: "fund_agency", agencyKey: "humanitarian_relief" },
    });

    expect(res.ok).toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it("still tables a free-trade agreement", async () => {
    vi.mocked(loadOrganizationDefWithPowers).mockResolvedValue({
      shortName: "EU",
      category: "economic",
    } as never);
    vi.mocked(getMembers).mockResolvedValue(["DE", "IE"]);
    const { db, inserted } = dbCapturingLegislation();

    const res = await proposeOrganizationLegislation({
      db,
      countryId: "DE",
      orgId: "EU",
      actor,
      input: { type: "free_trade_agreement", parties: ["IE"] },
    });

    expect(res.ok).toBe(true);
    expect(inserted[0]).toMatchObject({ type: "free_trade_agreement" });
    expect((inserted[0].parties as string[]).sort()).toEqual(["DE", "IE"]);
  });
});

describe("proposeOrganizationLegislation — aid recipients must have a treasury", () => {
  beforeEach(() => {
    vi.mocked(loadOrganizationDefWithPowers).mockResolvedValue({
      shortName: "NATO",
      category: "economic",
    } as never);
  });

  it("refuses a macro-tier member, which has no treasury to pay into", async () => {
    // Membership is entity-wide, so JO can be a member — but aid credits a
    // `federalBudget` it does not have. Before this guard the unguarded
    // `COUNTRY_CONFIGS[recipient].name` lookup threw a TypeError and the route
    // 500'd instead of explaining itself.
    vi.mocked(getMembers).mockResolvedValue(["US", "JO"] as never);
    const { db } = dbCapturingLegislation();

    const res = await proposeOrganizationLegislation({
      db,
      countryId: "US",
      orgId: "NATO",
      actor,
      input: { type: "aid_package", recipientCountryId: "JO" as never, amount: 1_000 },
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(400);
      expect(res.error).toMatch(/no treasury/i);
    }
  });

  it("still allows a member the game models as a country", async () => {
    vi.mocked(getMembers).mockResolvedValue(["US", "TR"] as never);
    const { db, inserted } = dbCapturingLegislation();

    const res = await proposeOrganizationLegislation({
      db,
      countryId: "US",
      orgId: "NATO",
      actor,
      input: { type: "aid_package", recipientCountryId: "TR", amount: 1_000 },
    });

    expect(res.ok).toBe(true);
    expect(inserted[0]).toMatchObject({ type: "aid_package", aidRecipientCountryId: "TR" });
  });
});
