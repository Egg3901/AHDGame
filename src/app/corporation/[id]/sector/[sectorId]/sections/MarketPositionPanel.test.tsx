/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MarketPositionPanel from "./MarketPositionPanel";
import type { Market, SectorData, CorporationRef } from "../types";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (value: number) => `M${value}`,
    formatAmountChip: (value: number) => `M${value}`,
    toInternalFrom: (value: number) => value,
  }),
}));

vi.mock("@/components/Tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const sector = {
  sectorLabel: "Technology",
  stateName: "California",
  countryId: "US",
} as unknown as SectorData;

const corporation = {
  name: "The Money Printer",
  brandColor: "#3b82f6",
  liquidCurrencyCode: "USD",
} as unknown as CorporationRef;

/** One NPP rival, shaped like the payload. */
const npp = (name: string, share: number) => ({
  corporationName: name,
  corporationId: name.toLowerCase().replace(/\s/g, "-"),
  marketShare: share,
  revenue: 1000,
  isNpp: true,
});

const player = (name: string, share: number) => ({
  corporationName: name,
  corporationId: name.toLowerCase().replace(/\s/g, "-"),
  marketShare: share,
  revenue: 1000,
  isNpp: false,
});

function makeMarket(competitors: Market["competitors"]): Market {
  return {
    totalMarket: 104_000 * 24,
    marketShare: 5.7,
    competitors,
    unownedRevenue: 0,
    unownedPercent: 0,
  } as Market;
}

function renderPanel(competitors: Market["competitors"]) {
  return render(
    <MarketPositionPanel
      market={makeMarket(competitors)}
      sector={sector}
      corporation={corporation}
      financials={null}
    />
  );
}

describe("MarketPositionPanel NPP grouping", () => {
  it("collapses the NPP field into one row and keeps its corps off screen", () => {
    renderPanel([
      npp("Atlas Mining", 5.56),
      npp("Prime Shipping", 5.68),
      npp("Drive Vehicles", 5.14),
    ]);

    expect(screen.getByText("NPP field")).toBeTruthy();
    expect(screen.getByText("(3 corps)")).toBeTruthy();
    // The whole point: seventeen near-equal rows no longer bury everything else.
    expect(screen.queryByText("Atlas Mining")).toBeNull();
  });

  it("shows the NPP field's combined share, not a per-corp figure", () => {
    renderPanel([npp("Atlas Mining", 5.56), npp("Prime Shipping", 5.68)]);
    expect(screen.getByText("11.24%")).toBeTruthy();
  });

  it("sums shares without leaking a float onto the screen", () => {
    // Per-corp percentages arrive already rounded, so the sum of rounded parts
    // can land on 16.919999999999998.
    renderPanel([npp("A", 5.56), npp("B", 5.68), npp("C", 5.68)]);
    expect(screen.getByText("16.92%")).toBeTruthy();
  });

  it("reveals the NPP roster on expand, and hides it again", () => {
    renderPanel([npp("Atlas Mining", 5.56)]);
    const toggle = screen.getByRole("button", { name: /NPP field/ });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Atlas Mining")).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.queryByText("Atlas Mining")).toBeNull();
  });

  it("lists player rivals directly, never inside the collapsed group", () => {
    renderPanel([npp("Atlas Mining", 5.5), player("Rival Holdings", 8.2)]);
    // Visible without expanding anything.
    expect(screen.getByText("Rival Holdings")).toBeTruthy();
    expect(screen.queryByText("Atlas Mining")).toBeNull();
  });

  it("renders no NPP group at all when every rival is a player", () => {
    renderPanel([player("Rival Holdings", 8.2), player("Second Player Co", 4.1)]);
    expect(screen.queryByText("NPP field")).toBeNull();
    expect(screen.getByText("Rival Holdings")).toBeTruthy();
    expect(screen.getByText("Second Player Co")).toBeTruthy();
  });

  it("treats a payload with no isNpp flag as all-player, exactly as before", () => {
    // Rolling deploy: a response served by the previous API build carries no
    // flag. The panel must render the old way rather than folding every rival
    // into an NPP group nobody can see into.
    render(
      <MarketPositionPanel
        market={makeMarket([
          { corporationName: "Legacy Co", corporationId: "legacy", marketShare: 9, revenue: 1 },
        ] as Market["competitors"])}
        sector={sector}
        corporation={corporation}
        financials={null}
      />
    );
    expect(screen.queryByText("NPP field")).toBeNull();
    expect(screen.getByText("Legacy Co")).toBeTruthy();
  });

  it("names the singular NPP holder rather than saying '1 corps'", () => {
    renderPanel([npp("Atlas Mining", 5.56)]);
    expect(screen.getByText("(1 corp)")).toBeTruthy();
  });
});
