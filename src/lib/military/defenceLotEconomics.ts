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
 * **This MUST read the same base-price table `rawLotsFromSector` reads, and it deliberately
 * reads the modern `COMMODITY_BASE_PRICES` rather than `eraScaledBasePrices`.** Swapping this
 * one to the era basis looks like a bug fix on a 1953 world, where the live commodity book is
 * era-scaled, and it is not. Two things make it wrong:
 *
 * 1. The base price is not a cost input here, it is the definition of the lot UNIT. Whatever
 *    table this function reads, `rawLotsFromSector` must read too, or "how many lots were
 *    delivered" and "what each lot cost to build" are counted in different units and the
 *    delivery burn is wrong by the era scale. That is the same denomination mismatch between
 *    the two ends of the price band that ticket #1134 exists to close.
 * 2. Changing BOTH is a no-op in money and a balance change in materiel. The base price
 *    cancels out of the input bill exactly - `computeInputsCost` charges
 *    `units × unitPrice` where `units = revenue × rate / basePrice` and
 *    `unitPrice = basePrice × realization` - so a plant's total input spend is
 *    `revenue × Σ(rate × realization)` on any table. Era-scaling both ends leaves the money
 *    untouched and simply redefines a lot as ~70x smaller, which makes every unit's
 *    `lotsRequired` load ~70x cheaper in real terms, because `lotsRequired` is a fixed
 *    function of archetype cost and does not move with it.
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
 * Overheads the commodity recipe does not name, as a flat share of the input bill.
 *
 * Only reached by `legacyLotProductionCost`. Retained because contracts awarded before ticket
 * #1134 settle on the cost model they were signed under, not because it is a good model.
 */
export const LOT_OVERHEAD_SHARE_OF_INPUTS = 0.35;

/**
 * What a lot cost to build under the PRE-#1134 model: the commodity bill plus a flat overhead
 * share, with no relation at all to what the lot sold for.
 *
 * This is the broken model. On the live world it returned about 1,091 against a lot the state
 * paid 383,748,809 for, so a delivery credited the supplier 99.9997% of the contract and the
 * defence appropriation converted into corporate cash instead of into equipment.
 *
 * It is kept, and still reachable, for exactly one reason: a contract signed under these terms
 * keeps them for its remaining lots. Players agreed to those deals in good faith under the
 * rules as they stood, and a repair never takes away what a player already holds. Selection is
 * by `DefenceContract.costBasis`, and NOTHING should call this for a new award.
 */
export function legacyLotProductionCost(
  strategyId: string | undefined | null,
  priceRatios?: ReadonlyMap<CommodityType, number>
): number | null {
  const inputs = lotInputCost(strategyId, priceRatios);
  if (inputs == null) return null;
  return inputs * (1 + LOT_OVERHEAD_SHARE_OF_INPUTS);
}

/**
 * The build cost that settles a given contract, on the economics it was signed under.
 *
 * THE grandfather rule, in one place so the delivery sweep and every order-book view agree.
 * A CEO's displayed margin must be the margin they are actually paid, or the order book lies
 * about a deal the player cannot renegotiate.
 */
export function contractLotProductionCost(
  contract: { costBasis?: "margin"; pricePerLot: number },
  strategyId: string | undefined | null,
  priceRatios?: ReadonlyMap<CommodityType, number>
): number | null {
  return contract.costBasis === "margin"
    ? lotProductionCost(strategyId, contract.pricePerLot, priceRatios)
    : legacyLotProductionCost(strategyId, priceRatios);
}

/**
 * The profit a defence prime is expected to make on a lot it builds to order.
 *
 * THE dial that decides what a contract IS. A lot's price is set by
 * `lotPrice`, the GDP-anchored figure the arsenal is calibrated around; production cost is
 * then that price less this margin. Cost is derived from price, not the other way round.
 *
 * Inverting the derivation is the whole of ticket #1134. Cost used to be built up from the
 * commodity recipe alone and came out around 1,091 against a lot the state paid 383,748,809
 * for, so delivering a lot consumed nothing and the supplier banked 99.9997% of the contract.
 * The appropriation was not buying materiel, it was buying a number in a corporation's cash
 * balance, and the minister signing for it could own part of that corporation.
 *
 * 15% is a real arms-industry return. The large Western primes run operating margins around
 * 9% to 11%, and US government contracting fee targets sit near 10% to 15%. Taking the top of
 * that range rather than the middle is deliberate: this is a game, and a defence contract
 * should be worth chasing. It is a good business, not a windfall. It also sits just above the
 * 12% `MIN_CONTRACT_MARGIN` floor, so the negotiable band is a genuine range rather than a
 * single legal price.
 */
export const TARGET_SUPPLIER_MARGIN = 0.15;

/**
 * Bounds on how far the commodity market may move a lot's build cost from its nominal share.
 *
 * Mirrors `priceRealizationFactor`'s own clamp, for the same buy-sell symmetry reason: a
 * supplier that sells into a damped, clamped market must buy from the same one. It also stops
 * a broken or half-seeded price book turning into an absurd cost, which under a cost-anchored
 * band would become an absurd price.
 */
export const LOT_COST_INDEX_MIN = 0.7;
export const LOT_COST_INDEX_MAX = 1.5;

/**
 * How expensive this line's inputs are right now, against its own nominal recipe. 1.0 in a
 * calm market, higher in a shortage.
 *
 * A RATIO, not a level, and that is the point. The level of `lotInputCost` is set by the
 * physical lot definition in `rawLotsFromSector`, which is five orders of magnitude away from
 * what the arsenal prices a lot at, so it can never be a build cost directly. Its movement is
 * still real information: it says how hard this recipe is being squeezed. Dividing by the same
 * function at nominal prices keeps the information and discards the broken level.
 *
 * Because both ends carry the same base-price basis, that basis cancels here exactly. The
 * index is identical on a modern or an era-scaled commodity book, which is what makes the
 * whole cost path immune to the era question `revenueBasisPerLot` documents.
 */
export function lotCostIndex(
  strategyId: string | undefined | null,
  priceRatios?: ReadonlyMap<CommodityType, number>
): number | null {
  const nominal = lotInputCost(strategyId);
  if (nominal == null || !(nominal > 0)) return null;
  const live = lotInputCost(strategyId, priceRatios);
  if (live == null || !Number.isFinite(live)) return null;
  return Math.min(LOT_COST_INDEX_MAX, Math.max(LOT_COST_INDEX_MIN, live / nominal));
}

/**
 * What one lot costs its builder, in the same units as the contract price.
 *
 * `lotPrice` is what the lot sells for: at award that is the GDP anchor, and at DELIVERY it
 * is the contract's own stored `pricePerLot`, so a signed order keeps the margin it was
 * struck at even if the anchor has moved since.
 *
 * Returns null for a line that builds no materiel (`cyber`, or a non-defence sector) or an
 * unusable price. Callers must refuse rather than treat it as free.
 */
export function lotProductionCost(
  strategyId: string | undefined | null,
  lotPrice: number,
  priceRatios?: ReadonlyMap<CommodityType, number>
): number | null {
  if (!(lotPrice > 0) || !Number.isFinite(lotPrice)) return null;
  const index = lotCostIndex(strategyId, priceRatios);
  if (index == null) return null;
  // Capped, so a shortage SQUEEZES THE SUPPLIER'S MARGIN and never raises the bill to the
  // taxpayer. Without the cap a shock of barely 5% pushed cost x MIN_CONTRACT_MARGIN above the
  // GDP anchor, the band inverted, and the floor became a price ABOVE the ceiling the anchor is
  // supposed to be. At the cap the margin has fallen to exactly the floor markup and stops:
  // the contract stays writable at the anchor and the supplier absorbs the rest, which is the
  // right side of that trade to put the pain on.
  const share = Math.min((1 - TARGET_SUPPLIER_MARGIN) * index, MAX_COST_SHARE_OF_PRICE);
  return lotPrice * share;
}

/**
 * The margin a contract must clear over production cost before it may be written.
 *
 * A floor, not a target: at 12% a supplier that wins on price still makes money, so the
 * cheap-mass doctrine is a real choice rather than a way to bankrupt your own arms industry.
 */
export const MIN_CONTRACT_MARGIN = 0.12;
/**
 * The most of a lot's price that its build cost may consume, whatever the commodity market
 * does.
 *
 * Set so the price floor lands exactly ON the GDP anchor rather than above it:
 * `cost x (1 + MIN_CONTRACT_MARGIN) = price` at this share. Past it the band would invert, and
 * a "floor" higher than the anchor is not a floor at all, it is the taxpayer funding a
 * shortage. A supplier squeezed this hard still clears the minimum contract margin.
 */
export const MAX_COST_SHARE_OF_PRICE = 1 / (1 + MIN_CONTRACT_MARGIN);

/**
 * The most a contract may mark a lot up over what it costs to build (ticket #1134).
 *
 * A backstop, not the working ceiling. With cost derived from price at
 * `TARGET_SUPPLIER_MARGIN` the GDP anchor is normally the tighter of the two bounds and is
 * what a minister actually negotiates against. This one exists so that if the cost model is
 * ever changed, mis-seeded, or handed a nonsense figure, the price still cannot float orders
 * of magnitude above what building the thing consumed. That is the failure mode this ticket
 * was raised for and it should be impossible by construction, not by calibration.
 */
export const MAX_CONTRACT_MARGIN = 1.0;

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
 * `anchorPrice` is `lotPrice(countryId, militaryPriceAnchor(...))`, the GDP-anchored figure
 * the whole arsenal is calibrated around: how much of its budget a country turns into materiel
 * per turn, how many lots a platform needs, and how long equipping a roster takes are all
 * derived from it. It is the designed number and this function does not second-guess it.
 *
 * What #1134 changed is the OTHER end. Production cost is now `anchorPrice` less
 * `TARGET_SUPPLIER_MARGIN`, so the two ends of the band are two views of one figure and
 * cannot drift apart. Previously the ceiling was the anchor and the floor was a raw commodity
 * bill computed on the physical lot definition, which sits five orders of magnitude below what
 * a lot sells for. The band therefore spanned from about 1,200 to about 383,700,000 and every
 * contract in it was a transfer rather than a purchase.
 *
 * The result is a genuine but narrow negotiation: roughly 12% margin at the floor, the
 * designed anchor price at the ceiling. A minister who bargains hard saves real money; one who
 * does not is not fleeced; and no price in the band lets a supplier bank the appropriation.
 *
 * Deliberately NOT retroactive on price. A contract stores `pricePerLot` at award and the
 * delivery sweep bills the stored figure, so every live order keeps the price its supplier
 * agreed to.
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
  // The anchor is the designed price and normally the binding ceiling; the cost backstop only
  // takes over if cost is ever mis-derived, and guarantees a price can never again sit orders
  // of magnitude above what building the lot consumed.
  const anchorCeiling = Math.round(anchorPrice * scale);
  const costCeiling = Math.round(gradedCost * (1 + MAX_CONTRACT_MARGIN));
  const ceiling = Math.max(floor, Math.min(anchorCeiling, costCeiling));
  // Grossing the graded cost back up by the same margin it was derived with lands exactly on
  // the anchor in a calm market, so leaving the price blank quotes the designed figure. In a
  // shortage it rises with cost and the ceiling caps it; if inputs run away far enough the
  // floor overtakes it and the floor wins, because nothing may be written below cost.
  const suggested = Math.max(
    floor,
    Math.min(ceiling, Math.round(gradedCost / (1 - TARGET_SUPPLIER_MARGIN)))
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
