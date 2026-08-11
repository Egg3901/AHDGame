/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExpandMarketModal from "./ExpandMarketModal";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (amount: number) => `$${Math.round(amount).toLocaleString("en-US")}`,
  }),
}));

const marketResponse = {
  suggestions: [
    {
      stateId: "CA",
      stateName: "California",
      countryId: "US",
      unownedRevenue: 0,
      splitCost: 0,
      estimatedRevenueCapture: 0,
      canAfford: true,
      ownedSectorId: null,
      competitors: [],
      totalCompetitorRevenue: 0,
      headroomUnits: 543_000,
      starterBuildCostAnchor: 1_100,
      foundingTotalAnchor: 1_600,
    },
  ],
  availableCountries: ["US"],
  liquidCapital: 25_400,
  liquidCurrencyCode: "USD",
  plantsMode: true,
  starterUnits: 60,
  foundingFeeAnchor: 500,
  foundingBuildTurns: 24,
};

function suggestionReply() {
  return Promise.resolve({
    ok: true,
    json: async () => marketResponse,
  } as Response);
}

describe("ExpandMarketModal plants market finder", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens on ranked new markets and limits the sector choice to primary and secondary", async () => {
    const fetchMock = vi.fn(suggestionReply);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ExpandMarketModal
        corpId="corp-1"
        primaryType="agriculture"
        secondaryType="retail"
        liquidCapital={25_400}
        plantsMode
        onClose={() => undefined}
      />
    );

    expect(screen.getByText("Build a new sector")).toBeTruthy();
    expect(screen.queryByText("Back to sector type selection")).toBeNull();

    await screen.findAllByText("California");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("sectorType=agriculture&mode=unowned&ownership=unowned")
    );
    const sectorTypeSelect = screen.getByLabelText("Sector type") as HTMLSelectElement;
    expect(sectorTypeSelect.value).toBe("agriculture");
    expect(sectorTypeSelect.options).toHaveLength(2);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toContain(
      "Retail (secondary)"
    );
    expect(screen.getByText("9,050")).toBeTruthy();
    expect(screen.getByText("farms")).toBeTruthy();
    expect(screen.getByText("Best fit")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Sector type"), { target: { value: "retail" } });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("sectorType=retail"))
    );
  });

  it("reviews the selected market and sends its sector type to founding", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(suggestionReply)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sectorId: "sector-9" }),
      } as Response);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ExpandMarketModal
        corpId="corp-1"
        primaryType="agriculture"
        secondaryType="retail"
        liquidCapital={25_400}
        plantsMode
        onClose={() => undefined}
      />
    );

    await screen.findByText("Best fit");
    fireEvent.click(screen.getByRole("button", { name: "Review farm" }));
    expect(await screen.findByText("Review California")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Build it" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/corporations/corp-1/sectors");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({
      stateId: "CA",
      sectorType: "agriculture",
    });
    expect(router.push).toHaveBeenCalledWith("/corporation/corp-1/sector/sector-9?build=1");
  });
});
