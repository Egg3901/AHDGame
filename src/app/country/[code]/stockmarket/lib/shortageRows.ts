/**
 * Shortage heat-map model for the stock-market Commodities tab.
 *
 * Pure, client-computable from data the tab already has: a commodity's
 * demand/supply ratio is the shortage signal, and its price versus base is the
 * premium a supplier earns. Ranked most-short first so a player sees at a
 * glance what is scarce (scarce = premium = a profitable thing to produce).
 *
 * The scope lens re-resolves each commodity's supply/demand/price from the
 * chosen level (whole world, one country, or one state) so the same ranking
 * answers "short where?". Country/State levels need the scope=full payload
 * (the national and per-state maps); missing scope data yields a null ratio.
 */
import type { CommodityData } from "../types";
import { priceRealizationFactor } from "@/lib/market/priceRealization";
import { reachableSellableDemand } from "@/lib/trade/reachableBook";

export type ShortageTone = "short-strong" | "short-mild" | "balanced" | "oversupplied";

export type ShortageScope =
  | { level: "global" }
  | { level: "reachable"; countryId: string }
  | { level: "country"; countryId: string }
  | { level: "state"; stateId: string };

export interface ShortageRow {
  commodity: string;
  label: string;
  unit: string;
  /** scoped demand / scoped supply; null when either side is absent (no signal). */
  dsRatio: number | null;
  /** (scoped price / basePrice - 1) * 100. */
  premiumPct: number;
  tone: ShortageTone;
  /** Bar magnitude 0..1: |log2(dsRatio)| saturating at a 4x imbalance. */
  intensity: number;
  /**
   * Demand exists but supply is zero at this scope: the most acute shortage
   * (e.g. a state with factories but no local mine). dsRatio is null because
   * there is no finite ratio, so this flag carries the "maximal shortage"
   * signal that tone/intensity/sort would otherwise miss.
   */
  noSupply: boolean;
  /** Scope-resolved figures (what the row's numbers/tooltip describe). */
  supply: number;
  demand: number;
  price: number;
  basePrice: number;
  /**
   * Disclosure for the Reachable lens: world supply this country cannot buy
   * from, split into embargoed and untraded. Never folded into `supply` or the
   * ratio — they exist so a 0 reads as "walled off" rather than "dead market"
   * (ticket #1077). Zero at every other scope.
   */
  blockedSupply: number;
  untradedSupply: number;
}

const SATURATION = Math.log2(4);

function toneFor(dsRatio: number | null): ShortageTone {
  if (dsRatio == null) return "balanced";
  if (dsRatio >= 1.75) return "short-strong";
  if (dsRatio >= 1.15) return "short-mild";
  if (dsRatio <= 0.85) return "oversupplied";
  return "balanced";
}

function intensityFor(dsRatio: number | null): number {
  if (dsRatio == null || dsRatio <= 0) return 0;
  return Math.min(1, Math.abs(Math.log2(dsRatio)) / SATURATION);
}

/**
 * Resolve a commodity's (supply, demand, price) at the requested scope. Country
 * and state levels read the scope=full maps; a scope with no entry for this
 * commodity resolves to supply/demand 0 (-> null ratio) and the base price.
 */
function resolveScope(
  c: CommodityData,
  scope: ShortageScope
): { supply: number; demand: number; price: number; blocked: number; untraded: number } {
  if (scope.level === "reachable") {
    // What a SELLER here can win: domestic demand (domestic output clears
    // before imports) plus what it can place abroad, against domestic supply.
    //
    // Deliberately not the book's clearing `demand`, which is pinned to
    // `supply` for every net importer by construction and would render every
    // importing market as exactly "balanced" — the same defect that made the
    // build gate report zero room in ticket #1077. Imports are an opportunity
    // to displace, not a wall.
    const book = c.reachableBooks?.[scope.countryId];
    const domestic = book ? reachableSellableDemand(book) : 0;
    return {
      supply: book?.supply ?? 0,
      demand: domestic,
      price: c.nationalPrices?.[scope.countryId] ?? c.basePrice,
      blocked: book?.blockedSupply ?? 0,
      untraded: book?.untradedSupply ?? 0,
    };
  }
  if (scope.level === "country") {
    // PRODUCTION versus CONSUMPTION inside the borders. It deliberately ignores
    // imports, so it answers "does this country feed itself" and NOT "can I
    // sell here" — the US ran 2.88 here on food while importing 1.13M units a
    // day and clearing its deficit in full (ticket #1077). The stored balance
    // is also only half-relieved of trade (TRADE_PRICE_CONVERGENCE_K = 0.5), so
    // it is a price-formation input, not physical unmet demand. Use Reachable
    // for a build decision.
    return {
      supply: c.nationalSupply?.[scope.countryId] ?? 0,
      demand: c.nationalDemand?.[scope.countryId] ?? 0,
      price: c.nationalPrices?.[scope.countryId] ?? c.basePrice,
      blocked: 0,
      untraded: 0,
    };
  }
  if (scope.level === "state") {
    return {
      supply: c.stateSupply?.[scope.stateId] ?? 0,
      demand: c.stateDemand?.[scope.stateId] ?? 0,
      price: c.statePrices?.[scope.stateId] ?? c.basePrice,
      blocked: 0,
      untraded: 0,
    };
  }
  return {
    supply: c.globalSupply,
    demand: c.globalDemand,
    price: c.globalPrice,
    blocked: 0,
    untraded: 0,
  };
}

/**
 * Build ranked shortage rows from the tab's commodity data at the given scope
 * (default: whole world). Drops rows with no signal (no S/D ratio and no
 * meaningful premium). Sorts most-short first; unpriced rows sink to the bottom.
 */
export function buildShortageRows(
  commodities: CommodityData[],
  scope: ShortageScope = { level: "global" }
): ShortageRow[] {
  const rows: ShortageRow[] = [];
  for (const c of commodities) {
    const { supply, demand, price, blocked, untraded } = resolveScope(c, scope);
    const dsRatio = supply > 0 && demand > 0 ? demand / supply : null;
    // Demand with zero supply = maximal shortage (the State-lens headline case).
    // dsRatio can't express it (division by zero), so flag it explicitly.
    const noSupply = supply <= 0 && demand > 0;
    // The premium a supplier ACTUALLY earns, not the raw price gap. The engine
    // scales realized revenue by clamp((price/base)^0.5, 0.7, 1.5) — the same
    // shared priceRealizationFactor — so a rare-earth price at +95% of base only
    // realizes about +40%. Showing raw price/base overstated the payoff ~2.4x
    // and made the "sells at a premium" copy a promise the engine never keeps.
    const premiumPct =
      c.basePrice > 0 ? (priceRealizationFactor(price / c.basePrice) - 1) * 100 : 0;
    // No shortage signal and no meaningful premium -> nothing to say. A zero
    // supply / positive demand row always has something to say, so never drop it.
    // On the Reachable lens a walled-off market also has something to say, even
    // when it is otherwise silent: that is the whole point of the lens.
    const hasDisclosure = blocked > 0 || untraded > 0;
    if (!noSupply && !hasDisclosure && dsRatio == null && Math.abs(premiumPct) < 0.5) continue;
    rows.push({
      commodity: c.commodity,
      label: c.label,
      unit: c.unit,
      dsRatio,
      premiumPct,
      tone: noSupply ? "short-strong" : toneFor(dsRatio),
      intensity: noSupply ? 1 : intensityFor(dsRatio),
      noSupply,
      supply,
      demand,
      price,
      basePrice: c.basePrice,
      blockedSupply: blocked,
      untradedSupply: untraded,
    });
  }
  rows.sort((a, b) => {
    // Zero-supply-with-demand rows are the most acute; float them to the top.
    if (a.noSupply !== b.noSupply) return a.noSupply ? -1 : 1;
    if (a.dsRatio == null && b.dsRatio == null) return b.premiumPct - a.premiumPct;
    if (a.dsRatio == null) return 1;
    if (b.dsRatio == null) return -1;
    return b.dsRatio - a.dsRatio;
  });
  return rows;
}
