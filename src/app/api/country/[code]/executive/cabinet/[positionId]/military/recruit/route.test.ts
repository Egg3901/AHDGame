import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { MoneyFlowKeyConflictError, MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";
import { resolveGameYear } from "@/lib/era/era";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/military/recruit", () => ({ applyMilitaryRecruit: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const { getGameState } = await import("@/lib/gameState");
const { applyMilitaryRecruit } = await import("@/lib/military/recruit");

const ROUTE = "@/app/api/country/[code]/executive/cabinet/[positionId]/military/recruit/route";

const SUCCESS = {
  success: true,
  actionsRemaining: 1,
  price: 4_160_000_000,
  appropriationRemaining: 5_840_000_000,
  manpowerRemaining: 488_000,
};

function req(body: unknown, headers?: Record<string, string>) {
  return new Request(
    "http://localhost/api/country/us/executive/cabinet/secretary_of_defense/military/recruit",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }
  );
}
const params = { params: Promise.resolve({ code: "us", positionId: "secretary_of_defense" }) };
const body = { branchId: "army", type: "Infantry Division", name: "3rd Vanguard" };

describe("POST military/recruit (thinned command seam)", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "char_1" } },
    } as never);
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 42, preset: "2019-default" } as never);
    vi.mocked(applyMilitaryRecruit).mockResolvedValue(SUCCESS as never);
  });

  it("passes a recruit through to the command and returns its success body", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req(body), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SUCCESS);
    expect(applyMilitaryRecruit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(applyMilitaryRecruit).mock.calls[0]![1]).toEqual({
      countryId: "US",
      positionId: "secretary_of_defense",
      branchId: "army",
      type: "Infantry Division",
      name: "3rd Vanguard",
      actorCharacterId: "char_1",
      isAdmin: false,
      liveYear: resolveGameYear({ currentTurn: 42, preset: "2019-default" } as never),
      currentTurn: 42,
      preset: "2019-default",
    });
  });

  it("forwards the admin flag and character id from auth", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: true, character: { _id: "admin_char" } },
    } as never);
    const { POST } = await import(ROUTE);
    const res = await POST(req(body), params);

    expect(res.status).toBe(200);
    expect(vi.mocked(applyMilitaryRecruit).mock.calls[0]![1]).toMatchObject({
      actorCharacterId: "admin_char",
      isAdmin: true,
    });
  });

  it("falls back to turn 1, the default preset, and a null year when gameState is missing", async () => {
    vi.mocked(getGameState).mockResolvedValue(null);
    const { POST } = await import(ROUTE);
    const res = await POST(req(body), params);

    expect(res.status).toBe(200);
    expect(vi.mocked(applyMilitaryRecruit).mock.calls[0]![1]).toMatchObject({
      liveYear: null,
      currentTurn: 1,
    });
  });

  it("passes command refusals through byte-identical", async () => {
    const refusals = [
      { error: "No ministerial actions remaining", status: 400 },
      { error: "Only the defence minister may recruit units.", status: 403 },
      { error: "Branch is not available in 1953", status: 400 },
      { error: "Unit type is not available in 1953", status: 400 },
      { error: "No region available to station the unit", status: 400 },
      { error: "Insufficient manpower — 12,000 required, 10 available", status: 400 },
      {
        error: "This country has no usable national budget — procurement is unavailable",
        status: 409,
      },
      {
        error: "This country has no usable GDP figure — procurement is unavailable",
        status: 409,
      },
      {
        error: "Defence appropriation is short — 4,160,000,000 required, 1,000 available",
        status: 409,
      },
      { error: "Manpower was drawn by another order — try again", status: 409 },
    ];
    const { POST } = await import(ROUTE);
    for (const refusal of refusals) {
      vi.mocked(applyMilitaryRecruit).mockResolvedValue(refusal as never);
      const res = await POST(req(body), params);
      expect(res.status).toBe(refusal.status);
      expect(await res.json()).toEqual({ error: refusal.error });
    }
    expect(applyMilitaryRecruit).toHaveBeenCalledTimes(refusals.length);
  });

  it("rejects an invalid country before reaching the command", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req(body), {
      params: Promise.resolve({ code: "xx", positionId: "secretary_of_defense" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid country" });
    expect(applyMilitaryRecruit).not.toHaveBeenCalled();
  });

  it("404s for a non-defense position before reaching the command", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req(body), {
      params: Promise.resolve({ code: "us", positionId: "secretary_of_treasury" }),
    });

    expect(res.status).toBe(404);
    expect(applyMilitaryRecruit).not.toHaveBeenCalled();
  });

  it("returns the auth refusal without reaching the command", async () => {
    const denied = new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: denied } as never);
    const { POST } = await import(ROUTE);
    const res = await POST(req(body), params);

    expect(res.status).toBe(401);
    expect(applyMilitaryRecruit).not.toHaveBeenCalled();
  });

  it("rejects a malformed body before reaching the command", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ branchId: "army" }), params);

    expect(res.status).toBe(400);
    expect(applyMilitaryRecruit).not.toHaveBeenCalled();
  });

  it("returns 400 for an empty or over-long Idempotency-Key header", async () => {
    const { POST } = await import(ROUTE);
    const empty = await POST(req(body, { "Idempotency-Key": "" }), params);
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "Invalid Idempotency-Key header" });

    const long = await POST(req(body, { "Idempotency-Key": "k".repeat(129) }), params);
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({ error: "Invalid Idempotency-Key header" });

    expect(applyMilitaryRecruit).not.toHaveBeenCalled();
  });

  it("forwards a client Idempotency-Key to the command", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req(body, { "Idempotency-Key": "client-key-1" }), params);

    expect(res.status).toBe(200);
    expect(vi.mocked(applyMilitaryRecruit).mock.calls[0]![1]).toMatchObject({
      idempotencyKey: "client-key-1",
    });
  });

  it("omits the key when the header is absent so the command mints one", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req(body), params);

    expect(res.status).toBe(200);
    const input = vi.mocked(applyMilitaryRecruit).mock.calls[0]![1] as Record<string, unknown>;
    expect(input).not.toHaveProperty("idempotencyKey");
  });

  it("maps a settled key to 409 instead of charging again", async () => {
    vi.mocked(applyMilitaryRecruit).mockRejectedValue(
      new MoneyFlowTerminalError("client-key-1", "compensated")
    );
    const { POST } = await import(ROUTE);
    const res = await POST(req(body, { "Idempotency-Key": "client-key-1" }), params);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Recruit already settled; start a new attempt with a new key.",
    });
  });

  it("maps a reused key for a different recruit to 409", async () => {
    vi.mocked(applyMilitaryRecruit).mockRejectedValue(
      new MoneyFlowKeyConflictError("client-key-1")
    );
    const { POST } = await import(ROUTE);
    const res = await POST(req(body, { "Idempotency-Key": "client-key-1" }), params);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Idempotency key was reused for a different recruit.",
    });
  });

  it("returns 500 when the compensated insert failure propagates", async () => {
    vi.mocked(applyMilitaryRecruit).mockRejectedValue(new Error("MILITARY_RECRUIT_UNIT:applied"));
    const { POST } = await import(ROUTE);
    const res = await POST(req(body), params);

    expect(res.status).toBe(500);
  });
});
