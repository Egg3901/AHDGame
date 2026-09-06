import { describe, expect, it } from "vitest";
import {
  ORDERS_OF_BATTLE,
  ORDERS_OF_BATTLE_BY_ERA,
  resolveOrderOfBattle,
  type OrderOfBattleEntry,
} from "./ordersOfBattle";
import {
  MILITARY_BRANCHES_BY_COUNTRY,
  UNIT_TYPES,
  getUnitTypesForYear,
  isMilitaryEraActive,
} from "@/lib/constants/military";
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
    // SCO and WAL are the only countries left without one, and correctly so:
    // they have no military branches in any era, so they seed nothing anyway.
    expect(resolveOrderOfBattle("SCO", "1953")).toBeNull();
    expect(resolveOrderOfBattle("WAL", "2019")).toBeNull();
  });

  it("authors every country that can field a force", () => {
    const unauthored = (Object.keys(MILITARY_BRANCHES_BY_COUNTRY) as CountryId[]).filter(
      (c) => MILITARY_BRANCHES_BY_COUNTRY[c].length > 0 && !ORDERS_OF_BATTLE[c]
    );
    // An unauthored branch falls back to 3-5 random units, which is how Ireland
    // came to outgun the United States. Nothing may rejoin that path silently.
    expect(unauthored).toEqual([]);
  });

  it("never names a branch using only archetypes that post-date the era", () => {
    // authoredPicks empty => buildCountryRoster falls back to random generation
    // for that branch, silently discarding the authored composition.
    const offenders: string[] = [];
    for (const [era, year] of [
      ["1979", 1979],
      ["1991", 1991],
      ["1999", 1999],
      ["2007", 2007],
      ["2019", 2019],
      ["2023", 2023],
    ] as Array<[string, number]>) {
      for (const [countryId, entries] of Object.entries(ORDERS_OF_BATTLE_BY_ERA[era] ?? {})) {
        const branches = MILITARY_BRANCHES_BY_COUNTRY[countryId as CountryId] ?? [];
        const byBranch = new Map<string, OrderOfBattleEntry[]>();
        for (const e of entries ?? []) {
          byBranch.set(e.branchId, [...(byBranch.get(e.branchId) ?? []), e]);
        }
        for (const [branchId, named] of byBranch) {
          const branch = branches.find((b) => b.id === branchId);
          if (!branch || !isMilitaryEraActive(branch, year)) continue;
          const active = getUnitTypesForYear(branch.domain, year).map((a) => a.type);
          if (active.length === 0) continue; // branch seeds nothing at all; not a fallback
          if (!named.some((e) => active.includes(e.type))) {
            offenders.push(`${era}/${countryId}/${branchId}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
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
