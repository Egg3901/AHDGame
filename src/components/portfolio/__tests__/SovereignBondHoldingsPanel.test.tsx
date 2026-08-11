/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SovereignBondHoldingsPanel } from "../SovereignBondHoldingsPanel";

describe("SovereignBondHoldingsPanel", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders empty state when character holds no sovereign bonds", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ characterId: "x", currentTurn: 1000, holdings: [] }),
    });
    render(<SovereignBondHoldingsPanel characterId="x" />);
    await waitFor(() => {
      expect(screen.getByText(/no sovereign holdings/i)).toBeTruthy();
    });
  });

  it("renders per-country holdings with face value and demand contribution", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        characterId: "x",
        currentTurn: 1000,
        holdings: [
          { countryCode: "US", faceValue: 5_000_000, demandContribution: 0.0025 },
          { countryCode: "UK", faceValue: 1_000_000, demandContribution: 0.0005 },
        ],
      }),
    });
    render(<SovereignBondHoldingsPanel characterId="x" />);
    await waitFor(() => {
      expect(screen.getByText(/US/)).toBeTruthy();
      expect(screen.getByText(/UK/)).toBeTruthy();
    });
  });

  it("renders error state when fetch fails", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    });
    render(<SovereignBondHoldingsPanel characterId="x" />);
    await waitFor(() => {
      expect(screen.getByText(/unavailable/i)).toBeTruthy();
    });
  });
});
