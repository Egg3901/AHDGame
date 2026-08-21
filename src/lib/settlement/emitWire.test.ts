import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";
import type { SettlementCrisisDoc } from "@/lib/db/types/settlementCrisis";
import {
  HUNDREDTHS,
  SETTLEMENT_INSTITUTIONS,
  SETTLEMENT_WIRE_INTERVAL_TURNS,
} from "@/lib/constants/settlementCrisis";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/news", () => ({ createSystemNewsPost: vi.fn() }));
vi.mock("@/lib/discordWebhooks", async (original) => {
  const actual = await original<typeof import("@/lib/discordWebhooks")>();
  return { ...actual, sendNewsEvent: vi.fn() };
});

const CRISIS_ID = new ObjectId();

function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

function crisis(over: Partial<SettlementCrisisDoc> = {}): SettlementCrisisDoc {
  return {
    _id: CRISIS_ID,
    kind: "settlement.germanQuestion",
    status: "open",
    targetEntityId: "DE",
    challengerEntityId: "DD",
    position: 47 * HUNDREDTHS,
    institutions: SETTLEMENT_INSTITUTIONS.map((i) => ({
      id: i.id,
      weight: i.weight,
      position: i.opening,
      lastPlay: null,
      lastDrift: 0,
    })),
    seats: [],
    ladder: { heat: 0, armedTurn: null },
    driftHistory: [],
    lastTickedTurn: 411,
    conflictId: null,
    openedTurn: 400,
    resolvedTurn: null,
    outcome: null,
    cooldownUntilTurn: null,
    lastBriefing: { turn: 400, position: 4400 },
    postedWireEvents: [],
    createdAt: new Date("1953-01-01T00:00:00Z"),
    updatedAt: new Date("1953-01-01T00:00:00Z"),
    ...over,
  } as SettlementCrisisDoc;
}

const DUE_TURN = 400 + SETTLEMENT_WIRE_INTERVAL_TURNS;

describe("emitSettlementWire", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 1 });
    prime(db, "settlementPlays").distinct = vi.fn().mockResolvedValue([]) as never;
  });

  async function sendCount() {
    const { sendNewsEvent } = await import("@/lib/discordWebhooks");
    return vi.mocked(sendNewsEvent).mock.calls.length;
  }

  it("posts a one-off moment and stamps it in the same write", async () => {
    const { emitSettlementWire } = await import("./emitWire");
    const res = await emitSettlementWire(db as unknown as Db, crisis(), 412, {
      events: ["opened"],
    });
    expect(res.kinds).toEqual(["opened"]);
    const [filter, update] = prime(db, "settlementCrises").updateOne.mock.calls[0];
    expect(filter.postedWireEvents).toEqual({ $ne: "opened" });
    expect(update.$addToSet).toEqual({ postedWireEvents: "opened" });
    expect(await sendCount()).toBe(1);
  });

  it("does NOT repost a moment whose stamp the write did not claim", async () => {
    // The state stays true for many ticks — armed is armed until it decays —
    // so the stamp, not the state, is what makes this fire once.
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 0 });
    const { emitSettlementWire } = await import("./emitWire");
    const res = await emitSettlementWire(db as unknown as Db, crisis(), 412, {
      events: ["armed"],
    });
    expect(res.posts).toBe(0);
    expect(await sendCount()).toBe(0);
  });

  it("claims before sending, so a crash loses a dispatch rather than repeating one", async () => {
    const { sendNewsEvent } = await import("@/lib/discordWebhooks");
    const order: string[] = [];
    prime(db, "settlementCrises").updateOne.mockImplementation(async () => {
      order.push("stamp");
      return { matchedCount: 1 };
    });
    vi.mocked(sendNewsEvent).mockImplementation(async () => {
      order.push("send");
      return undefined;
    });
    const { emitSettlementWire } = await import("./emitWire");
    await emitSettlementWire(db as unknown as Db, crisis(), 412, { events: ["war"] });
    expect(order).toEqual(["stamp", "send"]);
  });

  it("files the briefing when it is due and stamps the turn and the position", async () => {
    const { emitSettlementWire } = await import("./emitWire");
    const res = await emitSettlementWire(db as unknown as Db, crisis(), DUE_TURN, {
      briefing: true,
    });
    expect(res.kinds).toEqual(["briefing"]);
    const [, update] = prime(db, "settlementCrises").updateOne.mock.calls[0];
    expect(update.$set.lastBriefing).toEqual({ turn: DUE_TURN, position: 47 * HUNDREDTHS });
  });

  it("stays quiet between briefings", async () => {
    const { emitSettlementWire } = await import("./emitWire");
    const res = await emitSettlementWire(db as unknown as Db, crisis(), DUE_TURN - 1, {
      briefing: true,
    });
    expect(res.posts).toBe(0);
    expect(prime(db, "settlementCrises").updateOne).not.toHaveBeenCalled();
    expect(await sendCount()).toBe(0);
  });

  it("guards the briefing write so two turn runs cannot both file one", async () => {
    const { emitSettlementWire } = await import("./emitWire");
    await emitSettlementWire(db as unknown as Db, crisis(), DUE_TURN, { briefing: true });
    const [filter] = prime(db, "settlementCrises").updateOne.mock.calls[0];
    expect(filter.$or).toEqual([
      { "lastBriefing.turn": { $lt: DUE_TURN } },
      { lastBriefing: null },
    ]);
  });

  it("counts the public over the WHOLE period, not just the closing turn", async () => {
    // Six turns of turnout reported as one turn's would understate every
    // briefing by roughly a factor of six.
    const { emitSettlementWire } = await import("./emitWire");
    await emitSettlementWire(db as unknown as Db, crisis(), DUE_TURN, { briefing: true });
    const distinct = prime(db, "settlementPlays").distinct as unknown as ReturnType<typeof vi.fn>;
    const [field, filter] = distinct.mock.calls[0];
    expect(field).toBe("characterId");
    expect(filter).toMatchObject({ actor: "personal", turn: { $gt: 400, $lte: DUE_TURN } });
  });

  it("files a moment and a briefing on the same tick without either blocking the other", async () => {
    const { emitSettlementWire } = await import("./emitWire");
    const res = await emitSettlementWire(db as unknown as Db, crisis(), DUE_TURN, {
      events: ["armed"],
      briefing: true,
    });
    expect(res.kinds).toEqual(["armed", "briefing"]);
    expect(await sendCount()).toBe(2);
  });

  it("does not let a webhook failure escape into the turn", async () => {
    // A Discord outage must never fail a tick.
    const { sendNewsEvent } = await import("@/lib/discordWebhooks");
    vi.mocked(sendNewsEvent).mockRejectedValue(new Error("discord is down"));
    const { emitSettlementWire } = await import("./emitWire");
    await expect(
      emitSettlementWire(db as unknown as Db, crisis(), 412, { events: ["opened"] })
    ).resolves.toMatchObject({ posts: 1 });
  });

  it("does not let a news-post failure stop the webhook", async () => {
    const { createSystemNewsPost } = await import("@/lib/news");
    vi.mocked(createSystemNewsPost).mockRejectedValue(new Error("mongo is down"));
    const { emitSettlementWire } = await import("./emitWire");
    await emitSettlementWire(db as unknown as Db, crisis(), 412, { events: ["opened"] });
    expect(await sendCount()).toBe(1);
  });

  it("posts nothing at all when asked for nothing", async () => {
    const { emitSettlementWire } = await import("./emitWire");
    const res = await emitSettlementWire(db as unknown as Db, crisis(), 412, {});
    expect(res).toEqual({ posts: 0, kinds: [] });
    expect(prime(db, "settlementCrises").updateOne).not.toHaveBeenCalled();
  });
});
