import { describe, expect, it } from "vitest";
import { csRegions1991 } from "@/lib/countries/cs/data/csRegions1991";
import { yuRegions1991 } from "@/lib/countries/yu/data/yuRegions1991";
import {
  getLowerChamberOfficeType,
  getUpperChamberOfficeType,
} from "@/lib/legislature/chamberOfficeType";
import { sumSeatsHeld } from "@/lib/seeds/proportionalChamberSeats";
import { build1991FederationDelegationSeats } from "./seed1991FederationLegislatures";

describe("1991 federal opening delegations", () => {
  it("fills both Czechoslovak chambers from their actual regional magnitudes", () => {
    const parties = [
      { name: "Civic Forum", sequentialId: 1 },
      { name: "Public Against Violence", sequentialId: 2 },
      { name: "Communist Party of Czechoslovakia", sequentialId: 3 },
    ];
    const presence = csRegions1991.flatMap((region) =>
      parties.map((party) => ({
        stateId: region._id,
        partyId: String(party.sequentialId),
        organization: 35,
        hasPresence: true,
      }))
    );
    for (const [regionSeatField, officeType] of [
      ["houseDistricts", getLowerChamberOfficeType("CS", "1991-default")],
      ["stateSenateSeats", getUpperChamberOfficeType("CS", "1991-default")],
    ] as const) {
      expect(officeType).toBeDefined();
      const seats = build1991FederationDelegationSeats({
        countryId: "CS",
        officeType: officeType!,
        targetSeats: 150,
        regionSeatField,
        regions: csRegions1991,
        parties,
        presence,
      });
      expect(sumSeatsHeld(seats)).toBe(150);
      expect(new Set(seats.map((seat) => seat.state))).toEqual(
        new Set(csRegions1991.map((region) => region._id))
      );
    }
  });

  it("keeps Yugoslav republican parties in their own delegations", () => {
    const parties = [
      { name: "Alliance of Reform Forces of Yugoslavia", sequentialId: 1 },
      { name: "Croatian Democratic Union", sequentialId: 2 },
    ];
    const presence = yuRegions1991.flatMap((region) => [
      { stateId: region._id, partyId: "1", organization: 70, hasPresence: true },
      ...(region._id === "YU_CRO"
        ? [{ stateId: region._id, partyId: "2", organization: 35, hasPresence: true }]
        : []),
    ]);
    for (const [regionSeatField, officeType, targetSeats] of [
      ["houseDistricts", getLowerChamberOfficeType("YU", "1991-default"), 220],
      ["stateSenateSeats", getUpperChamberOfficeType("YU", "1991-default"), 88],
    ] as const) {
      expect(officeType).toBeDefined();
      const seats = build1991FederationDelegationSeats({
        countryId: "YU",
        officeType: officeType!,
        targetSeats,
        regionSeatField,
        regions: yuRegions1991,
        parties,
        presence,
      });
      expect(sumSeatsHeld(seats)).toBe(targetSeats);
      expect(
        seats.filter((seat) => seat.party === "Croatian Democratic Union").map((seat) => seat.state)
      ).toEqual(["YU_CRO"]);
    }
  });

  it("rejects a missing regional party footprint rather than inventing a delegation", () => {
    expect(() =>
      build1991FederationDelegationSeats({
        countryId: "CS",
        officeType: "assemblyDeputy",
        targetSeats: 150,
        regionSeatField: "houseDistricts",
        regions: csRegions1991,
        parties: [{ name: "Civic Forum", sequentialId: 1 }],
        presence: [],
      })
    ).toThrow(/valid parties/);
  });
});
