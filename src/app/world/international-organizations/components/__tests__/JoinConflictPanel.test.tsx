/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { JoinConflictPanel } from "../JoinConflictPanel";
import { resolveOrgIdentity } from "@/lib/constants/orgIdentity";
import type { OrgSummary, OrgViewerInfo } from "../../orgTypes";

const CONFLICTS = [
  {
    id: "korea-1953",
    conflictId: 7,
    name: "Korean War",
    sideALabel: "United Nations Command",
    sideBLabel: "Korean People's Army",
  },
];

let postResponse: { ok: boolean; body: unknown } = { ok: true, body: {} };
const fetchMock = vi.fn();

beforeEach(() => {
  postResponse = { ok: true, body: {} };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (!init || init.method !== "POST") {
      return { ok: true, json: async () => ({ conflicts: CONFLICTS }) };
    }
    return { ok: postResponse.ok, json: async () => postResponse.body };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const org = (category: string) =>
  ({
    id: "NATO",
    def: {
      id: "NATO",
      name: "NATO",
      shortName: "NATO",
      description: "",
      logoPath: null,
      foundingMembers: ["US"],
      leadership: { title: "Secretary-General", termTurns: 96 },
      charter: "",
      category,
    },
    members: [
      {
        countryId: "US",
        countryName: "United States",
        flagEmoji: "🇺🇸",
        status: "founding",
        joinedTurn: 0,
        hasVote: true,
        hasPolicyVote: true,
      },
    ],
    pendingMembershipProposals: [],
    pendingLegislation: [],
    activeLegislation: [],
    pendingWithdrawalMeasures: [],
    leadership: null,
    pendingLeadershipElections: [],
    identity: resolveOrgIdentity("NATO", false, "NATO", "bloc"),
    derived: { members: [], worldEconomySharePct: 50, notionalBudgetMillions: 0, yourInfluence: 0 },
    fund: {
      balanceLocal: 0,
      duesRateAnnual: 0.00006,
      currencyCode: "USD",
      currencyCountryId: "US",
    },
    posture: "standard",
    defensePctByCountry: {},
  }) as unknown as OrgSummary;

/** NATO with a voting roll of US + UK and one silent client state. */
const orgWithPendingEntry = () => {
  const base = org("bloc") as unknown as Record<string, unknown>;
  return {
    ...base,
    members: [
      {
        countryId: "US",
        countryName: "United States",
        status: "founding",
        joinedTurn: 0,
        hasVote: true,
        hasPolicyVote: true,
      },
      {
        countryId: "UK",
        countryName: "United Kingdom",
        status: "member",
        joinedTurn: 0,
        hasVote: true,
        hasPolicyVote: true,
      },
      {
        countryId: "DE",
        countryName: "Germany",
        status: "member",
        joinedTurn: 0,
        hasVote: false,
        hasPolicyVote: false,
      },
    ],
    pendingLegislation: [
      {
        _id: "l1",
        type: "join_conflict",
        title: "NATO Entry into the Korean War",
        proposedByCharacterName: "Lee Radziwill",
        closesOnTurn: 213,
        parties: [],
        votes: [{ countryId: "US", vote: "yes" }],
      },
    ],
  } as unknown as OrgSummary;
};

const viewer = {
  characterId: "c1",
  foreignMinisterOf: "US",
  foreignMinisterCountryName: "United States",
  headOfGovernmentOf: null,
  headOfGovernmentCountryName: null,
  diplomaticActionsRemaining: 3,
  diplomaticActionsPerTurn: 4,
  diplomaticActionsCountryId: "US",
} as unknown as OrgViewerInfo;

const renderPanel = (category = "bloc") =>
  render(
    <JoinConflictPanel
      org={org(category)}
      viewer={viewer}
      currentTurn={200}
      votingWindowTurns={24}
      onChange={() => {}}
    />
  );

async function openForm() {
  renderPanel();
  fireEvent.click(await screen.findByRole("button", { name: /propose entry/i }));
}

describe("JoinConflictPanel", () => {
  it("renders nothing for a non-bloc org", () => {
    // The write path refuses a security alliance, so the surface must not offer it.
    const { container } = renderPanel("security");
    expect(container.textContent).toBe("");
  });

  it("lists active conflicts with each side's label", async () => {
    await openForm();

    expect(await screen.findByRole("option", { name: "Korean War" })).toBeTruthy();
    // Both sides are named, so the choice is between two armies rather than
    // between the letters A and B.
    expect(screen.getByRole("option", { name: "United Nations Command" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Korean People's Army" })).toBeTruthy();
  });

  it("posts the theater id and the chosen side", async () => {
    await openForm();
    await screen.findByRole("option", { name: "Korean War" });

    fireEvent.change(screen.getByLabelText(/side/i), { target: { value: "B" } });
    fireEvent.click(screen.getByRole("button", { name: /submit for a vote/i }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(post).toBeDefined();
      const body = JSON.parse(post![1].body as string);
      // The _id, never the public conflictId — that is the theater key everything
      // downstream references.
      expect(body).toMatchObject({ type: "join_conflict", theaterId: "korea-1953", side: "B" });
    });
  });

  it("counts the tally against the voting roll, not the full membership", () => {
    // NATO carries client states that hold no ballot. Showing them in the
    // denominator told players a resolution needed far more support than the
    // resolver actually asks for.
    render(
      <JoinConflictPanel
        org={orgWithPendingEntry()}
        viewer={viewer}
        currentTurn={200}
        votingWindowTurns={24}
        onChange={() => {}}
      />
    );

    expect(screen.getByText(/1 \/ 2 members in favour/)).toBeTruthy();
    expect(screen.queryByText(/\/ 3 members in favour/)).toBeNull();
  });

  it("tells players entry needs unanimous consent", () => {
    render(
      <JoinConflictPanel
        org={orgWithPendingEntry()}
        viewer={viewer}
        currentTurn={200}
        votingWindowTurns={24}
        onChange={() => {}}
      />
    );

    expect(screen.getByText(/unanimous consent required/)).toBeTruthy();
  });

  it("surfaces the server's refusal reason", async () => {
    postResponse = { ok: false, body: { error: "That conflict is not live." } };
    await openForm();
    await screen.findByRole("option", { name: "Korean War" });

    fireEvent.click(screen.getByRole("button", { name: /submit for a vote/i }));

    expect(await screen.findByText(/That conflict is not live/)).toBeTruthy();
  });
});
