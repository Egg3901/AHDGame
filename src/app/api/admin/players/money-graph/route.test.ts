import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireModerator", () => ({ requireModerator: vi.fn() }));

let db: MockDb;

function makeTxRow(overrides: Partial<FinancialTxLogEntry>): FinancialTxLogEntry {
  return {
    _id: new ObjectId(),
    type: "wire_transfer_out",
    turn: 950,
    createdAt: new Date(),
    expiresAt: new Date(),
    subjectType: "character",
    subjectName: "Subject",
    amount: -100,
    currencyCode: "USD",
    flagged: false,
    ...overrides,
  } as FinancialTxLogEntry;
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("characters");
  db.collection("altClusters");
  db.collection("users");
  db.collection("gameState");
  db.collection("financialTxLog");
  db.collectionMocks.gameState!.findOne.mockResolvedValue({ _id: "current", currentTurn: 1000 });
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

function get(query: string) {
  return import("./route").then(({ GET }) =>
    GET(new Request(`http://localhost/api/admin/players/money-graph${query}`))
  );
}

describe("GET /api/admin/players/money-graph", () => {
  it("returns 403 when not a moderator/admin", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as Awaited<ReturnType<typeof requireModerator>>);

    const res = await get("?userId=" + new ObjectId().toString());
    expect(res.status).toBe(403);
  });

  it("returns 400 when neither userId nor clusterId is given", async () => {
    await mockModerator(true);
    const res = await get("");
    expect(res.status).toBe(400);
  });

  it("returns 400 when both userId and clusterId are given", async () => {
    await mockModerator(true);
    const res = await get(`?userId=${new ObjectId()}&clusterId=${new ObjectId()}`);
    expect(res.status).toBe(400);
  });

  it("returns 400 for an out-of-range depth", async () => {
    await mockModerator(true);
    const res = await get(`?userId=${new ObjectId()}&depth=3`);
    expect(res.status).toBe(400);
  });

  it("returns 404 when the userId has no character", async () => {
    await mockModerator(true);
    db.collectionMocks.characters!.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    const res = await get(`?userId=${new ObjectId()}`);
    expect(res.status).toBe(404);
  });

  it("returns 404 when the clusterId does not exist", async () => {
    await mockModerator(true);
    db.collectionMocks.altClusters!.findOne.mockResolvedValue(null);
    const res = await get(`?clusterId=${new ObjectId()}`);
    expect(res.status).toBe(404);
  });

  it("assembles an A->B->A cycle graph centered on userId, admin sees unmasked names", async () => {
    await mockModerator(true);

    const userId = new ObjectId();
    const alice = new ObjectId(); // the user's character
    const bob = new ObjectId();

    db.collectionMocks.characters!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: alice, userId }]),
    });

    const rows: FinancialTxLogEntry[] = [
      makeTxRow({
        subjectId: alice,
        subjectName: "Alice",
        amount: -1000,
        counterpartyType: "character",
        counterpartyId: bob,
        counterpartyName: "Bob",
      }),
      makeTxRow({
        subjectId: bob,
        subjectName: "Bob",
        amount: -400,
        counterpartyType: "character",
        counterpartyId: alice,
        counterpartyName: "Alice",
      }),
    ];
    db.collectionMocks.financialTxLog!.find.mockReturnValue({
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(rows),
    });
    db.collectionMocks.users!.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });

    const res = await get(`?userId=${userId.toString()}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.truncated).toBe(false);
    const nodeIds = body.nodes.map((n: { id: string }) => n.id).sort();
    expect(nodeIds).toEqual([alice.toHexString(), bob.toHexString()].sort());
    const aliceNode = body.nodes.find((n: { id: string }) => n.id === alice.toHexString());
    expect(aliceNode.name).toBe("Alice"); // admin: unmasked

    expect(body.edges).toHaveLength(2);
    const aliceToBob = body.edges.find(
      (e: { from: string; to: string }) =>
        e.from === alice.toHexString() && e.to === bob.toHexString()
    );
    const bobToAlice = body.edges.find(
      (e: { from: string; to: string }) =>
        e.from === bob.toHexString() && e.to === alice.toHexString()
    );
    expect(aliceToBob).toMatchObject({ totalAmount: 1000, txCount: 1, currencyCode: "USD" });
    expect(bobToAlice).toMatchObject({ totalAmount: 400, txCount: 1, currencyCode: "USD" });

    // Turn window: currentTurn(1000) - default turnsBack(168) = 832.
    const filterArg = db.collectionMocks.financialTxLog!.find.mock.calls[0][0];
    expect(filterArg.turn).toEqual({ $gte: 832 });
  });

  it("masks names for a non-admin moderator but keeps ids unmasked", async () => {
    await mockModerator(false);

    const userId = new ObjectId();
    const alice = new ObjectId();
    const bob = new ObjectId();

    db.collectionMocks.characters!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: alice, userId }]),
    });
    db.collectionMocks.financialTxLog!.find.mockReturnValue({
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        makeTxRow({
          subjectId: alice,
          subjectName: "Alice",
          amount: -1000,
          counterpartyType: "character",
          counterpartyId: bob,
          counterpartyName: "Bob",
        }),
      ]),
    });
    db.collectionMocks.users!.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });

    const res = await get(`?userId=${userId.toString()}`);
    const body = await res.json();

    const aliceNode = body.nodes.find((n: { id: string }) => n.id === alice.toHexString());
    expect(aliceNode.id).toBe(alice.toHexString()); // id never masked
    expect(aliceNode.name).toBe("Al…"); // name masked for non-admin

    // admin_transfer guard should be applied to the query for non-admins.
    const filterArg = db.collectionMocks.financialTxLog!.find.mock.calls[0][0];
    expect(filterArg.type).toEqual({ $ne: "admin_transfer" });
  });

  it("aggregates a fan-in when centered on a clusterId", async () => {
    await mockModerator(true);

    const clusterId = new ObjectId();
    const memberUser = new ObjectId();
    const recipient = new ObjectId(); // the cluster member's character
    const sender1 = new ObjectId();
    const sender2 = new ObjectId();

    db.collectionMocks.altClusters!.findOne.mockResolvedValue({
      _id: clusterId,
      memberUserIds: [memberUser],
    });
    db.collectionMocks.characters!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: recipient, userId: memberUser }]),
    });
    db.collectionMocks.financialTxLog!.find.mockReturnValue({
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        makeTxRow({
          subjectId: recipient,
          subjectName: "Recipient",
          amount: 500,
          counterpartyType: "character",
          counterpartyId: sender1,
          counterpartyName: "Sender1",
        }),
        makeTxRow({
          subjectId: recipient,
          subjectName: "Recipient",
          amount: 700,
          counterpartyType: "character",
          counterpartyId: sender2,
          counterpartyName: "Sender2",
        }),
      ]),
    });
    db.collectionMocks.users!.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });

    const res = await get(`?clusterId=${clusterId.toString()}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.nodes).toHaveLength(3);
    expect(body.edges).toHaveLength(2);
    const fromSender1 = body.edges.find((e: { from: string }) => e.from === sender1.toHexString());
    const fromSender2 = body.edges.find((e: { from: string }) => e.from === sender2.toHexString());
    expect(fromSender1).toMatchObject({ to: recipient.toHexString(), totalAmount: 500 });
    expect(fromSender2).toMatchObject({ to: recipient.toHexString(), totalAmount: 700 });
  });

  it("annotates banned=true for a character node whose owning user is banned", async () => {
    await mockModerator(true);

    const userId = new ObjectId();
    const alice = new ObjectId();
    const bob = new ObjectId();
    const bobUserId = new ObjectId();

    db.collectionMocks.characters!.find.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([{ _id: alice, userId }]),
    });
    db.collectionMocks.financialTxLog!.find.mockReturnValue({
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        makeTxRow({
          subjectId: alice,
          amount: -1000,
          counterpartyType: "character",
          counterpartyId: bob,
          counterpartyName: "Bob",
        }),
      ]),
    });
    // Second call to characters.find is annotateBannedFlags resolving
    // character -> userId for the banned lookup.
    db.collectionMocks.characters!.find.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([
        { _id: alice, userId },
        { _id: bob, userId: bobUserId },
      ]),
    });
    db.collectionMocks.users!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: bobUserId, isBanned: true }]),
    });

    const res = await get(`?userId=${userId.toString()}`);
    const body = await res.json();

    const bobNode = body.nodes.find((n: { id: string }) => n.id === bob.toHexString());
    expect(bobNode.banned).toBe(true);
    const aliceNode = body.nodes.find((n: { id: string }) => n.id === alice.toHexString());
    expect(aliceNode.banned).toBe(false);
  });
});
