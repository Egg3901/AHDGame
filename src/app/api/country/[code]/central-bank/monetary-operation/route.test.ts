import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getDb: vi.fn(),
  getGameState: vi.fn(),
  executeMonetaryOperation: vi.fn(),
  snapshotMoneySupply: vi.fn(),
}));

vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/gameState", () => ({ getGameState: mocks.getGameState }));
vi.mock("@/lib/moneySupply/operations", () => ({
  DIRECT_ADVANCE_GDP_CAP: 0.005,
  LIQUIDITY_INJECTION_GDP_CAP: 0.01,
  MONETARY_OPERATION_COOLDOWN_TURNS: 4,
  executeMonetaryOperation: mocks.executeMonetaryOperation,
}));
vi.mock("@/lib/moneySupply/snapshot", () => ({
  snapshotMoneySupply: mocks.snapshotMoneySupply,
}));

import { POST } from "./route";

const CHAIR_ID = "chair-1";

function request(body: unknown) {
  return new Request("http://localhost/api/country/US/central-bank/monetary-operation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function context(code = "US") {
  return { params: Promise.resolve({ code }) };
}

function authenticatedUser(overrides: Record<string, unknown> = {}) {
  return {
    ok: true as const,
    user: {
      userId: "user-1",
      username: "chair-user",
      isAdmin: false,
      character: { _id: CHAIR_ID, name: "Chair One" },
      ...overrides,
    },
  };
}

function configureDb({
  enabled = true,
  chairCharacterId = CHAIR_ID,
  chairControlsLocked = false,
  lastMonetaryOperationTurn,
}: {
  enabled?: boolean;
  chairCharacterId?: string;
  chairControlsLocked?: boolean;
  lastMonetaryOperationTurn?: number;
} = {}) {
  const documents: Record<string, unknown> = {
    centralBanks: {
      _id: "central_bank_US",
      countryId: "US",
      chairCharacterId,
      chairControlsLocked,
      lastMonetaryOperationTurn,
    },
    federalBudget: { _id: "federal", countryId: "US", gdp: 1_000_000 },
    gameConfig: { _id: "default", moneySupplyEnabled: enabled },
  };
  const db = {
    collection: vi.fn((name: string) => ({
      findOne: vi.fn().mockResolvedValue(documents[name] ?? null),
    })),
  };
  mocks.getDb.mockResolvedValue(db);
  mocks.getGameState.mockResolvedValue({ currentTurn: 20 });
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(authenticatedUser());
  mocks.executeMonetaryOperation.mockResolvedValue({
    type: "qe",
    amount: 1_000,
    turn: 20,
    actorName: "Chair One",
  });
  mocks.snapshotMoneySupply.mockResolvedValue({});
});

describe("POST /api/country/[code]/central-bank/monetary-operation", () => {
  it("stops unauthenticated requests before reading game state", async () => {
    mocks.requireAuth.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await POST(request({ type: "qe", bondId: "bond-1", units: 10 }), context());

    expect(response.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("returns 409 when money supply is not explicitly enabled", async () => {
    configureDb({ enabled: false });

    const response = await POST(request({ type: "qe", bondId: "bond-1", units: 10 }), context());

    expect(response.status).toBe(409);
    expect(mocks.executeMonetaryOperation).not.toHaveBeenCalled();
  });

  it("rejects a non-chair", async () => {
    configureDb({ chairCharacterId: "someone-else" });

    const response = await POST(request({ type: "qe", bondId: "bond-1", units: 10 }), context());

    expect(response.status).toBe(403);
    expect(mocks.executeMonetaryOperation).not.toHaveBeenCalled();
  });

  it("enforces the chair cooldown", async () => {
    configureDb({ lastMonetaryOperationTurn: 18 });

    const response = await POST(request({ type: "qe", bondId: "bond-1", units: 10 }), context());

    expect(response.status).toBe(409);
    expect(mocks.executeMonetaryOperation).not.toHaveBeenCalled();
  });

  it("executes a valid chair operation and refreshes the snapshot", async () => {
    const db = configureDb();

    const response = await POST(
      request({ type: "qe", bondId: "bond-1", units: 10, reason: "Support demand" }),
      context("us")
    );

    expect(response.status).toBe(200);
    expect(mocks.executeMonetaryOperation).toHaveBeenCalledWith(db, {
      countryId: "US",
      type: "qe",
      turn: 20,
      actorName: "Chair One",
      reason: "Support demand",
      amount: 0,
      bondId: "bond-1",
      units: 10,
    });
    expect(mocks.snapshotMoneySupply).toHaveBeenCalledWith(db, 20);
  });
});
