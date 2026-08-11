/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GdpDecompositionCard } from "./GdpDecompositionCard";

describe("GdpDecompositionCard", () => {
  const base = {
    gdp: 850000,
    gdpGrowth: 3.2,
    potentialGrowth: 2.4,
    outputGap: 1.1,
    laborForce: 6500000,
    countryId: "US",
  };

  it("shows the potential and cyclical split", () => {
    render(<GdpDecompositionCard {...base} />);
    expect(screen.getByText(/Potential/i)).toBeTruthy();
    expect(screen.getByText(/Cyclical/i)).toBeTruthy();
    // cyclical = 3.2 - 2.4 = +0.8
    expect(screen.getByText(/\+0\.8/)).toBeTruthy();
  });

  it("labels an above-trend economy as running hot", () => {
    render(<GdpDecompositionCard {...base} />);
    expect(screen.getByText(/above trend|running hot|expansion/i)).toBeTruthy();
  });

  it("renders without crashing when optional stocks are null", () => {
    render(
      <GdpDecompositionCard
        gdp={null}
        gdpGrowth={2.0}
        potentialGrowth={2.0}
        outputGap={null}
        laborForce={null}
        countryId="US"
      />
    );
    expect(screen.getAllByText(/GDP/i).length).toBeGreaterThan(0);
  });
});
