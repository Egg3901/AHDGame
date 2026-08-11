import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { State } from "@/lib/db/types";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import { eraForPreset } from "@/lib/seeds/presetSelector";

/**
 * Seed-time regional-GDP ⇄ national-GDP reconciliation.
 *
 * WHY: the annual fiscal-year rollover ("A1 SSOT", `src/lib/budget/fiscalYear.ts`)
 * REPLACES the authored `federalBudget.gdp` with Σ regional `state.gdp` (millions
 * × 1e6). When an era's regional seed files are not denominated consistently with
 * the authored national GDP config, the first rollover snaps national GDP by the
 * full inconsistency (the 1953 world's t39 snap: TR ×286, NG ×14, YU ×18, …
 * BAL ÷17, BY ÷11). Rather than hand-editing hundreds of region rows per era,
 * this normalizes each country's regional gdp values by ONE per-country scalar so
 * Σ state.gdp matches the authored national GDP, preserving every region's
 * relative share.
 *
 * DESIGN CHOICE (documented per the t39-snap fix): the mechanism is era-agnostic
 * but gated to the SEEDING path with two guards:
 *
 *   1. ERA GATE (refs #3247): only presets whose era (via `eraForPreset`) is
 *      pre-1999 — i.e. 1953/1979/1991 — are reconciled. Modern presets (2019
 *      etc.) have their OWN state-sum vs authored-GDP disagreements (US −14.6%,
 *      UK −31%, …) whose resolution is a pending DESIGN DECISION: which side is
 *      canonical has player-facing consequences, so a reseed of a modern world
 *      must not silently re-scale its regions. Until that decision lands, this
 *      reconciler is a no-op for 1999+ eras.
 *   2. TOLERANCE GUARD: within a gated era, only countries whose regional sum
 *      deviates from the authored national GDP by more than
 *      {@link STATE_GDP_RECONCILE_TOLERANCE} (2%) are rescaled.
 *
 * Runtime turn processing is never touched (fiscalYear keeps regional Σ as its
 * SSOT — after this reconciliation the two sources agree from turn 1).
 *
 * ORDERING: must run AFTER a country's regions are seeded and BEFORE anything
 * that derives absolute values from `state.gdp` — the per-country state-budget
 * seeders (`generateStateBudgets`: tax bases/revenue/spending are all linear in
 * state gdp), country-owned corp sizing (`generateCountryOwnedSeedData`), and
 * `seedUnownedSectors` (market sizing).
 *
 * ONE call site: the end of `seedAllCountryData`, covering EVERY country in the
 * preset's configs on both the bootstrap and in-world reset paths.
 *
 * ⚠️ `seedEasternBlocBudget` used to call this again per bloc country, on the
 * documented grounds that "bloc regions seed later than step 1". That stopped
 * being true when the Warsaw-Pact country block moved inside
 * `seedAllCountryData`: bloc regions now exist before the pass above, and the
 * bloc BUDGET block runs after `seedAllCountryData` has returned. Nothing
 * between the two writes `state.gdp` — the in-window writers touch region leans
 * and sector specializations — so the per-country repeat was six no-op passes.
 * Pinned by `gdpReconcileOrdering.test.ts`; if the bloc budget block is ever
 * moved ahead of the reconcile, restore a call rather than deleting that test.
 *
 * `state.capitalStock` is not seeded (the metric engine cold-starts it from gdp
 * at runtime), so scaling gdp alone keeps every downstream consumer coherent.
 */
export const STATE_GDP_RECONCILE_TOLERANCE = 0.02;

/**
 * Era gate (refs #3247): reconcile only pre-1999 eras (1953/1979/1991).
 * Derived from the preset via {@link eraForPreset} — no ad-hoc preset
 * string-matching — so preset aliases (e.g. `empty`, `2019-no-parties`
 * → era 2019) follow their era family. See the module doc for why modern
 * eras are excluded (pending design decision on which GDP side is canonical).
 */
export function shouldReconcileStateGdpForPreset(preset: string): boolean {
  return Number(eraForPreset(preset)) < 1999;
}

export interface CountryGdpScalar {
  countryId: CountryId;
  /** Authored national GDP (absolute units) from the preset's national-budget seed config. */
  nationalGdp: number;
  /** Σ regional state.gdp before scaling, converted to absolute units (millions × 1e6). */
  regionalSum: number;
  /** |regionalSum − nationalGdp| / nationalGdp before scaling. */
  deviation: number;
  /** Multiplier applied to every region's gdp (1 when within tolerance). */
  scalar: number;
  /** True when the scalar was (or should be) applied. */
  applied: boolean;
}

/**
 * Pure core: compute the per-country normalization scalar from region rows and
 * the authored national GDPs. Mirrors the fiscal-year SSOT sum exactly —
 * every row of the country except national-scope docs, `gdp || 0`, in millions.
 */
export function computeStateGdpScalars(
  regionRows: Array<Pick<State, "_id" | "countryId" | "gdp">>,
  nationalGdpByCountry: ReadonlyMap<string, number>,
  tolerance: number = STATE_GDP_RECONCILE_TOLERANCE
): CountryGdpScalar[] {
  const sumsByCountry = new Map<string, number>();
  for (const row of regionRows) {
    if (NATIONAL_SCOPE_IDS.has(String(row._id))) continue;
    sumsByCountry.set(row.countryId, (sumsByCountry.get(row.countryId) ?? 0) + (row.gdp || 0));
  }

  const results: CountryGdpScalar[] = [];
  for (const [countryId, nationalGdp] of nationalGdpByCountry) {
    const sumMillions = sumsByCountry.get(countryId);
    // No regional rows / zero sum: nothing to scale — fiscalYear falls back to
    // compounding the authored national GDP, which is already consistent.
    if (!sumMillions || sumMillions <= 0 || !Number.isFinite(sumMillions)) continue;
    if (!Number.isFinite(nationalGdp) || nationalGdp <= 0) continue;

    const regionalSum = sumMillions * 1_000_000;
    const deviation = Math.abs(regionalSum - nationalGdp) / nationalGdp;
    const applied = deviation > tolerance;
    results.push({
      countryId: countryId as CountryId,
      nationalGdp,
      regionalSum,
      deviation,
      scalar: applied ? nationalGdp / regionalSum : 1,
      applied,
    });
  }
  return results;
}

/**
 * Normalize the `states` collection so each country's Σ regional gdp matches the
 * authored national GDP of the given preset's national-budget seed configs.
 * Idempotent: once normalized, the deviation is ~0 and re-runs are no-ops.
 * No-op for 1999+ eras (see {@link shouldReconcileStateGdpForPreset}).
 *
 * @param countryIds restrict to these countries (used by the eastern-bloc lane,
 *   whose regions seed after the main reconciliation pass); omit for all
 *   countries in the preset's configs.
 */
export async function reconcileStateGdpWithNationalSeeds(
  db: Db,
  log: (msg: string) => void,
  preset: string,
  countryIds?: CountryId[]
): Promise<CountryGdpScalar[]> {
  if (!shouldReconcileStateGdpForPreset(preset)) {
    log(
      `[GdpReconcile] skipped — era ${eraForPreset(preset)} (${preset}) is not gated for ` +
        `seed-time regional-GDP reconciliation (pre-1999 eras only; refs #3247)`
    );
    return [];
  }
  const { getNationalBudgetSeedConfigsForPreset } = await import("@/lib/seeds/reference/budgets");
  const configs = getNationalBudgetSeedConfigsForPreset(preset).filter(
    (c) => !countryIds || countryIds.includes(c.countryId as CountryId)
  );
  if (configs.length === 0) return [];

  const nationalGdpByCountry = new Map<string, number>(
    configs.map((c) => [c.countryId as string, c.gdp])
  );
  const regionRows = await db
    .collection<State>("states")
    .find(
      { countryId: { $in: configs.map((c) => c.countryId as CountryId) } },
      { projection: { countryId: 1, gdp: 1 } }
    )
    .toArray();

  const scalars = computeStateGdpScalars(regionRows, nationalGdpByCountry);
  const toApply = scalars.filter((s) => s.applied);
  for (const entry of toApply) {
    await db.collection<State>("states").updateMany(
      {
        countryId: entry.countryId,
        _id: { $nin: [...NATIONAL_SCOPE_IDS] },
        // $gt is type-bracketed in MongoDB: matches only numeric gdp > 0, so
        // rows with missing/zero gdp are left untouched (never $mul'd to 0/NaN).
        gdp: { $gt: 0 },
      },
      { $mul: { gdp: entry.scalar } }
    );
    log(
      `[GdpReconcile] ${entry.countryId}: Σ regions ${Math.round(entry.regionalSum / 1e6).toLocaleString("en-US")}M ` +
        `vs authored ${Math.round(entry.nationalGdp / 1e6).toLocaleString("en-US")}M ` +
        `(dev ${(entry.deviation * 100).toFixed(1)}%) → scaled regional gdp ×${entry.scalar.toPrecision(6)}`
    );
  }
  if (toApply.length === 0) {
    log(`[GdpReconcile] all countries within ${STATE_GDP_RECONCILE_TOLERANCE * 100}% (${preset})`);
  }
  return scalars;
}
