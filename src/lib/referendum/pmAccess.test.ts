import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { canDecideReferendum } from "./pmAccess";
vi.mock("@/lib/api/headOfGovernment", () => ({ getHeadOfGovernmentCharacterId: vi.fn() }));
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
describe("referendum PM access", () => {
  const actor = new ObjectId();
  beforeEach(() => vi.clearAllMocks());
  it("does not let party leadership override a human PM", async () => {
    const db = createMockDb();
    vi.mocked(getHeadOfGovernmentCharacterId).mockResolvedValue(new ObjectId());
    expect(await canDecideReferendum(db as unknown as Db, actor)).toBe(false);
    expect(db.collection("politicalParties").findOne).not.toHaveBeenCalled();
  });
  it.each(["chairId", "viceChairId"])("allows the NPP PM's %s", async (role) => {
    const db = createMockDb();
    vi.mocked(getHeadOfGovernmentCharacterId).mockResolvedValue(null);
    db.collection("governmentFormations").findOne.mockResolvedValue({
      status: "formed",
      pmNppId: new ObjectId(),
      governingPartyId: "2",
      pmCharacterId: null,
    });
    db.collection("politicalParties").findOne.mockResolvedValue({ [role]: actor });
    expect(await canDecideReferendum(db as unknown as Db, actor)).toBe(true);
    expect(db.collection("politicalParties").findOne).toHaveBeenCalledWith(
      { countryId: "UK", sequentialId: 2 },
      expect.anything()
    );
  });
  it("refuses a forming or absent ministry", async () => {
    const db = createMockDb();
    vi.mocked(getHeadOfGovernmentCharacterId).mockResolvedValue(null);
    db.collection("governmentFormations").findOne.mockResolvedValue({
      status: "pending",
      pmNppId: new ObjectId(),
      governingPartyId: "2",
    });
    expect(await canDecideReferendum(db as unknown as Db, actor)).toBe(false);
  });
});
