import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/requirePeaceNegotiator", () => ({ requirePeaceNegotiator: vi.fn() }));

const acceptSpy = vi.fn().mockResolvedValue({ applied: true, resolved: false });
vi.mock("@/lib/military/acceptPeace", () => ({
  acceptPeace: (...a: unknown[]) => acceptSpy(...a),
}));

const ACTOR = new ObjectId();
const OFFER = new ObjectId();
let db: MockDb;

const conflict = {
  _id: "war1",
  status: "active",
  sideA: { label: "NATO", countries: ["US", "UK"], kind: "coalition" },
  sideB: { label: "PLA", countries: ["CN"], kind: "state" },
};

/** An offer FROM CN TO UK: UK answers it, CN withdraws it. */
const baseOffer = {
  _id: OFFER,
  conflictId: "war1",
  fromCountry: "CN",
  toCountry: "UK",
  // The original direction: the sender is the one leaving.
  leaver: "CN",
  term: { kind: "indemnity", payer: "CN", amount: 100 },
  status: "pending",
  offeredTurn: 1,
  expiresTurn: 999,
  offeredBy: "c0",
};

const req = (action: string) =>
  new Request("http://x/api/country/uk/executive/peace/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
const params = (code = "uk", offerId = OFFER.toString()) => ({
  params: Promise.resolve({ code, offerId }),
});

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  acceptSpy.mockResolvedValue({ applied: true, resolved: false });
  for (const c of ["gameState", "conflicts", "peaceOffers"]) db.collection(c);
  db.collectionMocks.gameState.findOne.mockResolvedValue({
    conflictsEnabled: true,
    currentTurn: 40,
  });
  db.collectionMocks.conflicts.findOne.mockResolvedValue(conflict);
  db.collectionMocks.peaceOffers.findOne.mockResolvedValue(baseOffer);
  db.collectionMocks.peaceOffers.updateOne.mockResolvedValue({ modifiedCount: 1 });

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { isAdmin: false, character: { _id: ACTOR, name: "P" } },
  } as never);
  const { requirePeaceNegotiator } = await import("@/lib/api/requirePeaceNegotiator");
  vi.mocked(requirePeaceNegotiator).mockResolvedValue({
    ok: true,
    via: "foreign_minister",
  } as never);
});

describe("accepting", () => {
  it("lets the country an offer was made to accept it", async () => {
    const { POST } = await import("./route");
    const res = await POST(req("accept"), params());
    expect(res.status).toBe(200);
    expect(acceptSpy).toHaveBeenCalled();
  });

  it("reports whether the war ended as a result", async () => {
    acceptSpy.mockResolvedValue({ applied: true, resolved: true });
    const { POST } = await import("./route");
    expect((await (await POST(req("accept"), params())).json()).warResolved).toBe(true);
  });

  it("refuses the OFFERER accepting their own offer", async () => {
    // The offer is CN→UK, so CN answering it would be accepting its own terms.
    const { POST } = await import("./route");
    const res = await POST(req("accept"), params("cn"));
    expect(res.status).toBe(403);
    expect(acceptSpy).not.toHaveBeenCalled();
  });

  it("409s on an offer whose window has passed, though the row says pending", async () => {
    // The lazy-expiry rule at the point it matters most.
    db.collectionMocks.peaceOffers.findOne.mockResolvedValue({ ...baseOffer, expiresTurn: 10 });
    const { POST } = await import("./route");
    expect((await POST(req("accept"), params())).status).toBe(409);
    expect(acceptSpy).not.toHaveBeenCalled();
  });

  it("409s exactly ON the expiry turn", async () => {
    db.collectionMocks.peaceOffers.findOne.mockResolvedValue({ ...baseOffer, expiresTurn: 40 });
    const { POST } = await import("./route");
    expect((await POST(req("accept"), params())).status).toBe(409);
  });

  it("accepts one turn before expiry", async () => {
    db.collectionMocks.peaceOffers.findOne.mockResolvedValue({ ...baseOffer, expiresTurn: 41 });
    const { POST } = await import("./route");
    expect((await POST(req("accept"), params())).status).toBe(200);
  });

  it("409s when the war resolved while the offer sat", async () => {
    // Revalidation at acceptance: an offer sits for turns while the world moves.
    db.collectionMocks.conflicts.findOne.mockResolvedValue({ ...conflict, status: "resolved" });
    const { POST } = await import("./route");
    expect((await POST(req("accept"), params())).status).toBe(409);
    expect(acceptSpy).not.toHaveBeenCalled();
  });

  it("409s when the other party already left the war", async () => {
    db.collectionMocks.conflicts.findOne.mockResolvedValue({
      ...conflict,
      sideB: { label: "PLA", countries: [], kind: "state" },
    });
    const { POST } = await import("./route");
    expect((await POST(req("accept"), params())).status).toBe(409);
    expect(acceptSpy).not.toHaveBeenCalled();
  });

  it("409s when the war record has vanished", async () => {
    db.collectionMocks.conflicts.findOne.mockResolvedValue(null);
    const { POST } = await import("./route");
    expect((await POST(req("accept"), params())).status).toBe(409);
  });

  it("409s when acceptPeace reports the offer was already claimed", async () => {
    // Two accepts raced; the loser must not report success.
    acceptSpy.mockResolvedValue({ applied: false, resolved: false });
    const { POST } = await import("./route");
    expect((await POST(req("accept"), params())).status).toBe(409);
  });
});

describe("rejecting and withdrawing", () => {
  it("lets the recipient reject", async () => {
    const { POST } = await import("./route");
    const res = await POST(req("reject"), params());
    expect(res.status).toBe(200);
    const [, update] = db.collectionMocks.peaceOffers.updateOne.mock.calls[0];
    expect(update.$set.status).toBe("rejected");
  });

  it("lets the OFFERER withdraw", async () => {
    const { POST } = await import("./route");
    const res = await POST(req("withdraw"), params("cn"));
    expect(res.status).toBe(200);
    const [, update] = db.collectionMocks.peaceOffers.updateOne.mock.calls[0];
    expect(update.$set.status).toBe("withdrawn");
  });

  it("refuses the RECIPIENT withdrawing an offer they did not make", async () => {
    const { POST } = await import("./route");
    expect((await POST(req("withdraw"), params("uk"))).status).toBe(403);
  });

  it("refuses the OFFERER rejecting their own offer", async () => {
    const { POST } = await import("./route");
    expect((await POST(req("reject"), params("cn"))).status).toBe(403);
  });

  it("guards the write on the offer still being pending", async () => {
    const { POST } = await import("./route");
    await POST(req("reject"), params());
    const [filter] = db.collectionMocks.peaceOffers.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: OFFER, status: "pending" });
  });

  it("409s when the row moved off pending first", async () => {
    db.collectionMocks.peaceOffers.updateOne.mockResolvedValue({ modifiedCount: 0 });
    const { POST } = await import("./route");
    expect((await POST(req("reject"), params())).status).toBe(409);
  });

  it("records who answered and when", async () => {
    const { POST } = await import("./route");
    await POST(req("reject"), params());
    const [, update] = db.collectionMocks.peaceOffers.updateOne.mock.calls[0];
    expect(update.$set.resolvedBy).toBe(ACTOR.toString());
    expect(update.$set.resolvedTurn).toBe(40);
  });
});

describe("refusals", () => {
  it("403s a viewer who is not a negotiator", async () => {
    const { requirePeaceNegotiator } = await import("@/lib/api/requirePeaceNegotiator");
    vi.mocked(requirePeaceNegotiator).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "no" }), { status: 403 }),
    } as never);
    const { POST } = await import("./route");
    expect((await POST(req("accept"), params())).status).toBe(403);
  });

  it("404s an offer id that is not an ObjectId", async () => {
    // Constructing one would throw; this must be a clean 404 instead of a 500.
    const { POST } = await import("./route");
    expect((await POST(req("accept"), params("uk", "not-an-id"))).status).toBe(404);
  });

  it("404s an offer that does not exist", async () => {
    db.collectionMocks.peaceOffers.findOne.mockResolvedValue(null);
    const { POST } = await import("./route");
    expect((await POST(req("accept"), params())).status).toBe(404);
  });

  it("400s an unknown action", async () => {
    const { POST } = await import("./route");
    expect((await POST(req("surrender"), params())).status).toBe(400);
  });

  it("404s when the conflicts subsystem is off", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: false });
    const { POST } = await import("./route");
    expect((await POST(req("accept"), params())).status).toBe(404);
  });
});

describe("who may answer", () => {
  it("lets the head of government accept while a minister holds the seat", async () => {
    const { requirePeaceNegotiator } = await import("@/lib/api/requirePeaceNegotiator");
    vi.mocked(requirePeaceNegotiator).mockResolvedValue({
      ok: true,
      via: "head_of_government",
    } as never);
    const { POST } = await import("./route");
    expect((await POST(req("accept"), params())).status).toBe(200);
  });
});
