/**
 * @vitest-environment happy-dom
 */
/**
 * Leadership is a CEO-style rolling contest on its own tab. These pin the
 * president strip, the contest copy, and the organizer roster.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import UnionPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: "u1" }),
}));

const UNION = {
  id: "u1",
  name: "Communications Workers of America",
  countryId: "US",
  countryName: "United States",
  sectorType: "telecommunications",
  sectorLabel: "Telecommunications",
  ownerId: "ceo-char" as string | null,
  pendingLeaderCharacterId: null,
  electionOpen: true,
  leadershipElectionMinStrength: 100,
  strength: 120,
  organizeActionCost: 5,
  organizeStrengthGain: 10,
  treasury: 164,
  membershipPressure: 13.9,
  demandedWageLevel: null,
  suspended: false,
};

const ORGANIZERS = [
  {
    characterId: "ceo-char",
    name: "Ada Prentice",
    sequentialId: 12,
    avatarUrl: null,
    strength: 30,
    organizeCount: 3,
    influencePct: 75,
    isLeader: true,
  },
  {
    characterId: "c1",
    name: "Bo Marsh",
    sequentialId: 44,
    avatarUrl: null,
    strength: 10,
    organizeCount: 1,
    influencePct: 25,
    isLeader: false,
  },
];

function mockFetch(
  union = UNION,
  organizers = ORGANIZERS,
  leaderOverride?: (typeof ORGANIZERS)[number] | null,
  voteExtras: Record<string, unknown> = {}
) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/character/me")) {
      return {
        ok: true,
        json: async () => ({ character: { _id: "c1", actions: 20, unionLeaderOf: null } }),
      } as unknown as Response;
    }
    if (u.includes("/leader/vote")) {
      return {
        ok: true,
        json: async () => ({
          tallies: [],
          myVote: null,
          canVote: false,
          organizerCount: organizers.length,
          organizers,
          myVotingPower: 10,
          leader:
            leaderOverride === undefined
              ? (organizers.find((o) => o.isLeader) ?? null)
              : leaderOverride,
          ...voteExtras,
        }),
      } as unknown as Response;
    }
    return {
      ok: true,
      json: async () => ({ union, sectors: [], endorsements: [] }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const PARAMS = {
  status: "fulfilled",
  value: { id: "u1" },
  then: (resolve: (v: { id: string }) => void) => resolve({ id: "u1" }),
} as unknown as Promise<{ id: string }>;

beforeEach(() => vi.restoreAllMocks());

async function openLeadershipTab() {
  const tab = await screen.findByRole("button", { name: /^Leadership/i });
  fireEvent.click(tab);
}

describe("union leadership surface", () => {
  it("names the sitting president in the stats strip and opens a contest while seated", async () => {
    global.fetch = mockFetch();
    render(<UnionPage params={PARAMS} />);

    // Stats strip president line (visible without opening the tab).
    expect(await screen.findByText("Ada Prentice")).toBeTruthy();
    expect(screen.queryByText(/the presidency is filled/i)).toBeNull();
    expect(screen.queryByText(/resigns or retires/i)).toBeNull();

    await openLeadershipTab();
    expect(screen.getByRole("heading", { name: /leadership contest/i })).toBeTruthy();
    expect(screen.getByText(/like a corporation ceo race/i)).toBeTruthy();
    expect(screen.getByText(/contest open/i)).toBeTruthy();
  });

  it("lists every organizer with their banked strength and share of the vote", async () => {
    global.fetch = mockFetch();
    render(<UnionPage params={PARAMS} />);
    await openLeadershipTab();

    expect(await screen.findByText("Bo Marsh")).toBeTruthy();
    expect(screen.getByText(/30 strength/)).toBeTruthy();
    expect(screen.getByText(/75\.0% of the vote/)).toBeTruthy();
    expect(screen.getByText(/25\.0% of the vote/)).toBeTruthy();
    expect(screen.getByText("(you)")).toBeTruthy();
  });

  it("shows the contest gate for a vacant under-strength union", async () => {
    global.fetch = mockFetch(
      { ...UNION, ownerId: null, electionOpen: false, strength: 30 },
      [],
      null
    );
    render(<UnionPage params={PARAMS} />);
    await openLeadershipTab();

    expect(await screen.findByText(/organize this union to 100 strength/i)).toBeTruthy();
    expect(screen.getByText(/nobody has organized this union yet/i)).toBeTruthy();
  });

  it("links an NPP president to the NPP profile with their real name", async () => {
    const nppLeader = {
      characterId: "npp-1",
      name: "Klaus Weber",
      sequentialId: 88,
      avatarUrl: null,
      isNPP: true,
      strength: 0,
      organizeCount: 0,
      influencePct: 0,
      isLeader: true,
    };
    global.fetch = mockFetch(
      { ...UNION, ownerId: "npp-1" },
      [{ ...ORGANIZERS[1], isLeader: false }],
      nppLeader
    );
    render(<UnionPage params={PARAMS} />);

    const link = await screen.findByRole("link", { name: "Klaus Weber" });
    expect(link.getAttribute("href")).toBe("/politicians/npp/88");
    expect(screen.queryByText("Unknown")).toBeNull();

    await openLeadershipTab();
    expect(screen.getByText(/\(NPP\)/)).toBeTruthy();
  });
});
