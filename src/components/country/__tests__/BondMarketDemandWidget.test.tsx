/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { BondMarketDemandWidget } from "../BondMarketDemandWidget";

describe("BondMarketDemandWidget", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders loading state initially", () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    const { container } = render(<BondMarketDemandWidget countryCode="US" />);
    // Loading state renders skeleton placeholders (no literal "loading" text).
    expect(screen.getByText("Bond Market Demand")).toBeTruthy();
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("renders demand ratio and components after fetch", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        countryCode: "US",
        currentTurn: 1000,
        snapshot: {
          countryCode: "US",
          currentTurn: 1000,
          debtToGdp: 1.2,
          inflationRate: 0.03,
          trust: 0.55,
          sovereignCouponRate: 4.5,
          fxDepreciationRate10t: 0,
          turnsSinceLastDefault: null,
        },
        demand: {
          demandRatio: 0.92,
          components: [
            { id: "base", label: "Base appetite", contribution: 1.2 },
            { id: "debtToGdp", label: "Debt-to-GDP penalty", contribution: -0.18 },
            { id: "trust", label: "Trust modifier", contribution: 0.02 },
          ],
        },
      }),
    });

    render(<BondMarketDemandWidget countryCode="US" />);

    await waitFor(() => {
      expect(screen.getByText(/0\.92/)).toBeTruthy();
    });
    expect(screen.getByText(/Debt-to-GDP penalty/)).toBeTruthy();
    expect(screen.getByText(/Trust modifier/)).toBeTruthy();
  });

  it("renders error state when fetch returns 404", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Country budget not found" }),
    });

    render(<BondMarketDemandWidget countryCode="ZZ" />);

    await waitFor(() => {
      expect(screen.getByText(/not available/i)).toBeTruthy();
    });
  });
});
