/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { HomeStatePicker } from "./HomeStatePicker";
import type { State } from "@/lib/db/types";

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
  it("separates the overall lean from the two compass axes", () => {
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

    // The combined headline still distinguishes Labour London from the Tory
    // South East, while the explicitly named axes report the coordinates that
    // are plotted on the character-creation compass.
    const london = within(screen.getByRole("radio", { name: /London/ }));
    expect(london.getByText("Electoral lean: Center-Left")).toBeTruthy();
    expect(london.getByText("Economic: Center-Left · Social: Center-Trad")).toBeTruthy();

    const southEast = within(screen.getByRole("radio", { name: /South East England/ }));
    expect(southEast.getByText("Electoral lean: Center-Right")).toBeTruthy();
    expect(southEast.getByText("Economic: Center-Left · Social: Center-Trad")).toBeTruthy();
  });

  it("labels a centrist economic coordinate separately from a center-right electoral lean", () => {
    render(
      <HomeStatePicker
        states={[ukRegion("TEST", "Reported region", 0.3, 1.2)]}
        value=""
        onChange={() => {}}
        playerCounts={{}}
        position={{ economic: 0, social: 0 }}
        regionNoun="region"
      />
    );

    const row = within(screen.getByRole("radio", { name: /Reported region/ }));
    expect(row.getByText("Electoral lean: Center-Right")).toBeTruthy();
    expect(row.getByText("Economic: Centrist · Social: Center-Trad")).toBeTruthy();
  });
});
