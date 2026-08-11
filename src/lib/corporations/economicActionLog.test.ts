import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";

const recordAudit = vi.fn();
vi.mock("@/lib/audit/recordAudit", () => ({
  recordAudit: (...a: unknown[]) => recordAudit(...a),
}));

import { logEconomicAction } from "./economicActionLog";

describe("logEconomicAction", () => {
  it("inserts an actionLogs row with economic actionType and core fields", async () => {
    const db = createMockDb();
    const characterId = new ObjectId();
    const userId = new ObjectId();

    await logEconomicAction(db as never, {
      characterId,
      userId,
      actionType: "attackSector",
      targetState: "KAN",
      turn: 324,
      characterName: "Takashi Mori",
      username: "truenozero",
      countryId: "JP",
      result: { success: true, message: "Captured $1,000,000", fundsChange: -45000 },
    });

    const insertOne = db.collectionMocks["actionLogs"]!.insertOne;
    expect(insertOne).toHaveBeenCalledTimes(1);
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId,
        userId,
        actionType: "attackSector",
        targetState: "KAN",
        turn: 324,
        username: "truenozero",
        countryId: "JP",
        actionCost: 0,
        result: expect.objectContaining({ success: true }),
      })
    );
    const inserted = insertOne.mock.calls[0]![0] as { createdAt: unknown };
    expect(inserted.createdAt).toBeInstanceOf(Date);
  });

  it("persists the ₳-denominated economic-cost fields when supplied", async () => {
    const db = createMockDb();

    await logEconomicAction(db as never, {
      characterId: new ObjectId(),
      userId: new ObjectId(),
      actionType: "splitSector",
      targetState: "KAN",
      turn: 400,
      corpCashCostAnchor: 250000,
      msCost: 4,
      capturedRevenueAnchor: 1000000,
      currencyCode: "JPY",
      result: { success: true, message: "Split" },
    });

    const insertOne = db.collectionMocks["actionLogs"]!.insertOne;
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        // actionCost stays 0 (character AP for the detector), separate from cost fields.
        actionCost: 0,
        corpCashCostAnchor: 250000,
        msCost: 4,
        capturedRevenueAnchor: 1000000,
        currencyCode: "JPY",
      })
    );
  });

  it("omits economic-cost fields (does not write undefined) when not supplied", async () => {
    const db = createMockDb();

    await logEconomicAction(db as never, {
      characterId: new ObjectId(),
      userId: new ObjectId(),
      actionType: "growSector",
      turn: 401,
      result: { success: true, message: "Grow" },
    });

    const insertOne = db.collectionMocks["actionLogs"]!.insertOne;
    const inserted = insertOne.mock.calls[0]![0] as Record<string, unknown>;
    expect(inserted).not.toHaveProperty("corpCashCostAnchor");
    expect(inserted).not.toHaveProperty("msCost");
    expect(inserted).not.toHaveProperty("capturedRevenueAnchor");
    expect(inserted).not.toHaveProperty("currencyCode");
  });

  it("records an audit envelope cross-linked to the actionLogs row via refs.actionLogId", async () => {
    recordAudit.mockClear();
    const db = createMockDb();
    const characterId = new ObjectId();
    const userId = new ObjectId();
    const insertedId = new ObjectId();
    db.collection("actionLogs");
    db.collectionMocks["actionLogs"]!.insertOne.mockResolvedValue({ insertedId });

    await logEconomicAction(db as never, {
      characterId,
      userId,
      actionType: "attackSector",
      targetState: "KAN",
      turn: 324,
      characterName: "Takashi Mori",
      username: "truenozero",
      countryId: "JP",
      corpCashCostAnchor: 45000,
      currencyCode: "JPY",
      result: { success: true, message: "Captured $1,000,000", fundsChange: -45000 },
    });

    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "corp.attackSector",
        category: "corp",
        amount: 45000,
        currencyCode: "JPY",
        refs: { actionLogId: insertedId },
        outcome: "ok",
      })
    );
  });

  it("records outcome:rejected when the action's result was unsuccessful", async () => {
    recordAudit.mockClear();
    const db = createMockDb();

    await logEconomicAction(db as never, {
      characterId: new ObjectId(),
      userId: new ObjectId(),
      actionType: "buyShares",
      turn: 402,
      result: { success: false, message: "Insufficient funds" },
    });

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "rejected", reason: "Insufficient funds" })
    );
  });
});
