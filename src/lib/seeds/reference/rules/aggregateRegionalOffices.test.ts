import { describe, expect, it } from "vitest";
import { getPresetSeats } from "@/lib/constants/historicalSeats";
import { IE_LOCAL_COUNCIL_SEATS } from "@/lib/countries/ie/data/ieLocalCouncilSeats";
import {
  modeledBrMacroregionGovernors,
  modeledIeRegionalOffices,
} from "./aggregateRegionalOffices";

const modernPresets = ["1991-default", "2019-default", "2027-default"];

describe("modeled BR and IE aggregate opening offices", () => {
  for (const preset of modernPresets) {
    it(`seats every synthetic aggregate office exactly once in ${preset}`, () => {
      const brGovernors = modeledBrMacroregionGovernors(preset);
      const ieOffices = modeledIeRegionalOffices(preset);
      const ieCouncil = ieOffices.filter((seat) => seat.officeType === "localCouncil");
      const ieChairs = ieOffices.filter((seat) => seat.officeType === "governor");

      expect(brGovernors).toHaveLength(5);
      expect(new Set(brGovernors.map((seat) => seat.state)).size).toBe(5);
      expect(
        brGovernors.every((seat) => seat.officeType === "governor" && seat.party.startsWith("br_"))
      ).toBe(true);
      expect(ieChairs).toHaveLength(8);
      expect(new Set(ieChairs.map((seat) => seat.state)).size).toBe(8);
      for (const [region, totalSeats] of Object.entries(IE_LOCAL_COUNCIL_SEATS)) {
        if (region === "NIR") continue;
        expect(
          ieCouncil
            .filter((seat) => seat.state === region)
            .reduce((sum, seat) => sum + (seat.seatsHeld ?? 0), 0)
        ).toBe(totalSeats);
        expect(ieChairs.filter((seat) => seat.state === region)).toHaveLength(1);
      }
      expect(ieCouncil.reduce((sum, seat) => sum + (seat.seatsHeld ?? 0), 0)).toBe(200);
      expect(
        ieCouncil.every((seat) => seat.party.startsWith("ie_") && (seat.seatsHeld ?? 0) > 0)
      ).toBe(true);

      const roster = getPresetSeats(preset);
      expect(
        roster.filter((seat) => seat.officeType === "governor" && seat.party.startsWith("br_"))
      ).toEqual(brGovernors);
      expect(
        roster.filter(
          (seat) =>
            (seat.officeType === "governor" || seat.officeType === "localCouncil") &&
            seat.party.startsWith("ie_")
        )
      ).toEqual(ieOffices);
      expect(modeledBrMacroregionGovernors(preset)).toEqual(brGovernors);
      expect(modeledIeRegionalOffices(preset)).toEqual(ieOffices);
    });
  }

  it("does not change the Cold War 1953 and 1979 seat rosters", () => {
    for (const preset of ["1953-default", "1979-default"]) {
      expect(modeledBrMacroregionGovernors(preset)).toEqual([]);
      expect(modeledIeRegionalOffices(preset)).toEqual([]);
      expect(getPresetSeats(preset).filter((seat) => seat.officeType === "localCouncil")).toEqual(
        []
      );
    }
  });
});
