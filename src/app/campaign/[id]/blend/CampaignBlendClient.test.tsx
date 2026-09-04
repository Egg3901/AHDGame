/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CampaignData } from "@/lib/campaigns/dto/campaignView";
import { CampaignBlendClient } from "./CampaignBlendClient";

// The state-presence controls in the rail navigate on success.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

function tree(starter: boolean, a: number, b: number, c: number) {
  return {
    unlocked: starter,
    starterCost: starter ? null : { funds: 50000, actions: 10, effect: "starter" },
    starterEffect: "Opens the lever.",
    requiresTarget: false,
    branches: (["a", "b", "c"] as const).map((k, i) => ({
      key: k,
      label: `Branch ${k.toUpperCase()}`,
      description: "Does a thing.",
      effectType: "incomeFlat",
      level: [a, b, c][i],
      maxLevel: 3,
      next: [a, b, c][i] < 3 ? { funds: 100, actions: 1, effect: "+more" } : null,
    })),
  };
}

function campaignFixture(over: Partial<CampaignData> = {}): CampaignData {
  return {
    id: "c1",
    electionId: "e1",
    candidateId: "cand1",
    candidateName: "Nominee",
    candidateIsNPP: false,
    party: "Democratic Party",
    accessLevel: "owner",
    isArchived: false,
    isRunningMate: false,
    currencyCode: "USD",
    fxRate: 1,
    funds: 1_284_500,
    actions: 14,
    levels: { fundraising: 4, oppositionResearch: 3, groundGame: 9, mediaSpending: 5 },
    managerId: null,
    managerName: null,
    managers: [],
    canAppointManagers: true,
    campaignStrength: 412,
    runningMateName: "The Running Mate",
    oppositionTargetId: null,
    oppositionTargetName: null,
    electionInfo: {
      state: "National",
      electionType: "president",
      cycle: 1,
      senateClass: null,
      electionYear: 2028,
      isEnded: false,
    },
    budget: {
      income: { total: 61_000 },
      expenses: { groundGameMaintenance: 6_200, mediaSpendingMaintenance: 2_400, total: 8_600 },
      netIncome: 52_400,
      actions: { endorsementCount: 0, perTurn: 9 },
      cumulative: {
        totalGenerated: 4_182_000,
        totalSpent: 2_610_500,
        actionsGenerated: 214,
        actionsSpent: 187,
      },
    },
    activityHistory: [],
    opsTrees: {
      fundraising: tree(true, 1, 0, 1),
      oppositionResearch: tree(true, 1, 0, 1),
      groundGame: tree(true, 3, 3, 2),
      mediaSpending: tree(true, 1, 1, 0),
    } as CampaignData["opsTrees"],
    ownSupport: {
      support: 63.4,
      pendingDripTotal: 1.84,
      rallyTourActive: false,
      rallyFiredThisTurn: false,
      rallyFullValue: 12,
      rallyOneShotActionCost: 4,
      rallyTourTickActionCost: 2,
    },
    ...over,
  } as CampaignData;
}

const ME = {
  funds: 612_000,
  storedFunds: 612_000,
  actions: 20,
  nationalInfluence: 8,
  fundsCurrency: "USD" as const,
};

function renderClient(over: Partial<Parameters<typeof CampaignBlendClient>[0]> = {}) {
  return render(
    <CampaignBlendClient
      campaign={campaignFixture()}
      me={ME}
      currentTurn={4182}
      wire={[]}
      canManage
      canSurrogate={false}
      onRefresh={() => {}}
      onRefreshMe={() => {}}
      {...over}
    />
  );
}

describe("manager view", () => {
  it("shows all four operation levers", () => {
    renderClient();
    // Desktop and mobile trees both render, so each label appears twice.
    expect(screen.getAllByText("Fundraising").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ground Game").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Opposition Research").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Media Spending").length).toBeGreaterThan(0);
  });

  it("offers the rally at the race's own action cost", () => {
    renderClient();
    expect(screen.getByText(/RALLY · 4/)).toBeTruthy();
  });

  it("names the running mate on the ticket", () => {
    renderClient();
    expect(screen.getByText("The Running Mate")).toBeTruthy();
  });

  it("offers both contribution routes to a party officer", () => {
    renderClient({
      campaign: campaignFixture({
        partyTreasuryAccess: {
          partyId: 1,
          partyName: "The Party",
          role: "treasurer",
          treasury: 4_105_000,
          currencyCode: "USD",
        },
      }),
    });
    expect(screen.getAllByText("From your own funds").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/From the The Party treasury/).length).toBeGreaterThan(0);
  });
});

describe("running-mate surrogate", () => {
  it("sees only the fundraising lane", () => {
    renderClient({ canManage: false, canSurrogate: true });
    expect(screen.getAllByText("Fundraising").length).toBeGreaterThan(0);
    expect(screen.queryByText("Ground Game")).toBeNull();
    expect(screen.queryByText("Media Spending")).toBeNull();
  });

  it("still gets the rally, which shares the ticket's action pool", () => {
    renderClient({ canManage: false, canSurrogate: true });
    expect(screen.getByText(/RALLY · 4/)).toBeTruthy();
  });

  it("cannot change the ticket or the managers", () => {
    renderClient({ canManage: false, canSurrogate: true });
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
  });
});

describe("read-only viewers", () => {
  it("gets no purchase, rally or ticket controls", () => {
    renderClient({ canManage: false, canSurrogate: false });
    expect(screen.queryByRole("button", { name: "Upgrade" })).toBeNull();
    expect(screen.queryByText(/RALLY ·/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
  });

  it("still sees the standing figures", () => {
    renderClient({ canManage: false, canSurrogate: false });
    expect(screen.getAllByText("63.4").length).toBeGreaterThan(0);
  });
});

describe("archived campaign", () => {
  it("takes no further contributions", () => {
    renderClient({ campaign: campaignFixture({ isArchived: true }) });
    expect(screen.queryByText("From your own funds")).toBeNull();
  });

  it("blocks the rally and says why", () => {
    renderClient({ campaign: campaignFixture({ isArchived: true }) });
    expect(screen.getByText("This campaign is concluded.")).toBeTruthy();
  });
});

describe("suspended campaign", () => {
  it("takes no further contributions", () => {
    renderClient({ campaign: campaignFixture({ campaignSuspended: true }) });
    expect(screen.queryByText("From your own funds")).toBeNull();
  });
});

describe("ticker", () => {
  it("renders nothing when the race has no wire traffic", () => {
    const { container } = renderClient({ wire: [] });
    expect(container.textContent).not.toContain("WIRE");
  });

  it("shows headlines when the race has traffic", () => {
    renderClient({ wire: ["NOMINEE TAKES GROUND GAME TO LEVEL 9"] });
    expect(screen.getAllByText("WIRE").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/GROUND GAME TO LEVEL 9/).length).toBeGreaterThan(0);
  });
});

describe("sparkline", () => {
  it("says the history is still filling rather than drawing an invented line", () => {
    renderClient();
    expect(
      screen.getAllByText("Per-turn history starts building from this turn onward.").length
    ).toBeGreaterThan(0);
  });
});

describe("where you are campaigning", () => {
  const presence = {
    electionId: "e1",
    phase: "primary" as const,
    currentStateId: "IA",
    currentStateName: "Iowa",
    playerActions: 25,
    states: [{ id: "IA", name: "Iowa", actionCost: 3 }],
    primary: {
      currentCampaignState: "IA",
      currentTicks: 3,
      tickCap: 5,
      homeState: "IA",
      surgeUsed: false,
      playerActions: 25,
      playerFunds: 250_000,
      surgeCostFunds: 25_000,
      surgeCostActions: 3,
      surgeBoost: 15,
      states: [{ id: "IA", name: "Iowa", actionCost: 3 }],
    },
  };

  it("puts the move controls in reach on both layouts, not a long scroll below", () => {
    // The desktop rail is `hidden lg:block`, so a single copy would mean the
    // only way to camp, surge or travel vanishes below the breakpoint. Both
    // trees render in the DOM, so each control appears exactly twice.
    renderClient({ campaign: { ...campaignFixture(), statePresence: presence } });
    expect(screen.getAllByText(/Where you are campaigning/i)).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /Change state/i })).toHaveLength(2);
  });

  it("offers travel rather than camping once the primary is over", () => {
    renderClient({
      campaign: {
        ...campaignFixture(),
        statePresence: { ...presence, phase: "general" as const, primary: null },
      },
    });
    expect(screen.getAllByRole("button", { name: /Travel elsewhere/i })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Surge home state/i })).toBeNull();
  });

  it("shows nothing there for someone who is not the candidate", () => {
    renderClient({ campaign: { ...campaignFixture(), statePresence: null } });
    expect(screen.queryByText(/Where you are campaigning/i)).toBeNull();
  });
});
