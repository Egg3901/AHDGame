/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NationsView from "./NationsView";
import type { WorldTradeLedger } from "@/lib/trade/queries/worldTradeLedger";

const ledger = {
  nations: [
    {
      code: "US",
      name: "United States",
      hue: "#b9933f",
      exports: 80000,
      imports: 25000,
      net: 55000,
      totalVolume: 105000,
      direction: "surplus",
    },
    {
      code: "CN",
      name: "China",
      hue: "#d8b25e",
      exports: 25000,
      imports: 80000,
      net: -55000,
      totalVolume: 105000,
      direction: "deficit",
    },
  ],
  meta: { countries: [] },
} as unknown as WorldTradeLedger;

describe("NationsView", () => {
  it("renders each nation with surplus/deficit direction marks and tones", () => {
    const { container } = render(<NationsView ledger={ledger} />);
    expect(screen.getByText("United States")).toBeTruthy();
    expect(screen.getByText("China")).toBeTruthy();
    // Surplus nation shows ▲, deficit shows ▼.
    expect(container.textContent).toContain("▲");
    expect(container.textContent).toContain("▼");
    // Direction is tokenized, not color-only.
    expect(container.querySelector(".text-success")).toBeTruthy();
    expect(container.querySelector(".text-error")).toBeTruthy();
  });

  it("shows an empty state when no nations trade", () => {
    const empty = { nations: [], meta: { countries: [] } } as unknown as WorldTradeLedger;
    render(<NationsView ledger={empty} />);
    expect(screen.getByText(/No nations are trading yet/)).toBeTruthy();
  });
});
