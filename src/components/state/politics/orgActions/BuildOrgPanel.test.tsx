/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/contexts/ToastContext";
import { BuildOrgPanel } from "./BuildOrgPanel";

afterEach(() => vi.unstubAllGlobals());

function renderPanel(extra?: Partial<React.ComponentProps<typeof BuildOrgPanel>>) {
  return render(
    <ToastProvider>
      <BuildOrgPanel
        countryCode="US"
        stateId="AK"
        partyId="9"
        partyColor="#2563eb"
        ps={100}
        hasPresence
        canBuildOrg
        onSuccess={() => {}}
        {...extra}
      />
    </ToastProvider>
  );
}

describe("BuildOrgPanel", () => {
  it("renders a projected Cost/Org gain from the preview", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.includes("/ps-spend-scope")) {
          return {
            json: async () => ({
              ok: true,
              eligibleScopes: { state: true, national: false },
              statePoolPS: 100,
              nationalPoolPS: 0,
            }),
          };
        }
        // build-org/preview
        return {
          json: async () => ({
            ok: true,
            effectiveCost: 5,
            pressureValue: 0,
            projectedGain: 1.25,
            factors: { base: 2, headroom: 0.5, ownDiminishing: 0.5, psLeverage: 1, catchup: 1 },
            scope: "state",
          }),
        };
      })
    );
    renderPanel();
    await waitFor(() => expect(screen.getByText("This click")).toBeTruthy());
    expect(screen.getByText("Cost")).toBeTruthy();
    expect(screen.getByText("Org gain")).toBeTruthy();
    expect(screen.getByText(/\+1\.25/)).toBeTruthy();
  });

  it("renders per-rival poach lines from the preview", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.includes("/ps-spend-scope")) {
          return {
            json: async () => ({
              ok: true,
              eligibleScopes: { state: true, national: false },
              statePoolPS: 100,
              nationalPoolPS: 0,
            }),
          };
        }
        return {
          json: async () => ({
            ok: true,
            effectiveCost: 1,
            pressureValue: 0,
            projectedGain: 0.36,
            poaches: [
              { partyId: "2", loss: 0.17 },
              { partyId: "3", loss: 0.19 },
            ],
            factors: { base: 2, headroom: 0, ownDiminishing: 0.7, psLeverage: 1.5, catchup: 1 },
            scope: "state",
          }),
        };
      })
    );
    renderPanel();
    await waitFor(() => expect(screen.getByText(/taken from rivals/i)).toBeTruthy());
    expect(screen.getByText(/−0\.17 Org/)).toBeTruthy();
    expect(screen.getByText(/−0\.19 Org/)).toBeTruthy();
  });

  it("prefers rival party names over Party #id in the poach list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.includes("/ps-spend-scope")) {
          return {
            json: async () => ({
              ok: true,
              eligibleScopes: { state: true, national: false },
              statePoolPS: 100,
              nationalPoolPS: 0,
            }),
          };
        }
        return {
          json: async () => ({
            ok: true,
            effectiveCost: 1,
            pressureValue: 0,
            projectedGain: 0.36,
            poaches: [
              { partyId: "2", loss: 0.17, partyName: "Democratic Party", abbreviation: "DEM" },
              { partyId: "3", loss: 0.19, partyName: "Green Party", abbreviation: "GRN" },
            ],
            factors: { base: 2, headroom: 0, ownDiminishing: 0.7, psLeverage: 1.5, catchup: 1 },
            scope: "state",
          }),
        };
      })
    );
    renderPanel();
    await waitFor(() => expect(screen.getByText("DEM")).toBeTruthy());
    expect(screen.getByText("GRN")).toBeTruthy();
    expect(screen.queryByText(/Party #2/)).toBeNull();
  });

  it("disables the action when the viewer cannot build org", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => ({ ok: false, reason: "auth", message: "no" }) }))
    );
    renderPanel({ canBuildOrg: false });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Build Org" }) as HTMLButtonElement).disabled
      ).toBe(true)
    );
  });

  it("shows national PS in the header when the preview spends the national pool", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.includes("/ps-spend-scope")) {
          return {
            json: async () => ({
              ok: true,
              eligibleScopes: { state: false, national: true },
              statePoolPS: 30,
              nationalPoolPS: 4,
            }),
          };
        }
        return {
          json: async () => ({
            ok: true,
            effectiveCost: 1,
            pressureValue: 0,
            projectedGain: 0.5,
            factors: { base: 2, headroom: 0.5, ownDiminishing: 0.5, psLeverage: 1, catchup: 1 },
            scope: "national-targeted",
          }),
        };
      })
    );
    renderPanel({ ps: 30 });
    await waitFor(() => expect(screen.getByText("National PS")).toBeTruthy());
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText(/\/ Nat'l/)).toBeTruthy();
  });

  // ── Treasury cost (2026-09-02) ──────────────────────────────────────────

  function stubPreview(extra: Record<string, unknown>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.includes("/ps-spend-scope")) {
          return {
            json: async () => ({
              ok: true,
              eligibleScopes: { state: true, national: false },
              statePoolPS: 100,
              nationalPoolPS: 0,
            }),
          };
        }
        return {
          json: async () => ({
            ok: true,
            effectiveCost: 2,
            pressureValue: 1,
            projectedGain: 1.25,
            factors: { base: 2, headroom: 0.5, ownDiminishing: 0.5, psLeverage: 1, catchup: 1 },
            scope: "state",
            ...extra,
          }),
        };
      })
    );
  }

  it("shows the cash price of the next click alongside the PS cost", async () => {
    stubPreview({ cashPrice: 5625, treasuryAvailable: 4_000_000, fundedFraction: 1 });
    renderPanel();

    await waitFor(() => expect(screen.getByText("This click")).toBeTruthy());
    expect(screen.getByText("Estimated Funds")).toBeTruthy();
    expect(screen.getByText(/5,625/)).toBeTruthy();
  });

  it("warns when the treasury can only part-fund the click", async () => {
    stubPreview({ cashPrice: 5625, treasuryAvailable: 2000, fundedFraction: 0.355 });
    renderPanel();

    await waitFor(() => expect(screen.getByText("This click")).toBeTruthy());
    expect(screen.getByText(/Partly funded/i)).toBeTruthy();
    expect(screen.getByText(/36%/)).toBeTruthy();
  });

  it("does not warn about funding when the click is fully funded", async () => {
    stubPreview({ cashPrice: 5625, treasuryAvailable: 4_000_000, fundedFraction: 1 });
    renderPanel();

    await waitFor(() => expect(screen.getByText("This click")).toBeTruthy());
    expect(screen.queryByText(/Partly funded/i)).toBeNull();
  });

  // A dual-role officer sees both buttons but the estimate box can only quote
  // one tier. The national pool is billed at twice the state rate, so each
  // button has to carry its own price or the National one charges double what
  // was shown.
  it("prices each pool button separately when the viewer may spend either", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.includes("/ps-spend-scope")) {
          return {
            json: async () => ({
              ok: true,
              eligibleScopes: { state: true, national: true },
              statePoolPS: 20,
              nationalPoolPS: 150,
            }),
          };
        }
        return {
          json: async () => ({
            ok: true,
            effectiveCost: 1,
            pressureValue: 0,
            projectedGain: 1.25,
            cashPrice: 2813,
            fundedFraction: 1,
            factors: { base: 2, headroom: 0.5, ownDiminishing: 0.5, psLeverage: 1, catchup: 1 },
            scope: "state",
          }),
        };
      })
    );
    renderPanel();

    const stateButton = await screen.findByRole("button", { name: /State PS/ });
    const nationalButton = screen.getByRole("button", { name: /Nat'l PS/ });
    // US state 37,500 × 0.075 = 2,813; national 75,000 × 0.075 = 5,625.
    expect(stateButton.getAttribute("title")).toMatch(/\$2,813/);
    expect(nationalButton.getAttribute("title")).toMatch(/\$5,625/);
  });

  // Price scales with the state's size, so the per-pool button tooltips must
  // carry the multiplier too — they are computed client-side from the preview.
  it("scales both pool button prices by the state's size multiplier", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.includes("/ps-spend-scope")) {
          return {
            json: async () => ({
              ok: true,
              eligibleScopes: { state: true, national: true },
              statePoolPS: 20,
              nationalPoolPS: 150,
            }),
          };
        }
        return {
          json: async () => ({
            ok: true,
            effectiveCost: 1,
            pressureValue: 0,
            projectedGain: 1.25,
            cashPrice: 5625,
            sizeMultiplier: 2,
            fundedFraction: 1,
            factors: { base: 2, headroom: 0.5, ownDiminishing: 0.5, psLeverage: 1, catchup: 1 },
            scope: "state",
          }),
        };
      })
    );
    renderPanel();

    const stateButton = await screen.findByRole("button", { name: /State PS/ });
    const nationalButton = screen.getByRole("button", { name: /Nat'l PS/ });
    // 2x the flat rates: state 2,813 -> 5,625 ; national 5,625 -> 11,250.
    expect(stateButton.getAttribute("title")).toMatch(/\$5,625/);
    expect(nationalButton.getAttribute("title")).toMatch(/\$11,250/);
    expect(screen.getByText(/Larger state: 2\.00× the national average/)).toBeTruthy();
  });

  it("surfaces the treasury refusal message from the preview", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input.includes("/ps-spend-scope")) {
          return {
            json: async () => ({
              ok: true,
              eligibleScopes: { state: true, national: false },
              statePoolPS: 100,
              nationalPoolPS: 0,
            }),
          };
        }
        return {
          json: async () => ({
            ok: false,
            reason: "insufficient-funds",
            message: "This state party cannot afford to organize here.",
          }),
        };
      })
    );
    renderPanel();

    await waitFor(() => expect(screen.getByText(/cannot afford to organize here/i)).toBeTruthy());
  });
});
