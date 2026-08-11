"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ComposableMap, Geographies, Geography, ZoomableGroup } from "react-simple-maps";
import { getCountryMapConfig } from "@/lib/commodity-map";
import { commodityColor, priceColor } from "@/lib/commodity-map";
import { getStateDisplayName } from "@/lib/commodity-map";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  convertCommodityPrice,
  formatCommodityPrice,
  getCommodityDisplayCurrency,
} from "@/lib/commodity-map/commodityPriceDisplay";
import { capacityColor } from "@/lib/commodity-map";
import type { MapMode } from "./CommodityMapModeToggle";

interface CommodityRegionMapProps {
  countryId: CountryId;
  mode: MapMode;
  basePrice: number;
  stateSupply: Record<string, number>;
  stateDemand: Record<string, number>;
  statePrices: Record<string, number>;
  stateCountryMap: Record<string, string>;
  capacityByState?: Record<string, number>;
  unit: string;
  forexEnabled: boolean;
  exchangeRates: Partial<Record<CurrencyCode, number>>;
  onStateClick?: (stateId: string) => void;
}

function formatUnits(value: number, unit: string): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M ${unit}`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K ${unit}`;
  if (value >= 10) return `${Math.round(value)} ${unit}`;
  return `${value.toFixed(1)} ${unit}`;
}

export default function CommodityRegionMap({
  countryId,
  mode,
  basePrice,
  stateSupply,
  stateDemand,
  statePrices,
  stateCountryMap,
  capacityByState,
  unit,
  forexEnabled,
  exchangeRates,
  onStateClick,
}: CommodityRegionMapProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const router = useRouter();
  const mapConfig = getCountryMapConfig(countryId);
  const currencyCode = getCommodityDisplayCurrency(countryId);

  // Get the relevant state IDs for this country
  const countryStateIds = useMemo(() => {
    return Object.keys(stateCountryMap).filter((id) => stateCountryMap[id] === countryId);
  }, [countryId, stateCountryMap]);

  // Compute max value for color normalization
  const maxValue = useMemo(() => {
    if (mode === "price") {
      let maxDeviation = 0;
      for (const id of countryStateIds) {
        const price = statePrices[id];
        if (price == null || basePrice <= 0) continue;
        const deviation = Math.abs(((price - basePrice) / basePrice) * 100);
        if (deviation > maxDeviation) maxDeviation = deviation;
      }
      return maxDeviation || 1;
    }
    if (mode === "capacity") {
      let max = 0;
      for (const id of countryStateIds) {
        const val = capacityByState?.[id] ?? 0;
        if (val > max) max = val;
      }
      return max || 1;
    }
    let max = 0;
    for (const id of countryStateIds) {
      const val = mode === "supply" ? (stateSupply[id] ?? 0) : (stateDemand[id] ?? 0);
      if (val > max) max = val;
    }
    return max;
  }, [basePrice, capacityByState, countryStateIds, mode, stateDemand, statePrices, stateSupply]);

  if (!mapConfig?.hasRegionMap || !mapConfig.geoUrl || !mapConfig.featureIdToStateId) {
    return (
      <div className="text-center text-muted text-sm py-8">
        Regional map not yet available for this country.
      </div>
    );
  }

  const {
    geoUrl,
    featureIdToStateId,
    featureIdExtractor,
    projection,
    projectionCenter,
    projectionScale,
  } = mapConfig;

  // Projection config based on country
  const projConfig =
    projection === "albers-usa"
      ? { projection: "geoAlbersUsa" as const, projectionConfig: {} }
      : {
          projection: "geoMercator" as const,
          projectionConfig: {
            center: (projectionCenter ?? [-2, 55.5]) as [number, number],
            scale: projectionScale ?? 1800,
          },
        };

  const mapWidth = projection === "albers-usa" ? 800 : 500;
  const mapHeight = projection === "albers-usa" ? 500 : 600;

  const handleMouseMove = (e: React.MouseEvent) => {
    const svg = (e.currentTarget as SVGGElement).closest("svg");
    const rect = svg?.getBoundingClientRect();
    if (rect) {
      setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
  };

  const hoveredStateId = hovered;
  const hoveredData = hoveredStateId
    ? {
        supply: stateSupply[hoveredStateId] ?? 0,
        demand: stateDemand[hoveredStateId] ?? 0,
        price: statePrices[hoveredStateId],
        capacity: capacityByState?.[hoveredStateId] ?? 0,
        name: getStateDisplayName(countryId, hoveredStateId),
      }
    : null;

  const handleStateClick = (stateId: string) => {
    if (onStateClick) {
      onStateClick(stateId);
      return;
    }
    router.push(`/state/${stateId}`);
  };

  return (
    <div className="relative">
      <ComposableMap
        width={mapWidth}
        height={mapHeight}
        projection={projConfig.projection}
        projectionConfig={projConfig.projectionConfig}
        className="w-full"
        style={{ maxHeight: projection === "albers-usa" ? 400 : 480 }}
      >
        <ZoomableGroup>
          <Geographies geography={geoUrl}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const featureId = featureIdExtractor
                  ? featureIdExtractor(geo)
                  : String(geo.id ?? geo.properties?.id ?? "");
                const stateId = featureIdToStateId[featureId];
                if (!stateId) {
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill="var(--card-elevated)"
                      stroke="var(--card-border)"
                      strokeWidth={0.5}
                      style={{ outline: "none" }}
                    />
                  );
                }

                const fill =
                  mode === "price"
                    ? priceColor(
                        convertCommodityPrice(
                          statePrices[stateId] ?? basePrice,
                          currencyCode,
                          forexEnabled,
                          exchangeRates
                        ),
                        convertCommodityPrice(basePrice, currencyCode, forexEnabled, exchangeRates),
                        maxValue
                      )
                    : mode === "capacity"
                      ? capacityColor(capacityByState?.[stateId] ?? 0, maxValue)
                      : commodityColor(
                          mode === "supply"
                            ? (stateSupply[stateId] ?? 0)
                            : (stateDemand[stateId] ?? 0),
                          maxValue,
                          mode
                        );
                const isHov = hovered === stateId;

                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={isHov ? "var(--primary)" : fill}
                    stroke={isHov ? "var(--foreground)" : "var(--card-border)"}
                    strokeWidth={isHov ? 1.5 : 0.5}
                    onMouseEnter={() => setHovered(stateId)}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={() => {
                      setHovered(null);
                      setTooltipPos(null);
                    }}
                    onClick={() => handleStateClick(stateId)}
                    style={{
                      outline: "none",
                      cursor: "pointer",
                      transition: "fill 0.15s ease, stroke 0.15s ease, stroke-width 0.15s ease",
                    }}
                  />
                );
              })
            }
          </Geographies>
        </ZoomableGroup>
      </ComposableMap>

      {/* Hover tooltip */}
      {hoveredData && tooltipPos && (
        <div
          className="absolute pointer-events-none z-20 px-3 py-2 rounded-lg text-xs bg-popover/95 border border-card-border shadow-xl backdrop-blur-md text-popover-foreground min-w-[140px] animate-in fade-in zoom-in-95 duration-100"
          style={{
            left: tooltipPos.x + 16,
            top: tooltipPos.y - 16,
            transform: "translateY(-50%)",
          }}
        >
          <div className="font-bold text-sm mb-1">{hoveredData.name}</div>
          <div className="space-y-0.5">
            {hoveredData.capacity > 0 && (
              <div className="flex justify-between gap-4">
                <span className="text-muted">Deposits</span>
                <span className="text-warning tabular-nums">
                  {formatUnits(hoveredData.capacity, unit)}/turn
                </span>
              </div>
            )}
            {hoveredData.price != null && (
              <div className="flex justify-between gap-4">
                <span className="text-muted">Price</span>
                <span className="font-mono tabular-nums">
                  {formatCommodityPrice(
                    hoveredData.price,
                    currencyCode,
                    forexEnabled,
                    exchangeRates
                  )}
                </span>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <span className="text-muted">Supply</span>
              <span className="text-success tabular-nums">
                {formatUnits(hoveredData.supply, unit)}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted">Demand</span>
              <span className="text-error tabular-nums">
                {formatUnits(hoveredData.demand, unit)}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted">Balance</span>
              <span
                className={`tabular-nums ${hoveredData.supply - hoveredData.demand > 0 ? "text-success" : hoveredData.supply - hoveredData.demand < 0 ? "text-error" : "text-muted"}`}
              >
                {hoveredData.supply - hoveredData.demand > 0 ? "+" : ""}
                {formatUnits(Math.abs(hoveredData.supply - hoveredData.demand), unit)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
