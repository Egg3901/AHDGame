import { describe, it, expect } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  getDiplomaticActionsRemaining,
  remainingFromRow,
  spendDiplomaticAction,
} from "./diplomaticActions";
import { DIPLOMATIC_ACTIONS_PER_TURN } from "@/lib/constants/internationalOrganizations";
import type { DiplomaticActionBudget } from "@/lib/db/types/diplomaticAction";

/**
 * Minimal stateful fake of the `diplomaticActions` collection — enough for
 * findOne by countryId + upsert via $set. The shared MockDb is stateless, so a
 * hand-rolled store is needed to exercise the decrement / refresh logic.
 */
function makeDb(): Db {
  const rows: DiplomaticActionBudget[] = [];
  const col = {
    async findOne(filter: { countryId: string }) {
      return rows.find((r) => r.countryId === filter.countryId) ?? null;
    },
    async updateOne(
      filter: { countryId: string },
      update: { $set: Partial<DiplomaticActionBudget> },
      opts?: { upsert?: boolean }
    ) {
      let row = rows.find((r) => r.countryId === filter.countryId);
      if (!row) {
        if (!opts?.upsert) return { matchedCount: 0, modifiedCount: 0 };
        row = { _id: new ObjectId(), countryId: filter.countryId } as DiplomaticActionBudget;
        rows.push(row);
      }
      Object.assign(row, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
  return { collection: () => col } as unknown as Db;
}

describe("remainingFromRow (pure)", () => {
  it("a missing row reads as full budget", () => {
    expect(remainingFromRow(null, 10)).toBe(DIPLOMATIC_ACTIONS_PER_TURN);
  });
  it("a stale (older-turn) row reads as full budget", () => {
    expect(remainingFromRow({ turn: 9, remaining: 0 }, 10)).toBe(DIPLOMATIC_ACTIONS_PER_TURN);
  });
  it("a current-turn row reports its clamped remaining", () => {
    expect(remainingFromRow({ turn: 10, remaining: 2 }, 10)).toBe(2);
    expect(remainingFromRow({ turn: 10, remaining: 99 }, 10)).toBe(DIPLOMATIC_ACTIONS_PER_TURN);
    expect(remainingFromRow({ turn: 10, remaining: -3 }, 10)).toBe(0);
  });
});

describe("diplomatic action budget (stateful)", () => {
  it("a fresh country has the full budget", async () => {
    const db = makeDb();
    expect(await getDiplomaticActionsRemaining(db, "US", 10)).toBe(DIPLOMATIC_ACTIONS_PER_TURN);
  });

  it("spending decrements within a turn", async () => {
    const db = makeDb();
    const r1 = await spendDiplomaticAction(db, "US", 10);
    expect(r1).toEqual({ ok: true, remaining: DIPLOMATIC_ACTIONS_PER_TURN - 1 });
    expect(await getDiplomaticActionsRemaining(db, "US", 10)).toBe(DIPLOMATIC_ACTIONS_PER_TURN - 1);
  });

  it("rejects once the budget is exhausted", async () => {
    const db = makeDb();
    for (let i = 0; i < DIPLOMATIC_ACTIONS_PER_TURN; i++) {
      expect((await spendDiplomaticAction(db, "US", 10)).ok).toBe(true);
    }
    const over = await spendDiplomaticAction(db, "US", 10);
    expect(over).toEqual({ ok: false, remaining: 0 });
  });

  it("refreshes to full on a new turn", async () => {
    const db = makeDb();
    await spendDiplomaticAction(db, "US", 10);
    expect(await getDiplomaticActionsRemaining(db, "US", 11)).toBe(DIPLOMATIC_ACTIONS_PER_TURN);
    const r = await spendDiplomaticAction(db, "US", 11);
    expect(r.remaining).toBe(DIPLOMATIC_ACTIONS_PER_TURN - 1);
  });

  it("budgets are independent per country", async () => {
    const db = makeDb();
    await spendDiplomaticAction(db, "US", 10);
    expect(await getDiplomaticActionsRemaining(db, "UK", 10)).toBe(DIPLOMATIC_ACTIONS_PER_TURN);
  });
});
