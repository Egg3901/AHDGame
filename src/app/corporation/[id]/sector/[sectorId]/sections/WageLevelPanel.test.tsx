/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WageLevelPanel from "./WageLevelPanel";
import type { SectorData } from "../types";

const baseSector = {
  _id: "s1",
  stateId: "CA",
  stateName: "California",
  sectorType: "technology",
  sectorLabel: "Technology",
  targetGrowthRate: 4,
  currentGrowthRate: 4,
  currentGrowthCost: 0,
  revenue: 1_000_000,
  workers: 500,
  productionPolicy: 0,
  productionPolicyLevel: 0,
  wageLevel: 1.2,
  payVsMedian: 0.55,
  minWageUplift: 0,
  createdAt: "2026-01-01",
} as unknown as SectorData;

function noop() {}

describe("WageLevelPanel", () => {
  it("shows the active wage level, % vs baseline, and pay level vs median", () => {
    render(
      <WageLevelPanel
        sector={baseSector}
        isCeo={false}
        wageDraft={1.2}
        wageSaving={false}
        wageMessage=""
        onWageChange={noop}
        onSave={noop}
      />
    );
    expect(screen.getByText(/1\.20×/)).toBeTruthy();
    expect(screen.getByText(/\+20%/)).toBeTruthy();
    expect(screen.getByText(/0\.55× regional median/)).toBeTruthy();
  });

  it("shows a minimum-wage badge only when the floor binds", () => {
    const { rerender } = render(
      <WageLevelPanel
        sector={baseSector}
        isCeo={false}
        wageDraft={1.2}
        wageSaving={false}
        wageMessage=""
        onWageChange={noop}
        onSave={noop}
      />
    );
    expect(screen.queryByText(/Minimum-wage floor/)).toBeNull();

    rerender(
      <WageLevelPanel
        sector={{ ...baseSector, minWageUplift: 0.3 } as SectorData}
        isCeo={false}
        wageDraft={1.2}
        wageSaving={false}
        wageMessage=""
        onWageChange={noop}
        onSave={noop}
      />
    );
    expect(screen.getByText(/Minimum-wage floor: \+30% labour cost/)).toBeTruthy();
  });

  it("hides the editor controls for non-CEOs", () => {
    render(
      <WageLevelPanel
        sector={baseSector}
        isCeo={false}
        wageDraft={1.2}
        wageSaving={false}
        wageMessage=""
        onWageChange={noop}
        onSave={noop}
      />
    );
    expect(screen.queryByText("Set Wage")).toBeNull();
  });

  it("lets a CEO change the wage and save", () => {
    const onWageChange = vi.fn();
    const onSave = vi.fn();
    render(
      <WageLevelPanel
        sector={baseSector}
        isCeo={true}
        wageDraft={1.0}
        wageSaving={false}
        wageMessage=""
        onWageChange={onWageChange}
        onSave={onSave}
      />
    );
    const number = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(number, { target: { value: "1.3" } });
    expect(onWageChange).toHaveBeenCalledWith(1.3);

    fireEvent.click(screen.getByText("Set Wage"));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("disables the button while saving", () => {
    render(
      <WageLevelPanel
        sector={baseSector}
        isCeo={true}
        wageDraft={1.0}
        wageSaving={true}
        wageMessage=""
        onWageChange={noop}
        onSave={noop}
      />
    );
    expect((screen.getByText("Saving...") as HTMLButtonElement).disabled).toBe(true);
  });

  it("code-review fix #11: shows a union wage-demand banner only when present", () => {
    const { rerender } = render(
      <WageLevelPanel
        sector={baseSector}
        isCeo={false}
        wageDraft={1.2}
        wageSaving={false}
        wageMessage=""
        onWageChange={noop}
        onSave={noop}
      />
    );
    expect(screen.queryByText(/is demanding/)).toBeNull();

    rerender(
      <WageLevelPanel
        sector={{ ...baseSector, unionWageDemand: 1.3 } as SectorData}
        isCeo={false}
        wageDraft={1.2}
        wageSaving={false}
        wageMessage=""
        onWageChange={noop}
        onSave={noop}
      />
    );
    expect(screen.getByText(/is demanding a 1\.30× wage level/)).toBeTruthy();
    expect(screen.getByText(/Your current wage does not meet it/)).toBeTruthy();
  });
});
