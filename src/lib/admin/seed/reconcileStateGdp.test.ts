import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import type { State } from "@/lib/db/types";
import {
  computeStateGdpScalars,
  reconcileStateGdpWithNationalSeeds,
  shouldReconcileStateGdpForPreset,
  STATE_GDP_RECONCILE_TOLERANCE,
} from "./reconcileStateGdp";
import { getNationalBudgetSeedConfigsForPreset } from "@/lib/seeds/reference/budgets";

// ── 1953 authored regional bundles (same modules the seeders import) ─────────
import { states1953 } from "@/lib/seeds/reference/states1953";
import { ukRegions1953 } from "@/lib/seeds/uk/ukRegions1953";
import { jpRegions1953 } from "@/lib/seeds/jp/jpRegions1953";
import { deRegions1953 } from "@/lib/seeds/de/deRegions1953";
import { brRegions1953 } from "@/lib/seeds/br/brRegions1953";
import { cnRegions1953 } from "@/lib/seeds/cn/cnRegions1953";
import { ieRegions1953 } from "@/lib/seeds/ie/ieRegions1953";
import { ruRegions1953 } from "@/lib/seeds/ru/ruRegions1953";
import { frRegions1953 } from "@/lib/seeds/fr/frRegions1953";
import { itRegions1953 } from "@/lib/seeds/it/itRegions1953";
import { esRegions1953 } from "@/lib/seeds/es/esRegions1953";
import { seRegions1953 } from "@/lib/seeds/se/seRegions1953";
import { trRegions1953 } from "@/lib/seeds/tr/trRegions1953";
import { grRegions1953 } from "@/lib/seeds/gr/grRegions1953";
import { atRegions1953 } from "@/lib/seeds/at/atRegions1953";
import { fiRegions1953 } from "@/lib/seeds/fi/fiRegions1953";
import { ddRegions1953 } from "@/lib/seeds/dd/ddRegions1953";
import { ngRegions1953 } from "@/lib/seeds/ng/ngRegions1953";
import { getHuSeedConfig } from "@/lib/seeds/hu/huSeed";
import { getPlSeedConfig } from "@/lib/seeds/pl/plSeed";
import { getRoSeedConfig } from "@/lib/seeds/ro/roSeed";
import { getYuSeedConfig } from "@/lib/seeds/yu/yuSeed";
import { getBgSeedConfig } from "@/lib/seeds/bg/bgSeed";
import { getUaSeedConfig } from "@/lib/seeds/ua/uaSeed";
import { getBlrSeedConfig } from "@/lib/seeds/blr/blrSeed";
import { getCsSeedConfig } from "@/lib/seeds/cs/csSeed";
import { getBalSeedConfig } from "@/lib/seeds/bal/balSeed";

// ── 2019 authored regional bundles ────────────────────────────────────────────
import { states } from "@/lib/seeds/reference/states";
import { ukRegions } from "@/lib/seeds/uk/ukRegions";
import { jpRegions } from "@/lib/seeds/jp/jpRegions";
import { deRegions } from "@/lib/seeds/de/deRegions";
import { brRegions } from "@/lib/seeds/br/brRegions";
import { cnRegions } from "@/lib/seeds/cn/cnRegions";
import { ieRegions } from "@/lib/seeds/ie/ieRegions";
import { ngRegions } from "@/lib/seeds/ng/ngRegions";

type Row = Pick<State, "_id" | "countryId" | "gdp">;

function authoredRows(preset: "1953-default" | "2019-default"): Row[] {
  if (preset === "1953-default") {
    return [
      ...states1953,
      ...ukRegions1953,
      ...jpRegions1953,
      ...deRegions1953,
      ...brRegions1953,
      ...cnRegions1953,
      ...ieRegions1953,
      ...ruRegions1953,
      ...frRegions1953,
      ...itRegions1953,
      ...esRegions1953,
      ...seRegions1953,
      ...trRegions1953,
      ...grRegions1953,
      ...atRegions1953,
      ...fiRegions1953,
      ...ddRegions1953,
      ...ngRegions1953,
      ...getHuSeedConfig(preset).regions,
      ...getPlSeedConfig(preset).regions,
      ...getRoSeedConfig(preset).regions,
      ...getYuSeedConfig(preset).regions,
      ...getBgSeedConfig(preset).regions,
      ...getUaSeedConfig(preset).regions,
      ...getBlrSeedConfig(preset).regions,
      ...getCsSeedConfig(preset).regions,
      ...getBalSeedConfig(preset).regions,
    ];
  }
  return [
    ...states,
    ...ukRegions,
    ...jpRegions,
    ...deRegions,
    ...brRegions,
    ...cnRegions,
    ...ieRegions,
    ...ngRegions,
  ];
}

function nationalGdps(preset: string): Map<string, number> {
  return new Map(getNationalBudgetSeedConfigsForPreset(preset).map((c) => [c.countryId, c.gdp]));
}

describe("computeStateGdpScalars (pure)", () => {
  it("scales only countries whose deviation exceeds the tolerance", () => {
    const rows: Row[] = [
      { _id: "A1", countryId: "US", gdp: 500_000 }, // Σ US = 1.0M millions = 1e12
      { _id: "A2", countryId: "US", gdp: 500_000 },
      { _id: "B1", countryId: "UK", gdp: 300_000 }, // Σ UK = 3e11 vs authored 1e12 → ×3.33
    ];
    const national = new Map([
      ["US", 1_000_000 * 1_000_000], // exact match
      ["UK", 1_000_000 * 1_000_000],
    ]);
    const result = computeStateGdpScalars(rows, national);
    const us = result.find((r) => r.countryId === "US")!;
    const uk = result.find((r) => r.countryId === "UK")!;
    expect(us.applied).toBe(false);
    expect(us.scalar).toBe(1);
    expect(uk.applied).toBe(true);
    expect(uk.scalar).toBeCloseTo(1_000_000 / 300_000, 10);
  });

  it("stays within the tolerance band without scaling (guard boundary)", () => {
    const rows: Row[] = [{ _id: "A1", countryId: "US", gdp: 1_010_000 }]; // +1%
    const national = new Map([["US", 1_000_000 * 1_000_000]]);
    const [us] = computeStateGdpScalars(rows, national);
    expect(us.deviation).toBeCloseTo(0.01, 10);
    expect(us.applied).toBe(false);
  });

  it("excludes national-scope docs from the sum (mirrors fiscalYear's SSOT)", () => {
    const rows: Row[] = [
      { _id: "federal", countryId: "US", gdp: 999_999_999 }, // national-scope — ignored
      { _id: "CA", countryId: "US", gdp: 1_000_000 },
    ];
    const national = new Map([["US", 1_000_000 * 1_000_000]]);
    const [us] = computeStateGdpScalars(rows, national);
    expect(us.regionalSum).toBe(1_000_000 * 1_000_000);
    expect(us.applied).toBe(false);
  });

  it("skips countries with no regional rows or zero sums", () => {
    const rows: Row[] = [{ _id: "X1", countryId: "UK", gdp: 0 }];
    const national = new Map([
      ["US", 1e12],
      ["UK", 1e12],
    ]);
    expect(computeStateGdpScalars(rows, national)).toEqual([]);
  });

  it("preserves each region's relative share when the scalar is applied", () => {
    const rows: Row[] = [
      { _id: "R1", countryId: "TR", gdp: 750 },
      { _id: "R2", countryId: "TR", gdp: 250 },
    ];
    const national = new Map([["TR", 24_000 * 1_000_000]]);
    const [tr] = computeStateGdpScalars(rows, national);
    expect(tr.applied).toBe(true);
    const scaled = rows.map((r) => r.gdp * tr.scalar);
    // Shares preserved…
    expect(scaled[0] / (scaled[0] + scaled[1])).toBeCloseTo(0.75, 10);
    // …and the new sum matches the authored national GDP exactly.
    expect((scaled[0] + scaled[1]) * 1_000_000).toBeCloseTo(24_000 * 1_000_000, 3);
  });
});

describe.each(["1953-default", "2019-default"] as const)("seed calibration — %s", (preset) => {
  const rows = authoredRows(preset);
  const national = nationalGdps(preset);
  const scalars = computeStateGdpScalars(rows, national);

  it("has authored regional gdp data for every national-budget config country", () => {
    const covered = new Set(scalars.map((s) => s.countryId as string));
    for (const countryId of national.keys()) {
      expect(covered, `country ${countryId} has no regional gdp rows`).toContain(countryId);
    }
  });
});

describe("seed calibration — 1953 (era-gated: reconciled at seed time)", () => {
  it("after reconciliation, |Σ state.gdp − federalBudget.gdp| / gdp < 2% for every country", () => {
    const scalars = computeStateGdpScalars(
      authoredRows("1953-default"),
      nationalGdps("1953-default")
    );
    for (const entry of scalars) {
      const reconciledSum = entry.regionalSum * entry.scalar;
      const residual = Math.abs(reconciledSum - entry.nationalGdp) / entry.nationalGdp;
      expect(
        residual,
        `${entry.countryId}: Σ regions ${reconciledSum} vs national ${entry.nationalGdp} (scalar ${entry.scalar})`
      ).toBeLessThan(STATE_GDP_RECONCILE_TOLERANCE);
    }
  });
});

describe("era gate (refs #3247) — only pre-1999 eras are reconciled", () => {
  // Modern presets (2019 etc.) have their own state-sum vs authored-GDP
  // disagreements (US −14.6%, UK −31%, …) whose resolution is a pending
  // DESIGN DECISION — the reconciler must not silently re-scale modern
  // worlds on a reseed. The gate derives the era via eraForPreset, so
  // preset aliases follow their era family.
  it("gates by era: 1953/1979/1991 reconcile, 1999+ do not", () => {
    expect(shouldReconcileStateGdpForPreset("1953-default")).toBe(true);
    expect(shouldReconcileStateGdpForPreset("1979-default")).toBe(true);
    expect(shouldReconcileStateGdpForPreset("1991-default")).toBe(true);
    expect(shouldReconcileStateGdpForPreset("1999-default")).toBe(false);
    expect(shouldReconcileStateGdpForPreset("2007-default")).toBe(false);
    expect(shouldReconcileStateGdpForPreset("2019-default")).toBe(false);
    expect(shouldReconcileStateGdpForPreset("2023-default")).toBe(false);
    // Aliases follow their era family (both map to era 2019).
    expect(shouldReconcileStateGdpForPreset("empty")).toBe(false);
    expect(shouldReconcileStateGdpForPreset("2019-no-parties")).toBe(false);
    // Unknown presets fall back to era 2019 → not reconciled.
    expect(shouldReconcileStateGdpForPreset("some-future-preset")).toBe(false);
  });

  it("2019 data IS out of tolerance (US), so the gate is load-bearing", () => {
    // Premise for the test below: without the era gate, the tolerance guard
    // alone would rescale 2019 US (authored $27T vs Σ states ~$23.07T, −14.6%).
    const scalars = computeStateGdpScalars(
      authoredRows("2019-default"),
      nationalGdps("2019-default")
    );
    const us = scalars.find((s) => s.countryId === "US")!;
    expect(us.deviation).toBeGreaterThan(STATE_GDP_RECONCILE_TOLERANCE);
  });

  it("a 2019 bundle is NOT modified even when out of tolerance", async () => {
    // Db stub that throws on ANY access — proves the gate short-circuits
    // before the reconciler reads or writes anything.
    const untouchableDb = new Proxy(
      {},
      {
        get(_target, prop) {
          throw new Error(`reconciler touched db.${String(prop)} for a gated modern preset`);
        },
      }
    ) as Db;
    const logs: string[] = [];
    const result = await reconcileStateGdpWithNationalSeeds(
      untouchableDb,
      (msg) => logs.push(msg),
      "2019-default"
    );
    expect(result).toEqual([]);
    expect(logs.join("\n")).toContain("skipped");
  });
});

describe("tolerance guard (within gated eras)", () => {
  // BR is the one 2019 country already within tolerance — pure-fn evidence
  // that consistent data is never perturbed by the tolerance guard.
  it("regional data within tolerance is NOT perturbed", () => {
    const scalars = computeStateGdpScalars(
      authoredRows("2019-default"),
      nationalGdps("2019-default")
    );
    const br = scalars.find((s) => s.countryId === "BR")!;
    expect(br.deviation).toBeLessThan(STATE_GDP_RECONCILE_TOLERANCE);
    expect(br.applied).toBe(false);
    expect(br.scalar).toBe(1);
  });
});
