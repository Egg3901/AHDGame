import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const { atLeastMock } = vi.hoisted(() => ({ atLeastMock: vi.fn() }));
vi.mock("../featureFlag", () => ({
  nppAutonomyAtLeast: (...a: unknown[]) => atLeastMock(...a),
}));

import { runCaretakerMinisters } from "../ministerialGovernance";

const now = new Date("2026-06-24T12:00:00Z");

function membersCursor(docs: unknown[]) {
  return { toArray: vi.fn().mockResolvedValue(docs) };
}

describe("runCaretakerMinisters", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    atLeastMock.mockReset();
  });

  it("is a no-op below v2 (gate false) and never reads the cabinet", async () => {
    atLeastMock.mockResolvedValue(false);
    const result = await runCaretakerMinisters(db as unknown as Db, "US", 100, now);
    expect(result.ran).toBe(false);
    expect(atLeastMock).toHaveBeenCalledWith(expect.anything(), "US", "v2");
    expect(db.collectionMocks["cabinetMembers"]).toBeUndefined();
  });

  it("ignores V1 NPP-government seats (appointed by an NPP head, not a player)", async () => {
    atLeastMock.mockResolvedValue(true);
    // An isNPP seat appointed by an NPP head (appointedByCharacterId null) is a
    // V1 government seat, not a player-appointed caretaker — it must be skipped.
    vi.mocked(db.collection("cabinetMembers").find).mockReturnValue(
      membersCursor([
        {
          _id: new ObjectId(),
          positionId: "secretary_of_state",
          isNPP: true,
          nppId: new ObjectId(),
          appointedByCharacterId: null,
          appointedByNppId: new ObjectId(),
        },
      ]) as never
    );
    const result = await runCaretakerMinisters(db as unknown as Db, "US", 100, now);
    expect(result.ran).toBe(true);
    expect(result.tiersSet).toBe(0);
    expect(result.ordersIssued).toBe(0);
    // Early return after filtering — NPP personalities are never hydrated.
    expect(db.collectionMocks["npps"]).toBeUndefined();
  });

  it("returns ran:true with nothing to do when there are no NPP seats", async () => {
    atLeastMock.mockResolvedValue(true);
    vi.mocked(db.collection("cabinetMembers").find).mockReturnValue(membersCursor([]) as never);
    const result = await runCaretakerMinisters(db as unknown as Db, "US", 100, now);
    expect(result.ran).toBe(true);
    expect(result.ordersIssued).toBe(0);
  });
});
