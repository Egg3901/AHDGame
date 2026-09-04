import { describe, it, expect } from "vitest";
import type { CampaignData } from "@/lib/campaigns/dto/campaignView";
import { campaignStrengthBoostPercent } from "@/lib/campaigns/campaignStrength";
import {
  buildCampaignBlendViewModel,
  OPS_TOTAL_CAP,
  LEDGER_PAGE_SIZE,
  type CampaignBlendInput,
} from "./campaignBlendViewModel";

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
      next:
        [a, b, c][i] < 3 ? { funds: 100000, actions: 5, effect: "+more", maintenance: 1000 } : null,
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
    managers: [{ characterId: "m1", name: "First Manager" }],
    canAppointManagers: true,
    campaignStrength: 412,
    oppositionTargetId: null,
    oppositionTargetName: "Rival Candidate",
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
      actions: { endorsementCount: 2, perTurn: 9 },
      cumulative: {
        totalGenerated: 4_182_000,
        totalSpent: 2_610_500,
        actionsGenerated: 214,
        actionsSpent: 187,
      },
    },
    activityHistory: Array.from({ length: 24 }, (_, i) => ({
      type: "upgrade" as const,
      category: "groundGame",
      newLevel: 24 - i,
      costFunds: 1000 * (i + 1),
      costActions: 3,
      timestamp: new Date().toISOString(),
      turnNumber: 4182 - i,
    })),
    opsTrees: {
      fundraising: tree(true, 1, 0, 1),
      oppositionResearch: tree(true, 1, 0, 1),
      groundGame: tree(true, 3, 3, 2),
      mediaSpending: tree(true, 1, 1, 0),
    } as CampaignData["opsTrees"],
    ownSupport: {
      support: 63.4,
      pendingDripTotal: 1.84,
      rallyTourActive: true,
      rallyFiredThisTurn: false,
      rallyFullValue: 12,
      rallyOneShotActionCost: 4,
      rallyTourTickActionCost: 2,
    },
    ...over,
  } as CampaignData;
}

function input(over: Partial<CampaignBlendInput> = {}): CampaignBlendInput {
  return {
    campaign: campaignFixture(),
    me: {
      funds: 612_000,
      storedFunds: 612_000,
      actions: 20,
      nationalInfluence: 8,
      fundsCurrency: "USD",
    },
    currentTurn: 4182,
    wire: [],
    runningMateName: "Running Mate",
    rail: "overview",
    ledgerPage: 0,
    expandedCategory: null,
    ...over,
  };
}

describe("rail", () => {
  it("badges operations with the invested total over the four-lever cap", () => {
    const vm = buildCampaignBlendViewModel(input());
    const ops = vm.railItems.find((i) => i.id === "ops");
    // fundraising 3 + oppo 3 + ground 9 + media 3 = 18 of 40.
    expect(ops?.badge).toBe(`18/${OPS_TOTAL_CAP}`);
  });

  it("caps at ten per lever, four levers", () => {
    expect(OPS_TOTAL_CAP).toBe(40);
  });

  it("badges the activity log with the entry count", () => {
    const vm = buildCampaignBlendViewModel(input());
    expect(vm.railItems.find((i) => i.id === "log")?.badge).toBe("24");
  });

  it("titles the pane from the selected rail item", () => {
    expect(buildCampaignBlendViewModel(input({ rail: "money" })).paneTitle).toBe(
      "Budget & contributions"
    );
  });
});

describe("fog of war", () => {
  it("shows no estimate footnote to the campaign's own side", () => {
    // Telling an owner their own levels are estimates would be false.
    expect(buildCampaignBlendViewModel(input()).fogFootnote).toBeNull();
  });

  it("warns a party viewer that levels are party intelligence", () => {
    const vm = buildCampaignBlendViewModel(
      input({ campaign: campaignFixture({ accessLevel: "party" }) })
    );
    expect(vm.fogFootnote).toMatch(/party/i);
  });

  it("warns a public viewer that levels are public intelligence", () => {
    const vm = buildCampaignBlendViewModel(
      input({ campaign: campaignFixture({ accessLevel: "public" }) })
    );
    expect(vm.fogFootnote).toMatch(/public/i);
  });
});

describe("vitals", () => {
  it("reads the war chest and its net per turn from the budget", () => {
    const cells = buildCampaignBlendViewModel(input()).vitals;
    const chest = cells.find((c) => c.label === "War chest");
    expect(chest?.value).toBe("$1.3M");
    expect(chest?.sub).toContain("52,400");
  });

  it("scales the war chest by magnitude instead of forcing millions", () => {
    // The mockup hardcodes (funds / 1e6).toFixed(2) + "M", which renders a
    // small campaign as "$0.05M". Most campaigns are far below a million, so
    // the app's magnitude-aware formatter is used instead (deviation D10).
    const small = buildCampaignBlendViewModel(
      input({ campaign: campaignFixture({ funds: 50_000 }) })
    );
    expect(small.vitals.find((c) => c.label === "War chest")?.value).toBe("$50K");
  });

  it("formats the war chest in the campaign's own currency", () => {
    const gbp = buildCampaignBlendViewModel(
      input({ campaign: campaignFixture({ currencyCode: "GBP" }) })
    );
    expect(gbp.vitals.find((c) => c.label === "War chest")?.value).toContain("£");
  });

  it("shows a negative net per turn as a fall, not a plus sign", () => {
    const bleeding = campaignFixture();
    bleeding.budget!.netIncome = -8_600;
    const vm = buildCampaignBlendViewModel(input({ campaign: bleeding }));
    const chest = vm.vitals.find((c) => c.label === "War chest");
    expect(chest?.sub).toContain("-");
    expect(chest?.sub).not.toContain("+");
  });

  it("reads actions per turn from the budget, not a literal", () => {
    const cells = buildCampaignBlendViewModel(input()).vitals;
    expect(cells.find((c) => c.label === "Actions")?.sub).toContain("9");
  });

  it("reads support and its pending drip from ownSupport", () => {
    const cells = buildCampaignBlendViewModel(input()).vitals;
    const support = cells.find((c) => c.label === "Support");
    expect(support?.value).toBe("63.4");
    expect(support?.sub).toContain("1.84");
  });

  it("uses the real strength boost formula, not the mockup's strength/50", () => {
    const cells = buildCampaignBlendViewModel(input()).vitals;
    const expected = campaignStrengthBoostPercent(412).toFixed(1);
    expect(cells.find((c) => c.label === "Strength")?.sub).toContain(expected);
    // 412/50 would be 8.2; the real formula must not coincidentally agree here.
    expect(campaignStrengthBoostPercent(412).toFixed(1)).not.toBe("8.2");
  });

  it("omits the support vital entirely when fog withholds it", () => {
    const vm = buildCampaignBlendViewModel(
      input({ campaign: campaignFixture({ accessLevel: "public", ownSupport: undefined }) })
    );
    expect(vm.vitals.some((c) => c.label === "Support")).toBe(false);
  });
});

describe("operations", () => {
  it("describes each lever's current standing effect", () => {
    const vm = buildCampaignBlendViewModel(input());
    const ground = vm.ops.find((o) => o.key === "groundGame");
    expect(ground?.effect).toContain("swing");
  });

  it("shows the invested level over ten with a matching segment bar", () => {
    const vm = buildCampaignBlendViewModel(input());
    const ground = vm.ops.find((o) => o.key === "groundGame");
    expect(ground?.level).toBe("9/10");
    expect(ground?.segments).toHaveLength(10);
  });

  it("marks a branch unaffordable when funds fall short", () => {
    const vm = buildCampaignBlendViewModel(
      input({
        campaign: campaignFixture({ funds: 1 }),
        expandedCategory: "fundraising",
      })
    );
    const branch = vm.ops.find((o) => o.key === "fundraising")?.tree?.branches[0];
    expect(branch?.affordable).toBe(false);
  });

  it("marks a maxed branch as maxed rather than unaffordable", () => {
    const vm = buildCampaignBlendViewModel(input({ expandedCategory: "groundGame" }));
    const branch = vm.ops.find((o) => o.key === "groundGame")?.tree?.branches[0];
    expect(branch?.maxed).toBe(true);
    expect(branch?.actionable).toBe(false);
  });

  it("builds the tree only for the expanded lever", () => {
    const vm = buildCampaignBlendViewModel(input({ expandedCategory: "fundraising" }));
    expect(vm.ops.find((o) => o.key === "fundraising")?.tree).not.toBeNull();
    expect(vm.ops.find((o) => o.key === "groundGame")?.tree).toBeNull();
  });

  it("carries the opposition target through to the expanded tree", () => {
    const opsTrees = campaignFixture().opsTrees!;
    const withTarget = {
      ...opsTrees,
      oppositionResearch: { ...opsTrees.oppositionResearch, requiresTarget: true },
    };
    const vm = buildCampaignBlendViewModel(
      input({
        campaign: campaignFixture({ opsTrees: withTarget as CampaignData["opsTrees"] }),
        expandedCategory: "oppositionResearch",
      })
    );
    const t = vm.ops.find((o) => o.key === "oppositionResearch")?.tree;
    expect(t?.requiresTarget).toBe(true);
    expect(t?.targetName).toBe("Rival Candidate");
  });

  it("is empty for a viewer with no ops trees, rather than throwing", () => {
    const vm = buildCampaignBlendViewModel(
      input({ campaign: campaignFixture({ accessLevel: "public", opsTrees: undefined }) })
    );
    expect(vm.ops).toEqual([]);
  });
});

describe("money", () => {
  it("reads the income and upkeep rows from the budget", () => {
    const m = buildCampaignBlendViewModel(input()).money;
    expect(m?.incomeTotal).toBe(61_000);
    expect(m?.groundUpkeep).toBe(6_200);
    expect(m?.mediaUpkeep).toBe(2_400);
    expect(m?.net).toBe(52_400);
  });

  it("passes the cumulative totals straight through", () => {
    const m = buildCampaignBlendViewModel(input()).money;
    expect(m?.cumulative.totalGenerated).toBe(4_182_000);
    expect(m?.cumulative.actionsSpent).toBe(187);
  });

  it("renders an empty sparkline when no net-income history has been recorded", () => {
    // The field fills in going forward; an absent series must never be faked.
    const m = buildCampaignBlendViewModel(input()).money;
    expect(m?.sparkline).toEqual([]);
  });

  it("plots the recorded history when it exists", () => {
    const withHistory = campaignFixture();
    (withHistory as { netIncomeHistory?: { turn: number; net: number }[] }).netIncomeHistory = [
      { turn: 4180, net: 40_000 },
      { turn: 4181, net: 48_000 },
      { turn: 4182, net: 52_400 },
    ];
    const m = buildCampaignBlendViewModel(input({ campaign: withHistory })).money;
    expect(m?.sparkline).toHaveLength(3);
    // Tallest bar is the largest net, and it is the most recent here.
    expect(m?.sparkline[2].heightPct).toBe(100);
  });

  it("offers the party treasury contribution only to an officer who has one", () => {
    expect(buildCampaignBlendViewModel(input()).money?.partyTreasury).toBeNull();

    const officer = campaignFixture({
      partyTreasuryAccess: {
        partyId: 1,
        partyName: "The Party",
        role: "treasurer",
        treasury: 4_105_000,
        currencyCode: "USD",
      },
    });
    const m = buildCampaignBlendViewModel(input({ campaign: officer })).money;
    expect(m?.partyTreasury?.balance).toBe(4_105_000);
    expect(m?.partyTreasury?.partyName).toBe("The Party");
  });
});

describe("ledger", () => {
  it("pages ten rows at a time", () => {
    const vm = buildCampaignBlendViewModel(input());
    expect(vm.ledger.rows).toHaveLength(LEDGER_PAGE_SIZE);
    expect(vm.ledger.hasPager).toBe(true);
    expect(vm.ledger.rangeText).toBe("1-10 of 24");
    expect(vm.ledger.pageText).toBe("Page 1 of 3");
  });

  it("serves the last, short page without inventing rows", () => {
    const vm = buildCampaignBlendViewModel(input({ ledgerPage: 2 }));
    expect(vm.ledger.rows).toHaveLength(4);
    expect(vm.ledger.rangeText).toBe("21-24 of 24");
  });

  it("clamps a page past the end back onto the last page", () => {
    const vm = buildCampaignBlendViewModel(input({ ledgerPage: 99 }));
    expect(vm.ledger.rows).toHaveLength(4);
    expect(vm.ledger.canNext).toBe(false);
  });

  it("hides the pager when everything fits on one page", () => {
    const short = campaignFixture({ activityHistory: [] });
    const vm = buildCampaignBlendViewModel(input({ campaign: short }));
    expect(vm.ledger.hasPager).toBe(false);
  });

  it("reads a demotion as demoted rather than as a spend", () => {
    const demoted = campaignFixture({
      activityHistory: [
        {
          type: "downgrade",
          category: "mediaSpending",
          newLevel: 5,
          timestamp: new Date().toISOString(),
          turnNumber: 4177,
          reason: "insolvency",
        },
      ],
    });
    const row = buildCampaignBlendViewModel(input({ campaign: demoted })).ledger.rows[0];
    expect(row.cost).toBe("demoted");
    expect(row.label).toMatch(/down to/i);
  });

  it("names the opposition target on a targeted upgrade", () => {
    const targeted = campaignFixture({
      activityHistory: [
        {
          type: "upgrade",
          category: "oppositionResearch",
          newLevel: 4,
          costFunds: 96_000,
          costActions: 2,
          targetName: "Rival Candidate",
          timestamp: new Date().toISOString(),
          turnNumber: 4180,
        },
      ],
    });
    const row = buildCampaignBlendViewModel(input({ campaign: targeted })).ledger.rows[0];
    expect(row.label).toContain("Rival Candidate");
    expect(row.turnTag).toBe("T4180");
  });
});

describe("strength contribution", () => {
  it("quotes the real cost, actions and resulting boost", () => {
    const vm = buildCampaignBlendViewModel(input());
    // 8 national influence x 0.75 = 6.0 strength added.
    expect(vm.strength?.strengthAdded).toBeCloseTo(6, 5);
    expect(vm.strength?.costActions).toBeGreaterThan(0);
    expect(vm.strength?.newBoostPct).toBe(campaignStrengthBoostPercent(412 + 6).toFixed(1));
  });

  it("blocks the contribution when the viewer has no influence to spend", () => {
    const vm = buildCampaignBlendViewModel(
      input({
        me: {
          funds: 612_000,
          storedFunds: 612_000,
          actions: 20,
          nationalInfluence: 0,
          fundsCurrency: "USD",
        },
      })
    );
    expect(vm.strength?.canContribute).toBe(false);
  });
});

describe("rally", () => {
  it("prices the rally from the race's own action cost", () => {
    const vm = buildCampaignBlendViewModel(input());
    expect(vm.support?.rallyActionCost).toBe(4);
    expect(vm.support?.canRally).toBe(true);
  });

  it("blocks a second rally in the same turn", () => {
    const fired = campaignFixture({
      ownSupport: { ...campaignFixture().ownSupport!, rallyFiredThisTurn: true },
    });
    expect(buildCampaignBlendViewModel(input({ campaign: fired })).support?.canRally).toBe(false);
  });

  it("blocks a rally the campaign cannot afford", () => {
    const broke = campaignFixture({ actions: 1 });
    expect(buildCampaignBlendViewModel(input({ campaign: broke })).support?.canRally).toBe(false);
  });
});

describe("header", () => {
  it("reads the turn from game state", () => {
    expect(buildCampaignBlendViewModel(input()).turnReadout).toContain("4,182");
  });

  it("omits the turn when game state has not loaded", () => {
    const vm = buildCampaignBlendViewModel(input({ currentTurn: null }));
    expect(vm.turnReadout).not.toContain("null");
  });

  it("names the manager and running mate in the standfirst", () => {
    const vm = buildCampaignBlendViewModel(input());
    expect(vm.standfirst).toContain("First Manager");
    expect(vm.standfirst).toContain("Running Mate");
  });

  it("says so plainly when no manager is appointed", () => {
    const vm = buildCampaignBlendViewModel(input({ campaign: campaignFixture({ managers: [] }) }));
    expect(vm.standfirst).toMatch(/no manager/i);
  });
});

describe("copy", () => {
  it("never emits an em or en dash in player-facing strings", () => {
    const vm = buildCampaignBlendViewModel(input({ expandedCategory: "fundraising" }));
    const strings = [
      vm.paneTitle,
      vm.standfirst,
      vm.turnReadout,
      vm.fogFootnote ?? "",
      ...vm.vitals.flatMap((v) => [v.label, v.value, v.sub ?? ""]),
      ...vm.ops.map((o) => o.effect),
      ...vm.ledger.rows.map((r) => r.label),
    ];
    for (const s of strings) expect(s).not.toMatch(/[–—]/);
  });
});
