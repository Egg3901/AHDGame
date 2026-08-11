/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HomeStatePicker } from "./HomeStatePicker";
import type { State } from "@/lib/db/types";

/**
 * Regression coverage for the "on registration, the UK is all C/C-lean" bug
 * report: the 1953 UK Layer-1 model keeps `cachedEconomicLean` negative and
 * `cachedSocialLean` positive in EVERY region by construction (see
 * `POSITIONS_1953` in src/lib/seeds/international/uk.ts and the calibration
 * suite at src/lib/seeds/calibration/uk1953.test.ts) — only the *magnitude*
 * of the social axis decides which axis dominates region to region. The
 * picker previously rendered `getLeanLabel(economic)` directly, so every
 * single region showed the identical "Center-Left" headline regardless of
 * its true (and historically correct) lean.
 */
function ukRegion(id: string, name: string, economic: number, social: number): State {
  return {
    _id: id,
    countryId: "UK",
    regionType: "constituency",
    parentRegionId: "ENG",
    name,
    population: 1_000_000,
    gdp: 100,
    houseDistricts: 10,
    stateSenateSeats: 10,
    region: name,
    votingSystem: "fptp",
    cachedEconomicLean: economic,
    cachedSocialLean: social,
  } as State;
}

// Real seed-derived values queried from the 1953-default world (see the
// audit): economic is negative and social is ~0.6-0.7 in every region, but
// SEE/SWE are historically Tory shires and LON/NEE are historically Labour.
const LON = ukRegion("LON", "London", -1.49, 0.61); // Labour-held in 1951
const SEE = ukRegion("SEE", "South East England", -0.53, 0.69); // Home Counties Tory shire

describe("HomeStatePicker — UK 1953 lean display", () => {
  it("does not collapse every region to the same lean headline", () => {
    render(
      <HomeStatePicker
        states={[LON, SEE]}
        value=""
        onChange={() => {}}
        playerCounts={{}}
        position={{ economic: 0, social: 0 }}
        regionNoun="region"
      />
    );

    // Both regions previously rendered the identical "Center-Left" headline
    // (raw economic is negative in both). They must now differ: SEE reads
    // right-of-centre once the dominant (social) axis is selected, matching
    // the 1951 election geography (Con held the Home Counties).
    expect(screen.getByText(/Center-Left · Center-Trad/)).toBeTruthy(); // LON
    expect(screen.getByText(/Center-Right · Center-Trad/)).toBeTruthy(); // SEE
  });
});
