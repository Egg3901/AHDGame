/** @vitest-environment happy-dom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AttackPanel from "./AttackPanel";
import ForSalePanel from "./ForSalePanel";
import PricingPanel from "./PricingPanel";
import SectorWorkspaceTabs from "../components/SectorWorkspaceTabs";
import type { AttackInfo, CorporationRef, SectorData } from "../types";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (value: number) => `M${value}`,
    toInternalFrom: (value: number) => value,
  }),
}));
vi.mock("@/components/InfoTooltip", () => ({
  InfoTooltip: ({ trigger }: { trigger: React.ReactNode }) => <>{trigger}</>,
}));
vi.mock("@/components/Tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const attackInfo: AttackInfo = {
  attackCost: 100,
  splitCost: 100,
  splitMsCost: 20,
  splitEstimatedCapture: 1000,
  userLiquidCapital: 1000,
  userMarketingStrength: 100,
  stateId: "US-CA",
};
const attackProps = {
  attackInfo,
  plantsMode: false,
  targetName: "Test corporation",
  showAttack: true,
  showSplit: true,
  attacking: false,
  attackError: "",
  attackMsg: "",
  onAttack: vi.fn().mockResolvedValue(true),
  splitting: false,
  splitError: "",
  splitMsg: "",
  onSplit: vi.fn(),
  sectorCurrencyCode: "USD" as const,
};

const saleProps = {
  sector: {
    stateName: "California",
    forSale: { listedAt: "", priceAnchor: 100, npvAnchor: 125 },
  } as SectorData,
  corporation: { _id: "seller", name: "Test corporation" } as CorporationRef,
  isCeo: false,
  forSaleInfo: {
    viewerCorporationId: "buyer",
    viewerCapitalAnchor: 1000,
    priceInViewerCapital: 100,
    eligible: true,
    conflict: false,
    hasFunds: true,
  },
  listing: false,
  unlisting: false,
  buying: false,
  message: null,
  onList: vi.fn(),
  onUnlist: vi.fn(),
  onBuy: vi.fn(),
};

const pricing = {
  posture: 0.1,
  effectivePosture: 0.1,
  soldFraction: 0.8,
  clearingFactor: 1,
  costPlusEnabled: true,
  costPlusReady: false,
};

describe("sector action visibility", () => {
  it("shows a published pricing sentence without controls or warnings to a non-CEO", () => {
    render(<PricingPanel corporationId="corp" sectorId="sector" isCeo={false} pricing={pricing} />);
    expect(
      screen.getByText("This sector prices its output at +10% relative to the market.")
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("Pricing posture")).toBeNull();
  });

  it("hides cost-plus mode until a producing turn provides its basis", () => {
    render(<PricingPanel corporationId="corp" sectorId="sector" isCeo pricing={pricing} />);
    expect(screen.queryByRole("button", { name: "costPlusMode" })).toBeNull();
    expect(screen.getByRole("button", { name: "Market" })).toBeTruthy();
  });

  it("offers a market reset but no unusable markup controls when the cost-plus basis is lost", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pricingPosture: 0.1, pricingMode: "market" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(
        <PricingPanel
          corporationId="corp"
          sectorId="sector"
          isCeo
          pricing={{ ...pricing, pricingMode: "costPlus" }}
        />
      );
      expect(screen.queryByRole("button", { name: "costPlusMode" })).toBeNull();
      expect(screen.queryByRole("button", { name: "+10%" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "marketMode" }));
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/corporations/corp/sectors/sector/pricing",
        expect.objectContaining({
          body: JSON.stringify({ pricingPosture: 0.1, pricingMode: "market" }),
        })
      );
      await waitFor(() => expect(screen.getByRole("button", { name: "+10%" })).toBeTruthy());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("omits an automatic-pricing action when pricing is already automatic", () => {
    render(
      <PricingPanel
        corporationId="corp"
        sectorId="sector"
        isCeo
        pricing={{ ...pricing, posture: null }}
      />
    );
    expect(screen.queryByRole("button", { name: "Auto" })).toBeNull();
  });

  it.each([
    { userLiquidCapital: 0 },
    { userMarketingStrength: 0 },
    { canAttack: false, canSplit: false },
  ])("hides market actions when they cannot succeed: %j", (unavailable) => {
    const { container } = render(
      <AttackPanel {...attackProps} attackInfo={{ ...attackInfo, ...unavailable }} />
    );
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("uses the whole-plant quote to hide an unaffordable rival split", () => {
    const { container } = render(
      <AttackPanel
        {...attackProps}
        plantsMode
        showSplit={false}
        attackInfo={{
          ...attackInfo,
          attackCost: 0,
          splitMsCost: 0,
          plantCount: 100,
          plantSplitQuote: {
            seizureFraction: 0.1,
            plantsAtRisk: 10,
            trancheBookValueAnchor: 4000,
            cashCostAnchor: 2000,
            marketingStrengthCost: 20,
            successProbability: 0.5,
          },
        }}
      />
    );
    expect(container.textContent).toBe("");
  });

  it("offers an affordable half split without the unavailable full strength choice", () => {
    const onSplit = vi.fn();
    const strength = {
      splitCost: 2000,
      splitMsCost: 20,
      splitEstimatedCapture: 1000,
      splitEstimatedNetIncome: 100,
      projectedMarketShare: 10,
      exceedsDominanceThreshold: false,
    };
    render(
      <AttackPanel
        {...attackProps}
        showAttack={false}
        onSplit={onSplit}
        attackInfo={{
          ...attackInfo,
          splitStrengths: { full: strength, half: { ...strength, splitCost: 500 } },
        }}
      />
    );
    expect(screen.queryByRole("button", { name: "Full" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Split Half" }));
    expect(onSplit).toHaveBeenCalledWith("half");
  });

  it.each([
    {
      eligible: false,
      hasFunds: true,
      blockReason: "merge_blocked" as const,
      text: "cannot be merged",
    },
    {
      eligible: false,
      hasFunds: false,
      blockReason: "insufficient_funds" as const,
      text: "enough liquid capital",
    },
    { eligible: false, hasFunds: true, blockReason: "not_ceo" as const, text: "Only the CEO" },
    { eligible: true, hasFunds: false, blockReason: null, text: "enough liquid capital" },
  ])(
    "explains why an ineligible buyer can't purchase: $blockReason",
    ({ text, ...eligibility }) => {
      const { container } = render(
        <ForSalePanel {...saleProps} forSaleInfo={{ ...saleProps.forSaleInfo, ...eligibility }} />
      );
      expect(container.textContent).toContain("can't buy this sector");
      expect(container.textContent).toContain(text);
      expect(screen.queryByRole("button")).toBeNull();
    }
  );

  it("preserves a funded eligible buyer's purchase action", () => {
    render(<ForSalePanel {...saleProps} />);
    expect(screen.getByRole("button", { name: "Buy sector" })).toBeTruthy();
  });

  it("reduces a foreclosed seller's listing to a sentence", () => {
    render(
      <ForSalePanel
        {...saleProps}
        isCeo
        sector={{
          ...saleProps.sector,
          forSale: { ...saleProps.sector.forSale!, foreclosed: true },
        }}
      />
    );
    expect(screen.getByText("This sector is listed for secured recovery.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("hides the People menu when workforce controls are disabled", () => {
    render(
      <SectorWorkspaceTabs
        activeTab="overview"
        onChange={vi.fn()}
        isCeo={false}
        labourEnabled={false}
      />
    );
    expect(screen.queryByRole("tab", { name: "People" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Manage" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Overview" })).toBeTruthy();
  });
});
