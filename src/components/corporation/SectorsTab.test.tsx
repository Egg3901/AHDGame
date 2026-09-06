/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SectorsTab from "./SectorsTab";
import type { SectorDetail } from "./CorporationPageTypes";

vi.mock("./ExpandMarketModal", () => ({
  default: ({
    initialSectorType,
    initialStateId,
  }: {
    initialSectorType?: string;
    initialStateId?: string;
  }) => (
    <div
      data-testid="expand-modal"
      data-sector-type={initialSectorType ?? ""}
      data-state-id={initialStateId ?? ""}
    >
      Expand modal open
    </div>
  ),
}));

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (v: number) => `$${v}`,
    toInternalFrom: (v: number) => v,
  }),
}));

const baseProps = {
  sectors: [],
  corpId: "corp-1",
  corporationType: "defense" as const,
  liquidCapital: 40_000,
  logisticsStrength: 0,
  onAbandonSector: () => undefined,
  abandoningSectorId: null,
  sectorsMessage: null,
  currentTurn: 10,
  plantsMode: true,
};

describe("SectorsTab Build-here deep link", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens the expand modal only after isCeo resolves (ticket #1004 race)", async () => {
    const onConsumed = vi.fn();
    const { rerender } = render(
      <SectorsTab
        {...baseProps}
        isCeo={false}
        expandOnMount
        expandSectorType="defense"
        expandStateId="MD"
        onExpandDeepLinkConsumed={onConsumed}
      />
    );

    expect(screen.queryByTestId("expand-modal")).toBeNull();
    expect(onConsumed).not.toHaveBeenCalled();

    rerender(
      <SectorsTab
        {...baseProps}
        isCeo
        expandOnMount
        expandSectorType="defense"
        expandStateId="MD"
        onExpandDeepLinkConsumed={onConsumed}
      />
    );

    await waitFor(() => expect(screen.getByTestId("expand-modal")).toBeTruthy());
    const modal = screen.getByTestId("expand-modal");
    expect(modal.getAttribute("data-sector-type")).toBe("defense");
    expect(modal.getAttribute("data-state-id")).toBe("MD");
    expect(onConsumed).toHaveBeenCalledTimes(1);
  });

  it("does not open the expand modal without the deep-link flag", () => {
    render(<SectorsTab {...baseProps} isCeo />);
    expect(screen.queryByTestId("expand-modal")).toBeNull();
  });
});

function sector(over: Partial<SectorDetail> & Pick<SectorDetail, "_id" | "sectorType">) {
  return {
    stateId: "OH",
    stateName: "Ohio",
    sectorLabel: "Sector",
    targetGrowthRate: 0,
    currentGrowthRate: 0,
    currentGrowthCost: 0,
    revenue: 1_000_000,
    financialRevenue: 1_000_000,
    realizedRevenue: 1_000_000,
    profitMargin: 10,
    effectiveProfitMargin: 10,
    marketSharePercent: 10,
    unemploymentModifier: 0,
    gridReliabilityModifier: 0,
    corruptionModifier: 0,
    workforceSkillModifier: null,
    crimeRateModifier: null,
    broadbandModifier: null,
    roadConditionModifier: null,
    carbonEmissionsModifier: null,
    costOfLivingModifier: null,
    commodityModifier: 0,
    homeLocationModifier: 0,
    stateSectorSpecializationModifier: 0,
    inflationModifier: 0,
    debtToGdpModifier: 0,
    deficitToGdpModifier: 0,
    foreignTariffModifier: 0,
    domesticTariffMalus: 0,
    profit: 100_000,
    workers: 1_000,
    capacityUnits: 10_000,
    plantCount: 2,
    producedUnits: 9_300,
    soldUnits: 9_000,
    ...over,
  } as SectorDetail;
}

const mixedSectors = [
  sector({
    _id: "s1",
    sectorType: "manufacturing",
    strategyId: "heavy_metals",
    displayName: "Cleveland Works",
  }),
  sector({
    _id: "s2",
    sectorType: "manufacturing",
    strategyId: "electronics_manufacturing",
    stateId: "MI",
    stateName: "Michigan",
    displayName: "Flint Assembly",
  }),
  sector({
    _id: "s3",
    sectorType: "energy",
    strategyId: "renewables",
    stateId: "NM",
    stateName: "New Mexico",
    displayName: "Albuquerque Solar",
  }),
];

describe("SectorsTab type rail and dossier", () => {
  afterEach(() => {
    cleanup();
  });

  it("lists one chip per owned type and shows every sector until one is picked", () => {
    render(<SectorsTab {...baseProps} sectors={mixedSectors} isCeo />);

    const rail = screen.getByRole("tablist", { name: "Sector type" });
    expect(
      within(rail)
        .getByRole("tab", { name: /All sectors/ })
        .getAttribute("aria-selected")
    ).toBe("true");
    expect(within(rail).getByRole("tab", { name: /Manufacturing/ })).toBeTruthy();
    expect(within(rail).getByRole("tab", { name: /Energy/ })).toBeTruthy();

    expect(screen.getByRole("heading", { name: "Owned Sectors" })).toBeTruthy();
    expect(screen.getByLabelText("Filter by sector type")).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: "Operating strategy" })).toBeNull();
  });

  it("opens the division dossier, its strategy panel and a retitled table", () => {
    render(<SectorsTab {...baseProps} sectors={mixedSectors} isCeo />);

    const rail = screen.getByRole("tablist", { name: "Sector type" });
    fireEvent.click(within(rail).getByRole("tab", { name: /Manufacturing/ }));

    // Two sectors holding two plants each: the headline counts facilities, not
    // the sectors that own them.
    expect(screen.getByRole("heading", { name: "4 plants in 2 states" })).toBeTruthy();
    expect(screen.getByText("Manufacturing division")).toBeTruthy();
    expect(screen.getByText("Line utilisation")).toBeTruthy();

    const strategyTabs = screen.getByRole("tablist", { name: "Operating strategy" });
    expect(within(strategyTabs).getByRole("tab", { name: /Heavy Metals/ })).toBeTruthy();
    expect(
      within(strategyTabs).getByRole("tab", { name: /Electronics Manufacturing/ })
    ).toBeTruthy();

    expect(screen.getByRole("heading", { name: "Manufacturing plants" })).toBeTruthy();
    expect(screen.queryByLabelText("Filter by sector type")).toBeNull();
  });

  it("filters the table to the chosen type", () => {
    render(<SectorsTab {...baseProps} sectors={mixedSectors} isCeo />);
    const rail = screen.getByRole("tablist", { name: "Sector type" });

    // Rows render a desktop and a mobile layout, so names appear more than once.
    expect(screen.getAllByText("Albuquerque Solar").length).toBeGreaterThan(0);
    fireEvent.click(within(rail).getByRole("tab", { name: /Manufacturing/ }));
    expect(screen.queryAllByText("Albuquerque Solar")).toHaveLength(0);
    expect(screen.getAllByText("Cleveland Works").length).toBeGreaterThan(0);
  });

  it("opens the expand modal already pointed at the open division", async () => {
    render(<SectorsTab {...baseProps} sectors={mixedSectors} isCeo />);
    const rail = screen.getByRole("tablist", { name: "Sector type" });
    fireEvent.click(within(rail).getByRole("tab", { name: /Energy/ }));

    fireEvent.click(screen.getAllByRole("button", { name: /Build a power station/ })[0]);
    await waitFor(() => expect(screen.getByTestId("expand-modal")).toBeTruthy());
    expect(screen.getByTestId("expand-modal").getAttribute("data-sector-type")).toBe("energy");
  });

  it("leaves the proposed type levers on screen but disabled", () => {
    render(<SectorsTab {...baseProps} sectors={mixedSectors} isCeo />);
    const rail = screen.getByRole("tablist", { name: "Sector type" });
    fireEvent.click(within(rail).getByRole("tab", { name: /Manufacturing/ }));

    for (const button of screen.getAllByRole("button", { name: "Retool line" })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect((screen.getByRole("button", { name: "Switch ▾" }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it("offers exactly two build buttons, neither of them inside the strategy panel", () => {
    render(<SectorsTab {...baseProps} sectors={mixedSectors} isCeo />);
    const rail = screen.getByRole("tablist", { name: "Sector type" });
    fireEvent.click(within(rail).getByRole("tab", { name: /Manufacturing/ }));

    // The dossier and the table each carry one; the strategy panel used to add
    // a third that only differed by pre-selecting a strategy.
    const builds = screen.getAllByRole("button", { name: /Build a plant/ });
    expect(builds).toHaveLength(2);
    for (const button of builds) expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: /Build a plant · / })).toBeNull();
  });

  it("keeps a site whose stored strategy no longer exists visible in the panel", () => {
    const orphaned = [
      sector({
        _id: "o1",
        sectorType: "manufacturing",
        strategyId: "a_removed_method",
        displayName: "Orphan Works",
      }),
    ];
    render(<SectorsTab {...baseProps} sectors={orphaned} isCeo />);
    const rail = screen.getByRole("tablist", { name: "Sector type" });
    fireEvent.click(within(rail).getByRole("tab", { name: /Manufacturing/ }));

    // It must land in some tab rather than vanishing: the badges have to sum
    // to the division's site count.
    const tabs = within(screen.getByRole("tablist", { name: "Operating strategy" })).getAllByRole(
      "tab"
    );
    const counted = tabs.reduce(
      (sum, t) => sum + Number(t.textContent?.match(/(\d+)$/)?.[1] ?? 0),
      0
    );
    expect(counted).toBe(1);
  });

  it("unfilters the table when the last sector of the open division goes away", () => {
    const { rerender } = render(<SectorsTab {...baseProps} sectors={mixedSectors} isCeo />);
    const rail = screen.getByRole("tablist", { name: "Sector type" });
    fireEvent.click(within(rail).getByRole("tab", { name: /Energy/ }));
    expect(screen.getByRole("heading", { name: "Energy power stations" })).toBeTruthy();

    // The CEO abandons the only energy sector. The rail loses the chip, and the
    // table must fall back to every sector rather than filtering to nothing.
    rerender(
      <SectorsTab
        {...baseProps}
        sectors={mixedSectors.filter((s) => s.sectorType !== "energy")}
        isCeo
      />
    );
    expect(screen.getByRole("heading", { name: "Owned Sectors" })).toBeTruthy();
    expect(screen.getAllByText("Cleveland Works").length).toBeGreaterThan(0);
    expect(screen.queryByRole("tablist", { name: "Operating strategy" })).toBeNull();
  });

  it("still filters the table for a sector type the constants no longer name", () => {
    // `sectorType` is a plain string on the wire and a row can carry a type
    // that predates a rename. The chip must still filter, even though there is
    // no dossier, palette or strategy table to open for it.
    const legacy = [
      ...mixedSectors,
      sector({
        _id: "x1",
        sectorType: "shipbuilding" as never,
        stateId: "ME",
        stateName: "Maine",
        displayName: "Bath Yards",
      }),
    ];
    render(<SectorsTab {...baseProps} sectors={legacy} isCeo />);
    const rail = screen.getByRole("tablist", { name: "Sector type" });
    const chip = within(rail).getByRole("tab", { name: /shipbuilding/ });

    fireEvent.click(chip);
    expect(chip.getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByText("Bath Yards").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Cleveland Works")).toHaveLength(0);
    // No dossier and no strategy panel: there is nothing known to describe.
    expect(screen.queryByText(/ division$/)).toBeNull();
    expect(screen.queryByRole("tablist", { name: "Operating strategy" })).toBeNull();
  });

  it("shows no proposed levers to an outsider", () => {
    render(<SectorsTab {...baseProps} sectors={mixedSectors} isCeo={false} />);
    const rail = screen.getByRole("tablist", { name: "Sector type" });
    fireEvent.click(within(rail).getByRole("tab", { name: /Manufacturing/ }));

    expect(screen.queryByRole("button", { name: "Retool line" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Switch ▾" })).toBeNull();
    // The dossier is not CEO-only: an outsider still gets the briefing.
    expect(screen.getByText("Manufacturing division")).toBeTruthy();
  });
});
