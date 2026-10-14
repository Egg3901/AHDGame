/**
 * Cross-state plant supply: buildOwnRoutes plans reachable freight hauls from
 * local surplus. Opted-in Group priority shares finite supply and demand across
 * wholly owned subsidiaries; failed hauls leave room for another origin.
 */
import type { CommodityType } from "@/lib/constants/commodities";
import type { CountryId } from "@/lib/constants/countries";
import {
  ownRouteIdentity,
  ownRoutePolicyOwner,
  type InternalSupplyPolicy,
} from "@/lib/market/internalSupply/rules";

export interface SourcingOwnRoute {
  commodity: CommodityType;
  /** A corporation id for legacy routes, or the namespaced group id for group routes. */
  corporationId: string;
  originStateId: string;
  destStateId: string;
  units: number;
  freightCharge?: number;
  ownFirstAcrossStates?: boolean;
  /** Shared budgets across alternative routes; spent only by successful hauls. */
  originSupplyUnits?: number;
  destinationDemandUnits?: number;
}

export interface OwnRouteSector {
  sectorId: string;
  corporationId: string;
  stateId: string;
}

const ROUTE_FLOOR_UNITS = 1e-6;

export function buildOwnRoutes(args: {
  sectors: readonly OwnRouteSector[];
  supplyBySector: ReadonlyMap<string, ReadonlyMap<CommodityType, number>>;
  inputDemandBySector: ReadonlyMap<string, ReadonlyMap<CommodityType, number>>;
  policies: ReadonlyMap<string, { root: string; policy: InternalSupplyPolicy }>;
  stateToCountry: ReadonlyMap<string, string>;
  hops: (country: CountryId, from: string, to: string) => number | null;
}): SourcingOwnRoute[] {
  const books = new Map<string, Map<string, { supply: number; demand: number }>>();
  const add = (key: string, stateId: string, field: "supply" | "demand", units: number) => {
    if (!(Number.isFinite(units) && units > 0)) return;
    let byState = books.get(key);
    if (!byState) books.set(key, (byState = new Map()));
    const entry = byState.get(stateId) ?? { supply: 0, demand: 0 };
    entry[field] += units;
    byState.set(stateId, entry);
  };

  for (const sector of args.sectors) {
    const setting = args.policies.get(sector.corporationId);
    if (!setting || setting.policy.priority === "market" || !sector.stateId) continue;
    const routeId = ownRouteIdentity(sector.corporationId, setting);
    for (const [commodity, units] of args.supplyBySector.get(sector.sectorId) ?? [])
      add(routeId + "|" + commodity, sector.stateId, "supply", units);
    for (const [commodity, units] of args.inputDemandBySector.get(sector.sectorId) ?? [])
      add(routeId + "|" + commodity, sector.stateId, "demand", units);
  }

  const routes: SourcingOwnRoute[] = [];
  for (const key of [...books.keys()].sort()) {
    const sep = key.indexOf("|");
    const routeId = key.slice(0, sep);
    const commodity = key.slice(sep + 1) as CommodityType;
    const byState = books.get(key)!;
    const spare = new Map<string, number>();
    const need = new Map<string, number>();
    for (const [stateId, { supply, demand }] of byState) {
      if (supply - demand > ROUTE_FLOOR_UNITS) spare.set(stateId, supply - demand);
      if (demand - supply > ROUTE_FLOOR_UNITS) need.set(stateId, demand - supply);
    }
    if (spare.size === 0 || need.size === 0) continue;
    const policyOwner = ownRoutePolicyOwner(routeId, routeId);
    const ownFirst = args.policies.get(policyOwner)?.policy.ownFirstAcrossStates === true;
    for (const destStateId of [...need.keys()].sort()) {
      const country = args.stateToCountry.get(destStateId);
      if (!country) continue;
      const origins = [...spare.keys()]
        .filter((o) => args.stateToCountry.get(o) === country)
        .map((o) => ({ o, h: args.hops(country as CountryId, o, destStateId) }))
        .filter((x): x is { o: string; h: number } => x.h !== null && x.h > 0)
        .sort((a, b) => a.h - b.h || a.o.localeCompare(b.o));
      let remaining = need.get(destStateId)!;
      for (const { o } of origins) {
        if (!(remaining > ROUTE_FLOOR_UNITS)) break;
        const available = spare.get(o) ?? 0;
        const units = Math.min(available, remaining);
        if (!(units > ROUTE_FLOOR_UNITS)) continue;
        routes.push({
          commodity,
          corporationId: routeId,
          originStateId: o,
          destStateId,
          units,
          ...(ownFirst
            ? {
                ownFirstAcrossStates: true,
                originSupplyUnits: available,
                destinationDemandUnits: remaining,
              }
            : {}),
        });
        // Opted-in plans list alternatives. Failed or partial hauls leave the
        // shared supply and demand budget for another reachable mine.
        if (!ownFirst) {
          spare.set(o, available - units);
          remaining -= units;
        }
      }
    }
  }
  return routes;
}
