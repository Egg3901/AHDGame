import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  calculatePartyNppCapacity,
  getPartyNppCapacity,
  NPP_ACTIVE_MEMBER_MIN_ACTIONS,
  PARTY_NPP_HARD_CAP,
  partyNppCapacityError,
} from "./partyCapacity";

describe("party NPP capacity", () => {
  it("allows five NPPs per active member and stops at 25", () => {
    expect(calculatePartyNppCapacity(0)).toBe(0);
    expect(calculatePartyNppCapacity(1)).toBe(5);
    expect(calculatePartyNppCapacity(3)).toBe(15);
    expect(calculatePartyNppCapacity(5)).toBe(PARTY_NPP_HARD_CAP);
    expect(calculatePartyNppCapacity(20)).toBe(PARTY_NPP_HARD_CAP);
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
