import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  executeTreasuryReserveTransfer,
  TreasuryReserveTransferRejected,
} from "@/lib/budget/treasuryReserveTransfer";
import { POST } from "./route";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 100 }),
}));
vi.mock("@/lib/budget/treasuryReserveTransfer", () => ({
  executeTreasuryReserveTransfer: vi.fn(),
  TreasuryReserveTransferRejected: class extends Error {
    constructor(
      message: string,
      readonly status = 400
    ) {
      super(message);
    }
  },
}));
const actor = new ObjectId();
const request = (body: Record<string, unknown>) =>
  new Request("http://localhost/api/country/US/cabinet/treasury-transfer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const context = (code = "US") => ({ params: Promise.resolve({ code }) });
async function setup(admin = false, member = true) {
  const { getGameState } = await import("@/lib/gameState");
  vi.mocked(getGameState).mockResolvedValue({ currentTurn: 100 } as never);
  const db = createMockDb();
  db.collection("cabinetMembers").findOne.mockResolvedValue(member ? { characterId: actor } : null);
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: {
      userId: actor.toHexString(),
      isAdmin: admin,
      character: { _id: actor, name: "Synthetic minister" },
    },
  } as never);
  vi.mocked(executeTreasuryReserveTransfer).mockResolvedValue({
    turn: 100,
    amount: 1000,
    transferredBy: actor,
    transferredByName: "Synthetic minister",
    createdAt: new Date(),
  });
  return db;
}
beforeEach(() => vi.resetAllMocks());
describe("treasury transfer route", () => {
  it("preserves minister authority and forwards a stable original command", async () => {
    const db = await setup();
    const response = await POST(
      request({ amount: 1000, operationId: "original", justification: "Reserve funding" }),
      context()
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      transferred: 1000,
      record: { transferredByName: "Synthetic minister" },
    });
    expect(db.collection("cabinetMembers").findOne).toHaveBeenCalledWith({
      countryId: "US",
      positionId: "secretary_of_treasury",
      characterId: actor,
    });
    expect(executeTreasuryReserveTransfer).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        operationId: "original",
        amount: 1000,
        actorId: actor,
        isAdmin: false,
        countryId: "US",
      })
    );
  });
  it("refuses a non-minister before delivery", async () => {
    await setup(false, false);
    expect((await POST(request({ amount: 1000 }), context())).status).toBe(403);
    expect(executeTreasuryReserveTransfer).not.toHaveBeenCalled();
  });
  it("preserves the admin authority bypass", async () => {
    const db = await setup(true, false);
    expect((await POST(request({ amount: 1000 }), context())).status).toBe(200);
    expect(db.collection("cabinetMembers").findOne).not.toHaveBeenCalled();
    expect(executeTreasuryReserveTransfer).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ isAdmin: true, operationId: expect.any(String) })
    );
  });
  it.each([
    { amount: 0 },
    { amount: 1000, operationId: "bad.key" },
    { amount: 1000, justification: "x".repeat(201) },
  ])("rejects invalid command %j", async (body) => {
    await setup();
    expect((await POST(request(body), context())).status).toBe(400);
    expect(executeTreasuryReserveTransfer).not.toHaveBeenCalled();
  });
  it.each([
    [400, "Transfer exceeds per-turn cap"],
    [400, "Transfer would breach the federal debt ceiling."],
    [400, "Only one treasury transfer per turn is permitted."],
    [404, "Federal budget not found"],
  ])("returns domain status %s", async (status, message) => {
    await setup();
    vi.mocked(executeTreasuryReserveTransfer).mockRejectedValue(
      new TreasuryReserveTransferRejected(String(message), Number(status))
    );
    const response = await POST(request({ amount: 1000 }), context());
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: message });
  });
});
