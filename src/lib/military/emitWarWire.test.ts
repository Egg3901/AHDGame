import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

const { createSystemNewsPost, sendNewsEvent } = vi.hoisted(() => ({
  createSystemNewsPost: vi.fn(async (..._a: unknown[]) => {}),
  sendNewsEvent: vi.fn(async (..._a: unknown[]) => {}),
}));
vi.mock("@/lib/news", () => ({ createSystemNewsPost }));
vi.mock("@/lib/discordWebhooks", () => ({
  sendNewsEvent,
  DISCORD_COLORS: { warEscalation: 0xb03a2e },
}));

import { emitWarWire } from "./emitWarWire";

const settledWar = {
  _id: "w1",
  name: "The Anatolian War",
  settlement: {
    term: { kind: "indemnity", payer: "TR", amount: 100 },
    path: "dictated",
    imposedBy: "UK",
    target: "TR",
    turn: 400,
  },
};

function mockDb(opts: { rows?: unknown[]; claimModified?: number }) {
  const updates: Array<{ filter: unknown; update: unknown }> = [];
  const db = {
    collection: () => ({
      find: () => ({ limit: () => ({ toArray: async () => opts.rows ?? [] }) }),
      updateOne: async (filter: unknown, update: unknown) => {
        updates.push({ filter, update });
        return { modifiedCount: opts.claimModified ?? 1 };
      },
    }),
  } as unknown as Db;
  return { db, updates };
}

beforeEach(() => {
  createSystemNewsPost.mockClear();
  createSystemNewsPost.mockResolvedValue(undefined as never);
  sendNewsEvent.mockClear();
  sendNewsEvent.mockResolvedValue(undefined as never);
});

describe("emitWarWire", () => {
  it("posts nothing when no war has settled", async () => {
    const { db } = mockDb({ rows: [] });
    expect(await emitWarWire(db, 400)).toEqual({ posts: 0 });
    expect(createSystemNewsPost).not.toHaveBeenCalled();
  });

  it("posts once for a settled war, to the feed and to Discord", async () => {
    const { db } = mockDb({ rows: [settledWar] });
    expect(await emitWarWire(db, 400)).toEqual({ posts: 1 });
    expect(createSystemNewsPost).toHaveBeenCalledTimes(1);
    expect(sendNewsEvent).toHaveBeenCalledTimes(1);
  });

  it("claims the stamp guarded on its absence, so two runners post once", async () => {
    // Two turn runners reading the same document would both see it unstamped, so a
    // read-then-write would post twice.
    const { db, updates } = mockDb({ rows: [settledWar] });
    await emitWarWire(db, 400);
    expect(updates[0]!.filter).toMatchObject({
      _id: "w1",
      postedWireEvents: { $ne: "settled" },
    });
  });

  it("posts nothing when another runner claimed the stamp first", async () => {
    const { db } = mockDb({ rows: [settledWar], claimModified: 0 });
    expect(await emitWarWire(db, 400)).toEqual({ posts: 0 });
    expect(createSystemNewsPost).not.toHaveBeenCalled();
  });

  it("writes the stamp BEFORE sending, so a crash loses a dispatch not repeats one", async () => {
    // The right way round for something that cannot be unsent.
    const order: string[] = [];
    createSystemNewsPost.mockImplementationOnce(async () => {
      order.push("post");
    });
    const db = {
      collection: () => ({
        find: () => ({ limit: () => ({ toArray: async () => [settledWar] }) }),
        updateOne: async () => {
          order.push("stamp");
          return { modifiedCount: 1 };
        },
      }),
    } as unknown as Db;
    await emitWarWire(db, 400);
    expect(order).toEqual(["stamp", "post"]);
  });

  it("does not fail the turn when the webhook throws", async () => {
    sendNewsEvent.mockRejectedValueOnce(new Error("discord down"));
    const { db } = mockDb({ rows: [settledWar] });
    await expect(emitWarWire(db, 400)).resolves.toEqual({ posts: 1 });
  });

  it("does not fail the turn when the news post throws", async () => {
    createSystemNewsPost.mockRejectedValueOnce(new Error("db down"));
    const { db } = mockDb({ rows: [settledWar] });
    await expect(emitWarWire(db, 400)).resolves.toEqual({ posts: 1 });
    // The Discord side still goes out: an outage on one must not silence the other.
    expect(sendNewsEvent).toHaveBeenCalled();
  });
});
