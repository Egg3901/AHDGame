/**
 * @vitest-environment happy-dom
 */
/**
 * A union that already had a president rendered no leadership block at all, so
 * the page never said who held the seat, why there was no vote, or who else
 * was organizing. Banked strength per organizer was computed for the vote
 * tally and thrown away. These pin the roster and the president line.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
  electionOpen: false,
  leadershipElectionMinStrength: 100,
  strength: 30,
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

function mockFetch(union = UNION, organizers = ORGANIZERS) {
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
          leader: organizers.find((o) => o.isLeader) ?? null,
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

describe("union leadership surface", () => {
  it("names the sitting president and says why no vote is running", async () => {
    global.fetch = mockFetch();
    render(<UnionPage params={PARAMS} />);

    // Once on the president line, once on the roster row.
    expect(await screen.findAllByText("Ada Prentice")).toHaveLength(2);
    expect(screen.getByText(/the presidency is filled/i)).toBeTruthy();
    expect(screen.getByText(/resigns or retires/i)).toBeTruthy();
  });

  it("lists every organizer with their banked strength and share of the vote", async () => {
    global.fetch = mockFetch();
    render(<UnionPage params={PARAMS} />);

    expect(await screen.findByText("Bo Marsh")).toBeTruthy();
    expect(screen.getByText(/30 strength/)).toBeTruthy();
    expect(screen.getByText(/75\.0% of the vote/)).toBeTruthy();
    expect(screen.getByText(/25\.0% of the vote/)).toBeTruthy();
    // The viewer is marked on their own row.
    expect(screen.getByText("(you)")).toBeTruthy();
  });

  it("keeps the election panel for a union with no president", async () => {
    global.fetch = mockFetch({ ...UNION, ownerId: null }, []);
    render(<UnionPage params={PARAMS} />);

    expect(await screen.findByText(/elect a president/i)).toBeTruthy();
    expect(screen.getByText(/nobody has organized this union yet/i)).toBeTruthy();
  });
});
