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
    // Stored oldest-first: `$push` appends, so index 0 is the earliest entry.
    // The fixture has to match, or paging tests pass against an order the
    // database never produces.
    activityHistory: Array.from({ length: 24 }, (_, i) => ({
      type: "upgrade" as const,
      category: "groundGame",
      newLevel: i + 1,
      costFunds: 1000 * (24 - i),
      costActions: 3,
      timestamp: new Date(Date.UTC(2026, 4, 1) + i * 3_600_000).toISOString(),
      turnNumber: 4159 + i,
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
    countryId: "US",
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
      countryId: "US",
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

  it("badges the ledger with everything both tabs hold", () => {
    // The rail names the whole panel, so a badge counting only purchases would
    // read "Ledger 0" for a campaign with no buys and a dozen endorsers.
    const vm = buildCampaignBlendViewModel(
      input({
        campaign: campaignFixture({
          endorsements: [
            { kind: "npp", name: "Carol Martin", since: null },
            { kind: "player", name: "Richard Nixon", since: null },
          ],
        }),
      })
    );
    expect(vm.railItems.find((i) => i.id === "log")?.badge).toBe("26");
  });

  it("badges nothing for a fogged viewer rather than a count of zero", () => {
    // The payload is redacted upstream, so history arrives empty whatever the
    // campaign did. A "0" badge asserts the absence the empty text is careful
    // not to claim.
    const fogged = campaignFixture({ accessLevel: "public", activityHistory: [] });
    const vm = buildCampaignBlendViewModel(input({ campaign: fogged }));
    expect(vm.railItems.find((i) => i.id === "log")?.badge).toBeUndefined();
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

  it("carries the runway beside the balance and burn it belongs to", () => {
    // A Cash runway card used to restate the balance and the burn rate from
    // this cell just to add the turn count, so the reader met the same money
    // twice on one page.
    const burning = campaignFixture();
    burning.budget!.netIncome = -8_600;
    burning.briefing = {
      ...burning.briefing!,
      cashRunway: { funds: 25_800, netPerTurn: -8_600, turnsOfRunway: 3 },
    };
    const chest = buildCampaignBlendViewModel(input({ campaign: burning })).vitals.find(
      (c) => c.label === "War chest"
    );
    expect(chest?.sub).toContain("3 turns of runway");
  });

  it("says nothing about runway for a campaign that is not burning", () => {
    const stable = campaignFixture();
    stable.briefing = {
      ...stable.briefing!,
      cashRunway: { funds: 25_800, netPerTurn: 52_400, turnsOfRunway: null },
    };
    const chest = buildCampaignBlendViewModel(input({ campaign: stable })).vitals.find(
      (c) => c.label === "War chest"
    );
    expect(chest?.sub).toContain("52,400");
    expect(chest?.sub).not.toContain("runway");
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

  it("opens on the newest entries, not the oldest", () => {
    // The array is stored oldest-first. While only ten entries were kept the
    // single page happened to be the newest ten; now that a campaign keeps its
    // whole history, showing it in stored order would open the log on ancient
    // purchases and bury last turn's on the final page.
    const vm = buildCampaignBlendViewModel(input());
    expect(vm.ledger.rows[0].turnTag).toBe("T4182");
    expect(vm.ledger.rows[9].turnTag).toBe("T4173");
  });

  it("runs oldest-last, so the final page holds the earliest entries", () => {
    const vm = buildCampaignBlendViewModel(input({ ledgerPage: 2 }));
    expect(vm.ledger.rows[vm.ledger.rows.length - 1].turnTag).toBe("T4159");
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

  it("reads a suspend-and-endorse as an endorsement, not a level 0 purchase", () => {
    // These entries carry no category, level or cost. Run through the upgrade
    // row builder they render as a level 0 purchase priced at nothing.
    const suspended = campaignFixture({
      activityHistory: [
        {
          type: "suspend_endorse",
          targetName: "Rival Candidate",
          timestamp: new Date().toISOString(),
          turnNumber: 4181,
        },
      ],
    });
    const row = buildCampaignBlendViewModel(input({ campaign: suspended })).ledger.rows[0];
    expect(row.label).toBe("Suspended and endorsed Rival Candidate");
    expect(row.label).not.toMatch(/Lv 0/);
    expect(row.cost).toBe("");
    expect(row.demoted).toBe(false);
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

describe("ledger endorsements tab", () => {
  function endorsers(n: number, kind: "player" | "npp" = "npp") {
    return Array.from({ length: n }, (_, i) => ({
      kind,
      name: `${kind === "npp" ? "Politician" : "Player"} ${i + 1}`,
      since: `2026-05-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    }));
  }

  it("does not tell a fogged viewer the records are empty when they are hidden", () => {
    // A non-owner's payload is redacted upstream: `getCampaignDetail` returns
    // before it reads either list, so both arrive empty. Saying nobody has
    // endorsed, or nothing was bought, states as fact something the viewer was
    // simply not shown.
    const fogged = campaignFixture({
      accessLevel: "public",
      activityHistory: [],
      endorsements: [],
    });

    const activity = buildCampaignBlendViewModel(input({ campaign: fogged }));
    expect(activity.ledger.emptyText).toMatch(/cannot see|not visible|own side/i);
    expect(activity.ledger.emptyText).not.toMatch(/Nothing has been bought/i);

    const endorsing = buildCampaignBlendViewModel(
      input({ campaign: fogged, ledgerTab: "endorsements" })
    );
    expect(endorsing.ledger.emptyText).not.toMatch(/No one has endorsed/i);
  });

  it("still says plainly when an owner's own records are genuinely empty", () => {
    const owner = campaignFixture({ accessLevel: "owner", activityHistory: [], endorsements: [] });
    expect(buildCampaignBlendViewModel(input({ campaign: owner })).ledger.emptyText).toBe(
      "Nothing has been bought yet."
    );
    // Scoped to the two sources the tab actually lists: governor and executive
    // endorsements pay actions but are not shown here.
    expect(
      buildCampaignBlendViewModel(input({ campaign: owner, ledgerTab: "endorsements" })).ledger
        .emptyText
    ).toBe("No players or politicians have endorsed this campaign yet.");
  });

  it("offers no source filter to a viewer who cannot see the records", () => {
    // The counts behind the chips are all zero for a fogged viewer because the
    // payload was redacted. Rendering "All 0 / Players 0 / Politicians 0" over
    // the "visible only to the campaign's own side" line reports the absence
    // that line is careful not to claim.
    const fogged = campaignFixture({ accessLevel: "public", endorsements: [] });
    const vm = buildCampaignBlendViewModel(input({ campaign: fogged, ledgerTab: "endorsements" }));
    expect(vm.ledger.showFilters).toBe(false);
  });

  it("offers the source filter to the campaign's own side", () => {
    const owner = campaignFixture({
      accessLevel: "owner",
      endorsements: [{ kind: "npp", name: "Carol Martin", since: null }],
    });
    const vm = buildCampaignBlendViewModel(input({ campaign: owner, ledgerTab: "endorsements" }));
    expect(vm.ledger.showFilters).toBe(true);
  });

  it("keeps real-world dates out of the endorsement rows", () => {
    // `createdAt` is a 2026 wall-clock stamp; the game's own calendar comes from
    // the era preset, so printing it beside turn tags dates the fiction wrongly.
    const campaign = campaignFixture({
      endorsements: [{ kind: "npp", name: "Carol Martin", since: "2026-05-05T00:00:00.000Z" }],
    });
    const vm = buildCampaignBlendViewModel(input({ campaign, ledgerTab: "endorsements" }));
    expect(JSON.stringify(vm.ledger.endorsementRows)).not.toMatch(/2026|May/);
  });

  it("lists endorsers instead of activity when the endorsements tab is open", () => {
    const campaign = campaignFixture({
      endorsements: [
        { kind: "npp", name: "Carol Martin", since: "2026-05-05T00:00:00.000Z" },
        { kind: "player", name: "Richard Nixon", since: "2026-05-04T00:00:00.000Z" },
      ],
    });
    const vm = buildCampaignBlendViewModel(input({ campaign, ledgerTab: "endorsements" }));

    expect(vm.ledger.tab).toBe("endorsements");
    expect(vm.ledger.endorsementRows.map((r) => r.name)).toEqual(["Carol Martin", "Richard Nixon"]);
    expect(vm.ledger.endorsementRows[0].kindLabel).toBe("Politician");
    expect(vm.ledger.endorsementRows[1].kindLabel).toBe("Player");
  });

  it("narrows the list to one source when the filter names it", () => {
    const campaign = campaignFixture({
      endorsements: [
        { kind: "npp", name: "Carol Martin", since: "2026-05-05T00:00:00.000Z" },
        { kind: "player", name: "Richard Nixon", since: "2026-05-04T00:00:00.000Z" },
      ],
    });
    const vm = buildCampaignBlendViewModel(
      input({ campaign, ledgerTab: "endorsements", endorsementFilter: "player" })
    );

    expect(vm.ledger.endorsementRows.map((r) => r.name)).toEqual(["Richard Nixon"]);
    // The chips report the unfiltered totals, so switching filters does not
    // change what the chips say is available behind them.
    expect(vm.ledger.filterCounts).toEqual({ all: 2, player: 1, npp: 1 });
  });

  it("pages endorsers ten to a page like the activity tab", () => {
    const campaign = campaignFixture({ endorsements: endorsers(23) });
    const vm = buildCampaignBlendViewModel(
      input({ campaign, ledgerTab: "endorsements", endorsementPage: 1 })
    );

    expect(vm.ledger.endorsementRows).toHaveLength(LEDGER_PAGE_SIZE);
    expect(vm.ledger.pageCount).toBe(3);
    expect(vm.ledger.canPrev).toBe(true);
    expect(vm.ledger.canNext).toBe(true);
    expect(vm.ledger.rangeText).toBe("11-20 of 23");
  });

  it("pages the filtered list, not the whole one", () => {
    const campaign = campaignFixture({
      endorsements: [...endorsers(12, "npp"), ...endorsers(3, "player")],
    });
    const vm = buildCampaignBlendViewModel(
      input({ campaign, ledgerTab: "endorsements", endorsementFilter: "player" })
    );

    expect(vm.ledger.hasPager).toBe(false);
    expect(vm.ledger.pageCount).toBe(1);
    expect(vm.ledger.rangeText).toBe("1-3 of 3");
  });

  it("clamps a page left past the end of a narrowed list", () => {
    const campaign = campaignFixture({
      endorsements: [...endorsers(12, "npp"), ...endorsers(3, "player")],
    });
    // Page 1 is valid for 12 NPP endorsers but not for the 3 player ones, which
    // is what a viewer sees when they page forward and then switch filters.
    const vm = buildCampaignBlendViewModel(
      input({
        campaign,
        ledgerTab: "endorsements",
        endorsementFilter: "player",
        endorsementPage: 1,
      })
    );

    expect(vm.ledger.page).toBe(0);
    expect(vm.ledger.endorsementRows).toHaveLength(3);
  });

  it("keeps the activity pager on its own page when the endorsements tab pages", () => {
    const campaign = campaignFixture({ endorsements: endorsers(23) });
    const vm = buildCampaignBlendViewModel(
      input({ campaign, ledgerTab: "activity", endorsementPage: 2 })
    );

    expect(vm.ledger.tab).toBe("activity");
    expect(vm.ledger.page).toBe(0);
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

  it("shows the strength to two decimals, not to seventeen", () => {
    // Campaign strength comes off a contribution curve and carries an
    // irrational tail, so the stored value is a full double. Printed raw it
    // read as "5920.075743469171" — false precision on a figure nobody can act
    // on past the decimal, and wider than the panel holding it.
    const vm = buildCampaignBlendViewModel(
      input({ campaign: { ...campaignFixture(), campaignStrength: 5920.075743469171 } })
    );
    expect(vm.strength?.strength).toBe("5,920.08");
    expect(vm.vitals.find((v) => v.label === "Strength")?.value).toBe("5,920.08");
  });

  it("keeps two decimals rather than rounding a small contribution to nothing", () => {
    // A contribution can be worth a fraction of a point, so whole numbers would
    // show a purchase moving the figure not at all.
    const vm = buildCampaignBlendViewModel(
      input({ campaign: { ...campaignFixture(), campaignStrength: 0.014 } })
    );
    expect(vm.strength?.strength).toBe("0.01");
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
          countryId: "US",
        },
      })
    );
    expect(vm.strength?.canContribute).toBe(false);
    expect(vm.strength?.blockedReason).toBe(
      "You need national influence to contribute campaign strength."
    );
  });

  it("lets a viewer who is not campaign staff contribute", () => {
    // Campaign strength is the one lever on this desk that is open to the whole
    // country: `contributeCampaignStrength` takes a contribution from any
    // authenticated character in the race's country, which is how allied and
    // rival players fund a nominee. Nothing about the viewer's access level may
    // close it.
    const vm = buildCampaignBlendViewModel(
      input({ campaign: campaignFixture({ accessLevel: "public", funds: undefined }) })
    );
    expect(vm.strength?.blockedReason).toBeNull();
    expect(vm.strength?.canContribute).toBe(true);
  });

  it("asks a signed-out reader to sign in rather than quoting a price", () => {
    const vm = buildCampaignBlendViewModel(
      input({
        campaign: campaignFixture({ accessLevel: "public", funds: undefined }),
        me: {
          funds: null,
          storedFunds: null,
          actions: null,
          nationalInfluence: null,
          fundsCurrency: null,
          countryId: null,
        },
      })
    );
    expect(vm.strength?.blockedReason).toBe("Sign in to contribute campaign strength.");
    expect(vm.strength?.canContribute).toBe(false);
  });

  it("closes contributions on a down-ballot race, where strength moves no votes", () => {
    // Only the presidential engine reads `campaignStrength`; the server rejects
    // a down-ballot contribution outright. Offering the control would charge a
    // player for a stat with no effect.
    const vm = buildCampaignBlendViewModel(
      input({
        campaign: campaignFixture({
          electionInfo: {
            state: "Ohio",
            electionType: "senate",
            cycle: 1,
            senateClass: 1,
            electionYear: 2028,
            isEnded: false,
          },
        }),
      })
    );
    expect(vm.strength?.canContribute).toBe(false);
    expect(vm.strength?.blockedReason).toBe(
      "Campaign strength only affects presidential races right now, so contributions to this race are closed."
    );
  });

  it("closes contributions for a viewer in another country", () => {
    // `contributeCampaignStrength` runs `assertSameCountry` and refuses. Worse
    // than the refusal, the price quoted here is converted at the CAMPAIGN's
    // rate while the affordability check reads the VIEWER's balance, so a
    // foreign reader was being shown a figure in one currency tested against a
    // balance in another. Currency alone cannot decide this: SUR is shared by
    // RU / BLR / UKR / BAL and GBP by UK / SCO / WAL.
    const vm = buildCampaignBlendViewModel(
      input({
        campaign: campaignFixture({ accessLevel: "public", funds: undefined }),
        me: {
          funds: 612_000,
          storedFunds: 612_000,
          actions: 20,
          nationalInfluence: 8,
          fundsCurrency: "GBP",
          countryId: "UK",
        },
      })
    );
    expect(vm.strength?.canContribute).toBe(false);
    expect(vm.strength?.blockedReason).toBe(
      "You can only contribute to campaigns in your own country."
    );
  });

  it("leaves contributions open for a viewer in the campaign's own country", () => {
    const vm = buildCampaignBlendViewModel(
      input({
        campaign: campaignFixture({ accessLevel: "public", funds: undefined }),
        me: {
          funds: 612_000,
          storedFunds: 612_000,
          actions: 20,
          nationalInfluence: 8,
          fundsCurrency: "USD",
          countryId: "US",
        },
      })
    );
    expect(vm.strength?.blockedReason).toBeNull();
  });

  it("does not block on country when the viewer's country is unknown", () => {
    // Fails OPEN to the server's own `assertSameCountry`. Blocking on a missing
    // value would lock out legitimate same-country players whenever the
    // `/api/auth/me` fetch degrades, which it is written to tolerate.
    const vm = buildCampaignBlendViewModel(
      input({
        campaign: campaignFixture({ accessLevel: "public", funds: undefined }),
        me: {
          funds: 612_000,
          storedFunds: 612_000,
          actions: 20,
          nationalInfluence: 8,
          fundsCurrency: "USD",
          countryId: null,
        },
      })
    );
    expect(vm.strength?.blockedReason).toBeNull();
  });

  it("closes contributions once the candidate has suspended their campaign", () => {
    // `canManage` and `canSurrogate` both carried `!campaignSuspended`, so
    // gating the control on them hid it here for free. The server still
    // refuses (getCampaignOrThrow -> assertCampaignActiveForManagement), so
    // this is a dead button rather than a money leak, but it is still a button
    // that cannot work.
    const vm = buildCampaignBlendViewModel(
      input({ campaign: campaignFixture({ campaignSuspended: true }) })
    );
    expect(vm.strength?.canContribute).toBe(false);
    expect(vm.strength?.blockedReason).toBe(
      "This candidate has suspended their campaign, so contributions are closed."
    );
  });

  it("closes contributions once the race is over", () => {
    const vm = buildCampaignBlendViewModel(
      input({
        campaign: campaignFixture({
          electionInfo: {
            state: "National",
            electionType: "president",
            cycle: 1,
            senateClass: null,
            electionYear: 2028,
            isEnded: true,
          },
        }),
      })
    );
    expect(vm.strength?.canContribute).toBe(false);
    expect(vm.strength?.blockedReason).toBe("This race has ended, so contributions are closed.");
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
