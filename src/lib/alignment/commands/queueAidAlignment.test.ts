import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("queueAidAlignmentPull", () => {
  let db: MockDb;

  const gameState = (doc: object | null) =>
    db.collection("gameState").findOne.mockResolvedValue(doc);

  const call = async (over: Record<string, unknown> = {}) => {
    const { queueAidAlignmentPull } = await import("./queueAidAlignment");
    return queueAidAlignmentPull({
      db: db as unknown as Db,
      organizationId: "NATO",
      recipient: "TR",
      amountUsd: 500_000_000,
      amountLocal: 500_000_000,
      turn: 10,
      ...over,
    } as never);
  };

  const inserted = () => db.collection("alignmentPlays").insertOne.mock.calls[0]?.[0];

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    gameState({ _id: "current", currentYear: 1953, intOrgAlignmentEnabled: true });
  });

  it("queues a pull toward the paying bloc, marked as aid", async () => {
    expect(await call()).toBe(true);
    // Recorded as a play so it resolves through the same cap, resistance and
    // locked gate as everything else that moves the meter.
    expect(inserted()).toMatchObject({
      organizationId: "NATO",
      targetEntityId: "TR",
      amountUsd: 500_000_000,
      resolvedTurn: null,
      source: "aid",
    });
  });

  it("queues nothing when the alignment gate is off", async () => {
    // The phase does not run at all with the gate off, so a queued row would
    // sit pending forever rather than being ignored.
    gameState({ _id: "current", currentYear: 1953, intOrgAlignmentEnabled: false });
    expect(await call()).toBe(false);
    expect(db.collection("alignmentPlays").insertOne).not.toHaveBeenCalled();
  });

  it("queues nothing for an org that carries no influence this era", async () => {
    // The EU is only a channel from 1991. The aid still pays; it simply buys
    // no alignment, which is not an error.
    expect(await call({ organizationId: "EU" })).toBe(false);
    expect(db.collection("alignmentPlays").insertOne).not.toHaveBeenCalled();
  });

  it("queues nothing for aid of nothing", async () => {
    expect(await call({ amountUsd: 0 })).toBe(false);
    expect(db.collection("alignmentPlays").insertOne).not.toHaveBeenCalled();
  });
});
