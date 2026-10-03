import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { getCountryConfig } from "@/lib/constants/countries";
import { getParliamentaryCountryIds } from "@/lib/turn/parliamentaryGovernment";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { seedBGGovernmentFormation1991 } from "@/lib/admin/seed/seedBGGovernmentFormation1991";
import { bgRegions1991 } from "../data/bgRegions1991";

describe("BG 1991 successor institutions", () => {
  it("starts with the multiparty 400-seat Grand National Assembly", () => {
    const config = getCountryConfig("BG", "1991-default");
    expect(config.governmentType).toBe("parliamentaryRepublic");
    expect(config.rulingPartyId).toBeUndefined();
    expect(config.executiveTitle).toBe("Prime Minister");
    expect(config.headOfStateTitle).toBe("President");
    expect(config.legislature.name).toBe("Grand National Assembly");
    expect(config.legislature.lowerChamber.seats).toBe(400);
    expect(config.coalitionThreshold).toBe(201);
    expect(bgRegions1991.reduce((sum, region) => sum + region.houseDistricts, 0)).toBe(400);
    expect(getParliamentaryCountryIds("1991-default")).toContain("BG");
  });

  it("keeps the 1979 one-party configuration", () => {
    const config = getCountryConfig("BG", "1979-default");
    expect(config.governmentType).toBe("onePartyState");
    expect(config.executiveTitle).toBe("General Secretary");
  });

  it("opens a pending 1991 government formation only", async () => {
    const mock = createMockDb();
    await seedBGGovernmentFormation1991(mock as unknown as Db, () => {}, "1991-default");
    const update = mock.collectionMocks.governmentFormations.updateOne.mock.calls[0]![1];
    expect(update.$set).toMatchObject({
      countryId: "BG",
      status: "pending",
      totalSeats: 400,
      majorityThreshold: 201,
    });
    const coldWar = createMockDb();
    await seedBGGovernmentFormation1991(coldWar as unknown as Db, () => {}, "1979-default");
    expect(coldWar.collectionMocks.governmentFormations).toBeUndefined();
  });
});
