import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  calculatePartyNppCapacity,
  getPartyNppCapacity,
  NPP_ACTIVE_MEMBER_MIN_ACTIONS,
  partyNppCapacityError,
} from "./partyCapacity";

describe("party NPP capacity", () => {
  it("gives five NPPs per member for small parties, then tapers with no ceiling", () => {
    expect(calculatePartyNppCapacity(0)).toBe(0);
    expect(calculatePartyNppCapacity(1)).toBe(5);
    expect(calculatePartyNppCapacity(3)).toBe(15);
    expect(calculatePartyNppCapacity(5)).toBe(25);
    expect(calculatePartyNppCapacity(6)).toBe(29);
    expect(calculatePartyNppCapacity(10)).toBe(45);
    expect(calculatePartyNppCapacity(20)).toBe(75);
    expect(calculatePartyNppCapacity(40)).toBe(115);
  });

  it("never lets an extra active member lower or freeze capacity", () => {
    for (let n = 1; n <= 200; n++) {
      const gain = calculatePartyNppCapacity(n) - calculatePartyNppCapacity(n - 1);
      expect(gain).toBeGreaterThanOrEqual(2);
      expect(gain).toBeLessThanOrEqual(5);
    }
  });

  it("treats negative or fractional member counts safely", () => {
    expect(calculatePartyNppCapacity(-3)).toBe(0);
    expect(calculatePartyNppCapacity(5.9)).toBe(25);
  });

  it("counts only non-banned members with two recent meaningful actions", async () => {
    const db = createMockDb();
    const activeUserId = new ObjectId();
    const inactiveUserId = new ObjectId();
    const bannedUserId = new ObjectId();
    db.collection("characters").find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([
            { userId: activeUserId },
            { userId: inactiveUserId },
            { userId: bannedUserId },
          ]),
      }),
    });
    db.collection("users").find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: activeUserId }, { _id: inactiveUserId }]),
      }),
    });
    db.collection("activityLog").aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: activeUserId }]),
    });

    const now = new Date("2026-09-12T12:00:00Z");
    await expect(getPartyNppCapacity(db as unknown as Db, "US", "10", now)).resolves.toEqual({
      activeMemberCount: 1,
      maxNpps: 5,
    });

    expect(db.collectionMocks.activityLog.aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          $match: expect.objectContaining({
            timestamp: { $gte: new Date("2026-08-29T12:00:00Z") },
          }),
        }),
        expect.objectContaining({
          $match: { actionCount: { $gte: NPP_ACTIVE_MEMBER_MIN_ACTIONS } },
        }),
      ])
    );
  });

  it("explains when a party has reached its capacity without removing existing NPPs", () => {
    expect(partyNppCapacityError({ activeMemberCount: 1, maxNpps: 5 }, 4)).toBeNull();
    expect(partyNppCapacityError({ activeMemberCount: 1, maxNpps: 5 }, 5)).toContain(
      "capacity reached"
    );
    expect(partyNppCapacityError({ activeMemberCount: 1, maxNpps: 5 }, 9)).toContain("9/5");
  });
});
