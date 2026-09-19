import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { recordIdentityObservation, recordIdentitySignals } from "./recordObservation";
import type { IdentityObservation } from "@/lib/db/types/identityObservation";

function fakeDb() {
  const rows: IdentityObservation[] = [];
  const db = {
    collection: () => ({
      async findOne(filter: { userId: ObjectId; track: string }) {
        const matches = rows
          .filter((r) => r.userId.equals(filter.userId) && r.track === filter.track)
          .sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
        return matches[0] ?? null;
      },
      async updateOne(filter: { _id: ObjectId }, update: { $set: { lastSeen: Date } }) {
        const row = rows.find((r) => r._id?.equals(filter._id));
        if (!row) return { matchedCount: 0 };
        row.lastSeen = update.$set.lastSeen;
        row.observations += 1;
        return { matchedCount: 1 };
      },
      async insertOne(doc: IdentityObservation) {
        const _id = new ObjectId();
        rows.push({ ...doc, _id });
        return { insertedId: _id };
      },
    }),
  } as unknown as Db;
  return { db, rows };
}

const USER = new ObjectId();
const at = (day: number) => new Date(Date.UTC(2026, 8, day));

describe("recordIdentityObservation", () => {
  it("opens a run the first time a value is seen", async () => {
    const { db, rows } = fakeDb();
    const result = await recordIdentityObservation(db, {
      userId: USER,
      track: "ip",
      value: "1.1.1.1",
      observedAt: at(1),
      source: "login",
    });
    expect(result).toBe("opened");
    expect(rows).toHaveLength(1);
    expect(rows[0].observations).toBe(1);
    expect(rows[0].firstSeen).toEqual(at(1));
    expect(rows[0].lastSeen).toEqual(at(1));
    expect(rows[0].datesKnown).toBe(true);
  });

  it("extends the open run when the same value is seen again", async () => {
    const { db, rows } = fakeDb();
    const input = {
      userId: USER,
      track: "ip" as const,
      value: "1.1.1.1",
      source: "login" as const,
    };
    await recordIdentityObservation(db, { ...input, observedAt: at(1) });
    const result = await recordIdentityObservation(db, { ...input, observedAt: at(2) });
    expect(result).toBe("extended");
    expect(rows).toHaveLength(1);
    expect(rows[0].observations).toBe(2);
    expect(rows[0].firstSeen).toEqual(at(1));
    expect(rows[0].lastSeen).toEqual(at(2));
  });

  it("debounces a repeat sighting of the same value inside the window", async () => {
    const { db, rows } = fakeDb();
    const input = {
      userId: USER,
      track: "ip" as const,
      value: "1.1.1.1",
      source: "session" as const,
    };
    const base = at(1);
    await recordIdentityObservation(db, { ...input, observedAt: base });
    const result = await recordIdentityObservation(db, {
      ...input,
      observedAt: new Date(base.getTime() + 30_000),
    });
    expect(result).toBe("debounced");
    expect(rows).toHaveLength(1);
    expect(rows[0].observations).toBe(1);
    expect(rows[0].lastSeen).toEqual(base);
  });

  it("never moves lastSeen backwards when an observation lands out of order", async () => {
    const { db, rows } = fakeDb();
    const input = {
      userId: USER,
      track: "ip" as const,
      value: "1.1.1.1",
      source: "session" as const,
    };
    await recordIdentityObservation(db, { ...input, observedAt: at(5) });
    const result = await recordIdentityObservation(db, { ...input, observedAt: at(1) });
    expect(result).toBe("debounced");
    expect(rows[0].lastSeen).toEqual(at(5));
  });

  it("opens a THIRD run when a user returns to an earlier value", async () => {
    const { db, rows } = fakeDb();
    const base = { userId: USER, track: "ip" as const, source: "login" as const };
    await recordIdentityObservation(db, { ...base, value: "1.1.1.1", observedAt: at(1) });
    await recordIdentityObservation(db, { ...base, value: "2.2.2.2", observedAt: at(2) });
    await recordIdentityObservation(db, { ...base, value: "1.1.1.1", observedAt: at(3) });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.value)).toEqual(["1.1.1.1", "2.2.2.2", "1.1.1.1"]);
    expect(rows[0].lastSeen).toEqual(at(1));
    expect(rows[2].firstSeen).toEqual(at(3));
  });

  it("repairs a malformed lastSeen instead of throwing and going silent", async () => {
    const { db, rows } = fakeDb();
    const input = {
      userId: USER,
      track: "ip" as const,
      value: "1.1.1.1",
      source: "session" as const,
    };
    await recordIdentityObservation(db, { ...input, observedAt: at(1) });
    // Simulate a schemaless row that lost its Date type.
    (rows[0] as unknown as { lastSeen: unknown }).lastSeen = "2026-09-01";
    const result = await recordIdentityObservation(db, { ...input, observedAt: at(2) });
    expect(result).toBe("extended");
    expect(rows[0].lastSeen).toEqual(at(2));
  });

  it("keeps the two tracks independent", async () => {
    const { db, rows } = fakeDb();
    await recordIdentityObservation(db, {
      userId: USER,
      track: "ip",
      value: "1.1.1.1",
      observedAt: at(1),
      source: "login",
    });
    await recordIdentityObservation(db, {
      userId: USER,
      track: "fingerprint",
      value: "abc123",
      observedAt: at(1),
      source: "login",
    });
    expect(rows).toHaveLength(2);
  });

  it("rejects a sentinel value without writing anything", async () => {
    const { db, rows } = fakeDb();
    const result = await recordIdentityObservation(db, {
      userId: USER,
      track: "ip",
      value: "unknown",
      observedAt: at(1),
      source: "login",
    });
    expect(result).toBe("rejected");
    expect(rows).toHaveLength(0);
  });
});

describe("recordIdentitySignals", () => {
  it("records both tracks from one event", async () => {
    const { db, rows } = fakeDb();
    recordIdentitySignals(db, {
      userId: USER,
      ip: "1.1.1.1",
      fingerprint: "abc123",
      observedAt: at(1),
      source: "login",
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(rows.map((r) => r.track).sort()).toEqual(["fingerprint", "ip"]);
  });

  it("records the IP alone when no fingerprint was supplied", async () => {
    const { db, rows } = fakeDb();
    recordIdentitySignals(db, {
      userId: USER,
      ip: "1.1.1.1",
      fingerprint: undefined,
      observedAt: at(1),
      source: "session",
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(rows).toHaveLength(1);
    expect(rows[0].track).toBe("ip");
  });

  it("records nothing in singleplayer", async () => {
    // One account on one machine has nothing to correlate against. Mirrors
    // SINGLEPLAYER_SKIP_PHASES dropping `suspiciousDetection`.
    const { db, rows } = fakeDb();
    vi.stubEnv("SINGLEPLAYER", "1");
    try {
      recordIdentitySignals(db, {
        userId: USER,
        ip: "1.1.1.1",
        fingerprint: "abc123",
        observedAt: at(1),
        source: "login",
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(rows).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not throw when the singleplayer check itself throws", async () => {
    // SINGLEPLAYER set on a host that looks like a deployment makes
    // `assertSingleplayerAllowed` throw. A login must not 500 over that.
    const { db, rows } = fakeDb();
    vi.stubEnv("SINGLEPLAYER", "1");
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
    try {
      expect(() =>
        recordIdentitySignals(db, {
          userId: USER,
          ip: "1.1.1.1",
          fingerprint: "abc123",
          observedAt: at(1),
          source: "login",
        })
      ).not.toThrow();
      await new Promise((resolve) => setImmediate(resolve));
      expect(rows).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("never throws or rejects when the database is broken", async () => {
    const brokenDb = {
      collection: () => ({
        findOne: async () => {
          throw new Error("connection lost");
        },
      }),
    } as unknown as Db;
    expect(() =>
      recordIdentitySignals(brokenDb, {
        userId: USER,
        ip: "1.1.1.1",
        fingerprint: "abc123",
        observedAt: at(1),
        source: "login",
      })
    ).not.toThrow();
    // An unhandled rejection here would fail the suite.
    await new Promise((resolve) => setImmediate(resolve));
  });
});
