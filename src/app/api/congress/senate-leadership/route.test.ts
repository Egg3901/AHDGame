/**
 * GET /api/congress/senate-leadership read shape.
 *
 * The page renders five leadership roles. Each role used to read its seated
 * leader with its own congressLeaders.findOne, which Sentry reported as an
 * N+1. These tests drive the real route and state builder against a small
 * in-memory store and count reads per collection.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { resolveLeadershipElection } from "@/lib/congress/leadershipElections";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({
    effectiveNow: new Date("2026-01-15T12:00:00.000Z"),
    currentTurn: 100,
    lastTurnProcessed: new Date("2026-01-15T11:00:00.000Z"),
    pausedAt: null,
    isActive: true,
  }),
}));

vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn().mockResolvedValue(null) }));

vi.mock("@/lib/db/partyMap", () => ({
  getPartyMap: vi.fn().mockResolvedValue(
    new Map([
      ["dem", { slug: "dem", name: "Democratic", color: "#0000ff" }],
      ["rep", { slug: "rep", name: "Republican", color: "#ff0000" }],
    ])
  ),
}));

vi.mock("@/lib/congress/senateComposition", () => ({
  getSenateComposition: vi.fn().mockResolvedValue({
    composition: [
      { party: "dem", seats: 30 },
      { party: "rep", seats: 20 },
    ],
    totalSeats: 50,
    blocs: [],
    majorityBloc: null,
    minorityBloc: null,
    majorityParty: "dem",
    minorityParty: "rep",
    majoritySeats: 30,
    minoritySeats: 20,
  }),
}));

vi.mock("@/lib/congress/leadershipElections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/congress/leadershipElections")>();
  return {
    ...actual,
    vacateLeadershipForLostSeats: vi.fn().mockResolvedValue(0),
    resolveLeadershipElection: vi.fn().mockResolvedValue(false),
  };
});

vi.mock("@/lib/congress/leadership/reconcilePartyEligibility", () => ({
  reconcileLeadershipPartyEligibility: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/congress/governmentVoteBreakdown", () => ({
  computeCongressLeadershipTally: vi.fn(
    async (_db: unknown, _chamber: string, votes?: Record<string, string>) => ({
      votesFor: Object.keys(votes ?? {}).length,
      voteByParty: [],
    })
  ),
}));

type Doc = Record<string, unknown>;
type Store = Record<string, Doc[]>;

function same(a: unknown, b: unknown): boolean {
  return String(a) === String(b);
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (cond && typeof cond === "object" && "$in" in (cond as Doc)) {
      return ((cond as { $in: unknown[] }).$in ?? []).some((v) => same(doc[key], v));
    }
    return same(doc[key], cond);
  });
}

/** Minimal Mongo stand-in: enough query surface for this route, plus a read log. */
function createStoreDb(store: Store) {
  const reads: Array<{ collection: string; filter: Doc }> = [];
  const collection = (name: string) => ({
    findOne: async (filter: Doc) => {
      reads.push({ collection: name, filter });
      return (store[name] ?? []).find((d) => matches(d, filter)) ?? null;
    },
    find: (filter: Doc) => {
      reads.push({ collection: name, filter });
      const cursor = {
        sort: () => cursor,
        project: () => cursor,
        toArray: async () => (store[name] ?? []).filter((d) => matches(d, filter)),
      };
      return cursor;
    },
  });
  return { db: { collection }, reads };
}

type Reads = ReturnType<typeof createStoreDb>["reads"];

const count = (reads: Reads, collection: string) =>
  reads.filter((r) => r.collection === collection).length;

/** Reads of `collection` whose filter names `id` (leader display lookups). */
const countFor = (reads: Reads, collection: string, id: ObjectId) =>
  reads.filter((r) => r.collection === collection && JSON.stringify(r.filter).includes(String(id)))
    .length;

let GET: typeof import("./route").GET;

async function callGet(store: Store) {
  const fake = createStoreDb(store);
  vi.mocked(getDb).mockResolvedValue(fake.db as never);
  const res = await GET();
  return { res, json: await res.json(), reads: fake.reads };
}

const ROLES = [
  "proTempore",
  "majorityLeader",
  "minorityLeader",
  "majorityWhip",
  "minorityWhip",
] as const;

describe("GET /api/congress/senate-leadership leader reads", () => {
  beforeAll(async () => {
    ({ GET } = await import("./route"));
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue(null);
    vi.mocked(resolveLeadershipElection).mockResolvedValue(false);
  });

  it("reads congressLeaders once for all five roles when no one is seated", async () => {
    const { res, json, reads } = await callGet({});

    expect(res.status).toBe(200);
    expect(count(reads, "congressLeaders")).toBe(1);
    for (const key of ROLES) {
      expect(json[key].current).toBeNull();
      expect(json[key].election.status).toBe("none");
    }
    expect(json.currentProTempore).toBeNull();
  });

  it("reads seated leaders and their display data once for all roles", async () => {
    const userId = new ObjectId();
    const playerId = new ObjectId();
    const nppId = new ObjectId();
    const { res, json, reads } = await callGet({
      congressLeaders: [
        {
          role: "president_pro_tempore",
          characterId: playerId,
          characterName: "Player Leader",
          party: "dem",
          electedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          role: "minority_leader_senate",
          characterId: nppId,
          characterName: "NPP Leader",
          party: "rep",
        },
        // A vacated seat keeps its row with a null holder.
        { role: "majority_whip_senate", characterId: null, characterName: "" },
      ],
      characters: [
        { _id: playerId, userId, sequentialId: 7, avatarUrl: "/a.png", homeState: "OH" },
      ],
      npps: [{ _id: nppId, sequentialId: 9, avatarUrl: "/n.png", homeState: "TX" }],
      users: [{ _id: userId, patreonProfileBorder: "gold", patreonHighlightColor: "#abc" }],
    });

    expect(res.status).toBe(200);
    expect(count(reads, "congressLeaders")).toBe(1);
    expect(countFor(reads, "characters", playerId)).toBe(1);
    expect(countFor(reads, "npps", nppId)).toBe(1);
    expect(count(reads, "users")).toBe(1);

    expect(json.proTempore.current).toEqual({
      characterId: playerId.toString(),
      sequentialId: 7,
      characterName: "Player Leader",
      avatarUrl: "/a.png",
      borderKey: "gold",
      tintColor: "#abc",
      party: "dem",
      partyName: "Democratic",
      partyColor: "#0000ff",
      state: "OH",
      electedAt: "2026-01-01T00:00:00.000Z",
      isNPP: false,
    });
    expect(json.minorityLeader.current).toMatchObject({
      characterId: nppId.toString(),
      sequentialId: 9,
      avatarUrl: "/n.png",
      state: "TX",
      partyName: "Republican",
      borderKey: null,
      isNPP: true,
    });
    expect(json.majorityWhip.current).toBeNull();
    expect(json.majorityLeader.current).toBeNull();
    expect(json.currentProTempore).toEqual(json.proTempore.current);
  });

  it("shows the winner of an election resolved during the request", async () => {
    const winnerId = new ObjectId();
    const store: Store = {
      senateLeadershipElections: [
        { _id: "majority_leader", status: "voting", endsOnTurn: 90, startedAt: new Date(0) },
      ],
    };
    vi.mocked(resolveLeadershipElection).mockImplementation(async (_db, role, leaderRole) => {
      // Let any read the builder issued too early run first.
      await new Promise((resolve) => setTimeout(resolve, 5));
      store.senateLeadershipElections = [{ _id: role, status: "closed", endsOnTurn: 90 }];
      store.congressLeaders = [
        { role: leaderRole, characterId: winnerId, characterName: "Fresh Winner", party: "dem" },
      ];
      return true;
    });

    const { json, reads } = await callGet(store);

    expect(resolveLeadershipElection).toHaveBeenCalledTimes(1);
    expect(resolveLeadershipElection).toHaveBeenCalledWith(
      expect.anything(),
      "majority_leader",
      "majority_leader_senate",
      "senate",
      false
    );
    expect(json.majorityLeader.election.status).toBe("closed");
    expect(json.majorityLeader.current?.characterName).toBe("Fresh Winner");
    expect(count(reads, "congressLeaders")).toBe(1);
  });

  it("keeps the viewer's membership, party and vote state per role", async () => {
    const userId = new ObjectId();
    const meId = new ObjectId();
    const nomineeId = new ObjectId();
    const nominationId = new ObjectId();
    vi.mocked(getAuthUser).mockResolvedValue({
      userId: userId.toString(),
      isAdmin: true,
    } as never);

    const { json } = await callGet({
      characters: [{ _id: meId, userId, party: "dem" }],
      electedOfficials: [{ characterId: meId, officeType: "senate" }],
      senateLeadershipElections: [
        { _id: "pro_tempore", status: "voting", endsOnTurn: 110, startedAt: new Date(0) },
      ],
      senateLeadershipNominations: [
        {
          _id: nominationId,
          role: "pro_tempore",
          nomineeId,
          nomineeName: "Nominee",
          nomineeParty: "dem",
          nominatedByName: "Someone",
          status: "voting",
          votesFor: 1,
          votes: { [meId.toString()]: "for" },
        },
      ],
    });

    expect(json.isAdmin).toBe(true);
    expect(json.isMember).toBe(true);
    expect(json.proTempore).toMatchObject({
      isMember: true,
      isInParty: true,
      partyLabel: "Majority Party",
      partySeats: 30,
      myVoteId: nominationId.toString(),
      election: { status: "voting", endsOnTurn: 110 },
    });
    expect(json.proTempore.candidacies).toHaveLength(1);
    expect(json.proTempore.candidacies[0]).toMatchObject({ isMyVote: true, votesFor: 1 });
    expect(json.myVoteId).toBe(nominationId.toString());
    expect(json.minorityLeader).toMatchObject({
      isMember: true,
      partyLabel: "Non-Majority Parties",
      partySeats: 20,
      myVoteId: null,
    });
  });
});
