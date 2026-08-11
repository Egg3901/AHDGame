import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { checkWikiDisabled } from "@/lib/api/wikiGuard";
import type { CommodityPrice, State } from "@/lib/db/types";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import {
  COMMODITY_TYPES,
  COMMODITY_LABELS,
  COMMODITY_BASE_PRICES,
  COMMODITY_UNITS,
  EXTRACTABLE_RESOURCES,
  type CommodityType,
  type ExtractableResource,
} from "@/lib/constants/commodities";
import { COUNTRY_CONFIGS, COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import { getEconomyVisibleCountryIds } from "@/lib/countryAccess";

interface CountryDistribution {
  countryId: CountryId;
  name: string;
  flagEmoji: string;
  supply: number;
  demand: number;
  net: number;
  /** Only present for extractable resources — summed state capacity (units/turn). */
  capacity?: number;
}

interface TopProducerState {
  stateId: string;
  name: string;
  countryId: CountryId;
  capacity: number;
}

export interface CommodityDistributionResponse {
  commodity: CommodityType;
  label: string;
  basePrice: number;
  globalPrice: number;
  unit: string;
  isExtractable: boolean;
  byCountry: CountryDistribution[];
  /** Populated only for extractables; top 5 producing states/regions. */
  topProducerStates: TopProducerState[];
  turn: number | null;
  updatedAt: string | null;
}

// GET /api/wiki/commodity-distribution/[type] — per-country supply/demand + capacity for a commodity.
// Auth: public; blocked when wiki is disabled for non-mod/admin.
// Errors: 400 (bad type), 403 (wiki disabled), 404 (no price record)
export async function GET(_request: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const blocked = await checkWikiDisabled();
    if (blocked) return blocked;

    const { type } = await params;
    const commodity = type as CommodityType;
    if (!COMMODITY_TYPES.includes(commodity)) {
      return NextResponse.json({ error: "Unknown commodity" }, { status: 400 });
    }

    const isExtractable = (EXTRACTABLE_RESOURCES as readonly string[]).includes(commodity);
    const db = await getDb();

    const [priceDoc, states, capacities] = await Promise.all([
      db.collection<CommodityPrice>("commodityPrices").findOne({ commodity }),
      db
        .collection<State>("states")
        .find({}, { projection: { _id: 1, countryId: 1, name: 1 } })
        .toArray(),
      isExtractable
        ? db
            .collection<StateResourceCapacity>("stateResourceCapacity")
            .find({}, { projection: { stateId: 1, countryId: 1, resources: 1 } })
            .toArray()
        : Promise.resolve([] as StateResourceCapacity[]),
    ]);

    // Build state→country lookup so we can aggregate per-state S/D to country totals
    // even when nationalSupply/nationalDemand aren't stored on the price document.
    const stateToCountry = new Map<string, CountryId>();
    const stateNames = new Map<string, string>();
    for (const s of states) {
      stateToCountry.set(s._id, s.countryId);
      stateNames.set(s._id, s.name);
    }

    const supplyByCountry = new Map<CountryId, number>();
    const demandByCountry = new Map<CountryId, number>();

    if (priceDoc) {
      // Prefer authoritative national totals stored on the price doc.
      const nationalSupply = priceDoc.nationalSupply ?? {};
      const nationalDemand = priceDoc.nationalDemand ?? {};
      const haveAuthoritative =
        Object.keys(nationalSupply).length > 0 || Object.keys(nationalDemand).length > 0;

      if (haveAuthoritative) {
        for (const c of COUNTRY_ORDER) {
          supplyByCountry.set(c, nationalSupply[c] ?? 0);
          demandByCountry.set(c, nationalDemand[c] ?? 0);
        }
      } else {
        // Fallback: aggregate from per-state supply/demand.
        for (const [stateId, supply] of Object.entries(priceDoc.stateSupply ?? {})) {
          const country = stateToCountry.get(stateId);
          if (!country) continue;
          supplyByCountry.set(country, (supplyByCountry.get(country) ?? 0) + supply);
        }
        for (const [stateId, demand] of Object.entries(priceDoc.stateDemand ?? {})) {
          const country = stateToCountry.get(stateId);
          if (!country) continue;
          demandByCountry.set(country, (demandByCountry.get(country) ?? 0) + demand);
        }
      }
    }

    const capacityByCountry = new Map<CountryId, number>();
    const stateCapacities: TopProducerState[] = [];
    if (isExtractable) {
      const resourceKey = commodity as ExtractableResource;
      for (const cap of capacities) {
        const value = cap.resources?.[resourceKey];
        if (typeof value !== "number" || value <= 0) continue;
        capacityByCountry.set(cap.countryId, (capacityByCountry.get(cap.countryId) ?? 0) + value);
        stateCapacities.push({
          stateId: cap.stateId,
          name: stateNames.get(cap.stateId) ?? cap.stateId,
          countryId: cap.countryId,
          capacity: value,
        });
      }
    }

    const economyVisible = await getEconomyVisibleCountryIds();
    const visibleOrder = COUNTRY_ORDER.filter((id) => economyVisible.includes(id));

    const byCountry: CountryDistribution[] = visibleOrder.map((id) => {
      const config = COUNTRY_CONFIGS[id];
      const supply = supplyByCountry.get(id) ?? 0;
      const demand = demandByCountry.get(id) ?? 0;
      const entry: CountryDistribution = {
        countryId: id,
        name: config.name,
        flagEmoji: config.flagEmoji,
        supply: Math.round(supply * 100) / 100,
        demand: Math.round(demand * 100) / 100,
        net: Math.round((supply - demand) * 100) / 100,
      };
      if (isExtractable) {
        entry.capacity = Math.round((capacityByCountry.get(id) ?? 0) * 100) / 100;
      }
      return entry;
    });

    const topProducerStates = stateCapacities.sort((a, b) => b.capacity - a.capacity).slice(0, 5);

    const response: CommodityDistributionResponse = {
      commodity,
      label: COMMODITY_LABELS[commodity],
      // The world's own seeded basePrice is era-scaled; the constant is 2019-only.
      basePrice: priceDoc?.basePrice ?? COMMODITY_BASE_PRICES[commodity],
      globalPrice: priceDoc?.globalPrice ?? priceDoc?.basePrice ?? COMMODITY_BASE_PRICES[commodity],
      unit: COMMODITY_UNITS[commodity],
      isExtractable,
      byCountry,
      topProducerStates,
      turn: priceDoc?.turn ?? null,
      updatedAt: priceDoc?.updatedAt ? priceDoc.updatedAt.toISOString() : null,
    };

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300, no-transform",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
