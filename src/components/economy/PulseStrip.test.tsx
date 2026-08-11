/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PulseStrip } from "./PulseStrip";

const pulse = {
  gdpMillions: 28_400_000,
  gdpPerCapita: 82_400,
  gdpGrowth: {
    value: 1.9,
    history: [
      { turn: 411, rate: 2.0 },
      { turn: 412, rate: 1.9 },
    ],
  },
  inflation: {
    value: 3.4,
    target: 2,
    history: [
      { turn: 411, rate: 3.2 },
      { turn: 412, rate: 3.4 },
    ],
  },
  primeRate: {
    value: 4.25,
    heldTurns: 6,
    neutral: 3,
    history: [
      { turn: 411, rate: 4.25 },
      { turn: 412, rate: 4.25 },
    ],
  },
  credit: { rating: "AA", debtToGdpRatio: 62 },
};

describe("PulseStrip", () => {
  it("renders the five hero cells with values, target, held turns, and Budget link", () => {
    render(<PulseStrip countryId="US" pulse={pulse} />);
    expect(screen.getByText("$28.40T")).toBeTruthy();
    expect(screen.getByText(/\$82K/)).toBeTruthy();
    expect(screen.getByText(/\+1\.9%/)).toBeTruthy();
    expect(screen.getByText(/3\.4%/)).toBeTruthy();
    expect(screen.getByText(/target 2\.0%/)).toBeTruthy();
    expect(screen.getByText(/4\.25%/)).toBeTruthy();
    expect(screen.getByText(/held 6t/)).toBeTruthy();
    expect(screen.getByText("AA")).toBeTruthy();
    expect(screen.getByText(/62% debt-to-GDP/)).toBeTruthy();
    const link = screen.getByRole("link", { name: /National Budget/ });
    expect(link.getAttribute("href")).toBe("/country/us/budget");
  });

  it("pairs inflation direction with a glyph, never color alone", () => {
    render(<PulseStrip countryId="US" pulse={pulse} />);
    // inflation rose 3.2 → 3.4 → up glyph somewhere in the inflation cell
    expect(screen.getAllByText(/▲/).length).toBeGreaterThan(0);
  });

  it("renders em-dashes when hero values are missing", () => {
    render(
      <PulseStrip
        countryId="US"
        pulse={{
          gdpMillions: 0,
          gdpPerCapita: 0,
          gdpGrowth: { value: null, history: [] },
          inflation: { value: null, target: 2, history: [] },
          primeRate: { value: null, heldTurns: null, neutral: 3, history: [] },
          credit: { rating: null, debtToGdpRatio: null },
        }}
      />
    );
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });
});
