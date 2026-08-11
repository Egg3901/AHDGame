import { MILITARY_COUNTRY_SCALE } from "@/lib/constants/military";
import type { CountryId } from "@/lib/constants/countries";

/**
 * `UnitArchetype.cost` per unit of GDP, so `cost / ARCHETYPE_COST_GDP_DIVISOR`
 * is the fraction of national GDP one unit costs. 387_000 = US 1953 GDP
 * ($387bn) expressed in cost units (millions).
 *
 * NOT era-coupled despite the 1953 provenance: it is a ratio applied to each
 * country's OWN gdp, so it cancels. Nominal growth into 2019 does not inflate
 * the fraction — an Infantry Division is 0.41% of GDP in every era.
 */
export const ARCHETYPE_COST_GDP_DIVISOR = 387_000;

/**
 * How much of a country's GDP growth flows through into military prices.
 * 0 = prices frozen at the baseline; 1 = pricing off live GDP, the pre-anchor behaviour.
 *
 * At 1 the model has a perverse property. Price is `gdp × k` and the defence
 * appropriation accrues `line / TURNS_PER_YEAR`, so units-per-year reduces to
 * `defenceBurden / k` — economic size cancels out entirely, and doubling GDP doubles
 * unit prices, so growing the economy buys nothing (and shrinks the army outright if the
 * defence line is a fixed nominal figure). Below 1 the line, which tracks GDP fully,
 * outruns prices and growth converts into force.
 *
 * NOT a flat anchor price: `gdp` is stored in LOCAL CURRENCY and cross-country comparison
 * is invalid by deliberate, guard-tested design (`seeds/reference/gdpDenomination.ts`), so
 * a flat figure has no meaning in old francs, and six Eastern Bloc countries have no
 * exchange-rate document at all. Anchoring against each country's OWN GDP keeps the model
 * denomination-agnostic, which is the property the whole pricing design rests on.
 */
export const MILITARY_PRICE_INDEXATION = 0.5;

/**
 * The GDP figure military prices are quoted against: the country's baseline GDP grown by a
 * fractional power of how far its GDP has actually moved.
 *
 * A closed form over `(gdpNow, baselineGdp)` on purpose — no per-turn write, no path
 * dependence, nothing to drift between a replayed turn and a live one, and `RecruitPanel`
 * (a client component) can compute exactly what the server charges without pulling
 * `mongodb` into the bundle.
 *
 * A missing or non-positive baseline returns live GDP, reproducing the pre-anchor price
 * exactly. That is the safe degradation: an unmigrated budget prices as it always did
 * rather than anchoring at zero and making every unit free.
 */
export function militaryPriceAnchor(
  gdpNow: number | null | undefined,
  baselineGdp: number | null | undefined
): number | null {
  if (gdpNow == null || !(gdpNow > 0)) return null;
  if (baselineGdp == null || !(baselineGdp > 0)) return gdpNow;
  return baselineGdp * Math.pow(gdpNow / baselineGdp, MILITARY_PRICE_INDEXATION);
}

/**
 * What the defence appropriation pays for one new unit, in the SAME units as the country's
 * `treasuryBalance` — because both derive from the same budget row's `gdp`.
 *
 * Priced as a share of national GDP rather than converted through an exchange
 * rate. The FX route fails three ways: the six Eastern Bloc countries have no
 * rate document at all (budget-only economies, `currencies.ts:441`), several
 * countries have USD-anchored GDP with local currency codes
 * (`GDP_DENOMINATION_1953`), and a converted price is still GDP-blind. A share
 * of GDP is denomination-agnostic by construction.
 *
 * MILITARY_COUNTRY_SCALE is a COST multiplier, not a size multiplier — it
 * already scales upkeep, and applying it here keeps the two symmetric. Force
 * size comes from the authored order of battle, never from it.
 *
 * Returns null when GDP is missing or non-positive. There is deliberately no
 * "assume 1" fallback: that is exactly how a country ends up recruiting free.
 *
 * Pure by design: RecruitPanel is a client component and must compute the same
 * price the server charges without pulling `mongodb` into the bundle.
 */
export function unitPurchasePrice(
  archetype: { cost: number },
  countryId: string,
  gdp: number | null | undefined,
  baselineGdp?: number | null
): number | null {
  const anchor = militaryPriceAnchor(gdp, baselineGdp);
  if (anchor == null) return null;
  const scale = MILITARY_COUNTRY_SCALE[countryId as CountryId] ?? 1;
  return Math.round(anchor * (archetype.cost / ARCHETYPE_COST_GDP_DIVISOR) * scale);
}

/**
 * A tier step's price as a share of what the unit costs to build new, by TARGET tier.
 *
 * Escalating on purpose: taking a formation from Modernized to Cutting-Edge is the
 * expensive half of its life, not another routine refit. The three steps together come
 * to 1.10× a fresh build, so modernising an army is a rebuild-scale commitment rather
 * than the free action it used to be.
 */
export const UPGRADE_COST_SHARE: Record<1 | 2 | 3, number> = { 1: 0.25, 2: 0.35, 3: 0.5 };

/**
 * What the treasury pays to raise one unit's tech tier by one step.
 *
 * Priced through the same GDP-share model as `unitPurchasePrice` — same divisor, same
 * country cost scale — so building and modernising are quoted in one currency-agnostic
 * unit and can be compared directly by a player deciding between them.
 *
 * Returns null on a missing or non-positive GDP, and callers MUST refuse rather than
 * treat it as zero. That fallback is exactly what made upgrades free before.
 */
export function unitUpgradePrice(
  archetype: { cost: number },
  countryId: string,
  gdp: number | null | undefined,
  targetTier: 1 | 2 | 3,
  baselineGdp?: number | null
): number | null {
  const anchor = militaryPriceAnchor(gdp, baselineGdp);
  if (anchor == null) return null;
  const share = UPGRADE_COST_SHARE[targetTier];
  if (!share) return null;
  const scale = MILITARY_COUNTRY_SCALE[countryId as CountryId] ?? 1;
  return Math.round(anchor * ((archetype.cost * share) / ARCHETYPE_COST_GDP_DIVISOR) * scale);
}

// `borrowingOutlook` lived here until procurement moved onto the defence appropriation.
// It reported the surplus/debt split of a purchase, and with no overdraft for new orders
// there is no borrowing left to report: the recruit panel now shows `balance − price` and
// turns-until-affordable instead. `computeFiscalImpact`, which it wrapped, is untouched and
// still used by the budget slider.
