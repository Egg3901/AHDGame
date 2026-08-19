import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import { priceRealizationFactor } from "@/lib/market/priceRealization";

/**
 * What it costs a plant to BUILD one lot, and what a minister is allowed to pay for it.
 *
 * Before this module a delivery credited the supplier the full contract price with no cost
 * behind it, so every lot was pure cash creation: an order for a million lots turned the
 * defence appropriation into corporate cash one-for-one and inflated the supplier's balance
 * (and, through it, the market-cap series) by the whole appropriation. Payment must be MARGIN.
 *
 * Everything here is pure. The award route, the delivery sweep and the client-side award form
 * all need the same numbers, and a client component cannot pull `mongodb` into the bundle.
 */

/**
 * The revenue a plant must book to produce exactly one lot, in the SAME units as
 * `CorporateSector.revenue`.
 *
 * `rawLotsFromSector` defines a lot as `Σ_c revenue × supplyRate_c / basePrice_c`, so one lot
 * is `1 / Σ_c (supplyRate_c / basePrice_c)`. Inverting the one identity the arsenal already
 * uses is deliberate: a second cost table for "what a lot is worth" would drift against the
 * production model the moment either was tuned.
 *
 * Returns null for a strategy that supplies nothing (`cyber`) or is not a defence line - the
 * same empty case `componentsForStrategy` returns `[]` for, and callers must refuse rather
 * than treat it as free.
 */
export function revenueBasisPerLot(strategyId: string | undefined | null): number | null {
  const strategy = SECTOR_STRATEGIES.defense.find((s) => s.id === (strategyId ?? "standard"));
  if (!strategy) return null;
  let perRevenue = 0;
  for (const [commodity, rate] of Object.entries(strategy.supply)) {
    const base = COMMODITY_BASE_PRICES[commodity as CommodityType] ?? 0;
    if (!(base > 0) || !((rate as number) > 0)) continue;
    perRevenue += (rate as number) / base;
  }
  if (!(perRevenue > 0)) return null;
  return 1 / perRevenue;
}

/**
 * The commodity input bill for one lot, in the same units as the contract price.
 *
 * Uses `computeInputsCost`'s identity with the units cancelled out:
 * `cost = revenueBasis × Σ_i demandRate_i × priceRealizationFactor(ratio_i)`. Pricing inputs
 * through `priceRealizationFactor` rather than the raw ratio is the buy-sell symmetry rule
 * the physical P&L already enforces - a supplier that sells into a damped, clamped market
 * must buy from the same one, or a world shortage drives every defence contract underwater
 * regardless of how the plant is run.
 *
 * `priceRatios` is the prior turn's lagged commodity price ÷ base price. Omitted or missing
 * for a commodity means ratio 1, i.e. the recipe's nominal input share - which is exactly
 * what the award form needs, since it quotes a price before the delivery turn exists.
 */
export function lotInputCost(
  strategyId: string | undefined | null,
  priceRatios?: ReadonlyMap<CommodityType, number>
): number | null {
  const basis = revenueBasisPerLot(strategyId);
  if (basis == null) return null;
  const strategy = SECTOR_STRATEGIES.defense.find((s) => s.id === (strategyId ?? "standard"));
  if (!strategy) return null;
  let share = 0;
  for (const [commodity, rate] of Object.entries(strategy.demand)) {
    if (!((rate as number) > 0)) continue;
    const ratio = priceRatios?.get(commodity as CommodityType);
    share += (rate as number) * priceRealizationFactor(Number.isFinite(ratio) ? ratio! : null);
  }
  return basis * share;
}

/**
 * Everything the input bill does not name: overheads, distribution, the labour the recipe
 * does not carry. Solved per sector for the market P&L (`otherOpexPerUnitAnchor`), but that
 * figure is per OUTPUT UNIT of a market mix and is absent on any plant that has not run a
 * producing plants turn, so a contract cannot depend on it existing.
 *
 * A flat share of the input bill instead. It is the conservative direction: it can only push
 * the price FLOOR up, never let a contract be written below the cost of the commodities the
 * plant demonstrably has to buy.
 */
export const LOT_OVERHEAD_SHARE_OF_INPUTS = 0.35;

/** Full production cost of one lot: commodity inputs plus the overhead share. */
export function lotProductionCost(
  strategyId: string | undefined | null,
  priceRatios?: ReadonlyMap<CommodityType, number>
): number | null {
  const inputs = lotInputCost(strategyId, priceRatios);
  if (inputs == null) return null;
  return inputs * (1 + LOT_OVERHEAD_SHARE_OF_INPUTS);
}

/**
 * The margin a contract must clear over production cost before it may be written.
 *
 * A floor, not a target: at 12% a supplier that wins on price still makes money, so the
 * cheap-mass doctrine is a real choice rather than a way to bankrupt your own arms industry.
 */
export const MIN_CONTRACT_MARGIN = 0.12;

/**
 * The most a contract may mark a lot up over what it costs to build (ticket #1134).
 *
 * The band used to be anchored at only ONE end. The floor was production cost plus 12%, but
 * the ceiling was the GDP anchor, and the two are not denominated in the same thing: the
 * anchor is a share of national output, while production cost is the commodity bill for the
 * goods a plant physically hands over. On the live world that put them four to five orders of
 * magnitude apart - a US aerospace lot costs 1,091 to build and the anchored ceiling was
 * 383,748,809, a markup of 209,000x. Delivery pays the supplier `price - cost`, so a contract
 * written near that ceiling was not a purchase at all. It was the defence appropriation moving
 * into one corporation's cash balance, and the minister signing it could hold a stake in that
 * corporation.
 *
 * Anchoring the ceiling to cost is what makes the band a NEGOTIATION rather than a tap. At
 * 100% a supplier can still double its money on a hard bargain, which is a fat margin by any
 * real arms-industry standard and leaves ministers a genuine range to trade quantity against
 * price inside.
 */
export const MAX_CONTRACT_MARGIN = 1.0;

/**
 * The margin the quoted price carries when a minister does not negotiate one.
 *
 * Sits between the 12% floor and the 100% ceiling so the default is a fair deal for both
 * sides rather than either end of the band: a supplier accepting the standing offer makes
 * real money, and a minister who does not haggle is not fleeced.
 */
export const TARGET_CONTRACT_MARGIN = 0.35;

/**
 * How grade (0..3) scales what a lot costs to build and what it is worth.
 *
 * One dial, two ends. A grade-0 lot is cheap tin: it costs less to build and is worth less,
 * so a minister buying mass gets more of it per unit of appropriation. A grade-3 lot costs
 * more and prices higher. The arsenal side needs no second dial - grade already lands as
 * `techTier` on the equipped unit, and `techPowerMult` already turns tier into combat
 * effectiveness, so cheap-mass and premium doctrines fall out of the price band alone.
 */
export const GRADE_PRICE_SCALE: Record<0 | 1 | 2 | 3, number> = {
  0: 0.7,
  1: 0.85,
  2: 1.0,
  3: 1.25,
};

/** Grade normalized into the 0..3 band the arsenal and the price scale both use. */
export function normalizeGrade(grade: number | undefined | null): 0 | 1 | 2 | 3 {
  if (typeof grade !== "number" || !Number.isFinite(grade)) return 3;
  return Math.max(0, Math.min(3, Math.round(grade))) as 0 | 1 | 2 | 3;
}

export interface LotPriceBand {
  /** Production cost of one lot at this grade - what the plant is out of pocket. */
  productionCost: number;
  /** Lowest price a contract may be written at: cost plus `MIN_CONTRACT_MARGIN`. */
  floor: number;
  /**
   * Highest price a contract may be written at: cost plus `MAX_CONTRACT_MARGIN`, and never
   * above the grade-scaled GDP anchor.
   */
  ceiling: number;
  /** What the price defaults to when the minister does not set one. */
  suggested: number;
}

/**
 * The band a minister may set a lot price inside (suggestion #291, re-anchored by #1134).
 *
 * Bounded at BOTH ends by the SAME quantity: what the lot costs to build. The floor is that
 * cost plus a minimum margin, so a minister cannot fill an arsenal by confiscation from a
 * rival's plant. The ceiling is that cost plus a maximum margin, so a minister with a stake
 * in the supplier cannot turn the appropriation into that corporation's cash.
 *
 * Anchoring both ends to one quantity is the whole fix. While the ceiling was the GDP anchor
 * and the floor was the commodity bill, the two ends were denominated in different things and
 * drifted five orders of magnitude apart, which is exactly the room a self-dealing contract
 * needs. A band whose ends can only move together has no such room, whatever the economy does.
 *
 * The GDP anchor survives as a hard upper bound and nothing else. A poor country must not be
 * quoted a rich country's price just because its plants happen to run expensive inputs, and
 * the anchor is the figure the rest of procurement already treats as what the economy can bear
 * for one lot. `anchorPrice` is `lotPrice(countryId, militaryPriceAnchor(...))`.
 *
 * Deliberately NOT retroactive. A contract stores `pricePerLot` at award and the delivery
 * sweep bills against the stored figure, so every live order keeps the price its supplier
 * agreed to. Players do not have a signed deal repriced under them; the new band governs new
 * awards.
 *
 * Returns null when either input is unusable. Callers MUST refuse: a null band treated as
 * "no limits" is the exploit this whole module exists to close.
 */
export function lotPriceBand(input: {
  anchorPrice: number;
  productionCost: number;
  grade: number;
}): LotPriceBand | null {
  const { anchorPrice, productionCost } = input;
  if (!(anchorPrice > 0) || !Number.isFinite(productionCost) || productionCost < 0) return null;
  const grade = normalizeGrade(input.grade);
  const scale = GRADE_PRICE_SCALE[grade];

  const gradedCost = productionCost * scale;
  const floor = Math.max(1, Math.ceil(gradedCost * (1 + MIN_CONTRACT_MARGIN)));
  // Cost first, anchor second. Taking the lower of the two means a lot is priced off what it
  // took to build it, and the economy-wide anchor can only ever pull that DOWN - it can no
  // longer lift a 1,091 lot to 383,748,809.
  const anchorCeiling = Math.round(anchorPrice * scale);
  const costCeiling = Math.round(gradedCost * (1 + MAX_CONTRACT_MARGIN));
  const ceiling = Math.max(floor, Math.min(anchorCeiling, costCeiling));
  // A fair deal, not either end of the band. Clamped rather than assumed inside it: on a line
  // whose inputs have run away the floor can overtake the target, and the floor wins because
  // nothing may be written below cost.
  const suggested = Math.max(
    floor,
    Math.min(ceiling, Math.round(gradedCost * (1 + TARGET_CONTRACT_MARGIN)))
  );
  return { productionCost: gradedCost, floor, ceiling, suggested };
}

/**
 * How many production lines a defence plant runs, and therefore how finely a CEO can split
 * it across orders (suggestion #281).
 *
 * A fixed four rather than a figure derived from revenue or capital stock: allocation is a
 * STANDING decision a CEO makes once, and a slot count that moved with last turn's revenue
 * would silently invalidate it every turn. Four divides cleanly by the one and two component
 * counts every defence strategy has.
 */
export const DEFENCE_FACTORY_SLOTS_PER_PLANT = 4;

/**
 * The default slot allocation for a new contract on a plant serving `componentCount` domains.
 *
 * Chosen so an unconfigured contract delivers EXACTLY what it delivered before slots existed:
 * throughput is `rawLots × assigned / SLOTS`, and `SLOTS / componentCount` slots reproduces
 * the old `rawLots / componentCount` split. Clamped to what is actually free, so a second
 * order on a plant takes what is left rather than overcommitting it.
 */
export function defaultFactoryAllocation(componentCount: number, freeSlots: number): number {
  const share = Math.floor(DEFENCE_FACTORY_SLOTS_PER_PLANT / Math.max(1, componentCount));
  return Math.max(0, Math.min(freeSlots, Math.max(1, share)));
}

/**
 * Lines a newly awarded contract should open on.
 *
 * Private suppliers keep the even-split default: the CEO can re-allocate afterwards.
 * A National Corporation has no player CEO (ticket #1087), so that lever is dead and a
 * two-domain plant would stay at half throughput forever. State industry therefore
 * takes every free line at award (ticket #1134).
 */
export function awardFactoryAllocation(input: {
  componentCount: number;
  freeSlots: number;
  stateOwned: boolean;
}): number {
  if (input.stateOwned) return Math.max(0, input.freeSlots);
  return defaultFactoryAllocation(input.componentCount, input.freeSlots);
}

/**
 * Lots a contract's assigned lines produce this turn.
 *
 * `rawLots` is the whole plant's fractional output (`rawLotsFromSector`). Splitting by SLOTS
 * rather than by contract count is what stops one plant's output being delivered in full to
 * two contracts at once - a plant could previously be double-booked and paid twice for
 * materiel it only built once, on top of whatever the market was still told it supplied.
 */
export function contractLotsThisTurn(rawLots: number, assignedFactories: number): number {
  if (!(rawLots > 0)) return 0;
  const assigned = Math.max(
    0,
    Math.min(DEFENCE_FACTORY_SLOTS_PER_PLANT, Math.floor(assignedFactories))
  );
  if (assigned <= 0) return 0;
  return (rawLots * assigned) / DEFENCE_FACTORY_SLOTS_PER_PLANT;
}
