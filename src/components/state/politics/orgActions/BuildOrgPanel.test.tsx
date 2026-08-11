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
});
