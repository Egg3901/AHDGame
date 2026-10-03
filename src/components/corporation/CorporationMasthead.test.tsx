/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CorporationMasthead } from "./CorporationMasthead";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (n: number) => `$${Math.round(n)}`,
    formatFull: (n: number) => `$${Math.round(n)}.00`,
    formatPriceIn: (n: number) => `$${n.toFixed(2)}`,
    formatPrice: (n: number) => `$${n.toFixed(2)}`,
    toInternalFrom: (n: number) => n,
  }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/components/HeroImage", () => ({
  HeroImage: ({ src }: { src: string }) => <span data-testid="banner" data-src={src} />,
}));
vi.mock("@/components/Avatar", () => ({ Avatar: () => null }));
vi.mock("./ceo/CeoCorporationSettingsModal", () => ({
  CeoCorporationSettingsModal: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Settings dialog</div> : null,
}));

const baseCorp = {
  _id: "c1",
  sequentialId: 7,
  name: "Keystone Industries",
  tickerSymbol: "KSTN",
  type: "manufacturing",
  typeLabel: "Manufacturing",
  secondaryType: null,
  countryId: "US",
  headquartersState: "PA",
  headquartersStateName: "Pennsylvania",
  legalStructureLabel: "C-Corp",
  isPrivate: false,
  liquidCapital: 2_900_000,
  liquidCurrencyCode: "USD",
  sharePrice: 24.74,
  marketCapitalization: 247_000_000,
  totalShares: 10_000_000,
  publicFloat: 4_800_000,
  dividendRate: 5,
  marketingStrength: 12.94,
  marketingStrengthGrowth: 1.08,
  ceoVacant: false,
  equityMarketPoolActive: true,
  marketBidPrice: 24.19,
  marketAskPrice: 25.18,
};

function renderMasthead(
  overrides: Record<string, unknown> = {},
  props: Record<string, unknown> = {}
) {
  return render(
    <CorporationMasthead
      corporation={{ ...baseCorp, ...overrides } as never}
      ceo={{ name: "Avery Lane", sequentialId: 1, profilePath: "/character/1" } as never}
      isCeo={false}
      corpId="7"
      exchangeLabel="NYSE"
      creditRating="AAA"
      retainedDaily={24_000}
      effectiveDividendRate={5}
      periodView="turn"
      financialFogOfWar={null}
      ceoIsInactive={false}
      onRefresh={vi.fn()}
      {...props}
    />
  );
}

describe("CorporationMasthead", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ history: [] }) })
    );
  });

  it("puts identity, the quote and the key figures in two lines", () => {
    renderMasthead();
    expect(screen.getByRole("heading", { level: 1, name: "Keystone Industries" })).toBeTruthy();
    expect(screen.getByText("NYSE: KSTN")).toBeTruthy();
    expect(screen.getByText("$24.74")).toBeTruthy();
    expect(screen.getByText("$24.19 / $25.18")).toBeTruthy();
    expect(screen.getByText("Retained/turn")).toBeTruthy();
    // 24,000/day is 1,000 per turn.
    expect(screen.getByText("+$1000")).toBeTruthy();
  });

  it("marks fogged figures as estimates and says where they come from", () => {
    renderMasthead(
      {},
      {
        financialFogOfWar: {
          isFinancialFogOfWar: true,
          fogSourceTurn: 96,
          maxDeviation: 0.1,
          lastQuarterly: {},
        },
      }
    );
    expect(screen.getByText("~$2900000")).toBeTruthy();
    expect(screen.getByText(/estimate from the turn 96 quarterly report/)).toBeTruthy();
  });

  it("hides the price of a private corporation from outsiders", () => {
    renderMasthead({ isPrivate: true });
    expect(screen.queryByText("$24.74")).toBeNull();
    expect(screen.queryByText("Mkt cap")).toBeNull();
  });

  it("offers Trade only when the viewer can trade, and Settings only to the CEO", () => {
    const onTrade = vi.fn();
    renderMasthead({}, { onTrade });
    fireEvent.click(screen.getByText("Trade shares"));
    expect(onTrade).toHaveBeenCalled();
    expect(screen.queryByText("Settings")).toBeNull();
  });

  it("opens the settings dialog for the CEO", () => {
    renderMasthead({}, { isCeo: true });
    fireEvent.click(screen.getByRole("button", { name: "Corporation settings" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("states nationalization exposure as plain text", () => {
    renderMasthead({
      nationalizationRisk: { sinceTurn: 10, turnsUntilEligible: 3 },
      nationalizationThreat: {
        whole: true,
        sectorCount: 0,
        stage: "pending",
        soonestTakingDeadlineTurn: 40,
        turnsUntilTaking: 2,
      },
    });
    expect(screen.getByText(/eligible for nationalization in 3 turns/)).toBeTruthy();
    expect(screen.getByText(/whole corporation/)).toBeTruthy();
    expect(screen.getByText(/taking in 2 turns/)).toBeTruthy();
  });

  it("shows an uploaded banner only where the page asks for it", () => {
    const { unmount } = renderMasthead({ headerImageUrl: "https://cdn.example/banner.png" });
    expect(screen.queryByTestId("banner")).toBeNull();
    unmount();
    renderMasthead({ headerImageUrl: "https://cdn.example/banner.png" }, { showBanner: true });
    expect(screen.getByTestId("banner")).toBeTruthy();
  });
});
