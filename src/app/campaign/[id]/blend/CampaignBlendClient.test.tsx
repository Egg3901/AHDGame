/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    expect(screen.getAllByText(/RALLY · 4/)).toHaveLength(2);
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
    expect(screen.getAllByText(/RALLY · 4/)).toHaveLength(2);
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
    expect(screen.getAllByText("This campaign is concluded.")).toHaveLength(2);
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

describe("national support", () => {
  it("puts the rally and the tour in reach on both layouts", () => {
    // These were passed only to the desktop rail, which is `hidden lg:block`,
    // so the largest lever a candidate has could not be reached on a phone.
    renderClient();
    expect(screen.getAllByText(/RALLY · 4/)).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /TOUR/ })).toHaveLength(2);
  });

  it("says the figure is national, and that it applies everywhere", () => {
    // Unlabelled, the figure sits above two buttons whose scope is not obvious;
    // support is one scalar applied identically in every state.
    renderClient();
    expect(screen.getAllByText("National support")).toHaveLength(2);
    expect(
      screen.getAllByText(/Applies in every state, not just the one you are campaigning in\./)
    ).toHaveLength(2);
  });

  it("shows the standing to a viewer who cannot act, without the buttons", () => {
    renderClient({ canManage: false, canSurrogate: false });
    expect(screen.getAllByText("National support")).toHaveLength(2);
    expect(screen.queryByText(/RALLY ·/)).toBeNull();
  });
});

describe("state operations", () => {
  const hub = {
    electionId: "e1",
    currentTurn: 12,
    positives: {
      camp: {
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
      presence: [],
      canvass: { available: true, stateId: "IA", reason: null },
    },
    opponents: [
      {
        candidateId: "r1",
        name: "Rival Filer",
        color: "#EF4444",
        delegates: 942,
        liveAgainstThem: [],
      },
    ],
    liveAgainstYou: [],
    shieldPct: 0,
    campaignFunds: 1_200_000,
    campaignFxRate: 1,
    countryId: "US",
    attacks: [
      {
        kind: "localFavorability",
        label: "Local attack",
        description:
          "Their favourability there falls 0.4 a turn for 8 turns. Costs $40,000 and 4 actions.",
        costFunds: 40_000,
        costActions: 4,
        needsBucket: false,
        shielded: true,
      },
      {
        kind: "voteSuppression",
        label: "Suppress their vote",
        description:
          "Takes 2.5% off their vote in one state for 8 turns. Costs $70,000 and 5 actions.",
        costFunds: 70_000,
        costActions: 5,
        needsBucket: false,
        shielded: true,
      },
      {
        kind: "turnoutSuppression",
        label: "Suppress a group's turnout",
        description:
          "Takes 1.5 points off one group's turnout in one state. Costs $50,000 and 4 actions.",
        costFunds: 50_000,
        costActions: 4,
        needsBucket: true,
        shielded: false,
      },
    ],
  };

  it("reaches both layouts, not the desktop shell alone", async () => {
    // Counting is the point: six blocks on this branch shipped invisible on
    // mobile because a test asserted "at least one" and a rail-only render
    // satisfied it.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => hub }));
    renderClient();
    await waitFor(() => expect(screen.getAllByText("State operations")).toHaveLength(2));
    expect(screen.getAllByRole("button", { name: /Rival Filer/ })).toHaveLength(2);
  });

  const primaryPresence = {
    electionId: "e1",
    phase: "primary" as const,
    currentStateId: "IA",
    currentStateName: "Iowa",
    playerActions: 25,
    states: [{ id: "IA", name: "Iowa", actionCost: 3 }],
    primary: hub.positives.camp,
  };

  it("does not duplicate camping into the rail once the hub carries it", async () => {
    // Camping and the surge live in the hub now. The rail's presence panel is
    // the fallback for the general phase and for a hub that never arrived; two
    // copies of one control is the complaint this whole section answers.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => hub }));
    renderClient({ campaign: { ...campaignFixture(), statePresence: primaryPresence } });
    await waitFor(() => expect(screen.getAllByText("State operations")).toHaveLength(2));
    expect(screen.queryByText(/Where you are campaigning/i)).toBeNull();
    expect(screen.getAllByRole("button", { name: /Change state/i })).toHaveLength(2);
  });

  it("keeps camping reachable when the hub does not load", async () => {
    // A failed fetch must not take the only camping control off the page.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    renderClient({ campaign: { ...campaignFixture(), statePresence: primaryPresence } });
    await waitFor(() => expect(screen.getAllByText(/Where you are campaigning/i)).toHaveLength(2));
    expect(screen.queryAllByText("State operations")).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: /Change state/i })).toHaveLength(2);
  });

  it("keeps travel in the rail during the general, where the hub does not run", async () => {
    // The hub is a primary mechanic. Removing the panel outright would put the
    // travel action back out of reach, which is the bug this branch has
    // already fixed three times.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    renderClient({
      campaign: {
        ...campaignFixture(),
        statePresence: { ...primaryPresence, phase: "general" as const, primary: null },
      },
    });
    expect(screen.getAllByRole("button", { name: /Travel elsewhere/i })).toHaveLength(2);
  });
});

describe("action failures", () => {
  it("shows a refused action on both layouts, not the desktop shell alone", async () => {
    // Every failed action sets one `error`, and the banner that renders it sits
    // in `body`, which only the desktop shell mounts. A refused upgrade, rally
    // or attack was invisible on a phone.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Not enough funds for that." }),
      })
    );
    renderClient();
    fireEvent.click(screen.getAllByRole("button", { name: /RALLY/ })[0]);
    await waitFor(() => expect(screen.getAllByText("Not enough funds for that.")).toHaveLength(2));
  });
});
