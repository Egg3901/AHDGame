/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { EstateSummaryView } from "./useCabinetOffice";

const office: {
  positionId: string;
  canView: boolean;
  nationalMetrics: Record<string, number>;
  estateSummary?: EstateSummaryView;
} = vi.hoisted(() => ({
  positionId: "secretary_of_treasury",
  canView: true,
  nationalMetrics: {},
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ code: "us", positionId: office.positionId }),
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
      canView: office.canView,
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
      nationalMetrics: office.nationalMetrics,
      estateSummary: office.estateSummary,
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

beforeEach(() => {
  office.positionId = "secretary_of_treasury";
  office.canView = true;
  office.nationalMetrics = {};
  office.estateSummary = undefined;
});
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

describe("estate office outcome metrics", () => {
  beforeEach(() => {
    office.positionId = "attorney_general";
    office.nationalMetrics = {
      "publicSafety.incarcerationRate": 123.4,
      "publicSafety.recidivismRate": 32.1,
    };
    office.estateSummary = {
      count: 2,
      totalUpkeep: 5,
      envelope: 20_000_000,
      portfolioKey: "justice",
      bySite: {},
    };
  });

  it("shows national outcomes together with facilities and their costs", () => {
    render(<CabinetOfficePage />);

    expect(screen.getByText("Incarceration Rate")).toBeTruthy();
    expect(screen.getByText("123.4")).toBeTruthy();
    expect(screen.getByText("Recidivism Rate")).toBeTruthy();
    expect(screen.getByText("32.1%")).toBeTruthy();
    expect(screen.getByText("Facilities")).toBeTruthy();
    expect(screen.getByText("Annual upkeep")).toBeTruthy();
  });

  it("keeps outcome metrics visible before a portfolio has any facilities", () => {
    office.estateSummary = {
      count: 0,
      totalUpkeep: 0,
      envelope: 20_000_000,
      portfolioKey: "justice",
      bySite: {},
    };
    render(<CabinetOfficePage />);

    expect(screen.getByText("Incarceration Rate")).toBeTruthy();
    expect(screen.getByText("Recidivism Rate")).toBeTruthy();
    expect(screen.getByText("Facilities")).toBeTruthy();
  });

  it("withholds both outcomes and facilities from a restricted viewer", () => {
    office.canView = false;
    render(<CabinetOfficePage />);

    expect(screen.getByText("Office records restricted")).toBeTruthy();
    expect(screen.queryByText("Incarceration Rate")).toBeNull();
    expect(screen.queryByText("Recidivism Rate")).toBeNull();
    expect(screen.queryByText("Facilities")).toBeNull();
  });
});
