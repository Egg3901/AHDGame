import type { SourcingOwnRoute } from "../ownRoutes";

/** Own routes may reclaim local market fill only after a haul succeeds. */
export function ownRouteAvailable(spare: number, localFill: number, ownFirst: boolean): number {
  return Math.max(0, spare) + (ownFirst ? Math.max(0, localFill) : 0);
}
export function reclaimedLocalUnits(dispatch: number, spare: number): number {
  return Math.max(0, dispatch - Math.max(0, spare));
}

export function ownRouteBudgetKey(route: SourcingOwnRoute, side: "origin" | "destination"): string {
  return `${route.commodity}|${route.corporationId}|${side === "origin" ? route.originStateId : route.destStateId}`;
}

/** Candidate alternatives share finite origin supply and destination demand. */
export function ownRouteBudgets(routes: readonly SourcingOwnRoute[]): {
  supply: Map<string, number>;
  demand: Map<string, number>;
} {
  const supply = new Map<string, number>();
  const demand = new Map<string, number>();
  for (const route of routes) {
    for (const [side, budget, amount] of [
      ["origin", supply, route.originSupplyUnits],
      ["destination", demand, route.destinationDemandUnits],
    ] as const) {
      if (amount === undefined || !Number.isFinite(amount)) continue;
      const key = ownRouteBudgetKey(route, side);
      budget.set(key, Math.min(budget.get(key) ?? Infinity, Math.max(0, amount)));
    }
  }
  return { supply, demand };
}
