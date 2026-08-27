import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { PEACE_OFFER_DURATION_TURNS } from "@/lib/db/types/peaceOffer";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/requirePeaceNegotiator", () => ({ requirePeaceNegotiator: vi.fn() }));
// Mocked rather than embedding a real slur in the repo. What matters here is that
// the justification is run through the filter at all, not what the filter contains.
vi.mock("@/lib/moderation", () => ({
  containsSlur: (v: string) => v.includes("BLOCKED"),
  containsBlockedName: () => false,
}));

const ACTOR = new ObjectId();
let db: MockDb;

const conflict = {
  _id: "war1",
  status: "active",
  sideA: { label: "NATO", countries: ["US", "UK"], kind: "coalition" },
  sideB: { label: "PLA", countries: ["CN"], kind: "state" },
};

const req = (body: unknown) =>
  new Request("http://x/api/country/uk/executive/peace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const getReq = () => new Request("http://x/api/country/uk/executive/peace");
const params = { params: Promise.resolve({ code: "uk" }) };

const good = {
  conflictId: "war1",
  toCountry: "CN",
  term: { kind: "indemnity", payer: "UK", amount: 100 },
};

/** Allow or refuse the negotiator gate, optionally naming which office authorized. */
async function negotiator(
  ok: boolean,
  via: "head_of_government" | "foreign_minister" = "foreign_minister"
) {
  const { requirePeaceNegotiator } = await import("@/lib/api/requirePeaceNegotiator");
  vi.mocked(requirePeaceNegotiator).mockResolvedValue(
    (ok
      ? { ok: true, via }
      : {
          ok: false,
          response: new Response(JSON.stringify({ error: "no" }), { status: 403 }),
        }) as never
  );
}

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  for (const c of ["gameState", "conflicts", "peaceOffers", "federalBudget"]) db.collection(c);
  db.collectionMocks.gameState.findOne.mockResolvedValue({
    conflictsEnabled: true,
    currentTurn: 40,
  });
  // The payer's GDP anchors the indemnity ceiling. Ample here so the small
  // amounts these cases use pass; the cap itself is unit-tested in peaceOffer.test.
  db.collectionMocks.federalBudget.findOne.mockResolvedValue({ countryId: "UK", gdp: 1_000_000 });
  db.collectionMocks.conflicts.findOne.mockResolvedValue(conflict);
  db.collectionMocks.conflicts.find.mockReturnValue({ toArray: async () => [conflict] });
  // No offer already open, in either the find (live-offer scan) or list path.
  db.collectionMocks.peaceOffers.find.mockReturnValue({
    toArray: async () => [],
    sort: () => ({ toArray: async () => [] }),
  });
  db.collectionMocks.peaceOffers.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { isAdmin: false, character: { _id: ACTOR, name: "P" } },
  } as never);
  await negotiator(true);
});

describe("POST offer", () => {
  it("lets the negotiator make an offer", async () => {
    const { POST } = await import("./route");
    expect((await POST(req(good), params)).status).toBe(200);
    expect(db.collectionMocks.peaceOffers.insertOne).toHaveBeenCalled();
  });

  it("refuses anyone who is not the foreign minister or head of government", async () => {
    await negotiator(false);
    const { POST } = await import("./route");
    expect((await POST(req(good), params)).status).toBe(403);
    expect(db.collectionMocks.peaceOffers.insertOne).not.toHaveBeenCalled();
  });

  it("stamps the fixed 72-turn window rather than trusting the client", async () => {
    const { POST } = await import("./route");
    await POST(req({ ...good, expiresTurn: 9999 }), params);
    const doc = db.collectionMocks.peaceOffers.insertOne.mock.calls[0][0];
    expect(doc.offeredTurn).toBe(40);
    expect(doc.expiresTurn).toBe(40 + PEACE_OFFER_DURATION_TURNS);
  });

  it("records who made the offer", async () => {
    const { POST } = await import("./route");
    await POST(req(good), params);
    const doc = db.collectionMocks.peaceOffers.insertOne.mock.calls[0][0];
    expect(doc.offeredBy).toBe(ACTOR.toString());
    expect(doc.status).toBe("pending");
  });

  it("uppercases the target and payer, so a lowercase body still matches rosters", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      req({ ...good, toCountry: "cn", term: { kind: "indemnity", payer: "uk", amount: 5 } }),
      params
    );
    expect(res.status).toBe(200);
    const doc = db.collectionMocks.peaceOffers.insertOne.mock.calls[0][0];
    expect(doc.toCountry).toBe("CN");
    expect((doc.term as { payer: string }).payer).toBe("UK");
  });

  it("refuses an offer to a country on the same side", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ ...good, toCountry: "US" }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/same side/i);
  });

  it("refuses a negative indemnity at the schema", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      req({ ...good, term: { kind: "indemnity", payer: "UK", amount: -5 } }),
      params
    );
    expect(res.status).toBe(400);
  });

  it("refuses an indemnity above the payer's GDP-share ceiling", async () => {
    // 2x GDP is the cap; 1e15 against a 1,000,000 GDP is far past it. Pre-fix this
    // was accepted and drained the payer treasury on accept.
    const { POST } = await import("./route");
    const res = await POST(
      req({ ...good, term: { kind: "indemnity", payer: "UK", amount: 1e15 } }),
      params
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/GDP/i);
    expect(db.collectionMocks.peaceOffers.insertOne).not.toHaveBeenCalled();
  });

  it("refuses an offer when the payer has no GDP on record", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(req(good), params);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.peaceOffers.insertOne).not.toHaveBeenCalled();
  });

  it("refuses a justification containing prohibited language", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ ...good, justification: "a BLOCKED word" }), params);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.peaceOffers.insertOne).not.toHaveBeenCalled();
  });

  it("carries a clean justification onto the document", async () => {
    const { POST } = await import("./route");
    await POST(req({ ...good, justification: "We seek an honourable settlement." }), params);
    const doc = db.collectionMocks.peaceOffers.insertOne.mock.calls[0][0];
    expect(doc.justification).toBe("We seek an honourable settlement.");
  });

  it("refuses a second live offer to the same country", async () => {
    db.collectionMocks.peaceOffers.find.mockReturnValue({
      toArray: async () => [{ status: "pending", expiresTurn: 999 }],
      sort: () => ({ toArray: async () => [] }),
    });
    const { POST } = await import("./route");
    const res = await POST(req(good), params);
    expect(res.status).toBe(409);
  });

  it("ALLOWS a new offer when the previous one has lapsed", async () => {
    // Lazy expiry: the stored row still says pending, but its window has passed.
    db.collectionMocks.peaceOffers.find.mockReturnValue({
      toArray: async () => [{ status: "pending", expiresTurn: 10 }],
      sort: () => ({ toArray: async () => [] }),
    });
    const { POST } = await import("./route");
    expect((await POST(req(good), params)).status).toBe(200);
  });

  it("404s when the war does not exist", async () => {
    db.collectionMocks.conflicts.findOne.mockResolvedValue(null);
    const { POST } = await import("./route");
    expect((await POST(req(good), params)).status).toBe(404);
  });

  it("404s when the conflicts subsystem is off", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: false });
    const { POST } = await import("./route");
    expect((await POST(req(good), params)).status).toBe(404);
  });

  it("400s on an unknown country code", async () => {
    const { POST } = await import("./route");
    const res = await POST(req(good), { params: Promise.resolve({ code: "zz" }) });
    expect(res.status).toBe(400);
  });
});

describe("GET offers", () => {
  const rows = [
    {
      _id: new ObjectId(),
      conflictId: "war1",
      fromCountry: "CN",
      toCountry: "UK",
      term: { kind: "indemnity", payer: "CN", amount: 10 },
      status: "pending",
      offeredTurn: 1,
      expiresTurn: 999,
    },
    {
      _id: new ObjectId(),
      conflictId: "war1",
      fromCountry: "UK",
      toCountry: "CN",
      term: { kind: "indemnity", payer: "UK", amount: 20 },
      status: "pending",
      offeredTurn: 1,
      expiresTurn: 5,
    },
  ];

  beforeEach(() => {
    db.collectionMocks.peaceOffers.find.mockReturnValue({
      toArray: async () => rows,
      sort: () => ({ toArray: async () => rows }),
    });
  });

  it("lists the wars this country is fighting, with its enemies", async () => {
    const { GET } = await import("./route");
    const body = await (await GET(getReq(), params)).json();
    expect(body.wars).toHaveLength(1);
    expect(body.wars[0].conflictId).toBe("war1");
    // Each enemy now carries the withdrawal gate's verdict alongside its id, so the
    // form can say what may be asked of them before an offer is composed.
    expect(body.wars[0].enemies.map((e: { country: string }) => e.country)).toEqual(["CN"]);
  });

  it("does NOT offer an ally as a country to negotiate with", async () => {
    // US is on side A alongside UK. Offering it terms would be nonsense.
    const { GET } = await import("./route");
    const body = await (await GET(getReq(), params)).json();
    expect(body.wars[0].enemies).not.toContain("US");
  });

  it("omits a war the country only HOSTS without fighting in it", async () => {
    // listConflictsForCountry also matches hostCountry, and a host that is not a
    // belligerent has nothing to negotiate.
    db.collectionMocks.conflicts.find.mockReturnValue({
      toArray: async () => [
        {
          _id: "elsewhere",
          status: "active",
          hostCountry: "UK",
          sideA: { label: "A", countries: ["US"], kind: "state" },
          sideB: { label: "B", countries: ["CN"], kind: "state" },
        },
      ],
    });
    const { GET } = await import("./route");
    const body = await (await GET(getReq(), params)).json();
    expect(body.wars).toEqual([]);
  });

  it("offers nobody when the enemy is a generated force", async () => {
    db.collectionMocks.conflicts.find.mockReturnValue({
      toArray: async () => [
        {
          _id: "war1",
          status: "active",
          sideA: { label: "Gov", countries: ["UK"], kind: "state" },
          sideB: { label: "Rebels", countries: [], kind: "generated" },
        },
      ],
    });
    const { GET } = await import("./route");
    const body = await (await GET(getReq(), params)).json();
    expect(body.wars[0].enemies).toEqual([]);
  });

  it("marks an offer made TO this country as incoming", async () => {
    const { GET } = await import("./route");
    const body = await (await GET(getReq(), params)).json();
    expect(body.offers[0].incoming).toBe(true);
    expect(body.offers[1].incoming).toBe(false);
  });

  it("reports a lapsed offer as expired even though the row says pending", async () => {
    const { GET } = await import("./route");
    const body = await (await GET(getReq(), params)).json();
    expect(body.offers[0].status).toBe("pending");
    expect(body.offers[1].status).toBe("expired");
  });

  it("converges the stale row so it stops saying pending", async () => {
    const { GET } = await import("./route");
    await GET(getReq(), params);
    expect(db.collectionMocks.peaceOffers.updateMany).toHaveBeenCalled();
  });

  it("refuses a viewer who is not a negotiator", async () => {
    await negotiator(false);
    const { GET } = await import("./route");
    expect((await GET(getReq(), params)).status).toBe(403);
  });
});

describe("who may negotiate", () => {
  it("lets the head of government offer peace while a minister holds the seat", async () => {
    // Previously a 403: requireForeignMinister gave the seated minister exclusivity.
    await negotiator(true, "head_of_government");
    const { POST } = await import("./route");
    expect((await POST(req(good), params)).status).toBe(200);
  });

  it("still lets the foreign minister offer peace", async () => {
    await negotiator(true, "foreign_minister");
    const { POST } = await import("./route");
    expect((await POST(req(good), params)).status).toBe(200);
  });
});

describe("which party the deal removes", () => {
  it("defaults to the sender leaving, so an existing client is unchanged", async () => {
    const { POST } = await import("./route");
    expect((await POST(req(good), params)).status).toBe(200);
    const doc = db.collectionMocks.peaceOffers.insertOne.mock.calls[0][0];
    expect(doc.leaver).toBe("UK");
  });

  it("records the recipient as the leaver when asked to withdraw", async () => {
    // Side B must survive the departure, or this is a buy-out and the gate refuses
    // it: the default fixture has CN alone on its side.
    db.collectionMocks.conflicts.findOne.mockResolvedValue({
      ...conflict,
      sideB: { label: "PLA", countries: ["CN", "RU"], kind: "coalition" },
    });
    const { POST } = await import("./route");
    const res = await POST(req({ ...good, leaver: "them" }), params);
    expect(res.status).toBe(200);
    const doc = db.collectionMocks.peaceOffers.insertOne.mock.calls[0][0];
    expect(doc.leaver).toBe("CN");
  });

  it("refuses a withdrawal that would end the war from a standing start", () => {
    // CN alone on its side, so its departure empties it and simply buys the war.
    return (async () => {
      const { POST } = await import("./route");
      const res = await POST(req({ ...good, leaver: "them" }), params);
      expect(res.status).toBe(400);
    })();
  });

  it("allows that same withdrawal as a white peace", () => {
    // No victor is recorded, so nothing is bought.
    return (async () => {
      const { POST } = await import("./route");
      const res = await POST(
        req({ ...good, leaver: "them", term: { kind: "white_peace" } }),
        params
      );
      expect(res.status).toBe(200);
    })();
  });

  it("refuses an unknown direction at the schema", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ ...good, leaver: "somebody-else" }), params);
    expect(res.status).toBe(400);
  });
});

describe("GET tells the form what it may ask for", () => {
  it("marks an enemy whose departure would end the war", async () => {
    // CN is alone on its side in the fixture, so asking it to leave empties the side.
    // Computed by the same `withdrawalGate` the POST runs, so the form and the route
    // cannot disagree about what is allowed.
    db.collectionMocks.conflicts.find.mockReturnValue({
      toArray: async () => [{ ...conflict, control: 50, controlStart: 50 }],
    });
    const { GET } = await import("./route");
    const body = await (await GET(getReq(), params)).json();
    const cn = body.wars[0].enemies.find((e: { country: string }) => e.country === "CN");
    expect(cn).toMatchObject({ endsWar: true, withdrawalBlocked: true, requiredPct: 75 });
  });

  it("clears the block once the front is deep enough", async () => {
    // Side A (US, UK) wins as control falls toward 0.
    db.collectionMocks.conflicts.find.mockReturnValue({
      toArray: async () => [{ ...conflict, control: 10, controlStart: 100 }],
    });
    const { GET } = await import("./route");
    const body = await (await GET(getReq(), params)).json();
    const cn = body.wars[0].enemies.find((e: { country: string }) => e.country === "CN");
    expect(cn).toMatchObject({ endsWar: true, withdrawalBlocked: false });
    expect(cn.progressPct).toBeGreaterThanOrEqual(75);
  });
});
