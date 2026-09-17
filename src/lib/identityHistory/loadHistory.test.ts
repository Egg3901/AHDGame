import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { loadIdentityHistory, IDENTITY_HISTORY_PAGE_SIZE } from "./loadHistory";
import type { IdentityObservation } from "@/lib/db/types/identityObservation";
import { hashSensitiveSignal } from "@/lib/utils/hashSignal";

const USER = new ObjectId();
const OTHER = new ObjectId();

function fakeDb(rows: IdentityObservation[]) {
  return {
    collection: () => ({
      countDocuments: async (f: { userId?: ObjectId }) =>
        rows.filter((r) => !f.userId || r.userId.equals(f.userId)).length,
      find: (f: { userId?: ObjectId }) => {
        const matched = rows
          .filter((r) => !f.userId || r.userId.equals(f.userId))
          .sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
        return {
          sort: () => ({
            skip: (skip: number) => ({
              limit: (limit: number) => ({
                toArray: async () => matched.slice(skip, skip + limit),
              }),
            }),
          }),
        };
      },
      aggregate: () => ({
        toArray: async () => {
          const byValue = new Map<string, ObjectId[]>();
          for (const r of rows) {
            const seen = byValue.get(r.value) ?? [];
            if (!seen.some((id) => id.equals(r.userId))) seen.push(r.userId);
            byValue.set(r.value, seen);
          }
          return [...byValue.entries()].map(([value, users]) => ({ _id: value, users }));
        },
      }),
    }),
  } as unknown as Db;
}

function row(userId: ObjectId, value: string, day: number, datesKnown = true): IdentityObservation {
  return {
    userId,
    track: "ip",
    value,
    firstSeen: new Date(Date.UTC(2026, 8, day)),
    lastSeen: new Date(Date.UTC(2026, 8, day)),
    observations: 1,
    source: "login",
    datesKnown,
  };
}

describe("loadIdentityHistory", () => {
  it("pages at 10 rows", async () => {
    const rows = Array.from({ length: 23 }, (_, i) => row(USER, `10.0.0.${i}`, i + 1));
    const page = await loadIdentityHistory(fakeDb(rows), USER, "ip", 1, { revealNetwork: true });
    expect(IDENTITY_HISTORY_PAGE_SIZE).toBe(10);
    expect(page.rows).toHaveLength(10);
    expect(page.total).toBe(23);
    expect(page.totalPages).toBe(3);
  });

  it("counts other accounts sharing a value, excluding the subject", async () => {
    const rows = [row(USER, "1.1.1.1", 1), row(OTHER, "1.1.1.1", 2), row(USER, "2.2.2.2", 3)];
    const page = await loadIdentityHistory(fakeDb(rows), USER, "ip", 1, { revealNetwork: true });
    expect(page.rows.find((r) => r.value === "1.1.1.1")?.sharedWithCount).toBe(1);
    expect(page.rows.find((r) => r.value === "2.2.2.2")?.sharedWithCount).toBe(0);
  });

  it("does not count the subject twice when they have two runs on one value", async () => {
    const rows = [row(USER, "1.1.1.1", 1), row(USER, "2.2.2.2", 2), row(USER, "1.1.1.1", 3)];
    const page = await loadIdentityHistory(fakeDb(rows), USER, "ip", 1, { revealNetwork: true });
    for (const r of page.rows) expect(r.sharedWithCount).toBe(0);
  });

  it("withholds the IP entirely when revealNetwork is false", async () => {
    const raw = "68.192.35.139";
    const page = await loadIdentityHistory(fakeDb([row(USER, raw, 1)]), USER, "ip", 1, {
      revealNetwork: false,
    });
    // Not a mask, not a hash, nothing derived: the value never leaves the
    // server. The UI renders "This value hidden" for a null.
    expect(page.rows[0].value).toBeNull();
    expect(JSON.stringify(page)).not.toContain(raw);
    expect(JSON.stringify(page)).not.toContain("68.192.35");
  });

  it("gives an admin the raw fingerprint", async () => {
    const fp: IdentityObservation = { ...row(USER, "abc123def456", 1), track: "fingerprint" };
    const page = await loadIdentityHistory(fakeDb([fp]), USER, "fingerprint", 1, {
      revealNetwork: true,
    });
    expect(page.rows[0].value).toBe("abc123def456");
  });

  it("withholds the fingerprint entirely when revealNetwork is false", async () => {
    const raw = "abc123def456";
    const fp: IdentityObservation = { ...row(USER, raw, 1), track: "fingerprint" };
    const page = await loadIdentityHistory(fakeDb([fp]), USER, "fingerprint", 1, {
      revealNetwork: false,
    });
    expect(page.rows[0].value).toBeNull();
    expect(JSON.stringify(page)).not.toContain(raw);
    // No hash either — a hash is still a stable identifier a moderator bundle
    // could hold and correlate.
    expect(JSON.stringify(page)).not.toContain(hashSensitiveSignal(raw));
  });

  it("still reports the shared-account count when the value is withheld", async () => {
    // The actionable signal survives: a moderator sees that someone else has
    // been on this value without being told what it is.
    const rows = [row(USER, "1.1.1.1", 1), row(OTHER, "1.1.1.1", 2)];
    const page = await loadIdentityHistory(fakeDb(rows), USER, "ip", 1, { revealNetwork: false });
    expect(page.rows[0].value).toBeNull();
    expect(page.rows[0].sharedWithCount).toBe(1);
  });

  it("emits null dates for undated rows", async () => {
    const page = await loadIdentityHistory(
      fakeDb([row(USER, "1.1.1.1", 1, false)]),
      USER,
      "ip",
      1,
      {
        revealNetwork: true,
      }
    );
    expect(page.rows[0].datesKnown).toBe(false);
    expect(page.rows[0].firstSeen).toBeNull();
    expect(page.rows[0].lastSeen).toBeNull();
  });

  it("returns an empty page past the end without reporting zero total", async () => {
    const page = await loadIdentityHistory(fakeDb([row(USER, "1.1.1.1", 1)]), USER, "ip", 99, {
      revealNetwork: true,
    });
    expect(page.rows).toHaveLength(0);
    expect(page.total).toBe(1);
  });

  it("coerces a nonsense page number to page 1", async () => {
    const rows = [row(USER, "1.1.1.1", 1)];
    for (const bad of [0, -5, Number.NaN, 1.7]) {
      const page = await loadIdentityHistory(fakeDb(rows), USER, "ip", bad, {
        revealNetwork: true,
      });
      expect(page.page).toBe(1);
      expect(page.rows).toHaveLength(1);
    }
  });

  it("reports one page when the user has no history at all", async () => {
    const page = await loadIdentityHistory(fakeDb([]), USER, "ip", 1, { revealNetwork: true });
    expect(page.rows).toHaveLength(0);
    expect(page.total).toBe(0);
    expect(page.totalPages).toBe(1);
  });

  it("does not query at all when the requested page is past the end", async () => {
    let findCalls = 0;
    const db = {
      collection: () => ({
        countDocuments: async () => 1,
        find: () => {
          findCalls += 1;
          return {
            sort: () => ({ skip: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
          };
        },
        aggregate: () => ({ toArray: async () => [] }),
      }),
    } as unknown as Db;
    const page = await loadIdentityHistory(db, USER, "ip", 1_000_000, { revealNetwork: true });
    expect(page.rows).toHaveLength(0);
    expect(page.page).toBe(1_000_000);
    expect(findCalls).toBe(0);
  });
});
