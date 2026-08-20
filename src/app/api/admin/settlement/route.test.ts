import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";
import { SETTLEMENT_INSTITUTIONS } from "@/lib/constants/settlementCrisis";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/settlement/openCrisis", async (original) => {
  const actual = await original<typeof import("@/lib/settlement/openCrisis")>();
  return { ...actual, openSettlementCrisisIfDue: vi.fn() };
});

const CRISIS_ID = new ObjectId();

function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

function cursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
}

function liveCrisis(over: Record<string, unknown> = {}) {
  return {
    _id: CRISIS_ID,
    kind: "settlement.germanQuestion",
    status: "open",
    position: 3820,
    ladder: { heat: 2, armedTurn: null },
    openedTurn: 12,
    conflictId: null,
    institutions: SETTLEMENT_INSTITUTIONS.map((i) => ({
      id: i.id,
      weight: i.weight,
      position: i.opening,
      lastPlay: null,
      lastDrift: 0,
    })),
    ...over,
  };
}

function post(body: unknown) {
  return new Request("http://localhost/api/admin/settlement", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/admin/settlement", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { userId: new ObjectId().toString(), username: "admin" },
    } as never);
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({
      _id: "current",
      currentTurn: 412,
      currentYear: 1953,
      settlementCrisisEnabled: true,
    } as never);
    prime(db, "settlementCrises").findOne.mockResolvedValue(null);
    prime(db, "settlementCrises").find.mockReturnValue(cursor([]));
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 1 });
    prime(db, "settlementCrises").insertOne.mockResolvedValue({ insertedId: CRISIS_ID });
  });

  it("refuses a caller who is not an admin", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 403 }),
    } as never);
    const { GET } = await import("./route");
    expect((await GET()).status).toBe(403);
  });

  it("reports the gate, the era and no crisis when none is live", async () => {
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body).toMatchObject({ enabled: true, currentTurn: 412, year: 1953, crisis: null });
  });

  it("reports the live board with its rules resolved", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(liveCrisis());
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body.crisis.rules).toEqual({
      openLog: true,
      driftRevealed: false,
      escalationEnabled: true,
    });
    expect(body.crisis.institutions).toHaveLength(SETTLEMENT_INSTITUTIONS.length);
  });

  it("routes an unforced open through the same gate the turn phase uses", async () => {
    const { openSettlementCrisisIfDue } = await import("@/lib/settlement/openCrisis");
    vi.mocked(openSettlementCrisisIfDue).mockResolvedValue({
      opened: true,
      reason: null,
      crisisId: CRISIS_ID.toString(),
    });
    const { POST } = await import("./route");
    const res = await POST(post({ action: "open", force: false }));
    expect(res.status).toBe(200);
    expect(vi.mocked(openSettlementCrisisIfDue).mock.calls[0][1]).toEqual({
      turn: 412,
      year: 1953,
    });
  });

  it("passes the gate's own reason back when it declines", async () => {
    const { openSettlementCrisisIfDue } = await import("@/lib/settlement/openCrisis");
    vi.mocked(openSettlementCrisisIfDue).mockResolvedValue({
      opened: false,
      reason: "cooling down until turn 500",
      crisisId: null,
    });
    const { POST } = await import("./route");
    const res = await POST(post({ action: "open", force: false }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("cooling down");
  });

  it("force-opens past the era gate", async () => {
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({
      _id: "current",
      currentTurn: 412,
      currentYear: 2019,
    } as never);
    const { POST } = await import("./route");
    const res = await POST(post({ action: "open", force: true }));
    expect(res.status).toBe(200);
    expect(prime(db, "settlementCrises").insertOne).toHaveBeenCalled();
  });

  it("refuses a forced open while one is already live", async () => {
    // Two live crises would both tick.
    prime(db, "settlementCrises").findOne.mockResolvedValue(liveCrisis());
    const { POST } = await import("./route");
    const res = await POST(post({ action: "open", force: true }));
    expect(res.status).toBe(409);
    expect(prime(db, "settlementCrises").insertOne).not.toHaveBeenCalled();
  });

  it("flips one rule without touching the other two", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(liveCrisis());
    const { POST } = await import("./route");
    await POST(post({ action: "setRule", key: "driftRevealed", value: true }));
    const [, update] = prime(db, "settlementCrises").updateOne.mock.calls[0];
    expect(update.$set["rules.driftRevealed"]).toBe(true);
    expect(Object.keys(update.$set)).not.toContain("rules");
  });

  it("rejects a rule key that is not one of the three", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(liveCrisis());
    const { POST } = await import("./route");
    expect((await POST(post({ action: "setRule", key: "wideOpen", value: true }))).status).toBe(
      400
    );
  });

  it("derives the index when an institution is set, never writing it directly", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(liveCrisis());
    const { POST } = await import("./route");
    const res = await POST(post({ action: "setPosition", institutionId: "street", points: 90 }));
    expect(res.status).toBe(200);
    const [, update] = prime(db, "settlementCrises").updateOne.mock.calls[0];
    const street = update.$set.institutions.find((i: { id: string }) => i.id === "street");
    expect(street.position).toBe(9000);
    // 3x43 + 2x37 + 2x90 + 3x19 = 129 + 74 + 180 + 57 = 440, over weight 10.
    expect(update.$set.position).toBe(4400);
  });

  it("rejects a position outside 0-100", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(liveCrisis());
    const { POST } = await import("./route");
    expect(
      (await POST(post({ action: "setPosition", institutionId: "street", points: 140 }))).status
    ).toBe(400);
  });

  it("writes a forced outcome but leaves actuation to the turn phase", async () => {
    // A null cooldown IS the marker the actuation sweep looks for. Enacting the
    // merge here would be a second write path into `mergeCountry`.
    prime(db, "settlementCrises").findOne.mockResolvedValue(liveCrisis());
    const { POST } = await import("./route");
    const res = await POST(post({ action: "resolve", outcome: "challenger" }));
    expect(res.status).toBe(200);
    const [, update] = prime(db, "settlementCrises").updateOne.mock.calls[0];
    expect(update.$set).toMatchObject({
      status: "resolved",
      outcome: "challenger",
      resolvedTurn: 412,
      cooldownUntilTurn: null,
    });
  });

  it("refuses every action but open when no crisis is live", async () => {
    const { POST } = await import("./route");
    for (const body of [
      { action: "resolve", outcome: "incumbent" },
      { action: "setRule", key: "openLog", value: false },
      { action: "setPosition", institutionId: "street", points: 50 },
    ]) {
      expect((await POST(post(body))).status).toBe(404);
    }
  });

  it("reports a resolve that lost its race rather than claiming success", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(liveCrisis());
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 0 });
    const { POST } = await import("./route");
    expect((await POST(post({ action: "resolve", outcome: "incumbent" }))).status).toBe(409);
  });
});
