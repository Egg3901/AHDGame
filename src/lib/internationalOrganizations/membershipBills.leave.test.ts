import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";

vi.mock("./withdrawalBills", () => ({
  removeOrganizationMembership: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(100) }));

const { removeOrganizationMembership } = await import("./withdrawalBills");
const { applyOrgLeaveProvision } = await import("./membershipBills");

beforeEach(() => vi.clearAllMocks());

describe("applyOrgLeaveProvision", () => {
  it("removes the org membership for the bill's country", async () => {
    const bill = { _id: new ObjectId(), countryId: "DE" as const };
    await applyOrgLeaveProvision({} as Db, bill, "DE", {
      type: "international_organization",
      subType: "leave",
      organizationId: "EU",
      organizationName: "European Union",
    });
    expect(removeOrganizationMembership).toHaveBeenCalledWith(
      {},
      "DE",
      "EU",
      "European Union",
      100
    );
  });
});
