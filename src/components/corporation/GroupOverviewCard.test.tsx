/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupOverviewCard } from "./GroupOverviewCard";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount: (amount: number) => `$${amount}` }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GroupOverviewCard", () => {
  it.each(["Burgess Group", "Burgess Holdings", "Burgess"])(
    "displays the root corporation name %s without adding a Group suffix",
    async (rootName) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            group: {
              rootCorporationId: "root-corp",
              rootName,
              memberCount: 2,
              members: [
                {
                  corporationId: "root-corp",
                  name: rootName,
                  countryId: "GB",
                  isRoot: true,
                  liquidCapitalAnchor: 10,
                  revenueAnchor: 20,
                  sectorCount: 1,
                },
                {
                  corporationId: "subsidiary",
                  name: "Burgess Logistics",
                  countryId: "GB",
                  isRoot: false,
                  liquidCapitalAnchor: 5,
                  revenueAnchor: 15,
                  sectorCount: 1,
                },
              ],
              totalLiquidCapitalAnchor: 15,
              totalRevenueAnchor: 35,
              totalSectorCount: 2,
              industries: ["logistics"],
              countries: ["GB"],
            },
            lossRelief: null,
            transferPricing: null,
          }),
        })
      );

      render(<GroupOverviewCard corpId="root-corp" />);

      await waitFor(() => expect(screen.getByRole("heading", { name: rootName })).toBeTruthy());
      expect(screen.queryByRole("heading", { name: `${rootName} Group` })).toBeNull();
    }
  );
});
