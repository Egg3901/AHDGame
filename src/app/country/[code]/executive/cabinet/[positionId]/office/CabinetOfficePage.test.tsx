/** @vitest-environment happy-dom */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useParams: () => ({ code: "us", positionId: "secretary_of_treasury" }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
// eslint-disable-next-line @next/next/no-img-element -- test mock replaces next/image with a plain img
vi.mock("next/image", () => ({ default: (p: Record<string, unknown>) => <img alt="" {...p} /> }));
vi.mock("@/components/Avatar", () => ({ Avatar: () => <span /> }));
vi.mock("@/app/congress/components/CongressShared", () => ({ PartyChip: () => <span /> }));

// Stub the panel components so the test exercises tab routing, not panel internals/fetches.
vi.mock("./components/MinisterialOrderPanel", () => ({
  MinisterialOrderPanel: () => <div>ORDERS</div>,
}));
vi.mock("./components/FxReserveTransferPanel", () => ({
  FxReserveTransferPanel: () => <div>FX</div>,
}));
vi.mock("./components/BondProfilePanel", () => ({ BondProfilePanel: () => <div>BOND</div> }));
vi.mock("./components/StateEnterprisesPanel", () => ({
  StateEnterprisesPanel: () => <div>ENTERPRISES</div>,
}));
vi.mock("./components/ChancellorFundingPanel", () => ({
  ChancellorFundingPanel: () => <div>GRANTS</div>,
}));
vi.mock("./components/TierSettingPanel", () => ({ TierSettingPanel: () => <div>TIER</div> }));
vi.mock("./components/RegionalTargetPanel", () => ({
  RegionalTargetPanel: () => <div>REGION</div>,
}));
vi.mock("./components/AdvocacyTogglePanel", () => ({
  AdvocacyTogglePanel: () => <div>ADVOCACY</div>,
}));
vi.mock("./components/EmergencyMechanicPanel", () => ({
  EmergencyMechanicPanel: () => <div>EMERGENCY</div>,
}));
vi.mock("./components/RegionalBreakdownTable", () => ({
  RegionalBreakdownTable: () => <div>BREAKDOWN</div>,
}));
vi.mock("./components/TradeEmbargoPanel", () => ({ TradeEmbargoPanel: () => <div>TRADE</div> }));
vi.mock("./components/ForeignSecPanels", () => ({ ForeignSecPanels: () => <div>FOREIGN</div> }));
vi.mock("./components/CabinetBannerUploader", () => ({ CabinetBannerUploader: () => <div /> }));

vi.mock("./useCabinetOffice", () => ({
  useCabinetOffice: () => ({
    loading: false,
    error: null,
    refetch: vi.fn(),
    data: {
      canAct: false,
      member: {
        characterId: "c1",
        characterName: "Jane Doe",
        party: "p1",
        partyName: "Unity",
        partyColor: "#fff",
        ministerialActions: 3,
        bannerImageUrl: null,
      },
      nationalMetrics: {},
      regionData: [],
      regionalBudgets: [],
      currentSettings: null,
      orders: [],
      activeOrders: [],
      targetCountries: [],
      mechanics: {},
    },
  }),
}));

import CabinetOfficePage from "./page";

afterEach(cleanup);

describe("CabinetOfficePage tabs", () => {
  it("defaults to Overview (ministerial orders) and switches to Treasury (fiscal panels)", () => {
    render(<CabinetOfficePage />);
    expect(screen.getByRole("heading", { name: "Secretary of the Treasury" })).toBeTruthy();
    // Overview is the default tab — ministerial orders always render there.
    expect(screen.getByText("ORDERS")).toBeTruthy();
    expect(screen.queryByText("ENTERPRISES")).toBeNull();

    fireEvent.click(screen.getByText("Treasury"));

    // Treasury now holds the fiscal panels (state enterprises); the monetary panels
    // (bond profile / FX transfer) relocated to the Monetary flagship tab.
    expect(screen.getByText("ENTERPRISES")).toBeTruthy();
    expect(screen.queryByText("ORDERS")).toBeNull();
    expect(screen.queryByText("FX")).toBeNull();
    expect(screen.queryByText("BOND")).toBeNull();
  });
});
