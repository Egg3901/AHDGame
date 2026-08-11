import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { expireCharters } from "./expireCharters";

function makeStubDb(modified: { pending: number; replacement: number }) {
  const updateMany = vi
    .fn()
    .mockResolvedValueOnce({ modifiedCount: modified.pending })
    .mockResolvedValueOnce({ modifiedCount: modified.replacement });
  const collection = vi.fn().mockReturnValue({ updateMany });
  return { db: { collection } as unknown as Db, updateMany, collection };
}

describe("expireCharters", () => {
  const CURRENT_TURN = 100;

  it("expires draft + pending-signatures charters past the deadline (turn-first)", async () => {
    const { db, updateMany } = makeStubDb({ pending: 2, replacement: 0 });
    const now = new Date("2026-04-01T00:00:00Z");

    const result = await expireCharters(CURRENT_TURN, now, db);

    expect(result.expiredFromPending).toBe(2);
    expect(updateMany).toHaveBeenCalledTimes(2);
    const [pendingFilter, pendingUpdate] = updateMany.mock.calls[0]!;
    expect(pendingFilter).toEqual({
      status: { $in: ["draft", "pending-signatures"] },
      $or: [
        { expiresOnTurn: { $ne: null, $lte: CURRENT_TURN } },
        { expiresOnTurn: null, expiresAt: { $ne: null, $lte: now } },
      ],
    });
    expect(pendingUpdate).toEqual({ $set: { status: "expired", updatedAt: now } });
  });

  it("expires founder-replacement charters past the deadline (turn-first)", async () => {
    const { db, updateMany } = makeStubDb({ pending: 0, replacement: 3 });
    const now = new Date("2026-04-01T00:00:00Z");

    const result = await expireCharters(CURRENT_TURN, now, db);

    expect(result.expiredFromReplacement).toBe(3);
    const [replacementFilter, replacementUpdate] = updateMany.mock.calls[1]!;
    expect(replacementFilter).toEqual({
      status: "founder-replacement",
      $or: [
        { founderReplacementDeadlineTurn: { $ne: null, $lte: CURRENT_TURN } },
        {
          founderReplacementDeadlineTurn: null,
          founderReplacementDeadline: { $ne: null, $lte: now },
        },
      ],
    });
    expect(replacementUpdate).toEqual({ $set: { status: "expired", updatedAt: now } });
  });

  it("returns zero counts when no charters past their deadline", async () => {
    const { db } = makeStubDb({ pending: 0, replacement: 0 });
    const now = new Date("2026-04-01T00:00:00Z");
    const result = await expireCharters(CURRENT_TURN, now, db);
    expect(result).toEqual({ expiredFromPending: 0, expiredFromReplacement: 0 });
  });

  it("never targets ratified / migrated / migrated-incomplete charters", async () => {
    const { db, updateMany } = makeStubDb({ pending: 0, replacement: 0 });
    const now = new Date("2026-04-01T00:00:00Z");
    await expireCharters(CURRENT_TURN, now, db);
    for (const call of updateMany.mock.calls) {
      const filter = call[0] as { status: unknown };
      const statusFilter = filter.status;
      const allowed = ["draft", "pending-signatures", "founder-replacement"];
      if (typeof statusFilter === "string") {
        expect(allowed).toContain(statusFilter);
      } else if (statusFilter && typeof statusFilter === "object" && "$in" in statusFilter) {
        const inList = (statusFilter as { $in: string[] }).$in;
        for (const s of inList) expect(allowed).toContain(s);
      }
    }
  });
});
