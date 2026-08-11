import { describe, it, expect } from "vitest";
import { electionRaceTitle } from "./electionHelpers";

describe("electionRaceTitle — governor label localization", () => {
  it("labels SCO/WAL regional governor races with their sub-national executive title", () => {
    expect(
      electionRaceTitle({ electionType: "governor", countryId: "SCO", state: "LOT" }, 2024)
    ).toBe("2024 Provost");
    expect(
      electionRaceTitle({ electionType: "governor", countryId: "WAL", state: "CDF" }, 2024)
    ).toBe("2024 Leader");
  });

  it("keeps the generic Governor label for countries without a titled sub-regional executive", () => {
    expect(
      electionRaceTitle({ electionType: "governor", countryId: "US", state: "CA" }, 2024)
    ).toBe("2024 Governor");
  });

  it("shows per-region council seat counts", () => {
    expect(
      electionRaceTitle(
        { electionType: "regionalCouncil", countryId: "SCO", state: "GLA", totalSeats: 6 },
        2024
      )
    ).toBe("2024 Regional Council · 6 seats");
  });
});

describe("electionRaceTitle — NG country-aware chamber labels", () => {
  it("labels NG House/Senate/Assembly without US strings", () => {
    expect(
      electionRaceTitle({ electionType: "house", countryId: "NG", state: "NORTH_EAST" }, 2009)
    ).toContain("House of Representatives");
    expect(
      electionRaceTitle({ electionType: "senate", countryId: "NG", state: "NORTH_EAST" }, 2009)
    ).toContain("Senate");
    expect(
      electionRaceTitle(
        { electionType: "regionalCouncil", countryId: "NG", state: "NORTH_EAST" },
        2009
      )
    ).toContain("State House of Assembly");
  });

  it("uses plain de-prefixed US labels (no 'U.S.')", () => {
    const title = electionRaceTitle({ electionType: "house", countryId: "US", state: "CA" }, 2024);
    expect(title).toContain("House");
    expect(title).not.toContain("U.S.");
  });
});
