import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { buildActionLogSearchFilter, mapActionLogToEvent, mergeActivityPage } from "./activityLog";

describe("mapActionLogToEvent", () => {
  it("maps an actionLog row to a game_action event, backfilling identity from the lookup", () => {
    const characterId = new ObjectId();
    const row = {
      _id: new ObjectId(),
      characterId,
      userId: new ObjectId(),
      actionType: "fundraise",
      actionCost: 2,
      result: { success: true, fundsChange: 500, message: "Raised $500." },
      turn: 7,
      createdAt: new Date("2026-05-30T10:00:00Z"),
    };
    const lookup = new Map([
      [characterId.toHexString(), { characterName: "Bob", countryId: "US" }],
    ]);
    const ev = mapActionLogToEvent(row as never, lookup);
    expect(ev.type).toBe("game_action");
    expect(ev.timestamp).toEqual(row.createdAt);
    expect(ev.characterName).toBe("Bob");
    expect(ev.countryId).toBe("US");
    expect(ev.summary).toContain("fundraise");
  });

  it("prefers denormalized identity on the row over the lookup", () => {
    const row = {
      _id: new ObjectId(),
      characterId: new ObjectId(),
      userId: new ObjectId(),
      actionType: "poll",
      actionCost: 1,
      result: { success: true, message: "Polled." },
      turn: 3,
      createdAt: new Date(),
      characterName: "Denorm",
      username: "denormuser",
      countryId: "UK",
    };
    const ev = mapActionLogToEvent(row as never, new Map());
    expect(ev.characterName).toBe("Denorm");
    expect(ev.username).toBe("denormuser");
    expect(ev.countryId).toBe("UK");
  });
});

describe("mergeActivityPage", () => {
  function withId(tsMs: number) {
    // ObjectIds are time-ordered; craft ascending ids by timestamp (seconds).
    return ObjectId.createFromTime(Math.floor(tsMs / 1000));
  }

  it("merges both streams by _id desc and computes hasMore/nextCursor", () => {
    const a1 = { _id: withId(3000), type: "login", timestamp: new Date(3000) };
    const a2 = { _id: withId(1000), type: "login", timestamp: new Date(1000) };
    const g1 = { _id: withId(2000), type: "game_action", timestamp: new Date(2000) };
    const merged = mergeActivityPage([a1, a2] as never, [g1] as never, 2);
    expect(merged.events.map((e) => e.type)).toEqual(["login", "game_action"]);
    expect(merged.hasMore).toBe(true);
    expect(merged.nextCursor).toBe((g1._id as ObjectId).toHexString());
  });

  it("no more pages when combined size <= limit", () => {
    const a1 = { _id: withId(2000), type: "login", timestamp: new Date(2000) };
    const g1 = { _id: withId(1000), type: "game_action", timestamp: new Date(1000) };
    const merged = mergeActivityPage([a1] as never, [g1] as never, 25);
    expect(merged.events).toHaveLength(2);
    expect(merged.hasMore).toBe(false);
    expect(merged.nextCursor).toBeNull();
  });
});

describe("buildActionLogSearchFilter", () => {
  it("matches denormalized names and resolved ids for action-log investigations", () => {
    const userId = new ObjectId();
    const characterId = new ObjectId();
    const filter = buildActionLogSearchFilter("banned user", [userId], [characterId]) as {
      $or: Array<Record<string, unknown>>;
    };

    expect(filter.$or).toHaveLength(4);
    expect(filter.$or[0]).toEqual({ username: /banned user/i });
    expect(filter.$or[1]).toEqual({ characterName: /banned user/i });
    expect(filter.$or[2]).toEqual({ userId: { $in: [userId] } });
    expect(filter.$or[3]).toEqual({ characterId: { $in: [characterId] } });
  });
});
