/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NationalSectorBoard } from "./NationalSectorBoard";
import type { CountrySectorMixEntry } from "@/lib/economy/sectorMix";

const mix: CountrySectorMixEntry[] = [
  {
    type: "financial",
    label: "Financial",
    totalMarketAnchor: 48_200_000,
    ownedPercent: 66,
    largestState: { stateId: "NY", stateName: "New York" },
    avgGrowth: 2.45,
  },
  {
    type: "energy",
    label: "Energy",
    totalMarketAnchor: 58_900_000,
    ownedPercent: 74,
    largestState: { stateId: "TX", stateName: "Texas" },
    avgGrowth: -1.3,
  },
  {
    type: "extraction",
    label: "Extraction",
    totalMarketAnchor: 0,
    ownedPercent: 0,
    largestState: null,
    avgGrowth: null,
  },
];

const fmt = (v: number) => `$${(v / 1_000_000).toFixed(1)}M`;

describe("NationalSectorBoard", () => {
  it("renders tiles sorted by market size, deep-linking the largest state's Economy tab", () => {
    render(<NationalSectorBoard countryId="US" sectorMix={mix} formatMarket={fmt} />);
    const links = screen.getAllByRole("link");
    expect(links[0].textContent).toContain("Energy");
    expect(links[0].getAttribute("href")).toBe("/country/us/region/TX?tab=economy&sector=energy");
    expect(links[0].getAttribute("title")).toMatch(/Texas.*largest Energy market/);
    expect(screen.getByText("↳ Texas")).toBeTruthy();
    expect(screen.getByText("$58.9M")).toBeTruthy();
  });

  it("shows colored average growth instead of the owned percentage", () => {
    render(<NationalSectorBoard countryId="US" sectorMix={mix} formatMarket={fmt} />);
    expect(screen.queryByText("74%")).toBeNull();
    const pos = screen.getByText("+2.45%");
    expect(pos.className).toContain("text-success");
    const neg = screen.getByText("-1.30%");
    expect(neg.className).toContain("text-error");
  });

  it("renders inactive sectors as plain tiles without a link", () => {
    render(<NationalSectorBoard countryId="US" sectorMix={mix} formatMarket={fmt} />);
    expect(screen.getByText("Extraction")).toBeTruthy();
    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.textContent?.includes("Extraction"))).toBe(false);
  });
});
