import { describe, expect, it } from "vitest";
import { COMMAND_CEILING, DUAL_TRACK_CEILING } from "@/lib/constants/commandEconomy";
import { REPRIVATIZE_COOLDOWN_TURNS } from "@/lib/nationalization/constants";
import {
  NPP_PRIVATIZATION_DUAL_TRACK,
  NPP_PRIVATIZATION_MARKET,
  NPP_PRIVATIZATION_STRATEGIC_GOLDEN_SHARE,
  nppPrivatizationGate,
  planNppPrivatization,
  privatizationPaceForLevel,
  sectorMarginFraction,
  type NppPrivatizationInput,
  type PrivatizationCandidateSector,
} from "./privatizationSponsorship";

const CORP = "aaaaaaaaaaaaaaaaaaaaaaaa";

function sector(
  id: string,
  overrides: Partial<PrivatizationCandidateSector> = {}
): PrivatizationCandidateSector {
  return {
    id,
    corporationId: CORP,
    sectorType: "retail",
    revenue: 1000,
    effectiveProfitMargin: 10,
    ...overrides,
  };
}

function input(overrides: Partial<NppPrivatizationInput> = {}): NppPrivatizationInput {
  return {
    level: 50,
    hasMarketizationSchedule: true,
    currentTurn: 1000,
    activeNppPrivatizeBills: 0,
    lastNppPrivatizeTurn: null,
    recentlyProposedSectorIds: new Set(),
    sectors: Array.from({ length: 10 }, (_, i) => sector(`s${i}`, { effectiveProfitMargin: i })),
    strategicSectorTypes: new Set(),
    ...overrides,
  };
}

function sectorCount(plan: ReturnType<typeof planNppPrivatization>): number {
  return plan.ok ? plan.provisions.reduce((n, p) => n + p.selections.length, 0) : 0;
}

describe("privatizationPaceForLevel", () => {
  it("is null below the command ceiling and for unscheduled countries", () => {
    expect(privatizationPaceForLevel(COMMAND_CEILING - 0.01, true)).toBeNull();
    expect(privatizationPaceForLevel(10, true)).toBeNull();
    expect(privatizationPaceForLevel(100, false)).toBeNull();
    expect(privatizationPaceForLevel(Number.NaN, true)).toBeNull();
  });

  it("dual-track sells small slices that grow across the band", () => {
    const low = privatizationPaceForLevel(COMMAND_CEILING, true)!;
    const mid = privatizationPaceForLevel(50, true)!;
    const high = privatizationPaceForLevel(DUAL_TRACK_CEILING - 0.01, true)!;
    expect(low.band).toBe("dualTrack");
    expect(low.maxSectors).toBe(NPP_PRIVATIZATION_DUAL_TRACK.minSectors);
    expect(low.carveFraction).toBeCloseTo(NPP_PRIVATIZATION_DUAL_TRACK.minCarveFraction);
    expect(mid.maxSectors).toBe(2);
    expect(high.maxSectors).toBe(NPP_PRIVATIZATION_DUAL_TRACK.maxSectors);
    expect(high.carveFraction).toBeLessThanOrEqual(NPP_PRIVATIZATION_DUAL_TRACK.maxCarveFraction);
    expect(high.carveFraction).toBeGreaterThan(low.carveFraction);
    expect(low.intervalTurns).toBe(NPP_PRIVATIZATION_DUAL_TRACK.intervalTurns);
  });

  it("market band is larger and more frequent than any dual-track level", () => {
    const market = privatizationPaceForLevel(DUAL_TRACK_CEILING, true)!;
    const dual = privatizationPaceForLevel(DUAL_TRACK_CEILING - 0.01, true)!;
    expect(market.band).toBe("market");
    expect(market.maxSectors).toBe(NPP_PRIVATIZATION_MARKET.sectors);
    expect(market.maxSectors).toBeGreaterThan(dual.maxSectors);
    expect(market.carveFraction).toBeGreaterThan(dual.carveFraction);
    expect(market.intervalTurns).toBeLessThan(dual.intervalTurns);
  });
});

describe("nppPrivatizationGate", () => {
  it("holds at most one active NPP privatization bill", () => {
    expect(nppPrivatizationGate({ ...input(), activeNppPrivatizeBills: 1 })).toEqual({
      ok: false,
      reason: "active_bill",
    });
  });

  it("waits for the band's interval", () => {
    const dualInterval = NPP_PRIVATIZATION_DUAL_TRACK.intervalTurns;
    expect(
      nppPrivatizationGate({ ...input(), lastNppPrivatizeTurn: 1000 - dualInterval + 1 }).ok
    ).toBe(false);
    expect(nppPrivatizationGate({ ...input(), lastNppPrivatizeTurn: 1000 - dualInterval }).ok).toBe(
      true
    );
    // The same gap clears the shorter market interval.
    const marketGap = NPP_PRIVATIZATION_MARKET.intervalTurns;
    expect(
      nppPrivatizationGate({ ...input({ level: 90 }), lastNppPrivatizeTurn: 1000 - marketGap }).ok
    ).toBe(true);
  });
});

describe("planNppPrivatization", () => {
  it("proposes nothing below the ceiling", () => {
    expect(planNppPrivatization(input({ level: 10 }))).toEqual({
      ok: false,
      reason: "not_eligible",
    });
  });

  it("proposes nothing in a country without a marketization schedule", () => {
    expect(planNppPrivatization(input({ level: 100, hasMarketizationSchedule: false }))).toEqual({
      ok: false,
      reason: "not_eligible",
    });
  });

  it("dual-track proposes a small batch at partial fractions", () => {
    const plan = planNppPrivatization(input({ level: 35 }));
    expect(plan.ok).toBe(true);
    expect(sectorCount(plan)).toBe(1);
    if (!plan.ok) return;
    for (const p of plan.provisions) {
      for (const sel of p.selections) expect(sel.carveFraction).toBeLessThanOrEqual(0.3);
    }
  });

  it("market band proposes a larger batch than dual-track", () => {
    const dual = planNppPrivatization(input({ level: 60 }));
    const market = planNppPrivatization(input({ level: 85 }));
    expect(sectorCount(market)).toBe(NPP_PRIVATIZATION_MARKET.sectors);
    expect(sectorCount(market)).toBeGreaterThan(sectorCount(dual));
  });

  it("is blocked by an active NPP privatization bill", () => {
    expect(planNppPrivatization(input({ level: 85, activeNppPrivatizeBills: 1 })).ok).toBe(false);
  });

  it("prefers loss-making, then thin-margin sectors", () => {
    const plan = planNppPrivatization(
      input({
        level: 85,
        sectors: [
          sector("profitable", { effectiveProfitMargin: 40 }),
          sector("loss", { effectiveProfitMargin: 50, plantsProfit: -10, plantsRevenue: 100 }),
          sector("thin", { effectiveProfitMargin: 2 }),
        ],
      })
    );
    expect(plan.ok && plan.provisions[0].selections.map((s) => s.sectorId)).toEqual([
      "loss",
      "thin",
      "profitable",
    ]);
  });

  it("puts strategic sectors last and gives them a golden share", () => {
    const plan = planNppPrivatization(
      input({
        level: 85,
        sectors: [
          sector("energy", { sectorType: "energy", effectiveProfitMargin: -50 }),
          sector("shop", { sectorType: "retail", effectiveProfitMargin: 30 }),
        ],
        strategicSectorTypes: new Set(["energy"]),
      })
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.provisions.map((p) => p.sectorType)).toEqual(["retail", "energy"]);
    expect(plan.provisions[0].goldenSharePercent).toBe(0);
    expect(plan.provisions[1].goldenSharePercent).toBe(NPP_PRIVATIZATION_STRATEGIC_GOLDEN_SHARE);
  });

  it("skips defence, idle, locked, recently absorbed and recently proposed sectors", () => {
    const plan = planNppPrivatization(
      input({
        level: 85,
        currentTurn: 1000,
        recentlyProposedSectorIds: new Set(["recent"]),
        sectors: [
          sector("arms", { sectorType: "defense", effectiveProfitMargin: -90 }),
          sector("idle", { revenue: 0 }),
          sector("locked", { constructionLocked: true }),
          sector("absorbed", { absorbedAtTurn: 1000 - REPRIVATIZE_COOLDOWN_TURNS + 1 }),
          sector("recent"),
          sector("ok"),
        ],
      })
    );
    expect(plan.ok && plan.provisions.flatMap((p) => p.selections.map((s) => s.sectorId))).toEqual([
      "ok",
    ]);
  });

  it("reports no candidates when nothing is sellable", () => {
    expect(planNppPrivatization(input({ sectors: [] }))).toEqual({
      ok: false,
      reason: "no_candidates",
    });
  });

  it("groups selections into one provision per source corporation and sector type", () => {
    const plan = planNppPrivatization(
      input({
        level: 85,
        sectors: [
          sector("a1", { sectorType: "agriculture", effectiveProfitMargin: 1 }),
          sector("a2", { sectorType: "agriculture", effectiveProfitMargin: 2 }),
          sector("r1", { sectorType: "retail", effectiveProfitMargin: 3 }),
        ],
      })
    );
    expect(plan.ok && plan.provisions.map((p) => [p.sectorType, p.selections.length])).toEqual([
      ["agriculture", 2],
      ["retail", 1],
    ]);
  });
});

describe("sectorMarginFraction", () => {
  it("reads the plants P&L first, then the percent margin", () => {
    expect(sectorMarginFraction(sector("x", { plantsProfit: 5, plantsRevenue: 50 }))).toBeCloseTo(
      0.1
    );
    expect(sectorMarginFraction(sector("x", { effectiveProfitMargin: 12 }))).toBeCloseTo(0.12);
    expect(sectorMarginFraction(sector("x", { effectiveProfitMargin: null }))).toBe(0);
  });
});
