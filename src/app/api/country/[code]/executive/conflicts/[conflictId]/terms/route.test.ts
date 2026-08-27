import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/requirePeaceNegotiator", () => ({ requirePeaceNegotiator: vi.fn() }));

const { applyPeaceTerm, resolveConflict, getCountryState } = vi.hoisted(() => ({
  applyPeaceTerm: vi.fn(async (..._a: unknown[]) => {}),
  resolveConflict: vi.fn(async (..._a: unknown[]) => {}),
  getCountryState: vi.fn(async () => ({ governmentType: "presidential" })),
}));
vi.mock("@/lib/military/applyPeaceTerm", () => ({ applyPeaceTerm }));
vi.mock("@/lib/military/resolveConflict", () => ({ resolveConflict }));
vi.mock("@/lib/countryState", () => ({ getCountryState }));

const ACTOR = new ObjectId();
let db: MockDb;

/** A war UK has won outright, awaiting UK's terms against TR. */
const wonWar = {
  _id: "war1",
  status: "terms_pending",
  sideA: { label: "Turkey", countries: ["TR"], kind: "state" },
  sideB: { label: "United Kingdom", countries: ["UK"], kind: "state" },
  termsWindow: { victor: "B", imposer: "UK", target: "TR", closesTurn: 60 },
};

const req = (body: unknown) =>
  new Request("http://x/api/country/uk/executive/conflicts/war1/terms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const params = { params: Promise.resolve({ code: "uk", conflictId: "war1" }) };

const indemnity = { term: { kind: "indemnity", payer: "TR", amount: 100 } };

async function negotiator(ok: boolean) {
  const { requirePeaceNegotiator } = await import("@/lib/api/requirePeaceNegotiator");
  vi.mocked(requirePeaceNegotiator).mockResolvedValue(
    (ok
      ? { ok: true, via: "foreign_minister" }
      : {
          ok: false,
          response: new Response(JSON.stringify({ error: "no" }), { status: 403 }),
        }) as never
  );
}

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  for (const c of ["gameState", "conflicts", "federalBudget"]) db.collection(c);
  db.collectionMocks.gameState.findOne.mockResolvedValue({
    conflictsEnabled: true,
    currentTurn: 40,
  });
  db.collectionMocks.federalBudget.findOne.mockResolvedValue({ countryId: "TR", gdp: 1_000_000 });
  db.collectionMocks.conflicts.findOne.mockResolvedValue(wonWar);
  db.collectionMocks.conflicts.updateOne.mockResolvedValue({ modifiedCount: 1 });

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { isAdmin: false, character: { _id: ACTOR, name: "P" } },
  } as never);
  getCountryState.mockResolvedValue({ governmentType: "presidential" } as never);
  await negotiator(true);
});

describe("POST impose terms", () => {
  it("lets the winning principal's negotiator impose a term", async () => {
    const { POST } = await import("./route");
    expect((await POST(req(indemnity), params)).status).toBe(200);
    expect(applyPeaceTerm).toHaveBeenCalled();
    expect(resolveConflict).toHaveBeenCalled();
  });

  it("refuses anyone who does not hold a negotiator seat", async () => {
    await negotiator(false);
    const { POST } = await import("./route");
    expect((await POST(req(indemnity), params)).status).toBe(403);
    expect(applyPeaceTerm).not.toHaveBeenCalled();
  });

  it("refuses a country on the winning side that is NOT the principal", async () => {
    // The whole point of principal against principal: a coalition victory yields
    // one term, not one per ally.
    db.collectionMocks.conflicts.findOne.mockResolvedValue({
      ...wonWar,
      termsWindow: { ...wonWar.termsWindow, imposer: "US" },
    });
    const { POST } = await import("./route");
    const res = await POST(req(indemnity), params);
    expect(res.status).toBe(403);
    expect(applyPeaceTerm).not.toHaveBeenCalled();
  });

  it("refuses a war that is not awaiting terms", async () => {
    db.collectionMocks.conflicts.findOne.mockResolvedValue({ ...wonWar, status: "active" });
    const { POST } = await import("./route");
    expect((await POST(req(indemnity), params)).status).toBe(409);
  });

  it("404s a war that does not exist", async () => {
    db.collectionMocks.conflicts.findOne.mockResolvedValue(null);
    const { POST } = await import("./route");
    expect((await POST(req(indemnity), params)).status).toBe(404);
  });

  it("refuses a window that has already closed", async () => {
    // The sweeper runs on a tick, so a window can sit past its closing turn for a
    // while. A victor must not be able to impose inside that gap.
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      conflictsEnabled: true,
      currentTurn: 60,
    });
    const { POST } = await import("./route");
    expect((await POST(req(indemnity), params)).status).toBe(409);
    expect(applyPeaceTerm).not.toHaveBeenCalled();
  });

  it("refuses an indemnity above the payer's GDP ceiling", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ term: { kind: "indemnity", payer: "TR", amount: 1e15 } }), params);
    expect(res.status).toBe(400);
    expect(applyPeaceTerm).not.toHaveBeenCalled();
  });

  it("refuses a regime change that would change nothing", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      req({ term: { kind: "regime_change", targetSystem: "presidential" } }),
      params
    );
    expect(res.status).toBe(400);
  });

  it("refuses installing a monarchy at the schema, before the validator sees it", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      req({ term: { kind: "regime_change", targetSystem: "parliamentaryMonarchy" } }),
      params
    );
    expect(res.status).toBe(400);
  });

  it("accepts a regime change to a system the target does not have", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      req({ term: { kind: "regime_change", targetSystem: "onePartyState" } }),
      params
    );
    expect(res.status).toBe(200);
    expect(applyPeaceTerm).toHaveBeenCalled();
  });

  it("accepts a demilitarisation", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ term: { kind: "demilitarisation", turns: 240 } }), params);
    expect(res.status).toBe(200);
  });

  it("claims the war before applying, so a second request imposes nothing", async () => {
    db.collectionMocks.conflicts.updateOne.mockResolvedValue({ modifiedCount: 0 });
    const { POST } = await import("./route");
    expect((await POST(req(indemnity), params)).status).toBe(409);
    expect(applyPeaceTerm).not.toHaveBeenCalled();
  });

  it("stamps the settlement on the war, so the wire can report it", async () => {
    const { POST } = await import("./route");
    await POST(req(indemnity), params);
    const update = db.collectionMocks.conflicts.updateOne.mock.calls[0]![1];
    expect(update.$set.settlement).toMatchObject({
      path: "dictated",
      imposedBy: "UK",
      target: "TR",
    });
  });

  it("applies the term BEFORE resolving, so it lands while the war is still on record", async () => {
    const order: string[] = [];
    applyPeaceTerm.mockImplementationOnce(async () => {
      order.push("apply");
    });
    resolveConflict.mockImplementationOnce(async () => {
      order.push("resolve");
    });
    const { POST } = await import("./route");
    await POST(req(indemnity), params);
    expect(order).toEqual(["apply", "resolve"]);
  });

  it("404s when the conflicts subsystem is disabled", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: false });
    const { POST } = await import("./route");
    expect((await POST(req(indemnity), params)).status).toBe(404);
  });

  it("400s an invalid country code", async () => {
    const { POST } = await import("./route");
    const res = await POST(req(indemnity), {
      params: Promise.resolve({ code: "zz", conflictId: "war1" }),
    });
    expect(res.status).toBe(400);
  });

  it("accepts a white peace and resolves the war for nobody", async () => {
    // The victor is choosing to record that the war settled nothing, which is what
    // releases a question being fought over back to the diplomatic track.
    const { POST } = await import("./route");
    const res = await POST(req({ term: { kind: "white_peace" } }), params);
    expect(res.status).toBe(200);
    expect(resolveConflict).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "stalemate",
      40
    );
  });

  it("resolves for the victor on every other term", async () => {
    // Guards the check above from being vacuous.
    const { POST } = await import("./route");
    await POST(req(indemnity), params);
    expect(resolveConflict).toHaveBeenCalledWith(expect.anything(), expect.anything(), "B", 40);
  });
});
