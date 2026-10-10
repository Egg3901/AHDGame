import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { ContestRound } from "@/lib/db/types/contestRound";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/patreon/service", () => ({ applyPatreonStatus: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn(),
  createNotifications: vi.fn(),
}));
vi.mock("@/lib/news", () => ({ createSystemNewsPost: vi.fn() }));
vi.mock("@/lib/api/headOfGovernment", () => ({
  getHeadOfGovernmentCharacterIds: vi.fn(),
}));
vi.mock("./netWorth", () => ({
  loadCharacterNetWorths: vi.fn().mockResolvedValue(new Map()),
  loadExternalInflows: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("./prize", () => ({
  payContestPrize: vi.fn().mockResolvedValue({
    credited: true,
    anchorAmount: 1_000_000,
    localAmount: 1_000_000,
    currencyCode: "USD",
  }),
}));

import { ensureContestsOpen, runContests } from "./engine";
import { payContestPrize } from "./prize";
import { getHeadOfGovernmentCharacterIds } from "@/lib/api/headOfGovernment";
import { applyPatreonStatus } from "@/lib/patreon/service";
import { loadCharacterNetWorths, loadExternalInflows } from "./netWorth";
import { CONTEST_KINDS, CONTEST_ROUND_MS } from "./rules";

// ── A small in-memory Mongo: enough query and update operators for the engine ──

type Doc = Record<string, unknown>;

function getPath(doc: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => {
    if (node === null || node === undefined) return undefined;
    return (node as Record<string, unknown>)[key];
  }, doc);
}

function norm(v: unknown): unknown {
  if (v instanceof ObjectId) return v.toString();
  if (v instanceof Date) return v.getTime();
  return v;
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === "$or") return (cond as Doc[]).some((sub) => matches(doc, sub));
    const value = norm(getPath(doc, key));
    if (
      cond &&
      typeof cond === "object" &&
      !(cond instanceof ObjectId) &&
      !(cond instanceof Date)
    ) {
      return Object.entries(cond as Doc).every(([op, arg]) => {
        const a = norm(arg);
        switch (op) {
          case "$in":
            return (arg as unknown[]).map(norm).includes(value);
          case "$ne":
            return value !== a;
          case "$gt":
            return value !== undefined && (value as number) > (a as number);
          case "$gte":
            return value !== undefined && (value as number) >= (a as number);
          case "$lte":
            return value !== undefined && (value as number) <= (a as number);
          case "$exists":
            return (value !== undefined) === arg;
          default:
            throw new Error(`fake mongo: unsupported operator ${op}`);
        }
      });
    }
    return value === norm(cond);
  });
}

function setPath(doc: Doc, path: string, value: unknown) {
  const keys = path.split(".");
  let node = doc as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) {
    node[key] ??= {};
    node = node[key] as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = value;
}

/** structuredClone drops the ObjectId class, so copy by hand. */
function clone<T>(value: T): T {
  if (value instanceof ObjectId || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  }
  return value;
}

function fakeDb(seed: Record<string, Doc[]>) {
  const data: Record<string, Doc[]> = {};
  for (const [name, docs] of Object.entries(seed)) data[name] = docs.map((d) => clone(d));
  const collection = (name: string) => {
    data[name] ??= [];
    const docs = data[name];
    return {
      find(filter: Doc = {}) {
        let rows = docs.filter((d) => matches(d, filter));
        const cursor = {
          sort(spec: Record<string, number>) {
            const [[key, dir]] = Object.entries(spec);
            rows = [...rows].sort(
              (a, b) =>
                ((norm(getPath(a, key)) as number) - (norm(getPath(b, key)) as number)) * dir
            );
            return cursor;
          },
          limit(n: number) {
            rows = rows.slice(0, n);
            return cursor;
          },
          project() {
            return cursor;
          },
          async toArray() {
            return rows.map((d) => clone(d));
          },
        };
        return cursor;
      },
      async countDocuments(filter: Doc = {}) {
        return docs.filter((d) => matches(d, filter)).length;
      },
      async findOne(filter: Doc) {
        const doc = docs.find((d) => matches(d, filter));
        return doc ? clone(doc) : null;
      },
      async insertOne(doc: Doc) {
        if (docs.some((d) => norm(d._id) === norm(doc._id))) {
          throw Object.assign(new Error("duplicate key"), { code: 11000 });
        }
        docs.push(clone(doc));
        return { insertedId: doc._id };
      },
      async updateMany(filter: Doc, update: { $set?: Doc }) {
        const hits = docs.filter((d) => matches(d, filter));
        for (const doc of hits) {
          for (const [path, value] of Object.entries(update.$set ?? {})) setPath(doc, path, value);
        }
        return { matchedCount: hits.length, modifiedCount: hits.length };
      },
      async updateOne(filter: Doc, update: { $set?: Doc }) {
        const doc = docs.find((d) => matches(d, filter));
        if (!doc) return { matchedCount: 0, modifiedCount: 0 };
        for (const [path, value] of Object.entries(update.$set ?? {})) setPath(doc, path, value);
        return { matchedCount: 1, modifiedCount: 1 };
      },
    };
  };
  return { db: { collection } as unknown as Db, data };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const now = new Date("2026-10-09T12:00:00Z");
const alice = new ObjectId();
const bob = new ObjectId();
const carol = new ObjectId();
const banned = new ObjectId();
const userA = new ObjectId();
const userB = new ObjectId();
const userC = new ObjectId();
const userBanned = new ObjectId();
const corpSmall = new ObjectId();
const corpMid = new ObjectId();
const corpBig = new ObjectId();
const corpShell = new ObjectId();
const corpState = new ObjectId();

function world(turn: number, caps: Record<string, number>, influence: Record<string, number>) {
  const historyRow = (id: ObjectId, marketCap: number) => ({
    corporationId: id,
    turn,
    marketCap,
    fxRateAtWrite: 1,
  });
  return {
    characters: [
      {
        _id: alice,
        userId: userA,
        name: "Alice",
        countryId: "US",
        nationalInfluence: influence.alice,
      },
      { _id: bob, userId: userB, name: "Bob", countryId: "UK", nationalInfluence: influence.bob },
      {
        _id: carol,
        userId: userC,
        name: "Carol",
        countryId: "US",
        nationalInfluence: influence.carol,
      },
      { _id: banned, userId: userBanned, name: "Mallory", countryId: "US", nationalInfluence: 0 },
    ],
    users: [
      { _id: userA, username: "a" },
      { _id: userB, username: "b" },
      { _id: userC, username: "c" },
      { _id: userBanned, username: "x", isBanned: true },
    ],
    gameState: [{ _id: "current", iteration: { type: "Beta", number: 2 } }],
    gameConfig: [{ _id: "default" }],
    corporations: [
      { _id: corpSmall, name: "Small Co", ceoId: alice, ceoType: "character" },
      { _id: corpMid, name: "Mid Co", ceoId: bob, ceoType: "character" },
      { _id: corpBig, name: "Big Co", ceoId: carol, ceoType: "character" },
      { _id: corpShell, name: "Shell", ceoId: carol, ceoType: "character" },
      {
        _id: corpState,
        name: "State Co",
        ceoId: bob,
        ceoType: "character",
        ownershipState: "stateOwned",
      },
    ],
    corporationHistory: [
      historyRow(corpSmall, caps.small),
      historyRow(corpMid, caps.mid),
      historyRow(corpBig, caps.big),
      historyRow(corpShell, 10),
      historyRow(corpState, 50_000_000),
    ],
    governmentApprovals: [
      { _id: "US", approvalRating: 40 },
      { _id: "UK", approvalRating: 50 },
    ],
  };
}

function rounds(data: Record<string, Doc[]>): ContestRound[] {
  return data.contestRounds as unknown as ContestRound[];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getHeadOfGovernmentCharacterIds).mockResolvedValue(
    new Map([
      ["US", alice],
      ["UK", null],
    ]) as never
  );
});

describe("runContests: opening rounds", () => {
  it("opens one round per kind from a baseline snapshot", async () => {
    const { db, data } = fakeDb(
      world(10, { small: 400_000, mid: 2_000_000, big: 30_000_000 }, { alice: 5, bob: 9, carol: 1 })
    );

    const summary = await runContests(db, 10, now);

    expect(summary.opened).toBe(CONTEST_KINDS.length);
    const byKind = new Map(rounds(data).map((r) => [r.kind, r]));
    expect(byKind.get("corp_growth_small")?._id).toBe("corp_growth_small:1");
    expect(byKind.get("corp_growth_small")?.endsAt.getTime()).toBe(
      now.getTime() + CONTEST_ROUND_MS
    );
    // Shell below the floor and the state-owned firm sit out; the median splits the rest.
    expect(byKind.get("corp_growth_small")?.baselines.map((b) => b.subjectId)).toEqual([
      corpSmall.toString(),
    ]);
    expect(
      byKind
        .get("corp_growth_large")
        ?.baselines.map((b) => b.subjectId)
        .sort()
    ).toEqual([corpMid.toString(), corpBig.toString()].sort());
    // Banned accounts are not entered.
    expect(
      byKind
        .get("influence_gain")
        ?.baselines.map((b) => b.characterId)
        .sort()
    ).toEqual([alice, bob, carol].map(String).sort());
    // Only countries led by a player are entered.
    expect(byKind.get("approval_gain")?.baselines).toEqual([
      { subjectId: "US", characterId: alice.toString(), value: 40 },
    ]);
  });

  it("lets a racing process that read no rounds fail its insert quietly", async () => {
    const { db, data } = fakeDb(
      world(10, { small: 400_000, mid: 2e6, big: 3e7 }, { alice: 0, bob: 0, carol: 0 })
    );
    await runContests(db, 10, now);

    // A second worker read contestRounds before the first one's inserts landed.
    const staleRead = {
      collection(name: string) {
        const real = db.collection(name);
        if (name !== "contestRounds") return real;
        return Object.assign(Object.create(real), {
          find: () => db.collection(name).find({ status: "none" }),
          insertOne: real.insertOne.bind(real),
        });
      },
    } as unknown as Db;

    await expect(runContests(staleRead, 10, now)).resolves.toMatchObject({ opened: 0 });
    expect(rounds(data).filter((r) => r.kind !== "referrals_iteration")).toHaveLength(
      CONTEST_KINDS.length
    );
  });
});

describe("runContests: approval entries during a round", () => {
  it("adds a late player-led government from the leader's office-start approval", async () => {
    const { db, data } = fakeDb(
      world(58, { small: 400_000, mid: 2_000_000, big: 30_000_000 }, { alice: 5, bob: 9, carol: 1 })
    );
    await runContests(db, 58, now);

    const ukApproval = data.governmentApprovals.find((approval) => approval._id === "UK")!;
    ukApproval.approvalRating = 61;
    ukApproval.headOfGovernmentSinceTurn = 72;
    ukApproval.history = [{ turn: 72, approval: 57, net: 14 }];
    vi.mocked(getHeadOfGovernmentCharacterIds).mockResolvedValue(
      new Map([
        ["US", alice],
        ["UK", bob],
      ]) as never
    );

    await runContests(db, 72, new Date(now.getTime() + 1_000));

    const approvalRound = rounds(data).find((round) => round.kind === "approval_gain")!;
    expect(approvalRound.baselines).toContainEqual({
      subjectId: "UK",
      characterId: bob.toString(),
      value: 57,
      enteredTurn: 72,
    });
  });

  it("uses the current approval when an office-start rating is unavailable", async () => {
    const { db, data } = fakeDb(
      world(58, { small: 400_000, mid: 2_000_000, big: 30_000_000 }, { alice: 5, bob: 9, carol: 1 })
    );
    await runContests(db, 58, now);

    const ukApproval = data.governmentApprovals.find((approval) => approval._id === "UK")!;
    ukApproval.approvalRating = 61;
    delete ukApproval.history;
    delete ukApproval.headOfGovernmentSinceTurn;
    vi.mocked(getHeadOfGovernmentCharacterIds).mockResolvedValue(
      new Map([
        ["US", alice],
        ["UK", bob],
      ]) as never
    );

    await runContests(db, 72, new Date(now.getTime() + 1_000));

    const approvalRound = rounds(data).find((round) => round.kind === "approval_gain")!;
    expect(approvalRound.baselines).toContainEqual({
      subjectId: "UK",
      characterId: bob.toString(),
      value: 61,
      enteredTurn: 72,
    });
  });

  it("does not enter a country whose current head is not a player", async () => {
    const { db, data } = fakeDb(
      world(58, { small: 400_000, mid: 2_000_000, big: 30_000_000 }, { alice: 5, bob: 9, carol: 1 })
    );
    await runContests(db, 58, now);
    vi.mocked(getHeadOfGovernmentCharacterIds).mockResolvedValue(
      new Map([
        ["US", alice],
        ["UK", new ObjectId()],
      ]) as never
    );

    await runContests(db, 59, new Date(now.getTime() + 1_000));

    const approvalRound = rounds(data).find((round) => round.kind === "approval_gain")!;
    expect(approvalRound.baselines.map((baseline) => baseline.subjectId)).toEqual(["US"]);
  });
});

describe("opening without waiting for a turn", () => {
  it("fills standings the moment a round opens", async () => {
    const { db, data } = fakeDb(
      world(10, { small: 400_000, mid: 2e6, big: 3e7 }, { alice: 5, bob: 9, carol: 1 })
    );

    await runContests(db, 10, now);

    const influence = rounds(data).find((r) => r.kind === "influence_gain")!;
    expect(influence.standings).toHaveLength(3);
    expect(influence.standings.every((s) => s.score === 0)).toBe(true);
    expect(influence.refreshedAt).toEqual(now);
  });

  it("opens missing rounds from a page view, at most once a minute per process", async () => {
    const { db, data } = fakeDb(
      world(10, { small: 400_000, mid: 2e6, big: 3e7 }, { alice: 0, bob: 0, carol: 0 })
    );
    data.gameState[0].currentTurn = 12;
    globalThis._ahdContestsOpenCheckedAt = undefined;

    await ensureContestsOpen(db, now);
    const opened = rounds(data).filter((r) => r.kind !== "referrals_iteration");
    expect(opened).toHaveLength(CONTEST_KINDS.length);
    expect(opened.every((r) => r.startTurn === 12)).toBe(true);

    // A second view inside the minute does nothing, even with a round missing.
    data.contestRounds = data.contestRounds.filter((r) => r.kind !== "approval_gain");
    await ensureContestsOpen(db, new Date(now.getTime() + 30_000));
    expect(rounds(data).some((r) => r.kind === "approval_gain")).toBe(false);

    await ensureContestsOpen(db, new Date(now.getTime() + 61_000));
    expect(rounds(data).some((r) => r.kind === "approval_gain")).toBe(true);
  });
});

describe("runContests: standings and settlement", () => {
  async function openedWorld() {
    const seed = world(
      10,
      { small: 400_000, mid: 2_000_000, big: 30_000_000 },
      { alice: 5, bob: 9, carol: 1 }
    );
    const { db, data } = fakeDb(seed);
    await runContests(db, 10, now);
    return { db, data };
  }

  function advance(data: Record<string, Doc[]>, turn: number, caps: Record<string, number>) {
    const ids: Record<string, ObjectId> = { small: corpSmall, mid: corpMid, big: corpBig };
    for (const [key, cap] of Object.entries(caps)) {
      data.corporationHistory.push({
        corporationId: ids[key],
        turn,
        marketCap: cap,
        fxRateAtWrite: 1,
      });
    }
  }

  it("ranks growth net of injected capital and keeps the running injection total", async () => {
    const { db, data } = await openedWorld();
    advance(data, 11, { mid: 3_000_000, big: 33_000_000 });
    // Bob put 900,000 of his own cash into Mid Co: only 100,000 of its growth is real.
    data.financialTxLog = [
      {
        type: "corp_capital_injection",
        subjectType: "corporation",
        subjectId: corpMid,
        amount: 900_000,
        createdAt: new Date(now.getTime() + 60_000),
      },
    ];

    await runContests(db, 11, new Date(now.getTime() + 3_600_000));

    const large = rounds(data).find((r) => r.kind === "corp_growth_large")!;
    expect(large.standings.map((s) => [s.subjectName, Math.round(s.score)])).toEqual([
      ["Big Co", 10],
      ["Mid Co", 5],
    ]);
    expect(large.baselines.find((b) => b.subjectId === corpMid.toString())?.injected).toBe(900_000);

    // The next refresh only adds rows after the last one; the total is not double counted.
    advance(data, 12, { mid: 3_000_000, big: 33_000_000 });
    await runContests(db, 12, new Date(now.getTime() + 7_200_000));
    const again = rounds(data).find((r) => r.kind === "corp_growth_large")!;
    expect(again.baselines.find((b) => b.subjectId === corpMid.toString())?.injected).toBe(900_000);
  });

  it("settles a finished round, pays the leader once, and opens the next round", async () => {
    const { db, data } = await openedWorld();
    for (const c of data.characters) {
      if (String(c._id) === bob.toString()) c.nationalInfluence = 30;
      if (String(c._id) === alice.toString()) c.nationalInfluence = 12;
    }
    advance(data, 40, { small: 400_000, mid: 2_000_000, big: 30_000_000 });
    const later = new Date(now.getTime() + CONTEST_ROUND_MS + 1);

    const summary = await runContests(db, 40, later);

    const influence = rounds(data).find((r) => r._id === "influence_gain:1")!;
    expect(influence.status).toBe("settled");
    expect(influence.winners[0]).toMatchObject({ characterName: "Bob", score: 21, paidAt: later });
    expect(payContestPrize).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ round: expect.objectContaining({ _id: "influence_gain:1" }) })
    );
    expect(rounds(data).find((r) => r._id === "influence_gain:2")?.status).toBe("active");
    expect(summary.opened).toBe(CONTEST_KINDS.length);

    // Corporate rounds with no growth settle without a winner or a payment.
    const flat = rounds(data).find((r) => r._id === "corp_growth_large:1")!;
    expect(flat.status).toBe("settled");
    expect(flat.winners).toEqual([]);
    const paidRounds = vi.mocked(payContestPrize).mock.calls.map((c) => c[1].round._id);
    expect(paidRounds).not.toContain("corp_growth_large:1");

    // Running again pays nothing more.
    vi.mocked(payContestPrize).mockClear();
    await runContests(db, 40, later);
    expect(payContestPrize).not.toHaveBeenCalled();
  });

  it("resets an approval entry when leadership changes and keeps only the current leader", async () => {
    const { db, data } = await openedWorld();
    data.governmentApprovals[0].approvalRating = 48;
    data.governmentApprovals[0].headOfGovernmentSinceTurn = 11;
    data.governmentApprovals[0].history = [{ turn: 11, approval: 45, net: -10 }];
    vi.mocked(getHeadOfGovernmentCharacterIds).mockResolvedValue(new Map([["US", carol]]) as never);

    await runContests(db, 11, new Date(now.getTime() + 3_600_000));

    const approvalRound = rounds(data).find((r) => r.kind === "approval_gain")!;
    expect(approvalRound.baselines).toEqual([
      { subjectId: "US", characterId: carol.toString(), value: 45, enteredTurn: 11 },
    ]);

    data.governmentApprovals[0].approvalRating = 50;
    data.governmentApprovals[0].headOfGovernmentSinceTurn = 12;
    data.governmentApprovals[0].history = [
      { turn: 11, approval: 45, net: -10 },
      { turn: 12, approval: 46, net: -8 },
    ];
    vi.mocked(getHeadOfGovernmentCharacterIds).mockResolvedValue(new Map([["US", alice]]) as never);

    await runContests(db, 12, new Date(now.getTime() + 3_601_000));

    expect(approvalRound.baselines).toEqual([
      { subjectId: "US", characterId: alice.toString(), value: 46, enteredTurn: 12 },
    ]);
  });

  it("voids a round left over from a previous world instead of paying it", async () => {
    const { db, data } = await openedWorld();
    for (const r of rounds(data)) r.endsAt = new Date(0);

    const summary = await runContests(db, 3, now);

    expect(summary.voided).toBe(CONTEST_KINDS.length);
    expect(payContestPrize).not.toHaveBeenCalled();
  });
});

describe("runContests: referrals", () => {
  async function openedWorld() {
    const seed = world(10, { small: 400_000, mid: 2e6, big: 3e7 }, { alice: 0, bob: 0, carol: 0 });
    const { db, data } = fakeDb(seed);
    data.gameConfig[0].referralContestStartedAt = new Date("2026-09-01T00:00:00Z");
    await runContests(db, 10, now);
    return { db, data };
  }

  function newPlayer(data: Record<string, Doc[]>, referrer: ObjectId, at: Date, extra: Doc = {}) {
    const userId = new ObjectId();
    data.users.push({
      _id: userId,
      username: `n${data.users.length}`,
      referredBy: referrer,
      ...extra,
    });
    data.characters.push({
      _id: new ObjectId(),
      userId,
      name: "New",
      countryId: "US",
      createdAt: at,
    });
    return userId;
  }

  it("ranks the week's referrers, skipping strong alt links, and pays the leader the referral prize", async () => {
    const { db, data } = await openedWorld();
    const during = new Date(now.getTime() + 60_000);
    newPlayer(data, userA, during);
    newPlayer(data, userA, during);
    const alt = newPlayer(data, userA, during);
    newPlayer(data, userB, during);
    newPlayer(data, userB, new Date(now.getTime() - 60_000)); // before the round
    data.altLinks = [{ userA: alt, userB: userA, confidence: 0.92 }];

    const later = new Date(now.getTime() + CONTEST_ROUND_MS + 1);
    await runContests(db, 40, later);

    const round = rounds(data).find((r) => r._id === "referrals_weekly:1")!;
    expect(round.standings.map((s) => [s.subjectName, s.score])).toEqual([
      ["Alice", 2],
      ["Bob", 1],
    ]);
    expect(round.winners[0]).toMatchObject({ characterId: alice.toString(), score: 2 });
    expect(payContestPrize).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ round: expect.objectContaining({ kind: "referrals_weekly" }) })
    );
  });

  it("counts the iteration from the world's start, realigning an older window", async () => {
    const { db, data } = await openedWorld();
    const worldStart = new Date(now.getTime() - 3 * 24 * 3_600_000);
    data.gameState[0].worldEpochStartedAt = worldStart;
    // A window carried over from before this world.
    const round = rounds(data).find((r) => r.kind === "referrals_iteration")!;
    round.startedAt = new Date("2026-08-09T00:00:00Z");
    newPlayer(data, userA, new Date(worldStart.getTime() - 60_000)); // previous world
    newPlayer(data, userA, new Date(worldStart.getTime() + 60_000));
    newPlayer(data, userB, new Date(worldStart.getTime() + 120_000));
    newPlayer(data, userB, new Date(worldStart.getTime() + 180_000));

    await runContests(db, 11, new Date(now.getTime() + 3_600_000));

    const updated = rounds(data).find((r) => r._id === round._id)!;
    expect(updated.startedAt).toEqual(worldStart);
    expect(updated.standings.map((s) => [s.characterName, s.score])).toEqual([
      ["Bob", 2],
      ["Alice", 1],
    ]);
  });

  it("awards the standings stored before the reset when the iteration changes", async () => {
    const { db, data } = await openedWorld();
    const during = new Date(now.getTime() + 60_000);
    for (let i = 0; i < 3; i++) newPlayer(data, userA, during);
    for (let i = 0; i < 2; i++) newPlayer(data, userB, during);
    newPlayer(data, userBanned, during);
    Object.assign(
      data.users.find((u) => String(u._id) === userC.toString())!,
      {
        patreonTier: "supporter",
        supporterProvider: "contest",
        patreonExpiresAt: null,
      }
    );
    await runContests(db, 11, new Date(now.getTime() + 3_600_000));
    expect(applyPatreonStatus).not.toHaveBeenCalled();
    const first = rounds(data).find((r) => r.kind === "referrals_iteration")!;

    // Reset: the old world's newcomers retire, a new iteration and world begin.
    data.characters = data.characters.filter((c) => c.name !== "New");
    const newWorld = new Date(now.getTime() + 7_000_000);
    data.gameState[0].iteration = { type: "Beta", number: 3 };
    data.gameState[0].worldEpochStartedAt = newWorld;
    newPlayer(data, userB, new Date(newWorld.getTime() + 60_000)); // before the first turn
    const summary = await runContests(db, 1, new Date(newWorld.getTime() + 3_600_000));

    expect(summary.referrals).toBe("awarded");
    const granted = vi.mocked(applyPatreonStatus).mock.calls.map((c) => c[1]);
    expect(granted.map((g) => g.userId.toString())).toEqual([userA, userB].map(String));
    expect(granted[0]).toMatchObject({ tier: "supporter", expiresAt: null, provider: "contest" });
    expect(data.users.find((u) => String(u._id) === userC.toString())).toMatchObject({
      patreonTier: null,
      supporterProvider: null,
    });
    const settled = rounds(data).find((r) => r._id === first._id)!;
    expect(settled.winners.map((w) => [w.rank, w.characterName, w.score])).toEqual([
      [1, "Alice", 3],
      [2, "Bob", 2],
    ]);
    // The next contest counts from the new world's start, including the
    // referral made before its first turn.
    const next = rounds(data).find(
      (r) => r.kind === "referrals_iteration" && r.status === "active"
    )!;
    expect(next).toMatchObject({ iterationKey: "Beta:3", startedAt: newWorld });
    expect(next.standings.map((s) => [s.characterName, s.score])).toEqual([["Bob", 1]]);
  });
});

describe("runContests: legislator, wealth and party contests", () => {
  const party1 = new ObjectId();
  const party2 = new ObjectId();
  const party3 = new ObjectId();

  function seed() {
    const base = world(10, { small: 400_000, mid: 2e6, big: 3e7 }, { alice: 0, bob: 0, carol: 0 });
    return {
      ...base,
      politicalParties: [
        { _id: party1, name: "Reform", chairId: alice, memberCount: 40 },
        { _id: party2, name: "Labour", chairId: bob, memberCount: 100 },
        // No player chair: not entered.
        { _id: party3, name: "Old Guard", chairId: null, memberCount: 80 },
      ],
      bills: [] as Doc[],
      stateBills: [] as Doc[],
    };
  }

  it("counts enacted bills by sponsor, national and state, from the round's opening", async () => {
    const { db, data } = fakeDb(seed());
    await runContests(db, 10, now);
    const later = new Date(now.getTime() + 60_000);
    data.bills.push(
      { _id: new ObjectId(), status: "signed", sponsorId: alice, enactedAt: later },
      { _id: new ObjectId(), status: "signed", sponsorId: alice, enactedAt: later },
      // Enacted before the round opened, or not law: not counted.
      { _id: new ObjectId(), status: "signed", sponsorId: bob, enactedAt: new Date(0) },
      { _id: new ObjectId(), status: "vetoed", sponsorId: bob, enactedAt: undefined },
      // Banned sponsor: not entered.
      { _id: new ObjectId(), status: "signed", sponsorId: banned, enactedAt: later }
    );
    data.stateBills.push({
      _id: new ObjectId(),
      status: "enacted",
      sponsorId: bob,
      enactedAt: later,
    });

    await runContests(db, 11, new Date(now.getTime() + 3_600_000));

    const round = rounds(data).find((r) => r.kind === "legislator_bills")!;
    expect(round.standings.map((s) => [s.characterName, s.score])).toEqual([
      ["Alice", 2],
      ["Bob", 1],
    ]);
  });

  it("ranks party member gains while the opening chair still leads", async () => {
    const { db, data } = fakeDb(seed());
    await runContests(db, 10, now);
    const opened = rounds(data).find((r) => r.kind === "party_growth")!;
    expect(opened.baselines.map((b) => b.subjectId).sort()).toEqual(
      [party1, party2].map(String).sort()
    );

    for (const p of data.politicalParties) {
      if (String(p._id) === party1.toString()) p.memberCount = 52;
      if (String(p._id) === party2.toString()) {
        p.memberCount = 130;
        p.chairId = carol;
      }
    }
    await runContests(db, 11, new Date(now.getTime() + 3_600_000));

    const round = rounds(data).find((r) => r.kind === "party_growth")!;
    // Labour changed chair, so it drops out.
    expect(round.standings.map((s) => [s.subjectName, s.characterName, s.score])).toEqual([
      ["Reform", "Alice", 12],
    ]);
  });

  it("ranks net worth growth net of wires and loans, above the opening floor", async () => {
    vi.mocked(loadCharacterNetWorths).mockResolvedValueOnce(
      new Map([
        [alice.toString(), 1_000_000],
        [bob.toString(), 2_000_000],
        // Below the floor: sits out.
        [carol.toString(), 1_000],
      ])
    );
    const { db, data } = fakeDb(seed());
    await runContests(db, 10, now);
    const opened = rounds(data).find((r) => r.kind === "wealth_growth")!;
    expect(opened.baselines.map((b) => b.subjectId).sort()).toEqual(
      [alice, bob].map(String).sort()
    );

    vi.mocked(loadCharacterNetWorths).mockResolvedValue(
      new Map([
        [alice.toString(), 1_200_000],
        [bob.toString(), 3_000_000],
      ])
    );
    // Bob received a 900,000 wire: only 100,000 of his growth is his own.
    vi.mocked(loadExternalInflows).mockResolvedValue(new Map([[bob.toString(), 900_000]]));
    await runContests(db, 11, new Date(now.getTime() + 3_600_000));

    const round = rounds(data).find((r) => r.kind === "wealth_growth")!;
    expect(round.standings.map((s) => [s.characterName, Math.round(s.score)])).toEqual([
      ["Alice", 20],
      ["Bob", 5],
    ]);
    vi.mocked(loadCharacterNetWorths).mockResolvedValue(new Map());
    vi.mocked(loadExternalInflows).mockResolvedValue(new Map());
  });
});

describe("runContests: one weekly clock", () => {
  it("opens a missing kind on the running week when it has at least half a week left", async () => {
    const { db, data } = fakeDb(
      world(10, { small: 400_000, mid: 2e6, big: 3e7 }, { alice: 0, bob: 0, carol: 0 })
    );
    await runContests(db, 10, now);
    const weekEnd = now.getTime() + CONTEST_ROUND_MS;

    // A new contest kind appears two days into the week.
    data.contestRounds = data.contestRounds.filter((r) => r.kind !== "party_growth");
    const later = new Date(now.getTime() + 2 * 24 * 3_600_000);
    await runContests(db, 58, later);
    const party = rounds(data).find((r) => r.kind === "party_growth")!;
    expect(party.endsAt.getTime()).toBe(weekEnd);
  });

  it("runs a full week when the running week is nearly over", async () => {
    const { db, data } = fakeDb(
      world(10, { small: 400_000, mid: 2e6, big: 3e7 }, { alice: 0, bob: 0, carol: 0 })
    );
    await runContests(db, 10, now);
    data.contestRounds = data.contestRounds.filter((r) => r.kind !== "party_growth");
    const later = new Date(now.getTime() + 5 * 24 * 3_600_000);
    await runContests(db, 130, later);
    const party = rounds(data).find((r) => r.kind === "party_growth")!;
    expect(party.endsAt.getTime()).toBe(later.getTime() + CONTEST_ROUND_MS);
  });
});
