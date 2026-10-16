import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUserWithCharacter: vi.fn() }));
vi.mock("@/lib/states/approval/getRegionalApprovalData", () => ({
  getRegionalApprovalData: vi.fn(),
}));

import { getDb } from "@/lib/mongodb";
import { getRegionalApprovalData } from "@/lib/states/approval/getRegionalApprovalData";
import { getRegionGovernmentApproval, getRegionPartyOrg } from "./regionData";

describe("getRegionPartyOrg", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("excludes merged-away party tombstones even when legacy state rows remain", async () => {
    const statePartyOrgFind = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "SCO_1", countryId: "UK", stateId: "SCO", partyId: "1", organization: 58.5 },
        { _id: "SCO_6", countryId: "UK", stateId: "SCO", partyId: "6", organization: 6.4 },
      ]),
    });
    const partyFind = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          sequentialId: 1,
          countryId: "UK",
          name: "Labour Party",
          abbreviation: "LAB",
          color: "#dc143c",
        },
      ]),
    });
    const db = {
      collection: vi.fn((name: string) => {
        if (name === "statePartyOrg") {
          return { find: statePartyOrgFind };
        }
        if (name === "politicalParties") return { find: partyFind };
        if (name === "characters") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            }),
          };
        }
        throw new Error(`Unexpected collection ${name}`);
      }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    const result = await getRegionPartyOrg("SCO", "UK");

    expect(statePartyOrgFind).toHaveBeenCalledWith({ countryId: "UK", stateId: "SCO" });
    expect(partyFind).toHaveBeenCalledWith({
      sequentialId: { $in: [1, 6] },
      countryId: "UK",
      isDefunct: { $ne: true },
    });
    expect(result.map((row) => row.partyId)).toEqual(["1"]);
  });
});

describe("getRegionGovernmentApproval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when optional approval data rejects asynchronously", async () => {
    vi.mocked(getDb).mockResolvedValue({} as never);
    vi.mocked(getRegionalApprovalData).mockRejectedValueOnce(new Error("Approval unavailable"));

    await expect(getRegionGovernmentApproval("SCO", "UK")).resolves.toBeNull();
  });

  it("preserves approval data and forwards the database, country and state", async () => {
    const db = {};
    const approvalData = { approval: 55, baseApproval: 50, modifiers: [] };
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(getRegionalApprovalData).mockResolvedValueOnce(approvalData);

    await expect(getRegionGovernmentApproval("SCO", "UK")).resolves.toBe(approvalData);
    expect(getRegionalApprovalData).toHaveBeenCalledExactlyOnceWith(db, "UK", "SCO");
  });
});
