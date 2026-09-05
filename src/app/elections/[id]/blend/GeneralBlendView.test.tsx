/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CandidateDetail, ElectionDetail } from "../components/ElectionDetailTypes";
import { GeneralBlendView } from "./GeneralBlendView";

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

  it("keeps the tiles themselves on both layouts", () => {
    renderView();
    expect(screen.getAllByText("PA")).toHaveLength(2);
  });
});

describe("nothing on this screen is won", () => {
  // GeneralBlendView renders only while a race is RUNNING; a concluded one gets
  // ResultsBlendView. So every figure here is a forecast from the votes banked
  // so far, and the screen has to say so rather than reading as a called result.
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

describe("the hero is the ticket list in a two-way race", () => {
  // The table repeated the hero's name, electoral votes, share and popular vote
  // for the same two people, adding only the running mate and the endorse
  // button. Both of those now live on the hero, so the table earns its place
  // only once a third ticket exists.
  it("draws no separate tickets table for two tickets", () => {
    renderView();
    expect(screen.queryByText("The tickets")).toBeNull();
  });

  it("offers no dead Tickets pane in the rail", () => {
    renderView();
    expect(screen.queryByRole("button", { name: /^Tickets/ })).toBeNull();
  });

  it("puts the endorse control on both layouts, which the table never did", () => {
    // The table was desktop-only, so a player on a phone could not endorse
    // anybody at all. One button per rival per tree: the fixture's c1 is the
    // reader, so only c2 gets one.
    renderView();
    expect(screen.getAllByRole("button", { name: /Endorse/ })).toHaveLength(2);
  });

  it("offers no endorse button on the reader's own ticket", () => {
    // The route refuses it ("You cannot endorse yourself", 400), so the button
    // could never do anything but fail. It was rendered anyway, and the failure
    // was silent. c1 is the reader; two tickets, two trees, so an ungated
    // version of this would render four buttons rather than two.
    renderView();
    expect(screen.getAllByRole("button", { name: /Endorse/ })).toHaveLength(2);
    expect(screen.getAllByText("First Ticket").length).toBeGreaterThan(0);
  });

  it("still offers it on a rival's ticket", () => {
    // The fixture's c1 is the reader and c2 is the rival, so exactly one
    // button per tree survives the guard.
    renderView();
    expect(screen.getAllByRole("button", { name: /Endorse/ })).toHaveLength(2);
  });

  it("prints the leader's electoral votes only where each one earns its place", () => {
    renderView();
    // Three bare figures, every one deliberate: the reader's own "Your ticket"
    // standing once per tree, plus the rail's nav badge. The hero's own two
    // now carry their unit and sit under a "Current projection" label, so they
    // read as "276 EV" instead. The bar used to label its own segment too,
    // ~20px under a 50px rendering of the same number, and the tickets table
    // repeated it a third time. If either count rises, something started
    // echoing the hero again.
    expect(screen.getAllByText("276")).toHaveLength(3);
    expect(screen.getAllByText("276 EV")).toHaveLength(2);
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
