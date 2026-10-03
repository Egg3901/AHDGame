import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { getCountryConfig } from "@/lib/constants/countries";
import { getParliamentaryCountryIds } from "@/lib/turn/parliamentaryGovernment";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { seedCSGovernmentFormation1991 } from "@/lib/admin/seed/seedCSGovernmentFormation1991";
import { csRegions1991 } from "../data/csRegions1991";

describe("CS 1991 successor institutions", () => {
  it("matches both 150-seat chambers and enters the parliamentary turn phase", () => {
    const config = getCountryConfig("CS", "1991-default");
    expect(config.governmentType).toBe("parliamentaryRepublic");
    expect(config.legislature.bicameral).toBe(true);
    expect(config.legislature.lowerChamber.seats).toBe(150);
    expect(config.legislature.upperChamber?.seats).toBe(150);
    expect(config.coalitionThreshold).toBe(76);
    expect(config.lowerElectionSystem.termYears).toBe(2);
    expect(csRegions1991.reduce((sum, region) => sum + region.houseDistricts, 0)).toBe(150);
    expect(csRegions1991.reduce((sum, region) => sum + (region.stateSenateSeats ?? 0), 0)).toBe(
      150
    );
    expect(getParliamentaryCountryIds("1991-default")).toContain("CS");
  });

  it("opens only the 1991 government formation", async () => {
    const mock = createMockDb();
    await seedCSGovernmentFormation1991(mock as unknown as Db, () => {}, "1991-default");
    const update = mock.collectionMocks.governmentFormations.updateOne.mock.calls[0]![1];
    expect(update.$set).toMatchObject({
      countryId: "CS",
      status: "pending",
      totalSeats: 150,
      majorityThreshold: 76,
    });
    const coldWar = createMockDb();
    await seedCSGovernmentFormation1991(coldWar as unknown as Db, () => {}, "1979-default");
    expect(coldWar.collectionMocks.governmentFormations).toBeUndefined();
  });
});
