import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/db/characterLookup", () => ({ getCharacterByUserId: vi.fn() }));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/lineOfCredit/featureFlag", () => ({
  isLineOfCreditEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/lineOfCredit/ledger", () => ({
  insertLocLedgerEntry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  SAVINGS_WALLET_LIMITS: { maxRequests: 10, windowMs: 60_000 },
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));

import { POST } from "./route";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { insertLocLedgerEntry } from "@/lib/lineOfCredit/ledger";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/character/loc/payment-mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setupAuth(userId = "user-1") {
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId, isAdmin: false },
  } as never);
}

function setupCharacter(overrides: Record<string, unknown> = {}) {
  const lineOfCredit = (overrides.lineOfCredit ?? {
    balances: { USD: 1000 },
    arrears: {},
    accountsOpened: { USD: true },
  }) as Record<string, unknown>;
  vi.mocked(getCharacterByUserId).mockResolvedValue({
    _id: new ObjectId(),
    lineOfCredit,
  } as never);
}

function setupDb() {
  const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
  vi.mocked(getDb).mockResolvedValue({
    collection: () => ({ updateOne }),
  } as never);
  return { updateOne };
}

describe("POST /api/character/loc/payment-mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("400 when the account is not opened for the currency", async () => {
    setupAuth();
    setupCharacter({
      lineOfCredit: {
        balances: {},
        arrears: {},
        accountsOpened: {},
      },
    });
    setupDb();
    vi.mocked(getCurrentTurn).mockResolvedValue(100);

    const res = await POST(makeRequest({ currency: "USD", mode: "io" }));
    expect(res.status).toBe(400);
  });

  it("flips P/I → I/O on first request and writes a paymode_change ledger row", async () => {
    setupAuth();
    setupCharacter();
    const { updateOne } = setupDb();
    vi.mocked(getCurrentTurn).mockResolvedValue(100);

    const res = await POST(makeRequest({ currency: "USD", mode: "io" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      currency: "USD",
      mode: "io",
      changedAtTurn: 100,
      nextEligibleTurn: 124,
    });
    expect(updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          "lineOfCredit.paymentMode.USD": "io",
        }),
      })
    );
    expect(insertLocLedgerEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "paymode_change",
        meta: { from: "pi", to: "io" },
        turn: 100,
      })
    );
  });

  it("is idempotent when the requested mode matches the current mode", async () => {
    setupAuth();
    setupCharacter({
      lineOfCredit: {
        balances: { USD: 1000 },
        arrears: {},
        accountsOpened: { USD: true },
        paymentMode: { USD: "io" },
        paymentModeChangedAt: { USD: { at: new Date(), turn: 50 } },
      },
    });
    const { updateOne } = setupDb();
    vi.mocked(getCurrentTurn).mockResolvedValue(200);

    const res = await POST(makeRequest({ currency: "USD", mode: "io" }));
    expect(res.status).toBe(200);
    expect(updateOne).not.toHaveBeenCalled();
    expect(insertLocLedgerEntry).not.toHaveBeenCalled();
  });

  it("409s when within the cooldown window", async () => {
    setupAuth();
    setupCharacter({
      lineOfCredit: {
        balances: { USD: 1000 },
        arrears: {},
        accountsOpened: { USD: true },
        paymentMode: { USD: "io" },
        paymentModeChangedAt: { USD: { at: new Date(), turn: 90 } },
      },
    });
    setupDb();
    vi.mocked(getCurrentTurn).mockResolvedValue(100); // 100 - 90 = 10 < 24

    const res = await POST(makeRequest({ currency: "USD", mode: "pi" }));
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.nextEligibleTurn).toBe(114);
    expect(insertLocLedgerEntry).not.toHaveBeenCalled();
  });

  it("allows a flip once cooldown has elapsed", async () => {
    setupAuth();
    setupCharacter({
      lineOfCredit: {
        balances: { USD: 1000 },
        arrears: {},
        accountsOpened: { USD: true },
        paymentMode: { USD: "io" },
        paymentModeChangedAt: { USD: { at: new Date(), turn: 50 } },
      },
    });
    setupDb();
    vi.mocked(getCurrentTurn).mockResolvedValue(74); // 74 - 50 = 24 — exactly eligible

    const res = await POST(makeRequest({ currency: "USD", mode: "pi" }));
    expect(res.status).toBe(200);
    expect(insertLocLedgerEntry).toHaveBeenCalled();
  });
});
