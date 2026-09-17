import { beforeEach, describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { MINISTERIAL_ACTION_CAP } from "@/lib/constants/cabinetMechanicsTypes";
import { getCalendarDayInTimezone } from "@/lib/time/dailyReset";
import {
  ensureUkSharedPool,
  reconcileUkSharedPool,
  refundMinisterialAction,
  resolveMinisterialRemaining,
  spendMinisterialAction,
  ukSharedPoolIdsNeedingReset,
  usesSharedMinisterialPool,
} from "./ministerialActionPool";

interface RowDoc {
  _id: ObjectId;
  countryId: string;
  positionId: string;
  characterId: ObjectId | null;
  ministerialActions?: number;
  lastMinisterialActionResetDay?: string;
}

interface CharDoc {
  _id: ObjectId;
  sharedMinisterialActions?: number;
  sharedMinisterialActionResetDay?: string;
}

const NOW = new Date("2026-09-17T14:00:00Z");
const TODAY = getCalendarDayInTimezone(NOW);
const YESTERDAY = "2026-09-16";

function setupStore(rows: RowDoc[], chars: CharDoc[]) {
  const db: MockDb = createMockDb();
  const rowStore = new Map(rows.map((row) => [row._id.toString(), { ...row }]));
  const charStore = new Map(chars.map((char) => [char._id.toString(), { ...char }]));

  const matches = (doc: Record<string, unknown>, filter: Record<string, unknown>): boolean =>
    Object.entries(filter).every(([key, value]) => {
      const actual = doc[key];
      if (value instanceof ObjectId && actual instanceof ObjectId) return value.equals(actual);
      if (value != null && typeof value === "object" && !Array.isArray(value)) {
        const ops = value as Record<string, unknown>;
        if ("$gte" in ops) return (actual as number) >= (ops.$gte as number);
        if ("$in" in ops) {
          const list = ops.$in as unknown[];
          return list.some((entry) =>
            entry instanceof ObjectId && actual instanceof ObjectId
              ? entry.equals(actual)
              : entry === actual
          );
        }
        if ("$ne" in ops) return actual !== ops.$ne;
        return false;
      }
      return actual === value;
    });

  const applyUpdate = (doc: Record<string, unknown>, update: Record<string, unknown>) => {
    if (update.$inc) {
      for (const [key, delta] of Object.entries(update.$inc as Record<string, number>)) {
        doc[key] = ((doc[key] as number) ?? 0) + delta;
      }
    }
    if (update.$set) Object.assign(doc, update.$set as Record<string, unknown>);
  };

  const members = db.collection("cabinetMembers");
  members.find.mockImplementation((filter: Record<string, unknown> = {}) => {
    const docs = [...rowStore.values()].filter((row) =>
      matches(row as unknown as Record<string, unknown>, filter)
    );
    return { project: () => ({ toArray: async () => docs.map((doc) => ({ ...doc })) }) };
  });
  members.findOne.mockImplementation(async (filter: Record<string, unknown> = {}) => {
    const found = [...rowStore.values()].find((row) =>
      matches(row as unknown as Record<string, unknown>, filter)
    );
    return found ? { ...found } : null;
  });
  members.updateOne.mockImplementation(
    async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      const found = [...rowStore.values()].find(
        (row) =>
          matches(row as unknown as Record<string, unknown>, filter) &&
          (!(filter.ministerialActions as Record<string, unknown> | undefined)?.$gte ||
            (row.ministerialActions ?? -1) >=
              ((filter.ministerialActions as Record<string, number>).$gte as number))
      );
      if (!found) return { modifiedCount: 0, matchedCount: 0 };
      applyUpdate(found as unknown as Record<string, unknown>, update);
      return { modifiedCount: 1, matchedCount: 1 };
    }
  );
  members.updateMany.mockImplementation(
    async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      let count = 0;
      for (const row of rowStore.values()) {
        if (matches(row as unknown as Record<string, unknown>, filter)) {
          applyUpdate(row as unknown as Record<string, unknown>, update);
          count++;
        }
      }
      return { modifiedCount: count, matchedCount: count };
    }
  );

  const characters = db.collection("characters");
  characters.findOne.mockImplementation(async (filter: Record<string, unknown> = {}) => {
    const found = [...charStore.values()].find((char) =>
      matches(char as unknown as Record<string, unknown>, filter)
    );
    return found ? { ...found } : null;
  });
  characters.find.mockImplementation((filter: Record<string, unknown> = {}) => {
    const idFilter = (filter._id ?? {}) as { $in?: ObjectId[] };
    const docs = [...charStore.values()].filter((char) =>
      idFilter.$in ? idFilter.$in.some((id) => id.equals(char._id)) : true
    );
    return { project: () => ({ toArray: async () => docs.map((doc) => ({ ...doc })) }) };
  });
  characters.updateOne.mockImplementation(
    async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      const found = [...charStore.values()].find((char) =>
        matches(char as unknown as Record<string, unknown>, filter)
      );
      if (!found) return { modifiedCount: 0, matchedCount: 0 };
      applyUpdate(found as unknown as Record<string, unknown>, update);
      return { modifiedCount: 1, matchedCount: 1 };
    }
  );
  characters.findOneAndUpdate.mockImplementation(
    async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      const found = [...charStore.values()].find((char) => {
        if (
          !matches(char as unknown as Record<string, unknown>, {
            _id: (filter as Record<string, unknown>)._id,
          })
        ) {
          return false;
        }
        const gate = (filter as Record<string, Record<string, number>>).sharedMinisterialActions;
        if (gate?.$gte != null) return (char.sharedMinisterialActions ?? -1) >= gate.$gte;
        return true;
      });
      if (!found) return null;
      applyUpdate(found as unknown as Record<string, unknown>, update);
      return { ...found };
    }
  );

  return { db, rowStore, charStore };
}

function ukRows(holderId: ObjectId): RowDoc[] {
  return [
    {
      _id: new ObjectId(),
      countryId: "UK",
      positionId: "chancellor",
      characterId: holderId,
      ministerialActions: 3,
      lastMinisterialActionResetDay: TODAY,
    },
    {
      _id: new ObjectId(),
      countryId: "UK",
      positionId: "deputy_prime_minister",
      characterId: holderId,
      ministerialActions: MINISTERIAL_ACTION_CAP,
      lastMinisterialActionResetDay: TODAY,
    },
  ];
}

let holderId: ObjectId;

beforeEach(() => {
  holderId = new ObjectId();
});

describe("usesSharedMinisterialPool", () => {
  it("covers UK player rows only, never NPP rows or other countries", () => {
    expect(usesSharedMinisterialPool("UK", { characterId: holderId } as never)).toBe(true);
    expect(usesSharedMinisterialPool("UK", { characterId: null } as never)).toBe(false);
    expect(usesSharedMinisterialPool("DE", { characterId: holderId } as never)).toBe(false);
    expect(usesSharedMinisterialPool("US", { characterId: holderId } as never)).toBe(false);
  });
});

describe("ensureUkSharedPool", () => {
  it("initializes a missing pool from the minimum surviving row balance, never a fresh cap", () => {
    const { db } = setupStore(ukRows(holderId), [{ _id: holderId }]);
    return expect(ensureUkSharedPool(db as unknown as Db, holderId, NOW)).resolves.toEqual({
      remaining: 3,
      resetDay: TODAY,
    });
  });

  it("leaves an existing character pool untouched", async () => {
    const { db } = setupStore(ukRows(holderId), [
      { _id: holderId, sharedMinisterialActions: 1, sharedMinisterialActionResetDay: YESTERDAY },
    ]);
    await expect(ensureUkSharedPool(db as unknown as Db, holderId, NOW)).resolves.toEqual({
      remaining: 1,
      resetDay: YESTERDAY,
    });
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });
});

describe("spendMinisterialAction", () => {
  it("spends one shared balance and mirrors it to both office rows", async () => {
    const { db, rowStore, charStore } = setupStore(ukRows(holderId), [{ _id: holderId }]);
    const [dept, central] = [...rowStore.values()];
    const spend = await spendMinisterialAction(
      db as unknown as Db,
      "UK",
      { ...dept!, ministerialActions: 3 } as never,
      NOW
    );
    expect(spend).toEqual({ ok: true, remaining: 2 });
    expect(charStore.get(holderId.toString())?.sharedMinisterialActions).toBe(2);
    for (const row of rowStore.values()) {
      expect(row.ministerialActions).toBe(2);
    }
    // Spending from the second office draws the same pool, so both office
    // pages report the same remaining balance.
    const second = await spendMinisterialAction(
      db as unknown as Db,
      "UK",
      { ...central!, ministerialActions: 2 } as never,
      NOW
    );
    expect(second).toEqual({ ok: true, remaining: 1 });
    expect(
      await resolveMinisterialRemaining(db as unknown as Db, "UK", { ...dept! } as never, NOW)
    ).toBe(1);
  });

  it("reports exhaustion on either office once the shared pool hits zero", async () => {
    const { db } = setupStore(ukRows(holderId), [
      { _id: holderId, sharedMinisterialActions: 0, sharedMinisterialActionResetDay: TODAY },
    ]);
    const row = {
      _id: new ObjectId(),
      countryId: "UK",
      positionId: "chancellor",
      characterId: holderId,
    };
    await expect(
      spendMinisterialAction(db as unknown as Db, "UK", row as never, NOW)
    ).resolves.toEqual({ ok: false, remaining: 0 });
    const central = { ...row, positionId: "deputy_prime_minister" };
    await expect(
      spendMinisterialAction(db as unknown as Db, "UK", central as never, NOW)
    ).resolves.toEqual({ ok: false, remaining: 0 });
    expect(db.collectionMocks.cabinetMembers.updateMany).not.toHaveBeenCalled();
  });

  it("keeps the legacy per-row spend outside the UK and for NPP-held UK rows", async () => {
    const foreignId = new ObjectId();
    const { db, rowStore, charStore } = setupStore(
      [
        {
          _id: new ObjectId(),
          countryId: "DE",
          positionId: "finance_minister",
          characterId: foreignId,
          ministerialActions: 2,
          lastMinisterialActionResetDay: TODAY,
        },
        {
          _id: new ObjectId(),
          countryId: "UK",
          positionId: "chancellor",
          characterId: null,
          ministerialActions: 2,
          lastMinisterialActionResetDay: TODAY,
        },
      ],
      [{ _id: foreignId }]
    );
    const [foreign, npp] = [...rowStore.values()];
    await expect(
      spendMinisterialAction(db as unknown as Db, "DE", { ...foreign! } as never, NOW)
    ).resolves.toEqual({ ok: true, remaining: 1 });
    await expect(
      spendMinisterialAction(db as unknown as Db, "UK", { ...npp! } as never, NOW)
    ).resolves.toEqual({ ok: true, remaining: 1 });
    expect(charStore.get(foreignId.toString())?.sharedMinisterialActions).toBeUndefined();
    expect(db.collectionMocks.characters.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("refunds to the shared pool and mirrors to both rows after a failed order write", async () => {
    const { db, rowStore, charStore } = setupStore(ukRows(holderId), [
      { _id: holderId, sharedMinisterialActions: 2, sharedMinisterialActionResetDay: TODAY },
    ]);
    const [dept] = [...rowStore.values()];
    await refundMinisterialAction(db as unknown as Db, "UK", { ...dept! } as never, NOW);
    expect(charStore.get(holderId.toString())?.sharedMinisterialActions).toBe(3);
    for (const row of rowStore.values()) {
      expect(row.ministerialActions).toBe(3);
    }
  });
});

describe("reconcileUkSharedPool", () => {
  it("recomputes the pool from the minimum row so a fresh cap row cannot mint actions", async () => {
    const { db, rowStore, charStore } = setupStore(ukRows(holderId), [{ _id: holderId }]);
    const reconciled = await reconcileUkSharedPool(db as unknown as Db, holderId, NOW);
    expect(reconciled).toEqual({ remaining: 3, resetDay: TODAY });
    expect(charStore.get(holderId.toString())?.sharedMinisterialActions).toBe(3);
    for (const row of rowStore.values()) {
      expect(row.ministerialActions).toBe(3);
    }
  });
});

describe("ukSharedPoolIdsNeedingReset", () => {
  it("lists missing and stale pools and skips fresh ones", async () => {
    const freshId = new ObjectId();
    const staleId = new ObjectId();
    const missingId = new ObjectId();
    const { db } = setupStore(
      [],
      [
        { _id: freshId, sharedMinisterialActions: 1, sharedMinisterialActionResetDay: TODAY },
        { _id: staleId, sharedMinisterialActions: 1, sharedMinisterialActionResetDay: YESTERDAY },
        { _id: missingId },
      ]
    );
    const rows = [freshId, staleId, missingId].map((characterId) => ({
      characterId,
      countryId: "UK",
    }));
    await expect(ukSharedPoolIdsNeedingReset(db as unknown as Db, rows, TODAY)).resolves.toEqual(
      expect.arrayContaining([staleId.toString(), missingId.toString()])
    );
    const ids = await ukSharedPoolIdsNeedingReset(db as unknown as Db, rows, TODAY);
    expect(ids).not.toContain(freshId.toString());
  });

  it("ignores non-UK rows and NPP seats", async () => {
    const { db } = setupStore([], []);
    await expect(
      ukSharedPoolIdsNeedingReset(
        db as unknown as Db,
        [
          { characterId: new ObjectId(), countryId: "DE" },
          { characterId: null, countryId: "UK" },
        ],
        TODAY
      )
    ).resolves.toEqual([]);
    expect(db.collectionMocks.characters.find).not.toHaveBeenCalled();
  });
});
