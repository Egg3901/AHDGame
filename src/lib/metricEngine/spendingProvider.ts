import type { Db } from "mongodb";
import type { State } from "@/lib/db/types/state";
import type { FederalBudget, StateBudget } from "@/lib/db/types/budget";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import type { ExternalAggregateProvider } from "./providers";

/** Budget categories the engine consumes as spending channels (P2+/P3+). */
export const SPENDING_CHANNEL_CATEGORIES = [
  "education",
  "healthcare",
  "infrastructure",
  "publicSafety",
  "social",
  "environment",
  // P5: consumed by bundeswehrReadiness (and P6 militaryReadiness later).
  "defense",
] as const;
export type SpendingCategory = (typeof SPENDING_CHANNEL_CATEGORIES)[number];

/**
 * byCategory keys folded into each channel. Laws book social-tier costs under
 * three sibling keys (`social`/`welfare`/`socialSecurity`) — the channel sums
 * them so a welfare act's spend reaches the poverty/childPoverty nodes (P3a).
 */
const CHANNEL_SOURCE_KEYS: Record<SpendingCategory, readonly string[]> = {
  education: ["education"],
  healthcare: ["healthcare"],
  infrastructure: ["infrastructure"],
  publicSafety: ["publicSafety"],
  social: ["social", "welfare", "socialSecurity"],
  environment: ["environment"],
  defense: ["defense"],
};

const channelSpend = (byCat: Record<string, number>, cat: SpendingCategory): number => {
  let sum = 0;
  for (const key of CHANNEL_SOURCE_KEYS[cat]) {
    const v = byCat[key];
    if (typeof v === "number" && Number.isFinite(v)) sum += v;
  }
  return sum;
};

export interface SpendingRollup {
  /**
   * Per-region per-capita spend by category (federal-national + state-local),
   * expressed in US-REFERENCE dollars: local per-capita ×
   * (US_REFERENCE_GDP_PER_CAPITA / country GDP-per-capita). See
   * {@link US_REFERENCE_GDP_PER_CAPITA}.
   */
  perCapitaByRegion: Map<string, Partial<Record<SpendingCategory, number>>>;
}

/**
 * Cross-country normalization anchor (#0887 RC2). Every channel HALF_SAT
 * (PS_SPEND_HALF_SAT=900, SOCIAL_SPEND_HALF_SAT=2700, …) was calibrated in
 * ticket #826 against LIVE US per-capita dollars, when the US sim GDP/capita
 * was ≈$24k. Budgets are stored in each country's own currency at its own sim
 * scale (UK ≈£9.4k GDP/capita, JP in ¥ — orders of magnitude apart), so raw
 * local per-capita spend lands on arbitrary points of the same saturation
 * curve: UK ~11% response across its whole playable range, JP pinned at ~100%.
 * Normalizing by GDP/capita converts spend into fiscal EFFORT (share of average
 * income), then × this reference re-expresses it in the #826-calibrated units —
 * US responses are unchanged by construction, and every other country lands on
 * the same effort curve. The per-capita bill-cost ramp (costs scale with
 * GDP/capita) makes each policy option's response stable across eras too.
 */
export const US_REFERENCE_GDP_PER_CAPITA = 24_000;

const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);

/**
 * Per-capita budget spending by category, per region (spec P2 §3, R1 provider).
 * Federal category pools are spread nationally per-capita; state category spend
 * is region-local: `perCapita(region,cat) = federalCat[country]/countryPop +
 * stateCat(region)/region.pop`. One batched read each of states + federal/state
 * budgets — nodes never read budgets themselves (keeps "add a metric = add an
 * entry" + the R4 perf budget). National-scope synthetic regions are skipped.
 */
export async function spendingProvider(db: Db): Promise<SpendingRollup> {
  const [states, federalBudgets, stateBudgets] = await Promise.all([
    db
      .collection<State>("states")
      .find({})
      .project<Pick<State, "_id" | "countryId" | "population">>({ countryId: 1, population: 1 })
      .toArray(),
    db
      .collection<FederalBudget>("federalBudget")
      .find({})
      .project<Pick<FederalBudget, "_id" | "countryId" | "spending" | "gdp">>({
        countryId: 1,
        spending: 1,
        gdp: 1,
      })
      .toArray(),
    db
      .collection<StateBudget>("stateBudgets")
      .find({})
      .project<Pick<StateBudget, "_id" | "spending">>({ spending: 1 })
      .toArray(),
  ]);

  const real = states.filter((s) => !NATIONAL_SCOPE_IDS.has(s._id));

  // Country population totals (denominator for federal-per-capita).
  const countryPop = new Map<string, number>();
  for (const s of real) {
    countryPop.set(s.countryId, (countryPop.get(s.countryId) ?? 0) + num(s.population));
  }

  // Federal per-capita by country/category + the country's GDP-normalization
  // factor (local per-capita → US-reference units; see US_REFERENCE_GDP_PER_CAPITA).
  const federalPerCapita = new Map<string, Partial<Record<SpendingCategory, number>>>();
  const normFactorByCountry = new Map<string, number>();
  for (const fb of federalBudgets) {
    const cid = fb.countryId || (String(fb._id) === "federal" ? "US" : String(fb._id));
    const pop = countryPop.get(cid) ?? 0;
    if (pop <= 0) continue;
    const gdpPerCapita = num(fb.gdp) / pop;
    // No usable GDP → factor 1 (raw local per-capita, the pre-#0887 behavior).
    if (gdpPerCapita > 0) normFactorByCountry.set(cid, US_REFERENCE_GDP_PER_CAPITA / gdpPerCapita);
    const byCat = fb.spending?.byCategory ?? {};
    const rec: Partial<Record<SpendingCategory, number>> = {};
    for (const cat of SPENDING_CHANNEL_CATEGORIES) rec[cat] = channelSpend(byCat, cat) / pop;
    federalPerCapita.set(cid, rec);
  }

  // State per-capita by region/category (needs region population).
  const popByRegion = new Map(real.map((s) => [s._id, num(s.population)]));
  const statePerCapita = new Map<string, Partial<Record<SpendingCategory, number>>>();
  for (const sb of stateBudgets) {
    const pop = popByRegion.get(String(sb._id)) ?? 0;
    if (pop <= 0) continue;
    const byCat = sb.spending?.byCategory ?? {};
    const rec: Partial<Record<SpendingCategory, number>> = {};
    for (const cat of SPENDING_CHANNEL_CATEGORIES) rec[cat] = channelSpend(byCat, cat) / pop;
    statePerCapita.set(String(sb._id), rec);
  }

  const perCapitaByRegion = new Map<string, Partial<Record<SpendingCategory, number>>>();
  for (const s of real) {
    const fed = federalPerCapita.get(s.countryId) ?? {};
    const st = statePerCapita.get(s._id) ?? {};
    // State budgets share the country's currency/scale, so one factor covers both.
    const norm = normFactorByCountry.get(s.countryId) ?? 1;
    const rec: Partial<Record<SpendingCategory, number>> = {};
    for (const cat of SPENDING_CHANNEL_CATEGORIES) rec[cat] = (num(fed[cat]) + num(st[cat])) * norm;
    perCapitaByRegion.set(s._id, rec);
  }

  return { perCapitaByRegion };
}

export const SPENDING_PROVIDER: ExternalAggregateProvider<SpendingRollup> = {
  name: "spending",
  run: spendingProvider,
};
