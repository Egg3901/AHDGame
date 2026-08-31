// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { InfluenceTarget, OrgInfluenceView } from "@/lib/alignment/queries/orgInfluence";
import { NationDossier } from "./NationDossier";

// Anchor-unit formatter, so a converted figure is distinguishable from one that
// was printed in the fund's own currency.
const formatAmount = vi.fn((anchor: number) => `¥${Math.round(anchor)}`);
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount }),
}));

// Cleared per test so call assertions read this render's calls, not the file's.
beforeEach(() => formatAmount.mockClear());

const VIEW = {
  poles: [
    { id: "WEST", label: "West", shortLabel: "W", accentToken: "info" },
    { id: "EAST", label: "East", shortLabel: "E", accentToken: "error" },
  ],
  remainderLabel: "Non-aligned",
  fundCurrencyCountryId: "US",
  joinShare: 60,
  leaveShare: 40,
  sustainTurns: 24,
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
  joinCountdown: null,
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

  it("shows the sustain countdown while a nation over the gate has not applied", () => {
    // The whole point of the fix: a share past 60 that has not "joined" is
    // working as designed, so the dossier says how many turns remain.
    renderDossier({
      ourShare: 62,
      shares: { WEST: 62, EAST: 10 },
      nonAligned: 28,
      joinCountdown: { turnsHeld: 21, turnsToApply: 3 },
    });
    expect(screen.getByText(/held above the 60 for/i)).toBeTruthy();
    expect(screen.getByText(/21\/24/)).toBeTruthy();
    expect(screen.getByText(/applies to join in/i)).toBeTruthy();
  });

  it("says the members now vote once the run is complete", () => {
    renderDossier({
      ourShare: 62,
      shares: { WEST: 62, EAST: 10 },
      nonAligned: 28,
      joinCountdown: { turnsHeld: 24, turnsToApply: 0 },
    });
    expect(screen.getByText(/applying to join/i)).toBeTruthy();
    expect(screen.getByText(/members.+vote now decides/i)).toBeTruthy();
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

  it("prices a ruble-denominated fund in rubles, never with a dollar fallback", () => {
    // The Warsaw Pact bug: the view names the fund country
    // `fundCurrencyCountryId`, and a formatter that missed it fell back to USD,
    // so the same point cost the form quoted in SUR read as dollars up here.
    render(
      <NationDossier
        view={{ ...VIEW, fundCurrencyCountryId: "RU", usdToFundRate: 0.1 } as OrgInfluenceView}
        target={TARGET}
        orgId="WARSAW_PACT"
        viewerCountryId="RU"
        onCommitted={() => {}}
      />
    );
    // 76M SUR a point at 0.1 anchor-per-ruble is 7.6M anchor, tagged SUR so the
    // "local" display preference resolves to rubles, not dollars.
    expect(formatAmount).toHaveBeenCalledWith(7_600_000, "SUR");
    expect(formatAmount).not.toHaveBeenCalledWith(7_600_000, "USD");
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
    // The currency CODE, not the country id: "Amount (US)" read as a country
    // and told a player nothing about which units the box wanted.
    expect(screen.getByText(/amount \(USD\)/i)).toBeTruthy();
    // ...and the source is named, which is what ticket #1064 could not work out.
    expect(screen.getByText(/paid from the US organisation fund/i)).toBeTruthy();
  });

  it("shows the fund balance and what the typed amount buys", () => {
    render(
      <NationDossier
        view={{ ...VIEW, fundBalanceLocal: 90_000_000 } as OrgInfluenceView}
        target={TARGET}
        orgId="NATO"
        viewerCountryId="US"
        onCommitted={() => {}}
      />
    );
    // The balance was computed and typed on the view but rendered nowhere, so a
    // player had no way to see what the fund held before spending from it.
    // Split across text nodes in one span, so match on the container's content.
    expect(
      screen.getByText((_, el) => el?.textContent?.trim() === "$90.0M available")
    ).toBeTruthy();

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "152000000" } });
    // TARGET prices a point at 76m, so 152m is exactly two points.
    // Scoped to the preview line: "2.00" also appears on the share bar above.
    expect(
      screen.getByText((_, el) => {
        const t = el?.textContent ?? "";
        return t.startsWith("Buys") && t.includes("2.00") && t.includes("each");
      })
    ).toBeTruthy();
  });

  it("says the spend resolves on the turn, not immediately", () => {
    // The literal question on ticket #1064: "once you commit play does it
    // automatically shift or do you have to wait a turn?"
    render(
      <NationDossier
        view={VIEW as OrgInfluenceView}
        target={TARGET}
        orgId="NATO"
        viewerCountryId="US"
        onCommitted={() => {}}
      />
    );
    expect(screen.getByText(/the nation moves when the turn processes/i)).toBeTruthy();
  });

  it("blocks and guides a spend too small to move the nation at all (ticket #1213)", () => {
    render(
      <NationDossier
        view={{ ...VIEW, fundBalanceLocal: 90_000_000 } as OrgInfluenceView}
        target={TARGET}
        orgId="NATO"
        viewerCountryId="US"
        onCommitted={() => {}}
      />
    );
    // The reporter's exact move: a handful of currency units against a nation
    // that costs 76m a point. It buys 0.00 points, so the commit is refused
    // client-side and the player is told the floor (a point is 76m, a hundredth
    // of it is 760,000).
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "10" } });
    expect(screen.getByText(/too little to move Yugoslavia/i)).toBeTruthy();
    expect(screen.getByText(/spend at least/i).textContent).toContain("0.01");
    const commit = screen.getByRole("button", { name: /commit play/i }) as HTMLButtonElement;
    expect(commit.disabled).toBe(true);
  });

  it("warns when the amount is past the per-turn ceiling", () => {
    render(
      <NationDossier
        view={VIEW as OrgInfluenceView}
        target={TARGET}
        orgId="NATO"
        viewerCountryId="US"
        onCommitted={() => {}}
      />
    );
    // 76m a point, so the 5-point ceiling is 380m; 500m is past it.
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "500000000" } });
    expect(screen.getByText(/past the 5-point ceiling/i)).toBeTruthy();
  });
});
