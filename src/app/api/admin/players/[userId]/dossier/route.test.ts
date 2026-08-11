import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { User } from "@/lib/db/types/user";
import type { ActivityLogAuth } from "@/lib/db/types/activityLog";
import type { ActionAuditRecord } from "@/lib/db/types/actionAuditLog";
import type { AltCluster, AltLink } from "@/lib/db/types/altDetection";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireModerator", () => ({ requireModerator: vi.fn() }));

const USER_ID = new ObjectId("507f1f77bcf86cd799439011");
const OTHER_ID = new ObjectId("507f191e810c19729de860ea");
const CHAR_ID = new ObjectId("507f11111111111111111111");

function makeUser(overrides: Partial<User> = {}): User {
  return {
    _id: USER_ID,
    email: "player@example.com",
    username: "player1",
    displayName: "Player One",
    password: "hash",
    role: "player",
    hasCompletedSetup: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    registrationIp: "198.51.100.42",
    lastKnownIp: "203.0.113.9",
    registrationFingerprint: "abcdef1234567890",
    lastFingerprint: "fedcba0987654321",
    fingerprintHistory: ["abcdef1234567890", "fedcba0987654321"],
    trackingId: "track-abc-123",
    deviceKey: "device-key-xyz",
    googleEmail: "google@example.com",
    referralCount: 2,
    ...overrides,
  };
}

function chainProjectToArray<T>(rows: T[]) {
  return () => ({
    project: () => ({ toArray: async () => rows }),
    sort: () => ({ limit: () => ({ toArray: async () => rows }) }),
  });
}

function chainFind<T>(rows: T[]) {
  return () => ({ sort: () => ({ limit: () => ({ toArray: async () => rows }) }) });
}

function chainAggregate<T>(rows: T[]) {
  return () => ({ toArray: async () => rows });
}

function makeAuditRow(overrides: Partial<ActionAuditRecord> = {}): ActionAuditRecord {
  return {
    _id: new ObjectId(),
    ts: new Date("2026-07-21T00:00:00.000Z"),
    turn: 100,
    traceId: "api:/auth/login",
    source: "api",
    action: "auth.login",
    category: "auth",
    actor: { kind: "player", userId: USER_ID },
    subject: { type: "user", id: USER_ID },
    outcome: "ok",
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    net: { ipHash: "abc123", fingerprint: "fp1", ipMasked: "198.51.100.xxx" },
    meta: { route: "/api/auth/login" },
    ...overrides,
  };
}

function makeLoginRow(): ActivityLogAuth {
  return {
    _id: new ObjectId(),
    type: "login",
    timestamp: new Date("2026-07-20T12:00:00.000Z"),
    userId: USER_ID,
    username: "player1",
    ipAddress: "198.51.100.55",
    fingerprint: "loginfp123456789",
    trackingId: "track-login-1",
    userAgent: "Mozilla/5.0",
  };
}

describe("GET /api/admin/players/[userId]/dossier", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("users");
    db.collection("characters");
    db.collection("imperialCharacters");
    db.collection("activityLog");
    db.collection("financialTxLog");
    db.collection("altLinks");
    db.collection("altClusters");
    db.collection("suspiciousCharacters");
    db.collection("actionAuditLog");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  async function seedHappyPath(isAdmin: boolean) {
    const user = makeUser();
    db.collectionMocks.users.findOne.mockResolvedValue(user);
    db.collectionMocks.characters.find.mockImplementation(
      chainProjectToArray([{ _id: CHAR_ID, userId: USER_ID }])
    );
    db.collectionMocks.imperialCharacters.find.mockImplementation(chainProjectToArray([]));

    const login = makeLoginRow();
    db.collectionMocks.activityLog.find.mockImplementation(chainFind([login]));

    const tx: FinancialTxLogEntry = {
      _id: new ObjectId(),
      type: "wire_transfer_in",
      turn: 99,
      createdAt: new Date("2026-07-19T00:00:00.000Z"),
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      subjectType: "character",
      subjectId: CHAR_ID,
      subjectName: "Player One",
      amount: 5000,
      currencyCode: "USD",
      anchorAmount: 5000,
      flagged: false,
    };
    db.collectionMocks.financialTxLog.find.mockImplementation(chainFind([tx]));
    db.collectionMocks.financialTxLog.aggregate.mockImplementation(
      chainAggregate([{ creditsIn: 5000, debitsOut: 1000 }])
    );

    const link: AltLink = {
      _id: new ObjectId(),
      userA: USER_ID,
      userB: OTHER_ID,
      confidence: 0.82,
      signals: [
        {
          type: "device_fingerprint_exact",
          weight: 0.9,
          contribution: 0.5,
          evidence: "Exact device fingerprint match (abcdef12…, 1 shared hash)",
          detectedAt: new Date(),
        },
      ],
      updatedAt: new Date(),
      turn: 100,
    };
    db.collectionMocks.altLinks.find.mockImplementation(chainFind([link]));

    const cluster: AltCluster = {
      _id: new ObjectId(),
      memberUserIds: [USER_ID, OTHER_ID],
      confidence: 0.82,
      size: 2,
      signalSummary: [{ type: "device_fingerprint_exact", count: 1, maxContribution: 0.5 }],
      roles: { burners: [USER_ID], associates: [OTHER_ID] },
      topEvidence: ["Shared IP 198.51.100.xxx"],
      status: "open",
      updatedAt: new Date(),
      turn: 100,
    };
    db.collectionMocks.altClusters.find.mockImplementation(chainFind([cluster]));

    db.collectionMocks.users.find.mockImplementation(
      chainProjectToArray([{ _id: OTHER_ID, username: "alt2" }])
    );

    db.collectionMocks.suspiciousCharacters.find.mockImplementation(chainFind([]));

    const auditRow = makeAuditRow();
    const flaggedRow = makeAuditRow({ flags: ["velocity"] });
    db.collectionMocks.actionAuditLog.find.mockImplementation((filter, options) => ({
      sort: () => ({
        limit: () => ({
          toArray: async () => {
            const rows = filter.flags ? [flaggedRow] : [auditRow];
            if (options?.projection) {
              return rows.map((row) => {
                const copy = { ...row };
                delete (copy as Partial<ActionAuditRecord>).net;
                delete (copy as Partial<ActionAuditRecord>).meta;
                return copy;
              });
            }
            return rows;
          },
        }),
      }),
    }));

    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: isAdmin ? "admin" : "mod",
        isAdmin,
      },
    } as never);
  }

  it("returns 403 when the caller is not at least a moderator", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    const forbidden = new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    vi.mocked(requireModerator).mockResolvedValue({ ok: false, response: forbidden } as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/players/x/dossier"), {
      params: Promise.resolve({ userId: USER_ID.toHexString() }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 for an invalid userId", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), username: "mod", isAdmin: false },
    } as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/players/bad/dossier"), {
      params: Promise.resolve({ userId: "not-an-object-id" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the user does not exist", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), username: "mod", isAdmin: false },
    } as never);
    db.collectionMocks.users.findOne.mockResolvedValue(null);

    const { GET } = await import("./route");
    const res = await GET(
      new Request(`http://localhost/api/admin/players/${USER_ID.toHexString()}/dossier`),
      { params: Promise.resolve({ userId: USER_ID.toHexString() }) }
    );
    expect(res.status).toBe(404);
  });

  it("moderator: returns aggregated dossier with masked PII and stripped audit net/meta", async () => {
    await seedHappyPath(false);

    const { GET } = await import("./route");
    const res = await GET(
      new Request(`http://localhost/api/admin/players/${USER_ID.toHexString()}/dossier`),
      { params: Promise.resolve({ userId: USER_ID.toHexString() }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.userId).toBe(USER_ID.toHexString());
    expect(body.identity.username).toBe("player1");
    expect(body.identity.email).toBe("pl****@example.com");
    expect(body.identity.registrationIp).toBe("198.51.100.xxx");
    expect(body.identity.lastKnownIp).toBe("203.0.113.xxx");
    expect(body.identity.registrationFingerprint).toBe("abcdef12…");
    expect(body.identity.deviceKey).toBeNull();
    expect(body.identity.trackingId).toBeNull();
    expect(body.identity.oauth.googleEmail).toBe("go****@example.com");

    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].ipAddress).toBe("198.51.100.xxx");
    expect(body.sessions[0].trackingId).toBeNull();

    expect(body.money.totals).toEqual({ creditsIn: 5000, debitsOut: 1000, net: 4000 });
    expect(body.money.recent).toHaveLength(1);
    expect(body.money.recent[0].type).toBe("wire_transfer_in");

    expect(body.linkedAccounts.links).toHaveLength(1);
    expect(body.linkedAccounts.links[0].otherUserId).toBe(OTHER_ID.toHexString());
    expect(body.linkedAccounts.clusters[0].topEvidence[0]).toBe("Shared IP [ip]");

    expect(body.recentActions).toHaveLength(1);
    expect(body.recentActions[0].net).toBeUndefined();
    expect(body.recentActions[0].meta).toBeUndefined();
    expect(body.flags.flaggedAuditRows).toHaveLength(1);
    expect(body.flags.flaggedAuditRows[0].flags).toEqual(["velocity"]);
  });

  it("admin: returns raw PII and audit net/meta", async () => {
    await seedHappyPath(true);

    const { GET } = await import("./route");
    const res = await GET(
      new Request(`http://localhost/api/admin/players/${USER_ID.toHexString()}/dossier`),
      { params: Promise.resolve({ userId: USER_ID.toHexString() }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.identity.email).toBe("player@example.com");
    expect(body.identity.registrationIp).toBe("198.51.100.42");
    expect(body.identity.registrationFingerprint).toBe("abcdef1234567890");
    expect(body.identity.deviceKey).toBe("device-key-xyz");
    expect(body.identity.trackingId).toBe("track-abc-123");

    expect(body.sessions[0].ipAddress).toBe("198.51.100.55");
    expect(body.sessions[0].trackingId).toBe("track-login-1");

    expect(body.linkedAccounts.clusters[0].topEvidence[0]).toBe("Shared IP 198.51.100.xxx");

    expect(body.recentActions[0].net).toEqual({
      ipHash: "abc123",
      fingerprint: "fp1",
      ipMasked: "198.51.100.xxx",
    });
    expect(body.recentActions[0].meta).toEqual({ route: "/api/auth/login" });
  });
});
