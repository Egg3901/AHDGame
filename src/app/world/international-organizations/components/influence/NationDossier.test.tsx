// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { InfluenceTarget, OrgInfluenceView } from "@/lib/alignment/queries/orgInfluence";
import { NationDossier } from "./NationDossier";

// Anchor-unit formatter, so a converted figure is distinguishable from one that
// was printed in the fund's own currency.
const formatAmount = vi.fn((anchor: number) => `¥${Math.round(anchor)}`);
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount }),
}));

const VIEW = {
  poles: [
    { id: "WEST", label: "West", shortLabel: "W", accentToken: "info" },
    { id: "EAST", label: "East", shortLabel: "E", accentToken: "error" },
  ],
  remainderLabel: "Non-aligned",
  fundCurrencyCountryId: "US",
  joinShare: 60,
  leaveShare: 40,
  channel: { poleId: "WEST", poleLabel: "West", accentToken: "info", weight: 1 },
  rivalIntel: {
    YU: [{ poleLabel: "East", accentToken: "error", pointsLanded: 6, turnsAgo: 1 }],
  },
} as unknown as OrgInfluenceView;

const TARGET = {
  entityId: "YU",
  name: "Yugoslavia",
  isPlayable: true,
  status: "contested",
  lead: 28,
  ourShare: 22,
  shares: { WEST: 22, EAST: 50 },
  nonAligned: 28,
  previousShares: null,
  axis: null,
  topPoleId: "EAST",
  trend: -1,
  ourShareTrend: -3,
  crisis: null,
  sanctionedBy: [],
  pointCostLocal: 76_000_000,
  turnCapCostLocal: 380_000_000,
  costToGate: 2_888_000_000,
  resistsAtHalfStrength: false,
} as unknown as InfluenceTarget;

const renderDossier = (
  over: Partial<InfluenceTarget> = {},
  viewerCountryId: string | null = "US"
) =>
  render(
    <NationDossier
      view={VIEW}
      target={{ ...TARGET, ...over } as InfluenceTarget}
      orgId="NATO"
      viewerCountryId={viewerCountryId}
      onCommitted={() => {}}
    />
  );

describe("NationDossier", () => {
  it("marks the join and leave gates, and never the locked one", () => {
    // Join and leave are thresholds on a SHARE, so they mark real positions on
    // this bar. Locked is a threshold on LEAD — drawing it here would put it
    // somewhere it does not mean.
    renderDossier();
    expect(screen.getByText(/38\.00 short of the 60 it takes to join/i)).toBeTruthy();
    expect(screen.getByText(/falls to 40/i)).toBeTruthy();
    expect(screen.queryByText(/85/)).toBeNull();
  });

  it("names the modifiers acting on the nation", () => {
    renderDossier({
      resistsAtHalfStrength: true,
      crisis: { turnsRemaining: 4, movementCap: 7.5 },
      sanctionedBy: ["WARSAW_PACT"],
    });
    expect(screen.getByText(/half strength/i)).toBeTruthy();
    expect(screen.getByText(/7\.5/)).toBeTruthy();
    expect(screen.getByText(/WARSAW_PACT/)).toBeTruthy();
  });

  it("says nothing about modifiers when none apply", () => {
    // An empty "what's affecting this" block would imply we looked and found
    // nothing worth naming, which is not the same as nothing applying.
    renderDossier();
    expect(screen.queryByText(/affecting this nation/i)).toBeNull();
  });

  it("reports rival activity as points and never as money", () => {
    renderDossier();
    const intel = screen.getByTestId("rival-intel");
    expect(intel.textContent).toMatch(/East/);
    expect(intel.textContent).toMatch(/6/);
    // The guard that stops a later change reintroducing the spend.
    expect(intel.textContent).not.toMatch(/[$£€]/);
  });

  it("shows a nation it cannot price without offering to buy it", () => {
    renderDossier({ pointCostLocal: null, turnCapCostLocal: null, costToGate: null });
    expect(screen.getByText(/not on record/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /commit play/i })).toBeNull();
  });

  it("is read-only for a viewer who holds no foreign-minister seat", () => {
    // The intel and prices are worth reading even without the ability to act.
    renderDossier({}, null);
    expect(screen.getByText("Yugoslavia")).toBeTruthy();
    expect(screen.getByTestId("rival-intel")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /commit play/i })).toBeNull();
  });
  it("says when a nation is already past the join gate", async () => {
    // "38 short" would be nonsense for a nation that has already cleared it.
    renderDossier({ ourShare: 72, shares: { WEST: 72, EAST: 10 }, nonAligned: 18 });
    expect(screen.getByText(/already past the 60/i)).toBeTruthy();
  });
});

describe("NationDossier costs and the display-currency preference", () => {
  it("shows costs in the viewer's currency, using the era rate from the server", () => {
    // 76M a point at 2 anchor-per-fund-unit is 152M anchor. Deriving the rate
    // client-side from COUNTRY_CONFIGS would price a 1953 world at 1979 rates.
    render(
      <NationDossier
        view={{ ...VIEW, usdToFundRate: 2 } as OrgInfluenceView}
        target={TARGET}
        orgId="NATO"
        viewerCountryId="US"
        onCommitted={() => {}}
      />
    );
    expect(formatAmount).toHaveBeenCalledWith(152_000_000, "USD");
    expect(screen.getByText("¥152000000")).toBeTruthy();
  });

  it("leaves the commit input in the fund's own currency", () => {
    // The route takes `amountLocal` in the FUND's currency. A field that
    // accepted one currency while labelled another would spend the wrong number.
    render(
      <NationDossier
        view={{ ...VIEW, usdToFundRate: 2 } as OrgInfluenceView}
        target={TARGET}
        orgId="NATO"
        viewerCountryId="US"
        onCommitted={() => {}}
      />
    );
    expect(screen.getByText(/amount \(US\)/i)).toBeTruthy();
  });
});
