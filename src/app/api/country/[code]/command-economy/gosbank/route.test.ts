import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { CommandEconomyRoles } from "@/lib/economy/commandEconomyAuth";

vi.mock("@/lib/economy/queries/commandEconomyWriteContext", () => ({
  resolveWriteContext: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));

import { POST } from "./route";
import { resolveWriteContext } from "@/lib/economy/queries/commandEconomyWriteContext";

const NONE: CommandEconomyRoles = {
  isHeadOfGovernment: false,
  isPlanner: false,
  isBankChair: false,
};
const characterId = new ObjectId();

let db: MockDb;

function ctx() {
  return { params: Promise.resolve({ code: "RU" }) };
}
function req(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/RU/command-economy/gosbank", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function stubContext(roles: CommandEconomyRoles) {
  db = createMockDb();
  db.collection("federalBudget").updateOne.mockResolvedValue({ acknowledged: true });
  vi.mocked(resolveWriteContext).mockResolvedValue({
    ok: true,
    ctx: {
      db: db as never,
      countryId: "RU",
      characterId,
      characterName: "Kosygin",
      roles,
      currentTurn: 42,
      marketizationLevel: 10,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST gosbank (authorization + validation)", () => {
  it("rejects a caller who holds no economic seat, and writes nothing", async () => {
    stubContext(NONE);
    const res = await POST(req({ creditAggressiveness: 0.9 }), ctx());
    expect(res.status).toBe(403);
    expect(db.collection("federalBudget").updateOne).not.toHaveBeenCalled();
  });

  it("allows the Gosbank chair and persists the directive to the P1 seam", async () => {
    stubContext({ ...NONE, isBankChair: true });
    const res = await POST(req({ creditAggressiveness: 0.8, budgetSoftness: 0.2 }), ctx());
    expect(res.status).toBe(200);
    const call = db.collection("federalBudget").updateOne.mock.calls[0];
    const set = call[1].$set as Record<string, unknown>;
    expect(set["economicFactors.gosbankDirective.creditAggressiveness"]).toBe(0.8);
    expect(set["economicFactors.gosbankDirective.budgetSoftness"]).toBe(0.2);
    expect(set["economicFactors.gosbankDirective.setByCharacterId"]).toBe(String(characterId));
  });

  it("allows the head of government too", async () => {
    stubContext({ ...NONE, isHeadOfGovernment: true });
    const res = await POST(req({ creditAggressiveness: 0.5 }), ctx());
    expect(res.status).toBe(200);
  });

  it("rejects out-of-range values before any write (zod bounds)", async () => {
    stubContext({ ...NONE, isBankChair: true });
    const res = await POST(req({ creditAggressiveness: 5 }), ctx());
    expect(res.status).toBe(400);
    expect(db.collection("federalBudget").updateOne).not.toHaveBeenCalled();
  });

  it("keeps only real SOE sectors in an explicit per-sector credit vector", async () => {
    stubContext({ ...NONE, isBankChair: true });
    const res = await POST(
      req({ sectorCredit: { manufacturing: 0.8, energy: 0.4, not_a_sector: 0.9 } }),
      ctx()
    );
    expect(res.status).toBe(200);
    const set = db.collection("federalBudget").updateOne.mock.calls[0][1].$set as Record<
      string,
      unknown
    >;
    const vec = set["economicFactors.gosbankDirective.sectorCredit"] as Record<string, number>;
    expect(vec).toEqual({ manufacturing: 0.8, energy: 0.4 });
    expect(vec).not.toHaveProperty("not_a_sector");
  });
});
