import { describe, it, expect, vi } from "vitest";
import {
  seedTradeLanes,
  COCOM_MEMBERS_1953,
  COMECON_MEMBERS_1953,
  STRATEGIC_COMMODITIES_1953,
} from "./seedTradeLanes";
import type { Db } from "mongodb";

vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(42) }));

function fakeDb(existing: Array<Record<string, unknown>> = []) {
  const inserted: Array<Record<string, unknown>> = [];
  const col = {
    find: () => ({ toArray: async () => existing }),
    insertMany: async (docs: Array<Record<string, unknown>>) => {
      inserted.push(...docs);
      return { insertedCount: docs.length };
    },
  };
  return { db: { collection: () => col } as unknown as Db, inserted };
}

const noop = () => {};

describe("seedTradeLanes", () => {
  // 8 CoCom × (7 Comecon + CN) × 9 strategic + 8 CHINCOM "all" docs.
  const expected =
    COCOM_MEMBERS_1953.length *
      (COMECON_MEMBERS_1953.length + 1) *
      STRATEGIC_COMMODITIES_1953.length +
    COCOM_MEMBERS_1953.length;

  it("is a no-op on modern presets", async () => {
    const { db, inserted } = fakeDb();
    const res = await seedTradeLanes(db, noop, "2019-default");
    expect(res.inserted).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it("seeds the full lane set on a 1953 preset", async () => {
    const { db, inserted } = fakeDb();
    const res = await seedTradeLanes(db, noop, "1953-default");
    expect(res.inserted).toBe(expected);
    expect(inserted).toHaveLength(expected);
    // Every lane is a durable organization-origin block: legislation origin
    // would be wiped by the per-turn bill rebuild, minister origin would need
    // an expiry.
    for (const d of inserted) {
      expect(d.origin).toBe("organization");
      expect(d.mode).toBe("block");
      expect(d.expiresTurn).toBeUndefined();
    }
    // Neutral leak routes carry no walls in either direction.
    for (const neutral of ["YU", "FI", "AT", "SE", "ES", "IE", "BR", "NG"]) {
      expect(inserted.some((d) => d.sourceCountry === neutral || d.targetCountry === neutral)).toBe(
        false
      );
    }
    // CHINCOM differential is export-only so it can never trip the
    // comprehensive-embargo corp suppression (which requires direction both).
    const chincom = inserted.filter((d) => d.commodity === "all");
    expect(chincom).toHaveLength(COCOM_MEMBERS_1953.length);
    for (const d of chincom) {
      expect(d.targetCountry).toBe("CN");
      expect(d.direction).toBe("export");
    }
  });

  it("is idempotent against existing rows on the same lane keys", async () => {
    const { db: db1, inserted: first } = fakeDb();
    await seedTradeLanes(db1, noop, "1953-default");
    const { db: db2, inserted: second } = fakeDb(first);
    const res = await seedTradeLanes(db2, noop, "1953-default");
    expect(res.inserted).toBe(0);
    expect(second).toHaveLength(0);
  });
});
