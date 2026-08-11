import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  auditProjectionFor,
  buildAuditLogFilter,
  categoryGuardFor,
  DEFAULT_AUDIT_LOG_LIMIT,
  MAX_AUDIT_LOG_LIMIT,
  MAX_TRACE_ROWS,
  queryAuditLog,
  queryAuditTrace,
} from "./queryAuditLog";
import type { ActionAuditRecord } from "@/lib/db/types/actionAuditLog";

function params(query: Record<string, string>): URLSearchParams {
  return new URLSearchParams(query);
}

function makeRecord(overrides: Partial<ActionAuditRecord> = {}): ActionAuditRecord {
  return {
    _id: new ObjectId(),
    ts: new Date("2026-07-21T00:00:00.000Z"),
    turn: 100,
    traceId: "turn:100:testPhase",
    seq: 0,
    source: "api",
    action: "wire.send",
    category: "money",
    actor: { kind: "player", userId: new ObjectId() },
    subject: { type: "character", id: new ObjectId() },
    outcome: "ok",
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("buildAuditLogFilter", () => {
  it("builds an empty filter with defaults when no params are given (admin)", () => {
    const result = buildAuditLogFilter(params({}), true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter).toEqual({});
    expect(result.limit).toBe(DEFAULT_AUDIT_LOG_LIMIT);
  });

  it("forces category != admin for non-admin callers with no category filter", () => {
    const result = buildAuditLogFilter(params({}), false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.category).toEqual({ $ne: "admin" });
  });

  it("makes an admin-category filter unsatisfiable for non-admin callers", () => {
    const result = buildAuditLogFilter(params({ category: "admin" }), false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Self-contradictory: category must equal "admin" AND not equal "admin".
    expect(result.filter.category).toEqual({ $eq: "admin", $ne: "admin" });
  });

  it("passes through a non-admin category filter unrestricted for non-admin callers", () => {
    const result = buildAuditLogFilter(params({ category: "money" }), false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.category).toBe("money");
  });

  it("passes through category=admin unrestricted for admin callers", () => {
    const result = buildAuditLogFilter(params({ category: "admin" }), true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.category).toBe("admin");
  });

  it("rejects an invalid category", () => {
    const result = buildAuditLogFilter(params({ category: "bogus" }), true);
    expect(result).toEqual({ ok: false, error: "Invalid category: bogus" });
  });

  it("rejects an invalid outcome", () => {
    const result = buildAuditLogFilter(params({ outcome: "bogus" }), true);
    expect(result).toEqual({ ok: false, error: "Invalid outcome: bogus" });
  });

  it("parses actorUserId/actorCharacterId as ObjectIds", () => {
    const userId = new ObjectId().toHexString();
    const characterId = new ObjectId().toHexString();
    const result = buildAuditLogFilter(
      params({ actorUserId: userId, actorCharacterId: characterId }),
      true
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter["actor.userId"]).toEqual(new ObjectId(userId));
    expect(result.filter["actor.characterId"]).toEqual(new ObjectId(characterId));
  });

  it("rejects a malformed actorUserId", () => {
    const result = buildAuditLogFilter(params({ actorUserId: "not-an-id" }), true);
    expect(result).toEqual({ ok: false, error: "Invalid actorUserId" });
  });

  it("matches subjectId against both ObjectId and string forms", () => {
    const hexId = new ObjectId().toHexString();
    const result = buildAuditLogFilter(params({ subjectId: hexId }), true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter["subject.id"]).toEqual({ $in: [new ObjectId(hexId), hexId] });
  });

  it("uses a raw string subjectId as-is when not a valid ObjectId hex", () => {
    const result = buildAuditLogFilter(params({ subjectId: "gov:US" }), true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter["subject.id"]).toBe("gov:US");
  });

  it("builds turn range filters", () => {
    const result = buildAuditLogFilter(params({ turnFrom: "10", turnTo: "20" }), true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.turn).toEqual({ $gte: 10, $lte: 20 });
  });

  it("rejects a non-numeric turnFrom", () => {
    const result = buildAuditLogFilter(params({ turnFrom: "abc" }), true);
    expect(result).toEqual({ ok: false, error: "Invalid turnFrom" });
  });

  it("builds ts range filters from ISO strings", () => {
    const result = buildAuditLogFilter(
      params({ tsFrom: "2026-01-01T00:00:00.000Z", tsTo: "2026-02-01T00:00:00.000Z" }),
      true
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.ts).toEqual({
      $gte: new Date("2026-01-01T00:00:00.000Z"),
      $lte: new Date("2026-02-01T00:00:00.000Z"),
    });
  });

  it("rejects an invalid tsFrom", () => {
    const result = buildAuditLogFilter(params({ tsFrom: "not-a-date" }), true);
    expect(result).toEqual({ ok: false, error: "Invalid tsFrom" });
  });

  it("filters by an exact flag when given", () => {
    const result = buildAuditLogFilter(params({ flag: "rapid_repeat" }), true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.flags).toBe("rapid_repeat");
  });

  it("filters flagged-only when flaggedOnly=true and no explicit flag is given", () => {
    const result = buildAuditLogFilter(params({ flaggedOnly: "true" }), true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.flags).toEqual({ $exists: true, $not: { $size: 0 } });
  });

  it("prefers an explicit flag filter over flaggedOnly", () => {
    const result = buildAuditLogFilter(params({ flag: "wash_trade", flaggedOnly: "true" }), true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.flags).toBe("wash_trade");
  });

  it("parses a valid cursor into an _id $lt filter", () => {
    const cursor = new ObjectId().toHexString();
    const result = buildAuditLogFilter(params({ cursor }), true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter._id).toEqual({ $lt: new ObjectId(cursor) });
  });

  it("rejects a malformed cursor", () => {
    const result = buildAuditLogFilter(params({ cursor: "not-an-id" }), true);
    expect(result).toEqual({ ok: false, error: "Invalid cursor" });
  });

  it("clamps limit to [1, MAX_AUDIT_LOG_LIMIT], falling back to the default for 0/NaN", () => {
    // "0" is falsy after parseInt, so (matching buildTxLogFilter's existing
    // convention) it falls back to the default rather than clamping to 1.
    expect(buildAuditLogFilter(params({ limit: "0" }), true)).toMatchObject({
      limit: DEFAULT_AUDIT_LOG_LIMIT,
    });
    expect(buildAuditLogFilter(params({ limit: "-5" }), true)).toMatchObject({ limit: 1 });
    expect(buildAuditLogFilter(params({ limit: "999999" }), true)).toMatchObject({
      limit: MAX_AUDIT_LOG_LIMIT,
    });
    expect(buildAuditLogFilter(params({ limit: "not-a-number" }), true)).toMatchObject({
      limit: DEFAULT_AUDIT_LOG_LIMIT,
    });
  });
});

describe("auditProjectionFor / categoryGuardFor", () => {
  it("returns no projection for admins and strips net/meta for non-admins", () => {
    expect(auditProjectionFor(true)).toBeUndefined();
    expect(auditProjectionFor(false)).toEqual({ net: 0, meta: 0 });
  });

  it("returns an empty guard for admins and excludes admin category for non-admins", () => {
    expect(categoryGuardFor(true)).toEqual({});
    expect(categoryGuardFor(false)).toEqual({ category: { $ne: "admin" } });
  });
});

describe("queryAuditLog", () => {
  it("requests the role-appropriate projection and reports truncation via nextCursor", async () => {
    const db = createMockDb();
    const collection = db.collection("actionAuditLog");
    const rows = Array.from({ length: 6 }, () => makeRecord());
    // limit=5 → fetch 6 to detect truncation; return all 6.
    collection.find.mockReturnValue({
      sort: () => ({ limit: () => ({ toArray: async () => rows }) }),
    });

    const result = await queryAuditLog(db as unknown as Db, {}, 5, false);
    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(5);
    expect(result.nextCursor).toBe(rows[4]._id.toHexString());
    expect(collection.find).toHaveBeenCalledWith({}, { projection: { net: 0, meta: 0 } });
  });

  it("reports no truncation when results fit within the limit", async () => {
    const db = createMockDb();
    const collection = db.collection("actionAuditLog");
    const rows = [makeRecord()];
    collection.find.mockReturnValue({
      sort: () => ({ limit: () => ({ toArray: async () => rows }) }),
    });

    const result = await queryAuditLog(db as unknown as Db, {}, 50, true);
    expect(result.truncated).toBe(false);
    expect(result.nextCursor).toBeNull();
    expect(collection.find).toHaveBeenCalledWith({}, { projection: undefined });
  });
});

describe("queryAuditTrace", () => {
  it("sorts by seq ascending, applies the category guard, and caps at MAX_TRACE_ROWS", async () => {
    const db = createMockDb();
    const collection = db.collection("actionAuditLog");
    const sortSpy = { spy: null as unknown };
    const limitSpy = { spy: null as unknown };
    const toArray = async () => [makeRecord({ seq: 0 }), makeRecord({ seq: 1 })];
    collection.find.mockImplementation((filter: unknown) => {
      sortSpy.spy = filter;
      return {
        sort: (s: unknown) => {
          sortSpy.spy = s;
          return {
            limit: (l: unknown) => {
              limitSpy.spy = l;
              return { toArray };
            },
          };
        },
      };
    });

    const rows = await queryAuditTrace(db as unknown as Db, "turn:100:testPhase", false);
    expect(rows).toHaveLength(2);
    expect(collection.find).toHaveBeenCalledWith(
      { traceId: "turn:100:testPhase", category: { $ne: "admin" } },
      { projection: { net: 0, meta: 0 } }
    );
    expect(sortSpy.spy).toEqual({ seq: 1, _id: 1 });
    expect(limitSpy.spy).toBe(MAX_TRACE_ROWS);
  });
});
