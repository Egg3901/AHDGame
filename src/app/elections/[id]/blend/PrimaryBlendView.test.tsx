/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ElectionDetail } from "../components/ElectionDetailTypes";
import type { PrimaryPartyDetail } from "@/lib/elections/dto/primaryPartyDetail";
import { PrimaryBlendView } from "./PrimaryBlendView";

// CarveUpPanel is translated; the root layout supplies the provider in the app,
// which a bare render does not have.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values?.state ? `${key}:${String(values.state)}` : key,
}));

const auth = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@/contexts/AuthDataContext", () => ({ useSignedIn: () => auth.signedIn }));

function detailFor(partyId: string, leader: string): PrimaryPartyDetail {
  return {
    partyId,
    partyName: partyId === "1" ? "Democratic Party" : "Republican Party",
    partyColor: "#2563eb",
    candidates: [{ id: `${partyId}-a`, name: leader, color: "#2563eb" }],
    byState: { IA: { [`${partyId}-a`]: 900 }, OH: { [`${partyId}-a`]: 400 } },
    stateNameById: { IA: "Iowa", OH: "Ohio" },
    votedStateIds: ["IA"],
    viewerCampaign: null,
  };
}

function candidate(id: string, name: string, party: string) {
  return {
    id,
    characterId: `ch-${id}`,
    characterName: name,
    party,
    partyName: party === "1" ? "Democratic Party" : "Republican Party",
    partyColor: "#2563eb",
    isNPP: false,
    nppId: null,
    sharePct: 50,
    isYou: false,
    endorsements: [],
  };
}

function election(): ElectionDetail {
  return {
    id: "e1",
    electionType: "president",
    countryId: "US",
    state: "National",
    status: "active",
    inPrimary: true,
    isEnded: false,
    isUpcoming: false,
    inGeneral: false,
    primaryAdvanceCount: 1,
    startTurn: 1,
    endTurn: 53,
    primaryEndTurn: 41,
    byParty: [
      {
        partyId: "1",
        partyName: "Democratic Party",
        partyColor: "#2563eb",
        countryId: "US",
        candidates: [candidate("1-a", "First Filer", "1")],
      },
      {
        partyId: "2",
        partyName: "Republican Party",
        partyColor: "#dc2626",
        countryId: "US",
        candidates: [candidate("2-a", "Other Filer", "2")],
      },
    ],
    allCandidates: [],
    snapshotHistory: [],
    generalVotes: null,
    myCharId: null,
    myEndorsedCandidateId: null,
    gameState: { isActive: true, pausedAt: null, currentTurn: 36 },
    primaryCalendar: [
      { label: "Iowa Caucus", turnsRemaining: 5, states: ["IA"], status: "complete" },
      { label: "Mid-March Wave", turnsRemaining: 3, states: ["OH"], status: "upcoming" },
    ],
  } as unknown as ElectionDetail;
}

/** Resolves the primary detail endpoint, recording the URLs asked for. */
function stubFetch(handler: (url: string) => unknown) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      const body = handler(url);
      if (body === null) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, json: async () => body };
    })
  );
  return urls;
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.signedIn = true;
});

describe("PrimaryBlendView", () => {
  it("fetches the selected party's detail and paints the board from it", async () => {
    const urls = stubFetch(() => detailFor("1", "First Filer"));
    render(<PrimaryBlendView election={election()} wire={[]} />);

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /Iowa/ }).length).toBeGreaterThan(0)
    );
    expect(urls.some((u) => u.includes("/api/elections/e1/primary/1"))).toBe(true);
  });

  it("says a voted state was won and an upcoming one is only projected", async () => {
    stubFetch(() => detailFor("1", "First Filer"));
    render(<PrimaryBlendView election={election()} wire={[]} />);
    // The state board is the stage's Squares view; the map is the default.
    fireEvent.click(screen.getByRole("tab", { name: "Squares" }));

    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "Iowa: First Filer won" }).length
      ).toBeGreaterThan(0)
    );
    expect(
      screen.getAllByRole("button", { name: "Ohio: First Filer projected to win" }).length
    ).toBeGreaterThan(0);
  });

  it("leaves the rest of the screen standing when the detail cannot be loaded", async () => {
    stubFetch(() => null);
    render(<PrimaryBlendView election={election()} wire={[]} />);

    // The field still renders; only the board and carve-up are absent.
    await waitFor(() => expect(screen.getAllByText("First Filer").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: /Iowa:/ })).toBeNull();
  });

  it("never paints one party's board under another party's heading", async () => {
    // The response for party 1 is held open, so it lands after the reader has
    // already moved to party 2. Stamping the response with its party is what
    // stops it being adopted.
    let releaseFirst: (v: unknown) => void = () => {};
    const held = new Promise((resolve) => {
      releaseFirst = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/primary/1")) {
          await held;
          return { ok: true, json: async () => detailFor("1", "First Filer") };
        }
        return { ok: true, json: async () => detailFor("2", "Other Filer") };
      })
    );

    render(<PrimaryBlendView election={election()} wire={[]} />);
    fireEvent.click(screen.getByRole("tab", { name: "Squares" }));
    fireEvent.click(screen.getAllByRole("button", { name: /Republican/ })[0]);

    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "Iowa: Other Filer won" }).length
      ).toBeGreaterThan(0)
    );

    await act(async () => {
      releaseFirst(null);
      await held;
    });

    // The late party-1 response must not replace the board on screen.
    expect(screen.queryByRole("button", { name: "Iowa: First Filer won" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Iowa: Other Filer won" }).length).toBeGreaterThan(
      0
    );
  });
});

describe("the wave calendar", () => {
  // The desktop rail is `hidden lg:block`. A rail-only calendar left mobile
  // with no schedule and no state chips, so the board was the only way to
  // reach a state there. The stage renders it once, at every width.
  it("reaches every width, not just the desktop rail", async () => {
    stubFetch(() => detailFor("1", "First Filer"));
    render(<PrimaryBlendView election={election()} wire={[]} />);

    await waitFor(() => expect(screen.getAllByText("Mid-March Wave").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Mid-March Wave")).toHaveLength(1);
    expect(screen.getAllByText("Iowa Caucus")).toHaveLength(1);
  });

  it("offers every wave's states as chips", async () => {
    stubFetch(() => detailFor("1", "First Filer"));
    render(<PrimaryBlendView election={election()} wire={[]} />);

    // Named for assistive tech, labelled by code on screen.
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Ohio" }).length).toBeGreaterThan(0)
    );
    expect(screen.getAllByRole("button", { name: "Ohio" })).toHaveLength(1);
  });

  it("moves the carve-up when a chip is chosen", async () => {
    stubFetch(() => detailFor("1", "First Filer"));
    render(<PrimaryBlendView election={election()} wire={[]} />);
    fireEvent.click(screen.getByRole("tab", { name: "Squares" }));

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Iowa" }).length).toBeGreaterThan(0)
    );
    // The calendar chip drives the shared selection, so the board's Iowa tile
    // becomes the pressed one.
    act(() => screen.getAllByRole("button", { name: "Iowa" })[0].click());

    await waitFor(() => {
      const tiles = screen.getAllByRole("button", { name: "Iowa: First Filer won" });
      expect(tiles.every((t) => t.getAttribute("aria-pressed") === "true")).toBe(true);
    });
  });
});

describe("the delegate column says what it is", () => {
  // A bare number beside a candidate's name reads as a count already won. It is
  // a forecast of the FINAL total, and for most of a primary nothing has been
  // awarded at all.
  function withDelegates(awardedDelegates?: Record<string, number>) {
    const base = election();
    return {
      ...base,
      byParty: [
        {
          ...base.byParty[0],
          projectedDelegates: { "1-a": 1695 },
          ...(awardedDelegates ? { awardedDelegates } : {}),
        },
        base.byParty[1],
      ],
    } as unknown as ElectionDetail;
  }

  it("labels the figure as projected in both layouts", () => {
    stubFetch(() => detailFor("1", "First Filer"));
    render(<PrimaryBlendView election={withDelegates()} wire={[]} />);

    // Desktop labels the column once in its header; mobile labels every row,
    // because a phone has no header to hang it on.
    expect(screen.getAllByText("Projected del.")).toHaveLength(1);
    expect(screen.getAllByText(/1,695 proj\./)).toHaveLength(1);
  });

  it("does not claim any delegates are won before a wave has awarded them", () => {
    stubFetch(() => detailFor("1", "First Filer"));
    render(<PrimaryBlendView election={withDelegates()} wire={[]} />);
    expect(screen.queryByText(/won/)).toBeNull();
  });

  it("shows what is locked in once a wave has awarded some", () => {
    stubFetch(() => detailFor("1", "First Filer"));
    render(<PrimaryBlendView election={withDelegates({ "1-a": 312 })} wire={[]} />);
    // Once per tree: desktop puts it under the forecast, mobile appends it to
    // the same line. Counting is the point — six blocks on this branch shipped
    // desktop-only because a test asserted "at least one".
    expect(screen.getAllByText(/312 won/)).toHaveLength(2);
    expect(screen.getAllByText(/1,695 proj\. · 312 won/)).toHaveLength(1);
  });
});

describe("campaign operations live in the field table", () => {
  // They used to be a separate "Campaign operations" list under the stage,
  // restating the field above it.
  it("joins each candidate's funds, actions, levels and manager to their row", async () => {
    stubFetch((url) =>
      url.includes("/campaigns")
        ? {
            campaigns: [
              {
                id: "camp-1",
                candidateId: "ch-1-a",
                candidateName: "First Filer",
                party: "1",
                currencyCode: "USD",
                funds: 1234,
                actions: 7,
                levels: { fundraising: 2, oppositionResearch: 1, groundGame: 3, mediaSpending: 0 },
                managerName: "Pat Manager",
                isExact: true,
              },
            ],
          }
        : detailFor("1", "First Filer")
    );
    render(<PrimaryBlendView election={election()} wire={[]} />);

    await waitFor(() =>
      expect(screen.getAllByRole("link", { name: "View campaign" }).length).toBeGreaterThan(0)
    );
    expect(screen.getAllByRole("link", { name: "View campaign" })[0].getAttribute("href")).toBe(
      "/campaign/camp-1"
    );
    expect(screen.getAllByText(/Manager: Pat Manager/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("6").length).toBeGreaterThan(0);
  });

  describe("endorsement", () => {
    it("offers Endorse on each filed candidate to a reader with a character", async () => {
      stubFetch(() => detailFor("1", "First Filer"));
      render(<PrimaryBlendView election={{ ...election(), myCharId: "me" }} wire={[]} />);
      expect(screen.getAllByRole("button", { name: "Endorse" }).length).toBeGreaterThan(0);
    });

    it("shows nothing to a reader with no character", async () => {
      stubFetch(() => detailFor("1", "First Filer"));
      render(<PrimaryBlendView election={election()} wire={[]} />);
      expect(screen.queryByRole("button", { name: /Endorse/ })).toBeNull();
    });

    it("posts the endorsement and flips to Endorsed", async () => {
      const calls: { url: string; method?: string; body?: string }[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
          calls.push({ url, method: init?.method, body: init?.body });
          if (url.includes("/endorse")) return { ok: true, json: async () => ({}) };
          return { ok: true, json: async () => detailFor("1", "First Filer") };
        })
      );
      const onRefresh = vi.fn();
      render(
        <PrimaryBlendView
          election={{ ...election(), myCharId: "me" }}
          wire={[]}
          onRefresh={onRefresh}
        />
      );
      fireEvent.click(screen.getAllByRole("button", { name: "Endorse" })[0]);
      await waitFor(() => expect(screen.getByRole("button", { name: "Endorsed" })).toBeTruthy());
      const post = calls.find((c) => c.url === "/api/elections/e1/endorse");
      expect(post?.method).toBe("POST");
      expect(JSON.parse(post?.body ?? "{}")).toEqual({ candidateId: "1-a" });
      expect(onRefresh).toHaveBeenCalled();
    });

    it("says why when the route refuses", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url.includes("/endorse"))
            return {
              ok: false,
              status: 403,
              json: async () => ({ error: "You can only endorse candidates in your own party" }),
            };
          return { ok: true, json: async () => detailFor("1", "First Filer") };
        })
      );
      render(<PrimaryBlendView election={{ ...election(), myCharId: "me" }} wire={[]} />);
      fireEvent.click(screen.getAllByRole("button", { name: "Endorse" })[0]);
      await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    });
  });
});

describe("the party switcher and endorse buttons", () => {
  function withViewer(myPartyId: string | null) {
    const base = election();
    return {
      ...base,
      myCharId: "me",
      myPartyId,
      allCandidates: base.byParty.flatMap((g) => g.candidates),
    } as unknown as ElectionDetail;
  }

  it("switches the primary map to another party from above the map", async () => {
    const urls = stubFetch((url) =>
      url.includes("/primary/2") ? detailFor("2", "Other Filer") : detailFor("1", "First Filer")
    );
    render(<PrimaryBlendView election={election()} wire={[]} />);
    const tabs = screen.getAllByRole("tab", { name: /Republican Party/ });
    fireEvent.click(tabs[0]);

    await waitFor(() => expect(urls.some((u) => u.includes("/primary/2"))).toBe(true));
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  });

  it("offers endorse only on candidates of the viewer's own party", () => {
    stubFetch(() => detailFor("1", "First Filer"));
    // The default party is the first; show both fields by selecting each.
    render(<PrimaryBlendView election={withViewer("1")} wire={[]} />);
    expect(screen.getAllByRole("button", { name: "Endorse" })).toHaveLength(1);

    fireEvent.click(screen.getAllByRole("tab", { name: /Republican Party/ })[0]);
    expect(screen.queryByRole("button", { name: "Endorse" })).toBeNull();
  });

  it("hides endorse everywhere for a viewer with no party", () => {
    stubFetch(() => detailFor("1", "First Filer"));
    render(<PrimaryBlendView election={withViewer(null)} wire={[]} />);
    expect(screen.queryByRole("button", { name: "Endorse" })).toBeNull();
  });
});

describe("what the page rebuild dropped", () => {
  it("links every party's full primary page", () => {
    stubFetch(() => detailFor("1", "First Filer"));
    render(<PrimaryBlendView election={election()} wire={[]} />);
    const nav = screen.getByRole("navigation", { name: "Full primary pages" });
    const hrefs = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/president/primary/1", "/president/primary/2"]);
  });

  it("shows no party page links outside the US", () => {
    stubFetch(() => detailFor("1", "First Filer"));
    const e = { ...election(), countryId: "GB" } as unknown as ElectionDetail;
    render(<PrimaryBlendView election={e} wire={[]} />);
    expect(screen.queryByRole("navigation", { name: "Full primary pages" })).toBeNull();
  });

  it("states when the primary ends and when the general election is held", () => {
    stubFetch(() => detailFor("1", "First Filer"));
    const e = { ...election(), electionYear: 1992 } as unknown as ElectionDetail;
    render(<PrimaryBlendView election={e} wire={[]} />);
    const dates = screen.getByLabelText("Key dates");
    expect(dates.textContent).toContain("Primary ends");
    expect(dates.textContent).toContain("5 turns");
    expect(dates.textContent).toContain("General election · 1992");
    expect(dates.textContent).toContain("17 turns");
  });

  it("tells a signed-out visitor to sign in rather than that they are not filed", () => {
    auth.signedIn = false;
    stubFetch(() => detailFor("1", "First Filer"));
    render(<PrimaryBlendView election={election()} wire={[]} />);
    expect(screen.queryByText(/You are not filed/)).toBeNull();
    expect(screen.getByText("Sign in to see where you stand.")).toBeTruthy();
  });

  it("keeps the not-filed note for a signed-in player in another party", () => {
    stubFetch(() => detailFor("1", "First Filer"));
    render(<PrimaryBlendView election={election()} wire={[]} />);
    expect(screen.getByText(/You are not filed in the Democratic Party primary/)).toBeTruthy();
  });

  it("lists the field once on a phone: the rail list carries the campaign line", () => {
    stubFetch(() => detailFor("1", "First Filer"));
    render(<PrimaryBlendView election={election()} wire={[]} />);
    // One rail row plus the desktop table's row; the old phone-only list is gone.
    expect(screen.getAllByText("First Filer")).toHaveLength(2);
  });

  it("shows the stage actions strip above the map when given", () => {
    stubFetch(() => detailFor("1", "First Filer"));
    render(
      <PrimaryBlendView
        election={election()}
        wire={[]}
        stageActions={<button type="button">Enter race</button>}
      />
    );
    const strip = screen.getByTestId("stage-actions");
    expect(strip.textContent).toBe("Enter race");
  });
});
