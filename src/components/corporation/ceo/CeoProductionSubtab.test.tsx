/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CeoProductionSubtab from "./CeoProductionSubtab"; // pragma: allowlist secret

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount: (n: number) => `$${n}`, toInternalFrom: (n: number) => n }),
}));

const corporation = { _id: "c1", countryId: "US", liquidCurrencyCode: "USD" } as never;
const sectors = [
  {
    _id: "s1",
    stateId: "CA",
    stateName: "California",
    countryId: "US",
    sectorType: "energy",
    revenue: 1000,
    profit: 100,
    workers: 10,
    effectiveProfitMargin: 10,
    targetGrowthRate: 4,
    currentGrowthRate: 4,
    currentGrowthCost: 50,
    productionPolicy: 0,
    productionPolicyLevel: 0,
  },
] as never;

describe("CeoProductionSubtab — bulk growth", () => {
  // pragma: allowlist secret
  it("growth Set growth previews then confirms via onBulkOperations", async () => {
    const onBulkOperations = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        matchedCount: 1,
        growth: {
          targetGrowthRate: 8,
          projectedTotalCostPerTurn: 200,
          currentTotalCostPerTurn: 50,
          costDeltaPerTurn: 150,
        },
      })
      .mockResolvedValueOnce({ ok: true, matchedCount: 1 });

    render(
      <CeoProductionSubtab // pragma: allowlist secret
        corporation={corporation}
        sectors={sectors}
        corpId="c1"
        onSavePolicy={vi.fn()}
        onBulkOperations={onBulkOperations}
        onSectorGrowth={vi.fn()}
      />
    );

    // Switch to "By Type" mode.
    fireEvent.click(screen.getByText("By Type"));

    // Growth "Set growth" triggers a preview (preview:true).
    fireEvent.click(screen.getByText("Set growth"));
    await waitFor(() =>
      expect(onBulkOperations).toHaveBeenCalledWith(
        "US",
        "energy",
        expect.objectContaining({ preview: true })
      )
    );

    // Confirm panel appears; confirming applies without preview.
    fireEvent.click(await screen.findByText("Confirm"));
    await waitFor(() =>
      expect(onBulkOperations).toHaveBeenLastCalledWith(
        "US",
        "energy",
        expect.objectContaining({ targetGrowthRate: expect.any(Number) })
      )
    );
  });

  it("production Set production applies directly via onBulkOperations", async () => {
    const onBulkOperations = vi.fn().mockResolvedValue({ ok: true, matchedCount: 1 });
    render(
      <CeoProductionSubtab // pragma: allowlist secret
        corporation={corporation}
        sectors={sectors}
        corpId="c1"
        onSavePolicy={vi.fn()}
        onBulkOperations={onBulkOperations}
        onSectorGrowth={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("By Type"));
    fireEvent.click(screen.getByText("Set production"));
    await waitFor(() =>
      expect(onBulkOperations).toHaveBeenCalledWith(
        "US",
        "energy",
        expect.objectContaining({ productionPolicy: expect.any(Number) })
      )
    );
  });

  it("By Type groups type cards under per-country accordions (home country open)", async () => {
    const multi = [
      {
        _id: "s1",
        stateId: "CA",
        stateName: "California",
        countryId: "US",
        sectorType: "energy",
        revenue: 1000,
        profit: 100,
        workers: 10,
        effectiveProfitMargin: 10,
        targetGrowthRate: 4,
        currentGrowthRate: 4,
        currentGrowthCost: 50,
        productionPolicy: 0,
        productionPolicyLevel: 0,
      }, // US / energy (home country)
      {
        _id: "s2",
        stateId: "DB",
        stateName: "Dongbei",
        countryId: "CN",
        sectorType: "technology",
        revenue: 500,
        profit: 50,
        workers: 5,
        effectiveProfitMargin: 8,
        targetGrowthRate: 2,
        currentGrowthRate: 2,
        currentGrowthCost: 20,
        productionPolicy: 0,
        productionPolicyLevel: 0,
      },
    ] as never;
    render(
      <CeoProductionSubtab // pragma: allowlist secret
        corporation={corporation}
        sectors={multi}
        corpId="c1"
        onSavePolicy={vi.fn()}
        onBulkOperations={vi.fn().mockResolvedValue({ ok: true })}
        onSectorGrowth={vi.fn().mockResolvedValue({ ok: true })}
      />
    );
    fireEvent.click(screen.getByText("By Type"));
    // Country accordion headers present.
    expect(screen.getByRole("button", { name: /US/ })).toBeTruthy();
    const cnHeader = screen.getByRole("button", { name: /CN/ });
    expect(cnHeader).toBeTruthy();
    // Home country (US) open by default → Energy type card visible.
    expect(screen.getByText("Energy")).toBeTruthy();
    // CN collapsed → Technology card hidden until expanded.
    expect(screen.queryByText("Technology")).toBeNull();
    fireEvent.click(cnHeader);
    expect(await screen.findByText("Technology")).toBeTruthy();
  });

  it("By Sector growth previews then confirms via onSectorGrowth", async () => {
    const onSectorGrowth = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        projectedCostPerTurn: 200,
        currentCostPerTurn: 50,
        costDeltaPerTurn: 150,
      })
      .mockResolvedValueOnce({ ok: true });
    render(
      <CeoProductionSubtab // pragma: allowlist secret
        corporation={corporation}
        sectors={sectors}
        corpId="c1"
        onSavePolicy={vi.fn()}
        onBulkOperations={vi.fn().mockResolvedValue({ ok: true })}
        onSectorGrowth={onSectorGrowth}
      />
    );
    // By Sector is the default mode.
    fireEvent.click(screen.getByText("Set growth"));
    await waitFor(() =>
      expect(onSectorGrowth).toHaveBeenCalledWith(
        "s1",
        expect.any(Number),
        expect.objectContaining({ preview: true })
      )
    );
    fireEvent.click(await screen.findByText("Confirm"));
    await waitFor(() => expect(onSectorGrowth).toHaveBeenLastCalledWith("s1", expect.any(Number)));
  });

  it("pricing posture applies directly via onBulkOperations", async () => {
    const onBulkOperations = vi.fn().mockResolvedValue({ ok: true, matchedCount: 1 });
    render(
      <CeoProductionSubtab // pragma: allowlist secret
        corporation={corporation}
        sectors={sectors}
        corpId="c1"
        onSavePolicy={vi.fn()}
        onBulkOperations={onBulkOperations}
        onSectorGrowth={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("By Type"));
    fireEvent.click(screen.getByText("-10%"));
    await waitFor(() =>
      expect(onBulkOperations).toHaveBeenCalledWith(
        "US",
        "energy",
        expect.objectContaining({ pricingPosture: -0.1 })
      )
    );
  });

  it("pricing Auto applies pricingPosture null via onBulkOperations", async () => {
    const onBulkOperations = vi.fn().mockResolvedValue({ ok: true, matchedCount: 1 });
    render(
      <CeoProductionSubtab // pragma: allowlist secret
        corporation={corporation}
        sectors={sectors}
        corpId="c1"
        onSavePolicy={vi.fn()}
        onBulkOperations={onBulkOperations}
        onSectorGrowth={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("By Type"));
    fireEvent.click(screen.getByText("Auto"));
    await waitFor(() =>
      expect(onBulkOperations).toHaveBeenCalledWith(
        "US",
        "energy",
        expect.objectContaining({ pricingPosture: null })
      )
    );
  });
});
