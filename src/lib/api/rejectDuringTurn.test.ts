import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { TURN_LOCK_STALE_MS } from "@/lib/turn/processingLock";
import { rejectDuringTurn } from "./rejectDuringTurn";

describe("rejectDuringTurn", () => {
  it("returns a conflict for a live turn lock", async () => {
    const db = createMockDb();
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      isProcessing: true,
      processingHeartbeatAt: new Date(),
    });

    const response = await rejectDuringTurn(db as unknown as Db);

    expect(response?.status).toBe(409);
  });

  it("does not block on an abandoned stale lock", async () => {
    const db = createMockDb();
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      isProcessing: true,
      processingHeartbeatAt: new Date(Date.now() - TURN_LOCK_STALE_MS - 1),
    });

    await expect(rejectDuringTurn(db as unknown as Db)).resolves.toBeNull();
  });
});
