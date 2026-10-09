import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  calculateNppCeiling,
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

  it("scales the ceiling at 6 per region with a floor of 25", () => {
    expect(calculateNppCeiling(0)).toBe(25);
    expect(calculateNppCeiling(4)).toBe(25);
    expect(calculateNppCeiling(12)).toBe(72);
    expect(calculateNppCeiling(24)).toBe(144);
    expect(calculateNppCeiling(51)).toBe(306);
  });

  it("clamps member capacity to the country ceiling", () => {
    expect(calculatePartyNppCapacity(40, calculateNppCeiling(12))).toBe(72);
    expect(calculatePartyNppCapacity(40, calculateNppCeiling(51))).toBe(115);
    expect(calculatePartyNppCapacity(3, calculateNppCeiling(5))).toBe(15);
    expect(calculatePartyNppCapacity(100, calculateNppCeiling(4))).toBe(25);
  });

  it("names the country ceiling when capacity is reached", () => {
    expect(
      partyNppCapacityError({ activeMemberCount: 40, maxNpps: 72, ceiling: 72 }, 72)
    ).toContain("up to 72 in this country");
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
    db.collection("states").countDocuments.mockResolvedValue(51);
    await expect(getPartyNppCapacity(db as unknown as Db, "US", "10", now)).resolves.toEqual({
      activeMemberCount: 1,
      maxNpps: 5,
      ceiling: 306,
    });
    expect(db.collectionMocks.states.countDocuments).toHaveBeenCalledWith({ countryId: "US" });

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
    expect(partyNppCapacityError({ activeMemberCount: 1, maxNpps: 5, ceiling: 25 }, 4)).toBeNull();
    expect(partyNppCapacityError({ activeMemberCount: 1, maxNpps: 5, ceiling: 25 }, 5)).toContain(
      "capacity reached"
    );
    expect(partyNppCapacityError({ activeMemberCount: 1, maxNpps: 5, ceiling: 25 }, 9)).toContain(
      "9/5"
    );
  });
});
