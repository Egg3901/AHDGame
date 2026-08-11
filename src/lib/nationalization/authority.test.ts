import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/constants/countries", () => ({
  getCountryConfig: vi.fn(),
}));
vi.mock("@/lib/governorOffice/isSittingLeader", () => ({
  isSittingLeader: vi.fn(),
}));

let db: MockDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("cabinetMembers");
});

describe("assertTreasuryAuthority", () => {
  it("authorizes the seated finance minister", async () => {
    const actor = new ObjectId();
    const { getCountryConfig } = await import("@/lib/constants/countries");
    vi.mocked(getCountryConfig).mockReturnValue({
      financeMinisterCabinetId: "secretary_of_treasury",
    } as never);
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      countryId: "US",
      positionId: "secretary_of_treasury",
      characterId: actor,
    });

    const { assertTreasuryAuthority } = await import("./authority");
    expect(await assertTreasuryAuthority(db as unknown as Db, "US", actor)).toBe(true);
  });

  it("rejects a non-finance-minister when the seat is filled by someone else", async () => {
    const actor = new ObjectId();
    const seatedOther = new ObjectId();
    const { getCountryConfig } = await import("@/lib/constants/countries");
    vi.mocked(getCountryConfig).mockReturnValue({
      financeMinisterCabinetId: "secretary_of_treasury",
    } as never);
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      countryId: "US",
      positionId: "secretary_of_treasury",
      characterId: seatedOther,
    });
    const { isSittingLeader } = await import("@/lib/governorOffice/isSittingLeader");

    const { assertTreasuryAuthority } = await import("./authority");
    expect(await assertTreasuryAuthority(db as unknown as Db, "US", actor)).toBe(false);
    // Filled seat short-circuits — head-of-gov fallback is NOT consulted.
    expect(isSittingLeader).not.toHaveBeenCalled();
  });

  it("falls back to head of government when the seat is vacant", async () => {
    const actor = new ObjectId();
    const { getCountryConfig } = await import("@/lib/constants/countries");
    vi.mocked(getCountryConfig).mockReturnValue({
      financeMinisterCabinetId: "secretary_of_treasury",
    } as never);
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      countryId: "US",
      positionId: "secretary_of_treasury",
      characterId: null, // vacant
    });
    const { isSittingLeader } = await import("@/lib/governorOffice/isSittingLeader");
    vi.mocked(isSittingLeader).mockResolvedValue(true);

    const { assertTreasuryAuthority } = await import("./authority");
    expect(await assertTreasuryAuthority(db as unknown as Db, "US", actor)).toBe(true);
    expect(isSittingLeader).toHaveBeenCalledWith(db, "US", actor);
  });

  it("falls back to head of government when the country has no finance portfolio", async () => {
    const actor = new ObjectId();
    const { getCountryConfig } = await import("@/lib/constants/countries");
    vi.mocked(getCountryConfig).mockReturnValue({ financeMinisterCabinetId: undefined } as never);
    const { isSittingLeader } = await import("@/lib/governorOffice/isSittingLeader");
    vi.mocked(isSittingLeader).mockResolvedValue(false);

    const { assertTreasuryAuthority } = await import("./authority");
    expect(await assertTreasuryAuthority(db as unknown as Db, "US", actor)).toBe(false);
    expect(db.collectionMocks.cabinetMembers.findOne).not.toHaveBeenCalled();
  });
});
