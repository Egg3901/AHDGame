import { describe, expect, it } from "vitest";
import { UK_REGIONAL_COUNCIL_SEATS } from "@/lib/constants/states";
import { ukRegions } from "./ukRegions";
import { ukRegions1991 } from "./ukRegions1991";

describe("UK regional council seat counts", () => {
  for (const [label, regions] of [
    ["modern", ukRegions],
    ["1991", ukRegions1991],
  ] as const) {
    it(`${label} region seeds match UK_REGIONAL_COUNCIL_SEATS`, () => {
      for (const region of regions) {
        expect(region.stateSenateSeats, `${region._id} stateSenateSeats`).toBe(
          UK_REGIONAL_COUNCIL_SEATS[region._id]
        );
      }
    });
  }
});
