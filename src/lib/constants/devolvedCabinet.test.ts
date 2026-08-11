import { describe, expect, it } from "vitest";
import { SCO_CABINET_POSITIONS, SCO_CABINET_MECHANICS, SCO_MINISTERIAL_ORDERS } from "./scoCabinet";
import { WAL_CABINET_POSITIONS, WAL_CABINET_MECHANICS, WAL_MINISTERIAL_ORDERS } from "./walCabinet";
import { getCabinetMechanics, getCabinetPositions } from "./cabinetMechanics";
import { getMinisterialOrders } from "./cabinetOrders";
import { COUNTRY_CONFIGS } from "./countries";
import { isParliamentaryCabinetCountry } from "@/app/country/[code]/executive/cabinet/parliamentaryCabinetConfig";

const NATIONS = [
  {
    id: "SCO" as const,
    positions: SCO_CABINET_POSITIONS,
    mechanics: SCO_CABINET_MECHANICS,
    orders: SCO_MINISTERIAL_ORDERS,
  },
  {
    id: "WAL" as const,
    positions: WAL_CABINET_POSITIONS,
    mechanics: WAL_CABINET_MECHANICS,
    orders: WAL_MINISTERIAL_ORDERS,
  },
];

describe.each(NATIONS)("$id devolved cabinet", ({ id, positions, mechanics, orders }) => {
  it("has 12 seats with unique ids and sequential orders", () => {
    expect(positions.length).toBe(12);
    expect(new Set(positions.map((p) => p.id)).size).toBe(12);
    expect(positions.map((p) => p.order)).toEqual([...Array(12).keys()]);
  });

  it("financeSecretary matches the config's financeMinisterCabinetId", () => {
    expect(COUNTRY_CONFIGS[id].financeMinisterCabinetId).toBe("financeSecretary");
    expect(positions.map((p) => p.id)).toContain("financeSecretary");
  });

  it("every seat has reused mechanics (matching positionId, localized department, metrics)", () => {
    for (const p of positions) {
      const m = mechanics[p.id];
      expect(m).toBeDefined();
      expect(m!.positionId).toBe(p.id);
      expect(m!.department).toBeTruthy();
      expect(m!.nationalMetrics.length).toBeGreaterThan(0);
    }
  });

  it("only financeSecretary carries the bond profile (sole-finance invariant)", () => {
    expect(mechanics.financeSecretary?.bondProfile).toBeDefined();
    for (const p of positions) {
      if (p.id === "financeSecretary") continue;
      expect(mechanics[p.id]!.bondProfile).toBeUndefined();
    }
  });

  it("resolves through the cabinet + orders barrels", () => {
    expect(getCabinetPositions(id).length).toBe(12);
    expect(getCabinetMechanics(id, "financeSecretary")?.positionId).toBe("financeSecretary");
  });

  it("ministerial orders (reused from UK) are valid where present", () => {
    for (const p of positions) {
      expect(orders[p.id]).toBeDefined();
      for (const o of getMinisterialOrders(id, p.id)) {
        expect(o.duration).toBeGreaterThan(0);
        expect(o.effects.length).toBeGreaterThan(0);
      }
    }
  });

  it("is registered as a parliamentary-cabinet country (so the cabinet UI renders)", () => {
    expect(isParliamentaryCabinetCountry(id)).toBe(true);
  });
});

describe("SCO and WAL share seat ids but localize the display names", () => {
  it("identical ids, nation-specific names", () => {
    expect(SCO_CABINET_POSITIONS.map((p) => p.id)).toEqual(WAL_CABINET_POSITIONS.map((p) => p.id));
    const sco = SCO_CABINET_POSITIONS.find((p) => p.id === "economySecretary")!.name;
    const wal = WAL_CABINET_POSITIONS.find((p) => p.id === "economySecretary")!.name;
    expect(sco).not.toBe(wal);
    expect(wal).toMatch(/Welsh Language/);
  });
});
