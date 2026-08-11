/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import UnionBustingPanel from "./UnionBustingPanel";
import type { SectorData } from "../types";

const baseSector = {
  _id: "s1",
  stateId: "CA",
  stateName: "California",
  sectorType: "manufacturing",
  sectorLabel: "Manufacturing",
  targetGrowthRate: 4,
  currentGrowthRate: 4,
  currentGrowthCost: 0,
  revenue: 1_000_000,
  workers: 500,
  productionPolicy: 0,
  productionPolicyLevel: 0,
  createdAt: "2026-01-01",
  unionization: 42.5,
  strikeActive: false,
  bustingCooldownUntilTurn: null,
} as unknown as SectorData;

describe("UnionBustingPanel", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing for non-CEOs", () => {
    const { container } = render(
      <UnionBustingPanel
        sector={baseSector}
        isCeo={false}
        corpId="c1"
        sectorId="s1"
        onBusted={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows current unionization and disables the button during cooldown", () => {
    render(
      <UnionBustingPanel
        sector={{ ...baseSector, bustingCooldownUntilTurn: 200 }}
        isCeo={true}
        corpId="c1"
        sectorId="s1"
        onBusted={vi.fn()}
      />
    );
    expect(screen.getByText("42.5%")).toBeTruthy();
    expect(screen.getByText(/On cooldown until turn 200/)).toBeTruthy();
    expect((screen.getByText("Bust the Union") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a strike-active badge when the sector is striking", () => {
    render(
      <UnionBustingPanel
        sector={{ ...baseSector, strikeActive: true }}
        isCeo={true}
        corpId="c1"
        sectorId="s1"
        onBusted={vi.fn()}
      />
    );
    expect(screen.getByText(/currently striking/)).toBeTruthy();
  });

  it("calls the API and reports success, triggering onBusted", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, bustingSucceeded: true, unionization: 22.5 }),
    });
    const onBusted = vi.fn();
    render(
      <UnionBustingPanel
        sector={baseSector}
        isCeo={true}
        corpId="c1"
        sectorId="s1"
        onBusted={onBusted}
      />
    );

    fireEvent.click(screen.getByText("Bust the Union"));

    await waitFor(() =>
      expect(screen.getByText(/It worked\. Unionization fell to 22\.5%/)).toBeTruthy()
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/corporations/c1/sectors/s1/union-busting",
      expect.objectContaining({ method: "POST" })
    );
    expect(onBusted).toHaveBeenCalledOnce();
  });

  it("reports a backfire without treating it as an error", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, bustingSucceeded: false, unionization: 60 }),
    });
    render(
      <UnionBustingPanel
        sector={baseSector}
        isCeo={true}
        corpId="c1"
        sectorId="s1"
        onBusted={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Bust the Union"));
    await waitFor(() =>
      expect(screen.getByText(/It backfired\. Unionization climbed to 60\.0%/)).toBeTruthy()
    );
  });

  it("shows the server error message on failure", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Not enough cash to attempt union-busting." }),
    });
    render(
      <UnionBustingPanel
        sector={baseSector}
        isCeo={true}
        corpId="c1"
        sectorId="s1"
        onBusted={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Bust the Union"));
    await waitFor(() => expect(screen.getByText(/Not enough cash/)).toBeTruthy());
  });
});
