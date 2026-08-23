import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { BILL_PROPOSE_ACTION_COST } from "@shared/constants/legislation";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/countryAccess", () => ({
  isCountryEnabledForPlayers: vi.fn().mockResolvedValue(true),
}));

const hogSpy = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/api/headOfGovernment", () => ({
  getHeadOfGovernmentCharacterId: (...a: unknown[]) => hogSpy(...a),
}));

const HOG = new ObjectId();
const DEFENCE = new ObjectId();
const BACKBENCHER = new ObjectId();

let db: MockDb;

/**
 * Seat the country's government. HOG always holds the premiership; only the defence
 * case seats a minister, so authenticating as anyone else exercises the refusal.
 */
function seat(as: "hog" | "defence" | "none") {
  // The route resolves the leader through getHeadOfGovernmentCharacterId, which
  // branches on government type — NOT through governmentFormations directly. The
  // collection mock stays for any other reader; the spy is what the route sees.
  hogSpy.mockResolvedValue(HOG);
  db.collectionMocks.governmentFormations.findOne.mockResolvedValue({
    _id: "US",
    pmCharacterId: HOG,
  });
  db.collectionMocks.cabinetMembers.findOne.mockResolvedValue(
    as === "defence" ? { characterId: DEFENCE, positionId: "secretary_of_defense" } : null
  );
}

/**
 * Seat `countries` in `orgId` on the live roll the alliance bar reads.
 *
 * The preset is stamped alongside because the roll is keyed on it, never on the live
 * year: only a 1953 world has a Warsaw Pact to be barred by.
 */
function allyRoll(orgId: string, countries: string[]) {
  db.collectionMocks.gameState.findOne.mockResolvedValue({
    conflictsEnabled: true,
    currentTurn: 40,
    preset: "1953-default",
  });
  db.collectionMocks.organizationMemberships.find.mockReturnValue({
    toArray: async () => countries.map((countryId) => ({ organizationId: orgId, countryId })),
  });
}

async function authAs(id: ObjectId) {
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { isAdmin: false, character: { _id: id, name: "P", party: null } },
  } as never);
}

const req = (body: unknown) =>
  new Request("http://x/api/country/us/executive/declare-war", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const params = { params: Promise.resolve({ code: "us" }) };
const good = { targetCountry: "CN", warGoal: "punitive" };

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  for (const c of [
    "gameState",
    "governmentFormations",
    "cabinetMembers",
    "bills",
    "conflicts",
    "characters",
    "organizationMemberships",
  ]) {
    db.collection(c);
  }
  db.collectionMocks.gameState.findOne.mockResolvedValue({
    conflictsEnabled: true,
    currentTurn: 40,
  });
  db.collectionMocks.conflicts.findOne.mockResolvedValue(null);
  db.collectionMocks.bills.findOne.mockResolvedValue(null);
  // No prior declaration, so the cooldown never bites in the default fixture.
  db.collectionMocks.bills.find.mockReturnValue({
    sort: () => ({ limit: () => ({ toArray: async () => [] }) }),
  });
  db.collectionMocks.bills.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
  // Solvent by default, so only the tests that care about the action cost pay it any
  // attention. Filing costs BILL_PROPOSE_ACTION_COST like any other bill.
  db.collectionMocks.characters.findOne.mockResolvedValue({ actions: 99 });
  db.collectionMocks.characters.updateOne.mockResolvedValue({ modifiedCount: 1 });
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  // clearAllMocks resets calls but NOT implementations set with mockResolvedValue,
  // so a test that disables a country would otherwise leak into the next one.
  const { isCountryEnabledForPlayers } = await import("@/lib/countryAccess");
  vi.mocked(isCountryEnabledForPlayers).mockResolvedValue(true);
  // clearAllMocks resets calls but NOT implementations, so this must be re-armed
  // or a test that seats a leader would leak into the next one.
  hogSpy.mockResolvedValue(null);
});

describe("POST declare-war", () => {
  it("lets the head of government declare war", async () => {
    seat("hog");
    await authAs(HOG);
    const { POST } = await import("./route");
    const res = await POST(req(good), params);
    expect(res.status).toBe(200);
    expect(db.collectionMocks.bills.insertOne).toHaveBeenCalled();
  });

  it("lets the defence minister declare war", async () => {
    seat("defence");
    await authAs(DEFENCE);
    const { POST } = await import("./route");
    expect((await POST(req(good), params)).status).toBe(200);
  });

  it("refuses an ordinary legislator", async () => {
    seat("none");
    await authAs(BACKBENCHER);
    const { POST } = await import("./route");
    const res = await POST(req(good), params);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/head of government|defence/i);
  });

  it("files a bill the chambers must ratify, not an instant war", async () => {
    seat("hog");
    await authAs(HOG);
    const { POST } = await import("./route");
    await POST(req(good), params);
    const bill = db.collectionMocks.bills.insertOne.mock.calls[0][0] as {
      status: string;
      provisions: Array<{ type: string; targetCountry: string; warGoal: string }>;
    };
    expect(bill.status).toBe("active");
    expect(bill.provisions[0]).toMatchObject({
      type: "declare_war",
      targetCountry: "CN",
      warGoal: "punitive",
    });
  });

  // End to end through the real validator and the real bloc roll: the route reads
  // organizationMemberships, so seating both countries in NATO is the whole fixture.
  it("refuses a declaration against a fellow alliance member", async () => {
    seat("hog");
    await authAs(HOG);
    allyRoll("NATO", ["US", "UK"]);
    const { POST } = await import("./route");
    const res = await POST(req({ ...good, targetCountry: "UK" }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/North Atlantic Treaty Organization/);
    expect(db.collectionMocks.bills.insertOne).not.toHaveBeenCalled();
  });

  it("does not charge action points for a declaration the alliance bars", async () => {
    seat("hog");
    await authAs(HOG);
    allyRoll("NATO", ["US", "UK"]);
    const { POST } = await import("./route");
    await POST(req({ ...good, targetCountry: "UK" }), params);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  it("still allows a declaration across the bloc line", async () => {
    seat("hog");
    await authAs(HOG);
    // US in NATO, CN in neither: an alliance binds its own members, nobody else.
    allyRoll("NATO", ["US"]);
    const { POST } = await import("./route");
    expect((await POST(req(good), params)).status).toBe(200);
  });

  it("refuses the reserved conquest goal", async () => {
    seat("hog");
    await authAs(HOG);
    const { POST } = await import("./route");
    const res = await POST(req({ ...good, warGoal: "conquest" }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not yet available/i);
    expect(db.collectionMocks.bills.insertOne).not.toHaveBeenCalled();
  });

  it("refuses declaring war on yourself", async () => {
    seat("hog");
    await authAs(HOG);
    const { POST } = await import("./route");
    expect((await POST(req({ ...good, targetCountry: "US" }), params)).status).toBe(400);
  });

  it("normalises a lowercase target rather than rejecting it", async () => {
    seat("hog");
    await authAs(HOG);
    const { POST } = await import("./route");
    const res = await POST(req({ ...good, targetCountry: "cn" }), params);
    expect(res.status).toBe(200);
    const bill = db.collectionMocks.bills.insertOne.mock.calls[0][0] as {
      provisions: Array<{ targetCountry: string }>;
    };
    expect(bill.provisions[0].targetCountry).toBe("CN");
  });

  it("refuses a second declaration against the same country", async () => {
    seat("hog");
    await authAs(HOG);
    db.collectionMocks.bills.findOne.mockResolvedValue({ _id: new ObjectId() });
    const { POST } = await import("./route");
    const res = await POST(req(good), params);
    expect(res.status).toBe(409);
  });

  it("404s when the conflicts subsystem is off", async () => {
    seat("hog");
    await authAs(HOG);
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: false });
    const { POST } = await import("./route");
    expect((await POST(req(good), params)).status).toBe(404);
  });

  it("rejects an unknown country code in the path", async () => {
    seat("hog");
    await authAs(HOG);
    const { POST } = await import("./route");
    const res = await POST(req(good), { params: Promise.resolve({ code: "zz" }) });
    expect(res.status).toBe(400);
  });
});

describe("POST declare-war — targeting and cooldown", () => {
  it("refuses a country that is not open to players", async () => {
    seat("hog");
    await authAs(HOG);
    const { isCountryEnabledForPlayers } = await import("@/lib/countryAccess");
    vi.mocked(isCountryEnabledForPlayers).mockResolvedValue(false);
    const { POST } = await import("./route");
    const res = await POST(req(good), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not open to players/i);
  });

  it("refuses a second declaration inside the cooldown", async () => {
    seat("hog");
    await authAs(HOG);
    db.collectionMocks.bills.find.mockReturnValue({
      sort: () => ({ limit: () => ({ toArray: async () => [{ proposedTurn: 39 }] }) }),
    });
    const { POST } = await import("./route");
    const res = await POST(req(good), params);
    expect(res.status).toBe(429);
    expect(db.collectionMocks.bills.insertOne).not.toHaveBeenCalled();
  });

  it("stamps the proposal turn so the cooldown can count turns", async () => {
    seat("hog");
    await authAs(HOG);
    const { POST } = await import("./route");
    await POST(req(good), params);
    const bill = db.collectionMocks.bills.insertOne.mock.calls[0][0] as { proposedTurn: number };
    expect(bill.proposedTurn).toBe(40);
  });
});

describe("action cost", () => {
  it("charges the same stake as any other bill proposal", async () => {
    seat("hog");
    await authAs(HOG);
    const { POST } = await import("./route");
    await POST(req(good), params);
    const [filter, update] = db.collectionMocks.characters.updateOne.mock.calls[0];
    expect((update as { $inc: { actions: number } }).$inc.actions).toBe(-BILL_PROPOSE_ACTION_COST);
    // Conditional $inc, not read-then-write: the guard has to be in the FILTER or
    // two simultaneous declarations both spend the same points.
    expect((filter as { actions: { $gte: number } }).actions.$gte).toBe(BILL_PROPOSE_ACTION_COST);
  });

  it("stamps the cost on the bill so enactment can refund it", async () => {
    seat("hog");
    await authAs(HOG);
    const { POST } = await import("./route");
    await POST(req(good), params);
    const bill = db.collectionMocks.bills.insertOne.mock.calls[0][0] as {
      proposalActionCost?: number;
    };
    expect(bill.proposalActionCost).toBe(BILL_PROPOSE_ACTION_COST);
  });

  it("refuses when the proposer cannot afford it, and files nothing", async () => {
    seat("hog");
    await authAs(HOG);
    db.collectionMocks.characters.findOne.mockResolvedValue({ actions: 1 });
    const { POST } = await import("./route");
    const res = await POST(req(good), params);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.bills.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  it("409s when the points were spent between the check and the debit", async () => {
    // The conditional $inc matched nothing, so someone else got there first.
    seat("hog");
    await authAs(HOG);
    db.collectionMocks.characters.updateOne.mockResolvedValue({ modifiedCount: 0 });
    const { POST } = await import("./route");
    const res = await POST(req(good), params);
    expect(res.status).toBe(409);
    expect(db.collectionMocks.bills.insertOne).not.toHaveBeenCalled();
  });

  it("charges NOTHING when the declaration is refused", async () => {
    // The debit sits below every check on purpose: a refused declaration is free.
    seat("hog");
    await authAs(HOG);
    const { POST } = await import("./route");
    await POST(req({ ...good, warGoal: "conquest" }), params);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  it("hands the points back if the bill insert fails", async () => {
    // Otherwise the points bought a bill that does not exist, and nothing
    // downstream would ever refund them.
    seat("hog");
    await authAs(HOG);
    db.collectionMocks.bills.insertOne.mockRejectedValue(new Error("write failed"));
    const { POST } = await import("./route");
    await POST(req(good), params);
    const refund = db.collectionMocks.characters.updateOne.mock.calls.at(-1);
    expect((refund?.[1] as { $inc: { actions: number } }).$inc.actions).toBe(
      BILL_PROPOSE_ACTION_COST
    );
  });

  it("does not charge an admin", async () => {
    seat("none");
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { isAdmin: true, character: { _id: BACKBENCHER, name: "A", party: null } },
    } as never);
    const { POST } = await import("./route");
    await POST(req(good), params);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
    const bill = db.collectionMocks.bills.insertOne.mock.calls[0][0] as {
      proposalActionCost?: number;
    };
    expect(bill.proposalActionCost).toBeUndefined();
  });
});

describe("presidential head of government", () => {
  it("lets a president declare war, though no governmentFormations row names them", async () => {
    // The defect: presidential leaders live in electedOfficials with
    // officeType "president", not governmentFormations.pmCharacterId. Reading
    // pmCharacterId meant only the Secretary of Defense could ever file.
    seat("none");
    db.collectionMocks.governmentFormations.findOne.mockResolvedValue(null);
    hogSpy.mockResolvedValue(HOG);
    await authAs(HOG);
    const { POST } = await import("./route");
    expect((await POST(req(good), params)).status).toBe(200);
  });

  it("resolves the leader through the shared helper", async () => {
    seat("hog");
    await authAs(HOG);
    const { POST } = await import("./route");
    await POST(req(good), params);
    expect(hogSpy).toHaveBeenCalledWith(expect.anything(), "US");
  });

  it("still lets the defence minister file", async () => {
    // The fix must not narrow anything.
    seat("defence");
    hogSpy.mockResolvedValue(null);
    await authAs(DEFENCE);
    const { POST } = await import("./route");
    expect((await POST(req(good), params)).status).toBe(200);
  });

  it("still refuses a backbencher", async () => {
    seat("none");
    hogSpy.mockResolvedValue(HOG);
    await authAs(BACKBENCHER);
    const { POST } = await import("./route");
    expect((await POST(req(good), params)).status).toBe(403);
  });
});
