import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const isEnabledMock = vi.fn();
vi.mock("./featureFlag", () => ({
  isSubsidiaryCorporationsEnabled: () => isEnabledMock(),
}));

import { canActOnCorporationAsParent } from "./authorization";

const parentId = new ObjectId();
const callerUserId = new ObjectId();

/** Subsidiary whose cap table gives `parentId` the supplied % of shares. */
function sub(parentPct: number, formalized: boolean): Corporation {
  const total = 10_000_000;
  return {
    _id: new ObjectId(),
    totalShares: total,
    shareholders: [{ corporationId: parentId, shares: Math.round((parentPct / 100) * total) }],
    subsidiaryFormalizedAtTurn: formalized ? 10 : undefined,
  } as any as Corporation;
}

let db: MockDb;
beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  isEnabledMock.mockResolvedValue(true);
  db.collection("corporations").findOne = vi
    .fn()
    .mockResolvedValue({ _id: parentId, userId: callerUserId, ceoVacant: false });
});

describe("canActOnCorporationAsParent", () => {
  it("is false when the feature flag is off", async () => {
    isEnabledMock.mockResolvedValue(false);
    expect(
      await canActOnCorporationAsParent(db as unknown as Db, callerUserId, sub(60, true))
    ).toBe(false);
  });

  it("is true when flag on, formalized, parent controls >50%, and caller is parent CEO", async () => {
    expect(
      await canActOnCorporationAsParent(db as unknown as Db, callerUserId, sub(60, true))
    ).toBe(true);
  });

  it("lapses when the parent's voting control slips to <=50%", async () => {
    expect(
      await canActOnCorporationAsParent(db as unknown as Db, callerUserId, sub(40, true))
    ).toBe(false);
  });

  it("is false when the corp is not formalized", async () => {
    expect(
      await canActOnCorporationAsParent(db as unknown as Db, callerUserId, sub(60, false))
    ).toBe(false);
  });

  it("is false when the caller is not the parent CEO", async () => {
    db.collection("corporations").findOne = vi
      .fn()
      .mockResolvedValue({ _id: parentId, userId: new ObjectId(), ceoVacant: false });
    expect(
      await canActOnCorporationAsParent(db as unknown as Db, callerUserId, sub(60, true))
    ).toBe(false);
  });

  it("keeps parent powers when the controlling block is reserved in an open sell", async () => {
    const emptyCapTable = sub(0, true);
    db.collection("shareOrders").find = vi.fn().mockReturnValue({
      toArray: async () => [
        {
          type: "sell",
          status: "open",
          corporationId: emptyCapTable._id,
          placerCorporationId: parentId,
          sharesRemaining: 6_000_000,
        },
      ],
    });
    expect(
      await canActOnCorporationAsParent(db as unknown as Db, callerUserId, emptyCapTable)
    ).toBe(true);
  });
});
