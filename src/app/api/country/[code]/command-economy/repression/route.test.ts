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
  return new Request("http://localhost/api/country/RU/command-economy/repression", {
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
      characterName: "Andropov",
      roles,
      currentTurn: 42,
      marketizationLevel: 10,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST repression (authorization + validation)", () => {
  it("rejects a caller who holds no seat, and writes nothing", async () => {
    stubContext(NONE);
    const res = await POST(req({ level: 0.8 }), ctx());
    expect(res.status).toBe(403);
    expect(db.collection("federalBudget").updateOne).not.toHaveBeenCalled();
  });

  it("rejects the Gosplan planner alone (not their call), and writes nothing", async () => {
    stubContext({ ...NONE, isPlanner: true });
    const res = await POST(req({ level: 0.8 }), ctx());
    expect(res.status).toBe(403);
    expect(db.collection("federalBudget").updateOne).not.toHaveBeenCalled();
  });

  it("allows the head of government and persists the directive", async () => {
    stubContext({ ...NONE, isHeadOfGovernment: true });
    const res = await POST(req({ level: 0.7 }), ctx());
    expect(res.status).toBe(200);
    const set = db.collection("federalBudget").updateOne.mock.calls[0][1].$set as Record<
      string,
      unknown
    >;
    expect(set["economicFactors.repressionDirective.level"]).toBe(0.7);
    expect(set["economicFactors.repressionDirective.setByCharacterId"]).toBe(String(characterId));
    expect(set["economicFactors.repressionDirective.setOnTurn"]).toBe(42);
  });

  it("allows the Gosbank chair too", async () => {
    stubContext({ ...NONE, isBankChair: true });
    const res = await POST(req({ level: 0.3 }), ctx());
    expect(res.status).toBe(200);
  });

  it("rejects out-of-range values before any write (zod bounds)", async () => {
    stubContext({ ...NONE, isHeadOfGovernment: true });
    const tooHigh = await POST(req({ level: 5 }), ctx());
    expect(tooHigh.status).toBe(400);
    const negative = await POST(req({ level: -1 }), ctx());
    expect(negative.status).toBe(400);
    expect(db.collection("federalBudget").updateOne).not.toHaveBeenCalled();
  });

  it("requires the level field", async () => {
    stubContext({ ...NONE, isHeadOfGovernment: true });
    const res = await POST(req({}), ctx());
    expect(res.status).toBe(400);
    expect(db.collection("federalBudget").updateOne).not.toHaveBeenCalled();
  });
});
