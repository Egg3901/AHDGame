import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";

vi.mock("@/lib/db/collections", () => ({
  getOrganizationLegislationCollection: vi.fn(),
}));

const { getOrganizationLegislationCollection } = await import("@/lib/db/collections");
const {
  jointStatementApprovalEffect,
  getActiveOrgStatementModifiersByCountry,
  JOINT_STATEMENT_ENDORSE_APPROVAL,
  JOINT_STATEMENT_CONDEMN_APPROVAL,
} = await import("./jointStatement");

beforeEach(() => vi.clearAllMocks());

describe("jointStatementApprovalEffect", () => {
  it("endorsement is a positive bump, condemnation a larger penalty", () => {
    expect(jointStatementApprovalEffect("endorse")).toBe(JOINT_STATEMENT_ENDORSE_APPROVAL);
    expect(jointStatementApprovalEffect("condemn")).toBe(JOINT_STATEMENT_CONDEMN_APPROVAL);
    expect(JOINT_STATEMENT_ENDORSE_APPROVAL).toBeGreaterThan(0);
    expect(JOINT_STATEMENT_CONDEMN_APPROVAL).toBeLessThan(0);
  });
});

describe("getActiveOrgStatementModifiersByCountry", () => {
  function mockLegislation(rows: Record<string, unknown>[]) {
    const find = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(rows) });
    vi.mocked(getOrganizationLegislationCollection).mockResolvedValue({ find } as never);
    return find;
  }

  it("maps active statements about the country to approval modifiers", async () => {
    const find = mockLegislation([
      {
        _id: new ObjectId("507f1f77bcf86cd7994390a1"),
        organizationId: "UN",
        jointStatementStance: "condemn",
      },
    ]);
    const mods = await getActiveOrgStatementModifiersByCountry({} as Db, "BR", 50);
    expect(mods).toHaveLength(1);
    expect(mods[0].effect).toBe(JOINT_STATEMENT_CONDEMN_APPROVAL);
    expect(mods[0].label).toContain("condemnation");
    // Query is scoped to active, un-expired statements about this country.
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "joint_statement",
        status: "active",
        jointStatementSubjectCountryId: "BR",
        jointStatementExpiresOnTurn: { $gt: 50 },
      })
    );
  });

  it("returns an empty list when there are no active statements", async () => {
    mockLegislation([]);
    const mods = await getActiveOrgStatementModifiersByCountry({} as Db, "US", 10);
    expect(mods).toEqual([]);
  });
});
