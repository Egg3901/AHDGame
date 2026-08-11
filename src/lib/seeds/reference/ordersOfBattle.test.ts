import { describe, expect, it } from "vitest";
import {
  ORDERS_OF_BATTLE,
  ORDERS_OF_BATTLE_BY_ERA,
  resolveOrderOfBattle,
  type OrderOfBattleEntry,
} from "./ordersOfBattle";
import { MILITARY_BRANCHES_BY_COUNTRY, UNIT_TYPES } from "@/lib/constants/military";
import type { CountryId } from "@/lib/constants/countries";

type Table = Partial<Record<CountryId, OrderOfBattleEntry[]>>;

describe("orders of battle", () => {
  it("references only real branches and real archetypes", () => {
    const tables: Array<[string, Table]> = [
      ["canonical", ORDERS_OF_BATTLE],
      ...Object.entries(ORDERS_OF_BATTLE_BY_ERA).map(
        ([era, t]) => [era, t ?? {}] as [string, Table]
      ),
    ];
    for (const [label, table] of tables) {
      for (const [countryId, entries] of Object.entries(table)) {
        const branches = MILITARY_BRANCHES_BY_COUNTRY[countryId as CountryId] ?? [];
        for (const entry of entries ?? []) {
          const branch = branches.find((b) => b.id === entry.branchId);
          expect(branch, `${label}/${countryId}: unknown branch "${entry.branchId}"`).toBeTruthy();
          expect(
            UNIT_TYPES[branch!.domain].map((a) => a.type),
            `${label}/${countryId}/${entry.branchId}: "${entry.type}" not in ${branch!.domain}`
          ).toContain(entry.type);
          expect(entry.count, `${label}/${countryId}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("has no 1953 key in the era table — 1953 is the canonical table", () => {
    expect(ORDERS_OF_BATTLE_BY_ERA["1953"]).toBeUndefined();
  });

  it("returns the canonical roster when no era override exists", () => {
    expect(resolveOrderOfBattle("PL", "1979")).toEqual(ORDERS_OF_BATTLE.PL);
  });

  it("returns null for a country with no authored roster", () => {
    expect(resolveOrderOfBattle("US", "1953")).toBeNull();
  });

  it("falls back to canonical when era is undefined", () => {
    expect(resolveOrderOfBattle("RU", undefined)).toEqual(ORDERS_OF_BATTLE.RU);
  });

  it("prefers an era override over the canonical roster", () => {
    const override: OrderOfBattleEntry[] = [
      { branchId: "ground", type: "Infantry Division", count: 1 },
    ];
    // SAVE/RESTORE, never `delete` — "2019" is a real shipped key now (RU), and
    // deleting it would strip that override for every later test in this file.
    const saved = ORDERS_OF_BATTLE_BY_ERA["2019"];
    ORDERS_OF_BATTLE_BY_ERA["2019"] = { PL: override };
    try {
      expect(resolveOrderOfBattle("PL", "2019")).toEqual(override);
      expect(resolveOrderOfBattle("PL", "1979")).toEqual(ORDERS_OF_BATTLE.PL);
    } finally {
      ORDERS_OF_BATTLE_BY_ERA["2019"] = saved;
    }
  });

  it("keeps the RU overrides that stop its later-era force going over budget", () => {
    // A 1953-pegged table cannot name RU's 1959 rocket or 1992 space force, so
    // without these the unnamed branches fall back to random generation and push
    // RU past its envelope floor. Measured before the overrides: 1979/1991 105%,
    // 2019 114%. Guarded end-to-end by seedMilitaryUnits.test.ts.
    for (const era of ["1979", "1991", "2019"]) {
      const ru = ORDERS_OF_BATTLE_BY_ERA[era]?.RU;
      expect(ru, `${era} must override RU`).toBeTruthy();
      expect(
        ru!.some((e) => e.branchId === "rocket"),
        `${era} must name the rocket force`
      ).toBe(true);
    }
    // The space forces stand up in 1992, so only the 2019 table names them.
    expect(ORDERS_OF_BATTLE_BY_ERA["2019"]!.RU!.some((e) => e.branchId === "space")).toBe(true);
    expect(ORDERS_OF_BATTLE_BY_ERA["1979"]!.RU!.some((e) => e.branchId === "space")).toBe(false);
  });
});
