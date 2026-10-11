/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PartyData } from "./types";
import { PartyOverviewPanel } from "./PartyOverviewPanel";

describe("PartyOverviewPanel leadership labels", () => {
  it("uses party titles and keeps country defaults for unset titles", () => {
    const party = {
      countryId: "CN",
      leadershipTitles: { chair: "Party Chair" },
      chair: null,
      viceChair: null,
      treasurer: null,
      economicPosition: 0,
      socialPosition: 0,
      politicalStrength: 0,
      effectivePsCap: 0,
    } as PartyData;

    render(<PartyOverviewPanel party={party} />);

    expect(screen.getByText("Party Chair")).toBeTruthy();
    expect(screen.getByText("Deputy General Secretary")).toBeTruthy();
    expect(screen.getByText("National Treasurer")).toBeTruthy();
  });

  it("renders custom titles as text", () => {
    const title = "<img src=x onerror=alert(1)>";
    const party = {
      countryId: "US",
      leadershipTitles: { chair: title },
      chair: null,
      viceChair: null,
      treasurer: null,
      economicPosition: 0,
      socialPosition: 0,
      politicalStrength: 0,
      effectivePsCap: 0,
    } as PartyData;

    render(<PartyOverviewPanel party={party} />);

    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
