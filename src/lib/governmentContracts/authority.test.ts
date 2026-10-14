import { beforeEach, describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { AuthUserWithCharacter } from "@/lib/auth";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { managementAuthority } from "./authority";
const mocks = vi.hoisted(() => ({
  law: vi.fn(),
  national: vi.fn(),
  regional: vi.fn(),
  acting: vi.fn(),
}));
vi.mock("@/lib/extraction/contractAuthority", () => ({ getResourceContractAuthority: mocks.law }));
vi.mock("@/lib/extraction/contractIssuerAuth", () => ({
  isNationalIssuer: mocks.national,
  isStateIssuer: mocks.regional,
}));
vi.mock("@/lib/api/requireConfirmedSecretary", () => ({ requireConfirmedSecretary: mocks.acting }));
const characterId = new ObjectId();
const user = {
  userId: new ObjectId().toHexString(),
  character: { _id: characterId },
  isAdmin: false,
} as AuthUserWithCharacter;
const extraction = {
  type: "extraction",
  stateId: "TX",
  resource: "oil",
  share: 0.1,
  termTurns: 48,
  royaltyRatePerTurn: 0,
  minimumSigningFeeAnchor: 0,
} as const;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.law.mockResolvedValue("national");
  mocks.national.mockResolvedValue(false);
  mocks.regional.mockResolvedValue(false);
  mocks.acting.mockReturnValue(null);
});
describe("contract management authority", () => {
  it("requires the country's actual defence holder rather than any cabinet member", async () => {
    const db = createMockDb();
    db.collection("cabinetMembers");
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({ characterId });
    expect(
      await managementAuthority(
        db as never,
        "US",
        { type: "defence", component: "ground", grade: 0, lots: 1, maximumPricePerLot: 100 },
        user
      )
    ).toBe("national");
    expect(db.collectionMocks.cabinetMembers.findOne).toHaveBeenCalledWith({
      countryId: "US",
      positionId: "secretary_of_defense",
      characterId,
    });
  });
  it("follows the licensing law and original institutional level for successor officials", async () => {
    const db = createMockDb();
    mocks.national.mockResolvedValue(true);
    expect(await managementAuthority(db as never, "US", extraction, user, "national")).toBe(
      "national"
    );
    expect(await managementAuthority(db as never, "US", extraction, user, "state")).toBeNull();
    mocks.law.mockResolvedValue("state");
    mocks.regional.mockResolvedValue(true);
    expect(await managementAuthority(db as never, "US", extraction, user, "state")).toBe("state");
    expect(await managementAuthority(db as never, "US", extraction, user, "national")).toBeNull();
  });
  it("does not grant a civilian or missing character a management role", async () => {
    expect(
      await managementAuthority(createMockDb() as never, "US", extraction, {
        ...user,
        character: undefined,
      })
    ).toBeNull();
  });
});
