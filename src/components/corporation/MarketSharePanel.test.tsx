/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MarketSharePanel } from "./MarketSharePanel";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        basisChange: {
          turn: 347,
          from: "revenue-proxy-v1",
          to: "plants-ledger-v1",
        },
        series: [
          {
            commodity: "energy",
            label: "Energy",
            icon: "EN",
            unit: "MWh",
            points: [
              {
                turn: 346,
                outputUnits: 9_500_000,
                globalSupplyUnits: 20_000_000,
                sharePercent: 47.5,
                stockUnits: 1_000_000,
              },
              {
                turn: 347,
                outputUnits: 2_150_000,
                globalSupplyUnits: 20_000_000,
                sharePercent: 10.75,
                stockUnits: 1_000_000,
              },
            ],
          },
        ],
      }),
    })
  );
});

describe("MarketSharePanel output basis", () => {
  it("labels the historical calculation change instead of presenting it as lost production", async () => {
    render(<MarketSharePanel corpId="example-corp" />);

    await waitFor(() =>
      expect(screen.getByText(/Reporting basis changed at turn 347/)).toBeTruthy()
    );
    expect(screen.getByText(/reporting correction, not production disappearing/)).toBeTruthy();
    expect(screen.getByText("Basis changed")).toBeTruthy();
  });
});
