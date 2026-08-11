import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireModerator", () => ({ requireModerator: vi.fn() }));

let db: MockDb;

const userA = new ObjectId();
const userB = new ObjectId();
const clusterId = new ObjectId();

function makeCluster() {
  return {
    _id: clusterId,
    memberUserIds: [userA, userB],
    confidence: 0.85,
    size: 2,
    signalSummary: [{ type: "ip_exact_nonCF", count: 1, maxContribution: 0.35 }],
    roles: { operator: userA, burners: [userB], associates: [] },
    topEvidence: ["Shared residential/mobile IP 12.34.56.xxx"],
    status: "open",
    updatedAt: new Date(),
    turn: 5,
  };
}

function makeLink() {
  return {
    _id: new ObjectId(),
    userA,
    userB,
    confidence: 0.7,
    signals: [
      {
        type: "ip_exact_nonCF",
        weight: 0.35,
        contribution: 0.35,
        evidence: "Shared residential/mobile IP 12.34.56.xxx",
        detectedAt: new Date(),
      },
      {
        type: "device_fingerprint_exact",
        weight: 0.95,
        contribution: 0.6,
        evidence: "Exact device fingerprint match (a1b2c3d4…, 1 shared hash)",
        detectedAt: new Date(),
      },
    ],
    updatedAt: new Date(),
    turn: 5,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("altClusters");
  db.collection("altLinks");
  db.collection("users");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

async function mockModerator(isAdmin: boolean) {
  const { requireModerator } = await import("@/lib/api/requireModerator");
  vi.mocked(requireModerator).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString(), username: "staff1", isAdmin },
  } as Awaited<ReturnType<typeof requireModerator>>);
}

function get(id: string) {
  return import("./route").then(({ GET }) =>
    GET(new Request(`http://localhost/api/admin/alts/cluster/${id}`), {
      params: Promise.resolve({ id }),
    })
  );
}

describe("GET /api/admin/alts/cluster/[id]", () => {
  it("returns 403 when not a moderator/admin", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as Awaited<ReturnType<typeof requireModerator>>);

    const res = await get(clusterId.toString());
    expect(res.status).toBe(403);
  });

  it("rejects a malformed cluster id", async () => {
    await mockModerator(false);
    const res = await get("not-an-id");
    expect(res.status).toBe(400);
  });

  it("returns 404 when the cluster does not exist", async () => {
    await mockModerator(false);
    db.collectionMocks.altClusters.findOne.mockResolvedValue(null);
    const res = await get(clusterId.toString());
    expect(res.status).toBe(404);
  });

  it("returns full cluster detail with the frozen response shape for an admin", async () => {
    await mockModerator(true);
    db.collectionMocks.altClusters.findOne.mockResolvedValue(makeCluster());
    db.collectionMocks.users.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: userA, username: "alice", isBanned: false },
        { _id: userB, username: "bob", isBanned: true },
      ]),
    });
    db.collectionMocks.altLinks.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([makeLink()]),
    });

    const res = await get(clusterId.toString());
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.id).toBe(clusterId.toString());
    expect(data.confidence).toBe(0.85);
    expect(data.members).toHaveLength(2);
    expect(data.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: userA.toString(), name: "alice", role: "operator" }),
        expect.objectContaining({
          userId: userB.toString(),
          name: "bob",
          banned: true,
          role: "burner",
        }),
      ])
    );
    expect(data.links).toHaveLength(1);
    expect(data.contributions.length).toBeGreaterThan(0);
    expect(data.signalSummary).toEqual([
      { type: "ip_exact_nonCF", count: 1, maxContribution: 0.35 },
    ]);

    // Admin sees the un-redacted masked-fingerprint fragment as stored.
    const fpContribution = data.contributions.find(
      (c: { type: string }) => c.type === "device_fingerprint_exact"
    );
    expect(fpContribution.evidence).toContain("a1b2c3d4…");
  });

  it("redacts the residual masked fingerprint/IP fragments in evidence for moderators", async () => {
    await mockModerator(false);
    db.collectionMocks.altClusters.findOne.mockResolvedValue(makeCluster());
    db.collectionMocks.users.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: userA, username: "alice", isBanned: false },
        { _id: userB, username: "bob", isBanned: true },
      ]),
    });
    db.collectionMocks.altLinks.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([makeLink()]),
    });

    const res = await get(clusterId.toString());
    expect(res.status).toBe(200);
    const data = await res.json();

    const fpContribution = data.contributions.find(
      (c: { type: string }) => c.type === "device_fingerprint_exact"
    );
    expect(fpContribution.evidence).not.toContain("a1b2c3d4…");
    expect(fpContribution.evidence).toContain("[fingerprint]");

    const ipContribution = data.contributions.find(
      (c: { type: string }) => c.type === "ip_exact_nonCF"
    );
    expect(ipContribution.evidence).not.toContain("12.34.56.xxx");
    expect(ipContribution.evidence).toContain("[ip]");

    for (const link of data.links) {
      for (const signal of link.signals) {
        expect(signal.evidence).not.toContain("12.34.56.xxx");
        expect(signal.evidence).not.toContain("a1b2c3d4…");
      }
    }
    for (const evidence of data.topEvidence) {
      expect(evidence).not.toContain("12.34.56.xxx");
    }
  });
});
