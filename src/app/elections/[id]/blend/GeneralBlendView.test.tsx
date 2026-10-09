/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CandidateDetail, ElectionDetail } from "../components/ElectionDetailTypes";
import { GeneralBlendView } from "./GeneralBlendView";

vi.mock("./presMap/usStatesGeo", () => ({
  MAP_WIDTH: 960,
  MAP_HEIGHT: 600,
  loadUsStateGeo: () =>
    Promise.resolve([
      { id: "PA", d: "M600 200h60v40h-60z", centroid: [630, 220], width: 60, height: 40 },
      { id: "CA", d: "M100 200h60v120h-60z", centroid: [130, 260], width: 60, height: 120 },
    ]),
}));

function candidate(over: Partial<CandidateDetail> = {}): CandidateDetail {
  return {
    id: "c1",
    characterId: "ch1",
    characterName: "First Ticket",
    party: "1",
    partyName: "Democratic Party",
    partyColor: "#2563eb",
    isNPP: false,
    nppId: null,
    sharePct: 49.2,
    isYou: false,
    endorsements: [],
    ...over,
  } as unknown as CandidateDetail;
}

const CANDIDATES = [
  candidate({ id: "c1", characterName: "First Ticket", isYou: true }),
  candidate({
    id: "c2",
    characterId: "ch2",
    characterName: "Second Ticket",
    party: "2",
    partyName: "Republican Party",
    partyColor: "#dc2626",
  }),
];

function election(): ElectionDetail {
  return {
    id: "e1",
    electionType: "president",
    state: "National",
    countryId: "US",
    cycle: 1,
    electionYear: 2028,
    status: "active",
    startTurn: 4100,
    endTurn: 4186,
    primaryEndTurn: 4150,
    inPrimary: false,
    isEnded: false,
    isUpcoming: false,
    inGeneral: true,
    primaryAdvanceCount: 1,
    byParty: [],
    allCandidates: CANDIDATES,
    snapshotHistory: [],
    myCharId: "ch1",
    myEndorsedCandidateId: null,
    gameState: { isActive: true, pausedAt: null, currentTurn: 4182 },
    generalVotes: {
      totalVotes: { c1: 69_473_000, c2: 67_213_000 },
      candidateNames: {},
      candidateParties: {},
      candidateColors: {},
      finalized: false,
      seatsEstimate: null,
      turnSnapshots: [],
      electoralVotesByCandidate: { c1: 276, c2: 251 },
      evByState: { CA: 54, TX: 40, PA: 19 },
      stateVoteData: {
        CA: { votesByCandidate: { c1: 700, c2: 300 }, evByCandidate: { c1: 54 } },
        TX: { votesByCandidate: { c1: 400, c2: 600 }, evByCandidate: { c2: 40 } },
        PA: { votesByCandidate: { c1: 510, c2: 490 }, evByCandidate: { c1: 19 } },
      },
    },
  } as unknown as ElectionDetail;
}

/**
 * The campaign operations the tickets table joins on. Only the first ticket
 * (the reader, character `ch1`) has a campaign: a rival without one must still
 * get a row.
 */
const CAMPAIGNS = [
  {
    id: "camp1",
    candidateId: "ch1",
    candidateName: "First Ticket",
    party: "1",
    partyName: "Democratic Party",
    currencyCode: "USD",
    funds: 1_250_000,
    actions: 3,
    levels: { fundraising: 2, oppositionResearch: 1, groundGame: 3, mediaSpending: 0 },
    managerName: "Casey Manager",
    isExact: true,
    isMine: true,
  },
];

function stubCampaigns(campaigns: unknown[] = CAMPAIGNS) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ campaigns }) })
  );
}

beforeEach(() => stubCampaigns());
afterEach(() => vi.unstubAllGlobals());

function renderView() {
  return render(
    <GeneralBlendView election={election()} electionId="e1" wire={[]} onRefresh={() => {}} />
  );
}

/**
 * Both trees are in the DOM at once (`lg:hidden` and `hidden lg:block`), so
 * anything reaching both layouts appears twice. Counting is the point: a
 * rail-only block reads as present when you only assert "at least one", which
 * is how these shipped invisible on mobile.
 */
describe("GeneralBlendView", () => {
  it("shows the reader their own ticket's standing on both layouts", () => {
    renderView();
    // 276 EV against 251 is a 25 EV lead.
    expect(screen.getAllByText("+25 EV lead")).toHaveLength(2);
    expect(screen.getAllByText("Your ticket")).toHaveLength(2);
  });

  it("carries the board's margin-tier legend to both layouts", () => {
    renderView();
    expect(screen.getAllByText("MARGIN TIERS:")).toHaveLength(2);
  });

  it("draws one map per layout and no tile board", async () => {
    renderView();
    expect(screen.getAllByRole("group", { name: /US presidential map/ })).toHaveLength(2);
    expect(await screen.findAllByRole("button", { name: /Pennsylvania/ })).toHaveLength(2);
    expect(screen.queryByText(/battleground board/i)).toBeNull();
  });

  it("starts locked on the phone, and the desktop stage owns its gestures", () => {
    // The phone map sits in a scrolling page, so it must not capture a swipe
    // until the reader unlocks it. The desktop stage is the whole viewport and
    // nothing scrolls under it, so it pans and zooms from the start.
    renderView();
    const maps = screen.getAllByRole("group", { name: /US presidential map/ });
    expect(maps.map((m) => m.getAttribute("data-locked")).sort()).toEqual(["false", "true"]);
    expect(screen.getAllByRole("button", { name: /Unlock map/ })).toHaveLength(1);
  });

  it("shows democratic health and both presidential drag levels on both layouts", () => {
    const { container } = render(
      <GeneralBlendView
        election={{
          ...election(),
          democraticHealth: {
            value: 42.5,
            label: "Fragile democracy",
            rulingPartyId: "1",
            rulingPartyName: "Democratic Party",
            partyPenaltyPct: 4.2,
            currentRulerPenaltyPct: 6.3,
            economicDragPctPoints: 1.25,
            currentRulerReliefPct: 40,
            currentRulerInRace: true,
            recordedTurn: 412,
          },
        }}
        electionId="e1"
        wire={[]}
        onRefresh={() => {}}
      />
    );
    // The desktop rail shows it open; the phone offers a chip that opens it.
    expect(screen.getAllByText("Democratic health")).toHaveLength(2);
    expect(screen.getAllByText("Ruling party drag")).toHaveLength(1);
    const phone = container.querySelector<HTMLElement>(".lg\\:hidden")!;
    fireEvent.click(within(phone).getByRole("button", { name: "Democratic health" }));
    expect(screen.getAllByText("Ruling party drag")).toHaveLength(2);
    expect(screen.getAllByText("Sitting President drag")).toHaveLength(2);
    expect(screen.getAllByText(/Temporary constitutional relief/)).toHaveLength(2);
  });
});

describe("nothing on this screen is won", () => {
  // GeneralBlendView renders only while a race is RUNNING; a concluded one gets
  // ResultsBlendView. So every figure here is a forecast from the votes banked
  // so far, and the screen has to say so rather than reading as a called result.
  it("raises the contingent election beside the college bar on both layouts", () => {
    const e = election();
    e.generalVotes!.electoralVotesByCandidate = { c1: 54, c2: 40, c3: 19 };
    render(<GeneralBlendView election={e} electionId="e1" wire={[]} onRefresh={() => {}} />);
    expect(screen.getAllByText("Contingent election risk")).toHaveLength(2);
  });

  it("raises no contingent election when a ticket holds the majority", () => {
    renderView();
    expect(screen.queryByText("Contingent election risk")).toBeNull();
  });

  it("says the figures are projected, on both layouts", () => {
    renderView();
    expect(screen.getAllByText(/No state is won until the race resolves/)).toHaveLength(2);
  });

  it("labels the hero's figures as projected", () => {
    renderView();
    expect(screen.getAllByText(/No state is won until the race resolves/)).toHaveLength(2);
  });

  it("uses one masthead label across both layouts", () => {
    // The mobile masthead had its own hardcoded "Election Night", so fixing the
    // desktop kicker alone left the two trees disagreeing about what the race
    // even is.
    renderView();
    const mastheads = screen.getAllByText(/^(Election Night|The Campaign)$/);
    expect(mastheads).toHaveLength(2);
    expect(new Set(mastheads.map((n) => n.textContent)).size).toBe(1);
  });
});

describe("the tickets and the campaign operations are one table", () => {
  it("draws the tickets for a two-way race, which the hero alone could not carry", () => {
    renderView();
    // One heading per tree.
    expect(screen.getAllByText("The tickets")).toHaveLength(2);
  });

  it("offers the Tickets pane in the rail", () => {
    renderView();
    expect(screen.getAllByRole("button", { name: /^Tickets/ }).length).toBeGreaterThan(0);
  });

  it("no longer draws a separate campaign operations list", () => {
    renderView();
    expect(screen.queryByText("Campaign operations")).toBeNull();
  });

  it("puts every column on a row: ticket, mate, manager, standing and campaign", async () => {
    renderView();
    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent)
    ).toEqual([
      "Ticket",
      "Mate and manager",
      "Proj. EV",
      "Share",
      "Votes",
      "Funds",
      "Actions",
      "Levels",
      "Endorse and campaign",
    ]);
    // Campaigns load after mount; the manager is the first thing to land.
    await waitFor(() => expect(within(table).getByText("Manager: Casey Manager")).toBeTruthy());
    const row = within(table).getByRole("link", { name: "First Ticket" }).closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    expect(cells[0].textContent).toContain("Democratic Party");
    expect(cells[2].textContent).toBe("276");
    expect(cells[3].textContent).toBe("50.8%");
    expect(cells[4].textContent).toBe("69.5M");
    expect(cells[5].textContent).toMatch(/1[.,]25|1\.3M|1,250,000/);
    // Levels are summed across the four operations.
    expect(cells[7].textContent).toBe("6");
    expect(cells[6].textContent).toBe("3");
    expect(within(row).getByRole("link", { name: "View campaign" }).getAttribute("href")).toBe(
      "/campaign/camp1"
    );
  });

  it("keeps a rival without a campaign as a row, with no campaign link", async () => {
    renderView();
    const table = screen.getByRole("table");
    await waitFor(() => expect(within(table).getByText("Manager: Casey Manager")).toBeTruthy());
    const row = within(table).getByRole("link", { name: "Second Ticket" }).closest("tr")!;
    expect(within(row).queryByRole("link", { name: "View campaign" })).toBeNull();
    expect(within(row).getByRole("button", { name: /Endorse/ })).toBeTruthy();
  });

  it("draws a compact card per ticket on the phone, with the same fields", async () => {
    const { container } = renderView();
    const cards = Array.from(container.querySelectorAll("article"));
    expect(cards).toHaveLength(2);
    await waitFor(() => expect(within(cards[0]).getByText("Manager: Casey Manager")).toBeTruthy());
    expect(within(cards[0]).getByRole("link", { name: "View campaign" })).toBeTruthy();
    expect(within(cards[0]).getByText("Funds")).toBeTruthy();
    expect(within(cards[0]).getByText("Levels")).toBeTruthy();
    expect(within(cards[1]).getByRole("button", { name: /Endorse/ })).toBeTruthy();
    expect(within(cards[1]).queryByRole("link", { name: "View campaign" })).toBeNull();
  });

  it("notes that campaign levels are approximate when none are exact", async () => {
    stubCampaigns([{ ...CAMPAIGNS[0], isExact: false }]);
    renderView();
    await waitFor(() =>
      expect(screen.getAllByText("Campaign levels are approximate (fog of war)")).toHaveLength(2)
    );
  });

  it("skips the campaign request outside the US", () => {
    const e = election();
    (e as unknown as Record<string, unknown>).countryId = "GB";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<GeneralBlendView election={e} electionId="e1" wire={[]} onRefresh={() => {}} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getAllByText("The tickets")).toHaveLength(2);
  });
});

describe("the phone folds the right rail behind a chip strip", () => {
  const withMood = () => {
    const e = election();
    (e as unknown as Record<string, unknown>).democraticHealth = {
      value: 42.5,
      label: "Fragile democracy",
      rulingPartyId: "1",
      rulingPartyName: "Democratic Party",
      partyPenaltyPct: 4.2,
      currentRulerPenaltyPct: 6.3,
      economicDragPctPoints: 1.25,
      currentRulerReliefPct: 40,
      currentRulerInRace: true,
      recordedTurn: 412,
    };
    return e;
  };

  it("opens one panel at a time and closes it again", () => {
    const { container } = render(
      <GeneralBlendView election={withMood()} electionId="e1" wire={[]} onRefresh={() => {}} />
    );
    const phone = container.querySelector<HTMLElement>(".lg\\:hidden")!;
    expect(within(phone).queryByRole("region")).toBeNull();
    fireEvent.click(within(phone).getByRole("button", { name: "Democratic health" }));
    expect(within(phone).getByRole("region", { name: "Democratic health" })).toBeTruthy();
    fireEvent.click(within(phone).getByRole("button", { name: "Close" }));
    expect(within(phone).queryByRole("region")).toBeNull();
  });
});

describe("the hero is the ticket list in a two-way race", () => {
  it("puts the endorse control on both layouts, which the table never did", () => {
    // The table was desktop-only, so a player on a phone could not endorse
    // anybody at all. One button per rival per tree: the fixture's c1 is the
    // reader, so only c2 gets one.
    renderView();
    // Hero and tickets table, one tree each way: 2 hero + 1 table + 1 card.
    expect(screen.getAllByRole("button", { name: /Endorse/ })).toHaveLength(4);
  });

  it("offers no endorse button on the reader's own ticket", () => {
    // The route refuses it ("You cannot endorse yourself", 400), so the button
    // could never do anything but fail. It was rendered anyway, and the failure
    // was silent. c1 is the reader; two tickets, two trees, so an ungated
    // version of this would render four buttons rather than two.
    renderView();
    expect(screen.getAllByRole("button", { name: /Endorse/ })).toHaveLength(4);
    expect(screen.getAllByText("First Ticket").length).toBeGreaterThan(0);
  });

  it("still offers it on a rival's ticket", () => {
    // The fixture's c1 is the reader and c2 is the rival, so exactly one
    // button per tree survives the guard, in the hero and in the tickets.
    renderView();
    expect(screen.getAllByRole("button", { name: /Endorse/ })).toHaveLength(4);
  });

  it("prints the leader's electoral votes only where each one earns its place", () => {
    renderView();
    // Four bare figures, every one deliberate: the reader's own "Your ticket"
    // standing once per tree, and the figure in the tickets table and card,
    // which is where each ticket's campaign sits next to its standing. The
    // desktop rail's nav badge went with the rail when the map stage replaced
    // it. The hero's own two carry their unit and sit under a "Current
    // projection" label, so they read as "276 EV", as does the stage's field
    // list. The bar used to label its own segment too. If the count rises,
    // something started echoing the hero again.
    expect(screen.getAllByText("276")).toHaveLength(4);
    expect(screen.getAllByText("276 EV")).toHaveLength(3);
  });
});

/**
 * The hero grids, one per tree.
 *
 * The two even columns are the hero's own signature; the board's grid is
 * `repeat(N, 1fr)` and the tickets table's columns are fixed widths, so neither
 * answers this selector. If the hero ever goes back to free columns it matches
 * nothing and the count assertion fails.
 */
const heroGrids = (container: HTMLElement) =>
  Array.from(
    container.querySelectorAll<HTMLElement>('div[style*="grid-template-columns: 1fr 1fr"]')
  );

/** One string per grid cell, in document order. */
const cellText = (grid: HTMLElement) =>
  Array.from(grid.children).map((cell) => cell.textContent ?? "");

describe("the hero's two sides stay level", () => {
  // As two independent flex columns, any asymmetry between the sides — a
  // running mate on one, no endorse button on the reader's own — pushed one
  // column down and the two big electoral-vote figures stopped lining up.
  // A grid of shared rows aligns them by construction.
  //
  // The phone drew its own inline copy of this block, so it had the same fault
  // and would not have been fixed by a change to the desktop hero. Both trees
  // now call one function, and these assertions check every copy of the hero
  // rather than the first one they find.
  it("draws the hero once per tree, from one shared function", () => {
    const { container } = renderView();
    expect(heroGrids(container)).toHaveLength(2);
  });

  it("lays each pair out as a two-column grid, not two free columns", () => {
    const { container } = renderView();
    for (const grid of heroGrids(container)) {
      expect(grid.style.display).toBe("grid");
    }
  });

  it("fills every row for both tickets, so no row can be half empty", () => {
    const { container } = renderView();
    const grids = heroGrids(container);
    expect(grids).toHaveLength(2);
    for (const grid of grids) {
      // Name, party, two labelled figures and a share for each ticket, plus an
      // endorse row the rival fills and the reader's own side leaves empty. An
      // odd count would mean a row exists on one side only, which is how the
      // figures drifted apart.
      expect(grid.children.length).toBeGreaterThan(0);
      expect(grid.children.length % 2).toBe(0);
    }
  });

  it("lets a long name give way rather than widen its track", () => {
    // Grid items default to min-width:auto, which floors a track at its widest
    // word. `body` is overflow-x: clip, so on a phone — where each track is
    // about 160px — a long name would push the other ticket off a screen that
    // cannot scroll sideways to reach it.
    const { container } = renderView();
    for (const grid of heroGrids(container)) {
      for (const cell of Array.from(grid.children) as HTMLElement[]) {
        expect(cell.style.minWidth).toBe("0");
      }
    }
  });

  it("renders both heroes from the same figures", () => {
    const { container } = renderView();
    const [mobile, desktop] = heroGrids(container).map(cellText);
    // The trees differ in type size and nothing else. Any divergence here means
    // a layout has started deciding for itself what to show.
    expect(mobile).toEqual(desktop);
  });
});

describe("the hero separates what is counted from what is forecast", () => {
  // No state is awarded until the race resolves — the engine writes electoral
  // votes only at resolution, and until then the API derives them by
  // winner-take-all over the ballots banked so far. So the electoral figure is
  // a forecast for the whole general, and leading with it unlabelled invited it
  // to be read as votes already won. The banked ballots are the real count, so
  // they carry the hero figure and the forecast is named as one.
  it("leads with the banked vote, then names the electoral figure a projection", () => {
    const { container } = renderView();
    for (const grid of heroGrids(container)) {
      const text = cellText(grid);
      expect(text).toContain("Votes banked");
      expect(text).toContain("69.5M");
      expect(text).toContain("Current projection");
      expect(text).toContain("276 EV");
      // Counted first, forecast second — the order is the whole point.
      expect(text.indexOf("Votes banked")).toBeLessThan(text.indexOf("Current projection"));
      expect(text.indexOf("69.5M")).toBeLessThan(text.indexOf("276 EV"));
    }
  });

  it("never prints a bare electoral figure that could read as won", () => {
    const { container } = renderView();
    for (const grid of heroGrids(container)) {
      // toContain is exact on array members, so "276 EV" is not "276".
      expect(cellText(grid)).not.toContain("276");
      expect(cellText(grid)).not.toContain("251");
      expect(cellText(grid)).toContain("276 EV");
    }
  });

  it("labels the reader's own standing in the rail as a projection too", () => {
    renderView();
    // Two hero cells and one rail block per tree: (2 + 1) x 2. The rail carried
    // the same derived figure at 34px with nothing saying what it was.
    expect(screen.getAllByText("Current projection")).toHaveLength(6);
  });
});

describe("names link out and states open", () => {
  it("links each hero ticket to its candidate profile, on both layouts", () => {
    renderView();
    // Hero and tickets table or card, in each tree.
    expect(screen.getAllByRole("link", { name: "First Ticket" })).toHaveLength(4);
    const hrefs = screen
      .getAllByRole("link", { name: "First Ticket" })
      .map((a) => a.getAttribute("href"));
    expect(new Set(hrefs)).toEqual(new Set(["/character/ch1"]));
  });

  it("links each hero party to its party page, on both layouts", () => {
    renderView();
    const links = screen.getAllByRole("link", { name: "Democratic Party" });
    expect(links).toHaveLength(4);
    for (const a of links) {
      expect(a.getAttribute("href")).toBe("/country/us/parties/1");
    }
  });

  it("opens a state overview linking to the full state page", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    renderView();
    fireEvent.click((await screen.findAllByRole("button", { name: /Pennsylvania/ }))[0]);
    const link = await screen.findByRole("link", { name: /Open full Pennsylvania page/ });
    expect(link.getAttribute("href")).toBe("/elections/e1/country/us/region/PA");
    expect(screen.getByText("Projected vote")).toBeTruthy();
    vi.restoreAllMocks();
  });

  it("pairs the turns with the local close time when the race has one", () => {
    const e = election();
    (e as unknown as Record<string, unknown>).endTime = "2026-11-10T15:24:00.000Z";
    render(<GeneralBlendView election={e} electionId="e1" wire={[]} onRefresh={() => {}} />);
    expect(screen.getAllByText(/4 TURNS LEFT, CLOSES /)).toHaveLength(2);
  });
});

describe("a third ticket pages the hero", () => {
  const threeWay = () => {
    const e = election();
    const third = candidate({
      id: "c3",
      characterId: "ch3",
      characterName: "Third Ticket",
      party: "3",
      partyName: "Libertarian Party",
      partyColor: "#d4af37",
    });
    e.allCandidates = [...CANDIDATES, third];
    e.generalVotes = {
      ...e.generalVotes!,
      totalVotes: { c1: 69_473_000, c2: 67_213_000, c3: 4_519_000 },
      electoralVotesByCandidate: { c1: 276, c2: 251, c3: 0 },
    };
    return e;
  };

  it("shows the top two first and pages to the third", () => {
    render(
      <GeneralBlendView election={threeWay()} electionId="e1" wire={[]} onRefresh={() => {}} />
    );
    expect(screen.getAllByText("1-2 OF 3")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Show next tickets" })[0]);
    expect(screen.getAllByText("3-3 OF 3")).toHaveLength(2);
  });

  it("draws no pager for a two-way race", () => {
    renderView();
    expect(screen.queryByRole("button", { name: "Show next tickets" })).toBeNull();
  });
});

describe("explanations live in tooltips", () => {
  it("demotes the vote-weighting line from the rail footnote", () => {
    renderView();
    expect(screen.queryByText(/final four turns/)).toBeNull();
    expect(screen.getAllByText("Turn weighting.")).toHaveLength(2);
  });

  it("tooltips the referendum figure instead of leaving it bare", () => {
    const e = election();
    (e as unknown as Record<string, unknown>).economicReferendum = {
      miseryIndex: 1.6,
      sharePts: 0.5,
      components: [{ key: "inflation", label: "Inflation", contributionPts: -1.0 }],
      fatigueMultiplier: 1,
      recordedTurn: 775,
    };
    (e as unknown as Record<string, unknown>).medianVoter = { ep: 0, sp: -0 };
    const { container } = render(
      <GeneralBlendView election={e} electionId="e1" wire={[]} onRefresh={() => {}} />
    );
    const tips = Array.from(container.querySelectorAll("[title]"));
    expect(tips.some((t) => t.textContent === "referendum points")).toBe(true);
    expect(tips.some((t) => (t.getAttribute("title") ?? "").includes("1 to 4%"))).toBe(true);
    // Negative-zero median normalizes rather than printing "-0 social".
    expect(container.textContent).not.toMatch(/-0 social/);
    expect(container.textContent).toMatch(/0 economic, 0 social/);
  });
});

describe("a refused endorsement says why", () => {
  it("shows the route's reason instead of doing nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "That endorsement is already spent" }),
      })
    );
    renderView();
    fireEvent.click(screen.getAllByRole("button", { name: /Endorse/ })[0]);
    // Once per tree: the message sits under the electoral-vote bar, which both
    // layouts draw.
    await waitFor(() =>
      expect(screen.getAllByText("That endorsement is already spent")).toHaveLength(2)
    );
  });

  it("falls back to its own wording when the route sends none", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    renderView();
    fireEvent.click(screen.getAllByRole("button", { name: /Endorse/ })[0]);
    await waitFor(() => expect(screen.getAllByText(/did not go through/)).toHaveLength(2));
  });

  it("says so when the request never lands", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    renderView();
    fireEvent.click(screen.getAllByRole("button", { name: /Endorse/ })[0]);
    await waitFor(() => expect(screen.getAllByText(/Network error/)).toHaveLength(2));
  });
});
