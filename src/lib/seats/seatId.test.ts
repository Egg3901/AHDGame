// src/lib/seats/seatId.test.ts
import { describe, it, expect } from "vitest";
import {
  buildSeatId,
  parseSeatId,
  getLocalRegionId,
  getHistoricalRaceId,
  getSeatIdFromElection,
} from "./seatId";

describe("seatId utilities", () => {
  describe("buildSeatId", () => {
    it("builds US senate seatId with class", () => {
      expect(buildSeatId("US", "senate", "PA", 1)).toBe("US-senate-PA-1");
    });

    it("builds US house seatId without class", () => {
      expect(buildSeatId("US", "house", "CA")).toBe("US-house-CA");
    });

    it("builds US governor seatId", () => {
      expect(buildSeatId("US", "governor", "TX")).toBe("US-governor-TX");
    });

    it("builds US president seatId", () => {
      expect(buildSeatId("US", "president", "US")).toBe("US-president");
    });

    it("builds UK commons seatId", () => {
      expect(buildSeatId("UK", "commons", "LON")).toBe("UK-commons-LON");
    });

    it("builds UK commons seatId for Scotland", () => {
      expect(buildSeatId("UK", "commons", "SCO")).toBe("UK-commons-SCO");
    });

    it("builds JP sangiin seatId with chamberClass", () => {
      expect(buildSeatId("JP", "sangiin", "TOH", 1)).toBe("JP-sangiin-TOH-1");
      expect(buildSeatId("JP", "sangiin", "TOH", 2)).toBe("JP-sangiin-TOH-2");
    });

    it("builds JP shugiin seatId without class", () => {
      expect(buildSeatId("JP", "shugiin", "KAN")).toBe("JP-shugiin-KAN");
    });
  });

  describe("getLocalRegionId", () => {
    it("returns UK region IDs unchanged (already unprefixed post-migration)", () => {
      expect(getLocalRegionId("LON", "UK")).toBe("LON");
      expect(getLocalRegionId("SCO", "UK")).toBe("SCO");
      expect(getLocalRegionId("NIR", "UK")).toBe("NIR");
    });

    it("returns US states unchanged", () => {
      expect(getLocalRegionId("PA", "US")).toBe("PA");
      expect(getLocalRegionId("CA", "US")).toBe("CA");
    });

    it("handles president special case", () => {
      expect(getLocalRegionId("US", "US")).toBe("US");
    });
  });

  describe("parseSeatId", () => {
    it("parses US senate seatId", () => {
      const result = parseSeatId("US-senate-PA-1");
      expect(result).toEqual({
        countryId: "US",
        electionType: "senate",
        localRegionId: "PA",
        senateClass: 1,
        chamberClass: 1,
      });
    });

    it("parses US house seatId", () => {
      const result = parseSeatId("US-house-CA");
      expect(result).toEqual({
        countryId: "US",
        electionType: "house",
        localRegionId: "CA",
        senateClass: undefined,
        chamberClass: undefined,
      });
    });

    it("parses US president seatId", () => {
      const result = parseSeatId("US-president");
      expect(result).toEqual({
        countryId: "US",
        electionType: "president",
        localRegionId: undefined,
        senateClass: undefined,
        chamberClass: undefined,
      });
    });

    it("parses UK commons seatId", () => {
      const result = parseSeatId("UK-commons-LON");
      expect(result).toEqual({
        countryId: "UK",
        electionType: "commons",
        localRegionId: "LON",
        senateClass: undefined,
        chamberClass: undefined,
      });
    });

    it("parses JP sangiin seatId with chamberClass (not senateClass)", () => {
      const result = parseSeatId("JP-sangiin-TOH-2");
      expect(result).toEqual({
        countryId: "JP",
        electionType: "sangiin",
        localRegionId: "TOH",
        senateClass: undefined,
        chamberClass: 2,
      });
    });
  });

  describe("getHistoricalRaceId", () => {
    it("appends cycle number", () => {
      expect(getHistoricalRaceId("US-senate-PA-1", 3)).toBe("US-senate-PA-1-c3");
      expect(getHistoricalRaceId("UK-commons-LON", 1)).toBe("UK-commons-LON-c1");
    });
  });

  describe("getSeatIdFromElection", () => {
    it("builds seatId from election document", () => {
      expect(
        getSeatIdFromElection({
          countryId: "US",
          electionType: "senate",
          state: "PA",
          senateClass: 1,
        })
      ).toBe("US-senate-PA-1");
    });

    it("defaults countryId to US if missing", () => {
      expect(
        getSeatIdFromElection({
          electionType: "house",
          state: "CA",
        })
      ).toBe("US-house-CA");
    });

    it("handles UK elections", () => {
      expect(
        getSeatIdFromElection({
          countryId: "UK",
          electionType: "commons",
          state: "LON",
        })
      ).toBe("UK-commons-LON");
    });

    it("uses chamberClass for JP Sangiin", () => {
      expect(
        getSeatIdFromElection({
          countryId: "JP",
          electionType: "sangiin",
          state: "TOH",
          chamberClass: 1,
        })
      ).toBe("JP-sangiin-TOH-1");
      expect(
        getSeatIdFromElection({
          countryId: "JP",
          electionType: "sangiin",
          state: "TOH",
          chamberClass: 2,
        })
      ).toBe("JP-sangiin-TOH-2");
    });
  });
});
