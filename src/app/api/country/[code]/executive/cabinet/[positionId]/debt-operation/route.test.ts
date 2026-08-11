import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

const charId = new ObjectId();

let memberDoc: any;
let opDoc: any;

vi.mock("@/lib/api/requireAuth", () => ({
  requireAuth: vi.fn(async () => ({
    ok: true,
    user: { isAdmin: false, character: { _id: charId } },
  })),
}));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn(async () => ({ currentTurn: 200 })) }));

const updateOne = vi.fn(async () => ({ modifiedCount: 1 }));
const opsUpdateOne = vi.fn(async () => ({ modifiedCount: 1 }));

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(async () => ({ collection: () => ({}) })),
}));
vi.mock("@/lib/db/collections/cabinetMembers", () => ({
  getCabinetMembersCollection: () => ({
    findOne: async () => memberDoc,
    updateOne,
  }),
}));
vi.mock("@/lib/db/collections/treasuryOperations", () => ({
  getTreasuryOperationsCollection: () => ({
    findOne: async () => opDoc,
    updateOne: opsUpdateOne,
  }),
}));

import { POST } from "./route";

function call(code = "us", positionId = "secretary_of_treasury") {
  return POST(new Request("http://t", { method: "POST", body: "{}" }), {
    params: Promise.resolve({ code, positionId }),
  });
}

beforeEach(() => {
  memberDoc = {
    _id: new ObjectId(),
    countryId: "US",
    positionId: "secretary_of_treasury",
    characterId: charId,
    characterName: "Sec",
    ministerialActions: 2,
  };
  opDoc = null;
  updateOne.mockClear();
  opsUpdateOne.mockClear();
});

describe("POST debt-operation", () => {
  it("404 for a non-finance seat", async () => {
    const res = await call("us", "secretary_of_energy");
    expect(res.status).toBe(404);
  });

  it("launches: decrements an action and writes activeOp", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.actionsRemaining).toBe(1);
    expect(json.expiresTurn).toBe(212); // 200 + DEBT_OP_DURATION_TURNS(12)
    expect(opsUpdateOne).toHaveBeenCalled();
  });

  it("409 when an operation is already active", async () => {
    opDoc = { _id: "US", activeOp: { expiresTurn: 999 }, cooldownUntilTurn: 0 };
    const res = await call();
    expect(res.status).toBe(409);
  });

  it("409 while in cooldown", async () => {
    opDoc = { _id: "US", activeOp: null, cooldownUntilTurn: 250 };
    const res = await call();
    expect(res.status).toBe(409);
  });

  it("400 with no actions left", async () => {
    memberDoc.ministerialActions = 0;
    const res = await call();
    expect(res.status).toBe(400);
  });
});
