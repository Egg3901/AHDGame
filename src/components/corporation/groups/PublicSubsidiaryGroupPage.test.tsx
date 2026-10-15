/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/corporations.json";
import { PublicSubsidiaryGroupPage } from "./PublicSubsidiaryGroupPage";
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount: (n: number) => `A${n}` }),
}));
vi.mock("../CorporationLogo", () => ({ CorporationLogo: () => null }));
vi.mock("./SubsidiaryGroupPage", () => ({
  SubsidiaryGroupPage: () => <div>Owner management page</div>,
}));
let canViewManagement = false;
let amounts: number | null = 100;
vi.mock("@/components/market/useMarketJson", () => ({
  useMarketJson: () => ({
    loading: false,
    error: "",
    data: {
      canViewManagement,
      group: {
        id: "A",
        pathId: "1",
        name: "Harbor Group",
        parentName: "Harbor",
        members: [],
        equityValueAnchor: amounts,
        cashAnchor: amounts,
        revenueAnchor: amounts,
        sectorCount: 2,
        regionCount: 1,
        countries: ["US"],
      },
    },
  }),
}));
function mount() {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PublicSubsidiaryGroupPage corpId="1" />
    </NextIntlClientProvider>
  );
}
beforeEach(() => {
  cleanup();
  canViewManagement = false;
  amounts = 100;
});
describe("public group overview", () => {
  it("keeps visitors on overview even with a private hash", () => {
    window.history.replaceState(null, "", "#financials");
    mount();
    expect(screen.getByRole("heading", { name: "Harbor Group" })).toBeTruthy();
    expect(screen.getByText("Overview")).toBeTruthy();
    expect(screen.queryByText("Owner management page")).toBeNull();
    expect(screen.queryByRole("button", { name: /financial|direction|supply/i })).toBeNull();
  });
  it("renders private or unavailable financial totals without formatting null as zero", () => {
    amounts = null;
    mount();
    expect(screen.getAllByText("Unavailable")).toHaveLength(3);
    expect(screen.queryByText("A0")).toBeNull();
  });
  it("preserves the owner's management page", () => {
    canViewManagement = true;
    mount();
    expect(screen.getByText("Owner management page")).toBeTruthy();
  });
});
