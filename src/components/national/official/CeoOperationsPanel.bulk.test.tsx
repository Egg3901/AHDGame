/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CeoOperationsPanel } from "./CeoOperationsPanel";

const vm = {
  countryId: "US",
  currency: "USD",
  finance: {
    profitRetentionPercent: 50,
    treasuryDrawCap: 0,
    liquidCapital: 0,
    rdBudgetPerTurn: 0,
    rdScore: 0,
    rdFullFundBudget: 0,
    rdSustainChancePercent: 0,
  },
  stats: { grossRevenuePerTurn: 0 },
  holdingsByRegion: [
    {
      sectors: [
        {
          sectorId: "s1",
          stateName: "California",
          sectorType: "energy",
          revenue: 1000,
          workers: 10,
          profitMargin: 10,
          currentGrowthRate: 4,
          targetGrowthRate: 4,
          productionPolicy: 0,
          productionPolicyLevel: 0,
        },
      ],
    },
  ],
} as never;

function bulkCalls() {
  return vi.mocked(global.fetch).mock.calls.filter((c) => String(c[0]).includes("/sectors/bulk"));
}

describe("CeoOperationsPanel — bulk by type", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, matchedCount: 1 }),
    } as never);
  });

  it("production Set production posts to /sectors/bulk with countryId + sectorType", async () => {
    render(<CeoOperationsPanel vm={vm} corpId="c1" onRefresh={vi.fn()} />);
    fireEvent.click(screen.getAllByText("Set production")[0]);
    await waitFor(() => {
      const call = bulkCalls()[0];
      expect(call).toBeTruthy();
      expect(JSON.parse(String((call![1] as RequestInit).body))).toMatchObject({
        countryId: "US",
        sectorType: "energy",
      });
    });
  });

  it("growth Set growth previews (preview:true) then confirms", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          matchedCount: 1,
          growth: {
            targetGrowthRate: 6,
            projectedTotalCostPerTurn: 200,
            currentTotalCostPerTurn: 50,
            costDeltaPerTurn: 150,
          },
        }),
      } as never)
      .mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, matchedCount: 1 }),
      } as never);

    render(<CeoOperationsPanel vm={vm} corpId="c1" onRefresh={vi.fn()} />);
    fireEvent.click(screen.getAllByText("Set growth")[0]);
    await waitFor(() => {
      const body = JSON.parse(String((bulkCalls()[0]![1] as RequestInit).body));
      expect(body).toMatchObject({ countryId: "US", sectorType: "energy", preview: true });
    });
    fireEvent.click(await screen.findByText("Confirm"));
    await waitFor(() => {
      const last = bulkCalls().at(-1)!;
      const body = JSON.parse(String((last[1] as RequestInit).body));
      expect(body.targetGrowthRate).toEqual(expect.any(Number));
      expect(body.preview).toBeUndefined();
    });
  });

  it("pricing posture chip posts to /sectors/bulk with pricingPosture", async () => {
    render(<CeoOperationsPanel vm={vm} corpId="c1" onRefresh={vi.fn()} />);
    // First "-10%" in the bulk-by-type energy card (pricing posture).
    fireEvent.click(screen.getAllByText("-10%")[0]);
    await waitFor(() => {
      const call = bulkCalls().at(-1);
      expect(call).toBeTruthy();
      expect(JSON.parse(String((call![1] as RequestInit).body))).toMatchObject({
        countryId: "US",
        sectorType: "energy",
        pricingPosture: -0.1,
      });
    });
  });

  it("pricing Auto posts pricingPosture null", async () => {
    render(<CeoOperationsPanel vm={vm} corpId="c1" onRefresh={vi.fn()} />);
    fireEvent.click(screen.getAllByText("Auto")[0]);
    await waitFor(() => {
      const call = bulkCalls().at(-1);
      expect(call).toBeTruthy();
      expect(JSON.parse(String((call![1] as RequestInit).body))).toMatchObject({
        countryId: "US",
        pricingPosture: null,
      });
    });
  });
});
