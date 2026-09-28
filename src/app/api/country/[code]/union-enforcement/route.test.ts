import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { GET, POST } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));

const unionId = new ObjectId();
const characterId = new ObjectId();
let db: MockDb;

function request(body: unknown): Request {
  return new Request("http://localhost/api/country/US/union-enforcement", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function post(body: unknown, code = "US") {
  return POST(request(body), { params: Promise.resolve({ code }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
  vi.mocked(getCurrentTurn).mockResolvedValue(42);
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: {
      userId: "executive",
      character: {
        _id: characterId,
        countryId: "US",
        currentOffice: { type: "president" },
      },
    },
  } as never);
  db.collection("federalBudget").findOne.mockResolvedValue({ unionsBanned: true });
  db.collection("federalBudget").updateOne.mockResolvedValue({ modifiedCount: 1 });
  db.collection("unions").findOne.mockResolvedValue({ _id: unionId, countryId: "US", heat: 72 });
  db.collection("characters").updateOne.mockResolvedValue({ modifiedCount: 1 });
});

describe("union ban enforcement route", () => {
  it("reports the persisted posture only to the country's executive", async () => {
    db.collection("federalBudget").findOne.mockResolvedValue({
      unionsBanned: true,
      unionEnforcementPosture: "crackdown",
      unionEnforcementPostureChangedTurn: 42,
    });
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ code: "US" }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      posture: "crackdown",
      canChangePosture: false,
    });
  });

  it("rejects an executive of another country", async () => {
    const response = await post({ action: "posture", posture: "crackdown" }, "UK");
    expect(response.status).toBe(403);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("persists one posture change per turn only during an active ban", async () => {
    const response = await post({ action: "posture", posture: "crackdown" });
    expect(response.status).toBe(200);
    expect(db.collection("federalBudget").updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        unionsBanned: true,
        unionEnforcementPostureChangedTurn: { $ne: 42 },
      }),
      expect.objectContaining({
        $set: expect.objectContaining({ unionEnforcementPosture: "crackdown" }),
      })
    );
  });

  it("investigates a domestic cell for one action and reveals only a bracket", async () => {
    const response = await post({ action: "investigate", unionId: unionId.toString() });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      unionId: unionId.toString(),
      heat: "high",
      actionsSpent: 1,
    });
    expect(db.collection("characters").updateOne).toHaveBeenCalledWith(
      { _id: characterId, actions: { $gte: 1 } },
      expect.objectContaining({ $inc: { actions: -1 } })
    );
  });

  it("does not spend an action when the target union is outside the country", async () => {
    db.collection("unions").findOne.mockResolvedValue(null);
    const response = await post({ action: "investigate", unionId: unionId.toString() });
    expect(response.status).toBe(404);
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
  });

  it("raids a high heat suspended cell for two actions and plants a cooldown", async () => {
    db.collection("unions").findOne.mockResolvedValue({
      _id: unionId,
      countryId: "US",
      suspended: true,
      heat: 72,
      undergroundStrength: 20,
    });
    db.collection("unions").updateOne.mockResolvedValue({ modifiedCount: 1 });
    const response = await post({ action: "raid", unionId: unionId.toString() });
    expect(response.status).toBe(200);
    expect(db.collection("characters").updateOne).toHaveBeenCalledWith(
      { _id: characterId, actions: { $gte: 2 } },
      expect.objectContaining({ $inc: { actions: -2 } })
    );
    expect(db.collection("unions").updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ suspended: true }),
      expect.objectContaining({ $set: expect.objectContaining({ lastUndergroundRaidTurn: 42 }) })
    );
  });

  it("refuses a cold cell or a cell still in raid cooldown without spending actions", async () => {
    db.collection("unions").findOne.mockResolvedValue({
      _id: unionId,
      countryId: "US",
      suspended: true,
      heat: 20,
      undergroundStrength: 20,
    });
    expect((await post({ action: "raid", unionId: unionId.toString() })).status).toBe(409);
    db.collection("unions").findOne.mockResolvedValue({
      _id: unionId,
      countryId: "US",
      suspended: true,
      heat: 72,
      undergroundStrength: 20,
      lastUndergroundRaidTurn: 41,
    });
    expect((await post({ action: "raid", unionId: unionId.toString() })).status).toBe(409);
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
  });

  it("refunds action points when the raid write throws before applying", async () => {
    db.collection("unions")
      .findOne.mockResolvedValueOnce({
        _id: unionId,
        countryId: "US",
        suspended: true,
        heat: 72,
        undergroundStrength: 20,
      })
      .mockResolvedValueOnce({ _id: unionId, countryId: "US" });
    db.collection("unions").updateOne.mockRejectedValue(new Error("write failed"));
    const response = await post({ action: "raid", unionId: unionId.toString() });
    expect(response.status).toBe(500);
    expect(db.collection("characters").updateOne).toHaveBeenCalledTimes(2);
    expect(db.collection("characters").updateOne).toHaveBeenLastCalledWith(
      { _id: characterId },
      { $inc: { actions: 2 } }
    );
  });

  it("does not refund when the raid write applied before reporting an error", async () => {
    db.collection("unions")
      .findOne.mockResolvedValueOnce({
        _id: unionId,
        countryId: "US",
        suspended: true,
        heat: 72,
        undergroundStrength: 20,
      })
      .mockResolvedValueOnce({ _id: unionId, countryId: "US", lastUndergroundRaidTurn: 42 });
    db.collection("unions").updateOne.mockRejectedValue(new Error("ack lost"));
    const response = await post({ action: "raid", unionId: unionId.toString() });
    expect(response.status).toBe(500);
    expect(db.collection("characters").updateOne).toHaveBeenCalledTimes(1);
  });

  it("rejects enforcement after repeal", async () => {
    db.collection("federalBudget").findOne.mockResolvedValue({ unionsBanned: false });
    const response = await post({ action: "posture", posture: "normal" });
    expect(response.status).toBe(409);
  });
});
