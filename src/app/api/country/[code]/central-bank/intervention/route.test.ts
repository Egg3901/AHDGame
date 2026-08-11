import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 100 }),
}));

let db: MockDb;
const chairId = new ObjectId();

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    userId: new ObjectId().toString(),
    username: "chair",
    isAdmin: false,
    character: { _id: chairId, name: "Chair Character" },
    ...overrides,
  };
}

function makeBank(overrides: Record<string, unknown> = {}) {
  return {
    _id: "US",
    countryId: "US",
    chairCharacterId: chairId,
    chairCharacterName: "Chair Character",
    primeRate: 2.0,
    rateHistory: [],
    chairControlsLocked: false,
    ...overrides,
  };
}

function makeRate(overrides: Record<string, unknown> = {}) {
  return {
    _id: "US",
    countryId: "US",
    currencyCode: "USD",
    rate: 1.0,
    baseRate: 1.0,
    macroTarget: 1.0,
    rateHistory: [],
    buyVolume24: 0,
    sellVolume24: 0,
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRequest(body: Record<string, unknown>, method = "POST") {
  return new Request("http://localhost/api/country/US/central-bank/intervention", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = () => ({ params: Promise.resolve({ code: "US" }) });

async function setup({
  bank = makeBank(),
  rate = makeRate(),
  user = makeUser(),
}: {
  bank?: ReturnType<typeof makeBank>;
  rate?: ReturnType<typeof makeRate>;
  user?: ReturnType<typeof makeUser>;
} = {}) {
  db = createMockDb();
  db.collection("centralBanks").findOne.mockResolvedValue(bank);
  db.collection("exchangeRates").findOne.mockResolvedValue(rate);

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user } as never);
}

describe("POST /api/country/[code]/central-bank/intervention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when caller is not the chair", async () => {
    const otherChar = new ObjectId();
    await setup({ user: makeUser({ character: { _id: otherChar, name: "Random" } }) });
    const { POST } = await import("./route");

    const res = await POST(makeRequest({ floor: 0.95, ceiling: 1.05 }), ctx());
    expect(res.status).toBe(403);
  });

  it("returns 403 when chair controls are locked", async () => {
    await setup({ bank: makeBank({ chairControlsLocked: true }) });
    const { POST } = await import("./route");

    const res = await POST(makeRequest({ floor: 0.95, ceiling: 1.05 }), ctx());
    expect(res.status).toBe(403);
  });

  it("sets a new band with no cooldown (no prior policy)", async () => {
    await setup();
    const { POST } = await import("./route");

    const res = await POST(makeRequest({ floor: 0.95, ceiling: 1.05 }), ctx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.interventionPolicy.floor).toBe(0.95);
    expect(json.interventionPolicy.ceiling).toBe(1.05);
    expect(json.interventionPolicy.lastAdjustedAtTurn).toBe(100);
  });

  it("rejects band where floor >= ceiling", async () => {
    await setup();
    const { POST } = await import("./route");

    const res = await POST(makeRequest({ floor: 1.1, ceiling: 1.0 }), ctx());
    expect(res.status).toBe(400);
  });

  it("rejects band outside guardrails", async () => {
    await setup();
    const { POST } = await import("./route");

    // baseRate 1.0 → guardrails [0.5, 1.5]; ceiling 2.0 is outside
    const res = await POST(makeRequest({ floor: 0.95, ceiling: 2.0 }), ctx());
    expect(res.status).toBe(400);
  });

  it("rejects POST when a band already exists", async () => {
    await setup({
      rate: makeRate({
        interventionPolicy: {
          floor: 0.9,
          ceiling: 1.1,
          setByCharacterId: chairId,
          setByCharacterName: "Prior",
          setAtTurn: 0,
          lastAdjustedAtTurn: 0,
          recentInterventions: [],
        },
      }),
    });
    const { POST } = await import("./route");

    const res = await POST(makeRequest({ floor: 0.95, ceiling: 1.05 }), ctx());
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/country/[code]/central-bank/intervention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("widens an existing band with no cooldown", async () => {
    await setup({
      rate: makeRate({
        interventionPolicy: {
          floor: 0.95,
          ceiling: 1.05,
          setByCharacterId: chairId,
          setByCharacterName: "Prior",
          setAtTurn: 98,
          lastAdjustedAtTurn: 98, // 2 turns ago — cooldown would block narrow
          recentInterventions: [],
        },
      }),
    });
    const { PATCH } = await import("./route");

    // Wider band: [0.9, 1.1] ⊇ [0.95, 1.05]
    const res = await PATCH(makeRequest({ floor: 0.9, ceiling: 1.1 }, "PATCH"), ctx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.action).toBe("widen");
    // Widening preserves original lastAdjustedAtTurn
    expect(json.interventionPolicy.lastAdjustedAtTurn).toBe(98);
  });

  it("rejects narrow within cooldown window", async () => {
    await setup({
      rate: makeRate({
        interventionPolicy: {
          floor: 0.9,
          ceiling: 1.1,
          setByCharacterId: chairId,
          setByCharacterName: "Prior",
          setAtTurn: 98,
          lastAdjustedAtTurn: 98, // 2 turns ago < 6
          recentInterventions: [],
        },
      }),
    });
    const { PATCH } = await import("./route");

    const res = await PATCH(makeRequest({ floor: 0.95, ceiling: 1.05 }, "PATCH"), ctx());
    expect(res.status).toBe(400);
  });

  it("permits narrow after cooldown elapses", async () => {
    await setup({
      rate: makeRate({
        interventionPolicy: {
          floor: 0.9,
          ceiling: 1.1,
          setByCharacterId: chairId,
          setByCharacterName: "Prior",
          setAtTurn: 90,
          lastAdjustedAtTurn: 90, // 10 turns ago >= 6
          recentInterventions: [],
        },
      }),
    });
    const { PATCH } = await import("./route");

    const res = await PATCH(makeRequest({ floor: 0.95, ceiling: 1.05 }, "PATCH"), ctx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.action).toBe("narrow");
    // Narrowing updates lastAdjustedAtTurn to current turn
    expect(json.interventionPolicy.lastAdjustedAtTurn).toBe(100);
  });
});

describe("DELETE /api/country/[code]/central-bank/intervention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cancels active band after cooldown", async () => {
    await setup({
      rate: makeRate({
        interventionPolicy: {
          floor: 0.9,
          ceiling: 1.1,
          setByCharacterId: chairId,
          setByCharacterName: "Prior",
          setAtTurn: 80,
          lastAdjustedAtTurn: 80,
          recentInterventions: [],
        },
      }),
    });
    const { DELETE } = await import("./route");

    const res = await DELETE(
      new Request("http://localhost/api/country/US/central-bank/intervention", {
        method: "DELETE",
      }),
      ctx()
    );
    expect(res.status).toBe(200);
  });

  it("rejects cancel within cooldown", async () => {
    await setup({
      rate: makeRate({
        interventionPolicy: {
          floor: 0.9,
          ceiling: 1.1,
          setByCharacterId: chairId,
          setByCharacterName: "Prior",
          setAtTurn: 98,
          lastAdjustedAtTurn: 98,
          recentInterventions: [],
        },
      }),
    });
    const { DELETE } = await import("./route");

    const res = await DELETE(
      new Request("http://localhost/api/country/US/central-bank/intervention", {
        method: "DELETE",
      }),
      ctx()
    );
    expect(res.status).toBe(400);
  });
});
