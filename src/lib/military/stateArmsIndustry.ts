import type { CountryId } from "@/lib/constants/countries";

/**
 * Passive materiel production for planned-defence economies.
 *
 * The national arsenal is fed by defence contracts: a ministry appropriates, a supplying
 * corporation builds, lots are delivered. A command economy has no such market to place
 * an order into, so that pipeline never runs for it and its store stays empty however
 * much it spends. Measured on the live world, RU's last procurement window closed on turn
 * 204 and DD had never signed a contract at all, which left both unable to replace a
 * single piece of battle-destroyed equipment while the US refitted after every engagement.
 *
 * This is the substitute: a modest, uncontracted trickle straight into the store,
 * representing state arsenals producing to plan rather than to order.
 *
 * A NAMED ROSTER on purpose, not derived from `isCommandEconomy`. That predicate covers
 * only RU and CN and drives non-convertible currency, the passive monobank, administered
 * CPI and soft budgets. Adding DD to it to obtain arsenal accrual would flip East Germany
 * into all of that, which is a far larger change than arms supply.
 *
 * Spec: calibrated in scripts/sim/stateArmsIndustry2026-08-28.ts.
 */
export const STATE_ARMS_INDUSTRY: Partial<Record<CountryId, number>> = {
  /**
   * The Soviet defence industry is the point of the Soviet Union, so it out-produces its
   * client by three to one. At 3 lots a turn a new formation is equipped in under three
   * turns and a stripped 52-formation roster rebuilds in about 81.
   */
  RU: 3,
  /**
   * East Germany runs a real but much smaller arsenal: one lot a turn kits a new
   * formation in about seven turns and rebuilds its eleven in about sixty.
   */
  DD: 1,
};

/** Lots per turn this country's state arsenals produce. Zero for a market economy. */
export function stateArmsLotsPerTurn(countryId: string): number {
  return STATE_ARMS_INDUSTRY[countryId as CountryId] ?? 0;
}

/**
 * The emergency floor, for everyone who is NOT on the roster above.
 *
 * The asymmetry this closes: a planned economy's equipment cannot reach zero, because
 * `STATE_ARMS_INDUSTRY` tops it up every turn whatever else is happening. A market
 * economy's can, and did. On the live world the United States finished the War for
 * Germany with 0/0/0 firepower, protection and support on its Armored and Infantry
 * Divisions, because the only route into its store is a defence contract, and
 * `applyDefenceRefit` returns immediately on an empty arsenal. Procurement was also
 * frozen at the time, which made the gap total.
 *
 * This is a FLOOR, not a pipeline, and the distinction is the whole design:
 *
 *  - It engages only for a domain whose store is at zero. One lot arrives, the store
 *    is no longer empty, and the floor switches itself off next turn. It cannot fill a
 *    store, only refuse to leave one at nothing.
 *  - It is a third of the Soviet rate and equal to East Germany's, so planned production
 *    keeps its whole advantage: RU still re-equips a stripped 52-formation roster in
 *    about 81 turns, and nobody else can approach that.
 *  - It never substitutes for procurement. Contracts remain the only way to stock an
 *    arsenal, modernise a tier, or supply a war at pace.
 *
 * A nation that has lost everything improvises something. It does not get a defence
 * industry for free.
 */
export const MATERIEL_FLOOR_LOTS = 1;

/**
 * The floor's production for a country, and the domains it may reach.
 *
 * Returns 0 lots for a planned economy (which has its own rate) and for anyone whose
 * stores are not actually empty. `onlyEmpty` is what keeps this a floor: the allocator
 * fills toward a domain's CEILING, so handing it every domain would turn one lot a turn
 * into a full second supply line.
 */
export function materielFloor(
  countryId: string,
  domains: Record<string, DomainDemand>
): { lots: number; domains: Record<string, DomainDemand> } {
  if (stateArmsLotsPerTurn(countryId) > 0) return { lots: 0, domains: {} };
  const onlyEmpty = Object.fromEntries(
    Object.entries(domains).filter(([, d]) => d.stock <= 0 && d.need > 0)
  );
  return {
    lots: Object.keys(onlyEmpty).length > 0 ? MATERIEL_FLOOR_LOTS : 0,
    domains: onlyEmpty,
  };
}

/** What one domain's store needs and how much it may hold. */
export interface DomainDemand {
  /** Lots required to bring the domain's EXISTING formations up to a full load. */
  need: number;
  /** Lots to equip the domain's roster outright. The store may bank up to one of these. */
  ceiling: number;
  /** What the store holds now. */
  stock: number;
}

/**
 * Where this turn's production goes, or null when there is nowhere useful to put it.
 *
 * Feeds whichever domain is furthest from covering its own shortfall, so production
 * self-directs at the army's actual gap rather than needing a split to be configured. As
 * each domain fills, the next-hungriest takes over.
 *
 * The ceiling is what makes a long war finite. A nation at peace banks at most one full
 * re-equip of its roster and then stops; a war fought at pace burns more per turn than
 * the trickle replaces, so the reserve drains and the army starts going short. Expressed
 * as the roster's own size rather than a constant, so it scales with the army and needs
 * no separate tuning.
 */
export function stateArmsAllocation(
  lotsPerTurn: number,
  domains: Record<string, DomainDemand>
): { domain: string; lots: number } | null {
  if (lotsPerTurn <= 0) return null;

  const eligible = Object.entries(domains).filter(([, d]) => d.stock < d.ceiling);
  if (eligible.length === 0) return null;

  // Sorted rather than reduced so the tiebreak is explicit: hungriest first, then the
  // emptier store, then the domain name. A roster's iteration order must never decide
  // where a country's production goes.
  eligible.sort((a, b) => {
    const hunger = b[1].need - b[1].stock - (a[1].need - a[1].stock);
    if (hunger !== 0) return hunger;
    if (a[1].stock !== b[1].stock) return a[1].stock - b[1].stock;
    return a[0] < b[0] ? -1 : 1;
  });

  const [domain, d] = eligible[0];
  return { domain, lots: Math.min(lotsPerTurn, d.ceiling - d.stock) };
}
