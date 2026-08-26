import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";
import {
  SETTLEMENT_INSTITUTIONS,
  SETTLEMENT_WIRE_INTERVAL_TURNS,
} from "@/lib/constants/settlementCrisis";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/settlement/openCrisis", async (original) => {
  const actual = await original<typeof import("@/lib/settlement/openCrisis")>();
  return { ...actual, openSettlementCrisis: vi.fn() };
});
vi.mock("@/lib/settlement/closeCrisis", () => ({ closeSettlementCrisis: vi.fn() }));

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
    const { closeSettlementCrisis } = await import("@/lib/settlement/closeCrisis");
    vi.mocked(closeSettlementCrisis).mockResolvedValue({
      closed: true,
      reason: null,
      orphanedConflictId: null,
    });
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
    expect(body).toMatchObject({ enabled: true, currentTurn: 412, crisis: null });
  });

  it("tells the operator when the next World News briefing is due", async () => {
    // Without this an admin cannot tell whether the wire is running short of
    // going and reading the channel.
    prime(db, "settlementCrises").findOne.mockResolvedValue(
      liveCrisis({ openedTurn: 400, lastBriefing: { turn: 406, position: 4400 } })
    );
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    // Off the LAST BRIEFING, and derived from the constant rather than frozen:
    // the cadence is a dial and a retune must not read as a broken route.
    expect(body.crisis.nextBriefingTurn).toBe(406 + SETTLEMENT_WIRE_INTERVAL_TURNS);
  });

  it("counts the briefing cadence from the opening when none has been filed", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(liveCrisis({ openedTurn: 400 }));
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    // Off the OPENING, since no briefing has been filed yet.
    expect(body.crisis.nextBriefingTurn).toBe(400 + SETTLEMENT_WIRE_INTERVAL_TURNS);
    expect(body.crisis.postedWireEvents).toEqual([]);
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

  it("opens the question at the current turn, with no options to pass", async () => {
    const { openSettlementCrisis } = await import("@/lib/settlement/openCrisis");
    vi.mocked(openSettlementCrisis).mockResolvedValue({
      opened: true,
      reason: null,
      crisisId: CRISIS_ID.toString(),
    });
    const { POST } = await import("./route");
    const res = await POST(post({ action: "open" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(openSettlementCrisis).mock.calls[0][1]).toEqual({ turn: 412 });
  });

  it("passes the opener's own reason back when it declines", async () => {
    const { openSettlementCrisis } = await import("@/lib/settlement/openCrisis");
    vi.mocked(openSettlementCrisis).mockResolvedValue({
      opened: false,
      reason: "A settlement crisis is already live.",
      crisisId: null,
    });
    const { POST } = await import("./route");
    const res = await POST(post({ action: "open" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("already live");
  });

  it("has no force escape hatch — a stale `force` flag changes nothing", async () => {
    // There is no era gate or cooldown left to force past, so the schema takes
    // no options and the opener's refusal stands however the caller asks.
    const { openSettlementCrisis } = await import("@/lib/settlement/openCrisis");
    vi.mocked(openSettlementCrisis).mockResolvedValue({
      opened: false,
      reason: "A settlement crisis is already live.",
      crisisId: null,
    });
    const { POST } = await import("./route");
    expect((await POST(post({ action: "open", force: true }))).status).toBe(409);
    expect(vi.mocked(openSettlementCrisis).mock.calls[0][1]).toEqual({ turn: 412 });
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

  it("gives an attached war its own name back when the outcome is forced", async () => {
    // Forcing an outcome ENDS the attachment. Leaving the marks on would keep a
    // US-East Germany war called "The War for Germany" with the question over.
    prime(db, "settlementCrises").findOne.mockResolvedValue(
      liveCrisis({
        status: "frozen",
        conflictId: "war_us_dd_412",
        conflictAttachment: {
          anchor: "DD",
          previousName: "United States vs East Germany",
          previousHostEntities: null,
        },
      })
    );
    prime(db, "conflicts").updateOne.mockResolvedValue({ matchedCount: 1 });
    const { POST } = await import("./route");
    expect((await POST(post({ action: "resolve", outcome: "challenger" }))).status).toBe(200);

    const [, update] = prime(db, "conflicts").updateOne.mock.calls[0];
    expect(update.$set.name).toBe("United States vs East Germany");
    expect(update.$unset).toEqual({ hostEntities: "" });
  });

  it("leaves a war the crisis DECLARED alone when the outcome is forced", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(
      liveCrisis({ status: "frozen", conflictId: "gq_de_400" })
    );
    const { POST } = await import("./route");
    expect((await POST(post({ action: "resolve", outcome: "incumbent" }))).status).toBe(200);
    expect(prime(db, "conflicts").updateOne).not.toHaveBeenCalled();
  });

  it("does not touch the war when the forced resolve lost its race", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(
      liveCrisis({
        status: "frozen",
        conflictId: "war_us_dd_412",
        conflictAttachment: {
          anchor: "DD",
          previousName: "United States vs East Germany",
          previousHostEntities: null,
        },
      })
    );
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 0 });
    const { POST } = await import("./route");
    expect((await POST(post({ action: "resolve", outcome: "incumbent" }))).status).toBe(409);
    expect(prime(db, "conflicts").updateOne).not.toHaveBeenCalled();
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
  it("closes the live question at the current turn", async () => {
    const { POST } = await import("./route");
    const res = await POST(post({ action: "close" }));
    expect(res.status).toBe(200);
    const { closeSettlementCrisis } = await import("@/lib/settlement/closeCrisis");
    expect(vi.mocked(closeSettlementCrisis).mock.calls[0][1]).toEqual({ turn: 412 });
  });

  it("passes the closer's own reason back when it declines", async () => {
    const { closeSettlementCrisis } = await import("@/lib/settlement/closeCrisis");
    vi.mocked(closeSettlementCrisis).mockResolvedValue({
      closed: false,
      reason: "No settlement crisis is live.",
      orphanedConflictId: null,
    });
    const { POST } = await import("./route");
    const res = await POST(post({ action: "close" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("No settlement crisis is live");
  });

  it("names the war a closed frozen crisis leaves running", async () => {
    // Silently orphaning a live conflict is exactly the failure the note exists
    // to prevent.
    const { closeSettlementCrisis } = await import("@/lib/settlement/closeCrisis");
    vi.mocked(closeSettlementCrisis).mockResolvedValue({
      closed: true,
      reason: null,
      orphanedConflictId: "gq_de_400",
    });
    const { POST } = await import("./route");
    const body = await (await POST(post({ action: "close" }))).json();
    expect(body.note).toContain("gq_de_400");
    expect(body.note).toContain("Conflicts board");
  });

  it("does not route close through the resolve path", async () => {
    // A close that wrote an outcome would merge two countries a turn later.
    const { POST } = await import("./route");
    await POST(post({ action: "close" }));
    expect(prime(db, "settlementCrises").updateOne).not.toHaveBeenCalled();
  });

  it("lists cancelled questions in the history alongside resolved ones", async () => {
    prime(db, "settlementCrises").find.mockReturnValue(
      cursor([
        {
          _id: CRISIS_ID,
          status: "cancelled",
          outcome: null,
          resolvedTurn: 400,
          cooldownUntilTurn: null,
        },
      ])
    );
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body.history[0]).toMatchObject({ status: "cancelled", outcome: null });
    const [filter] = prime(db, "settlementCrises").find.mock.calls[0];
    expect(filter.status).toEqual({ $in: ["resolved", "cancelled"] });
  });
});
