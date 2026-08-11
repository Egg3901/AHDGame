"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  WORLD_GEO_URL,
  SVG_W,
  SVG_H,
  TRANSLATE,
  ORTHO_SCALE,
  easeInOutCubic,
} from "@/app/world/worldConstants";
import {
  aggregateByCountry,
  getMaxValue,
  getMaxPriceDeviation,
  commodityColor,
  capacityColor,
  priceColor,
  ISO_NUMERIC_TO_COUNTRY,
  type CountryCommodityData,
} from "@/lib/commodity-map";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  convertCommodityPrice,
  getCommodityDisplayCurrency,
} from "@/lib/commodity-map/commodityPriceDisplay";
import CommodityMapModeToggle, { type MapMode } from "./CommodityMapModeToggle";
import CommodityMapLegend from "./CommodityMapLegend";
import CommodityCountryStatCard from "./CommodityCountryStatCard";

interface CommodityWorldMapViewProps {
  commodityLabel: string;
  unit: string;
  basePrice: number;
  globalPrice: number;
  forexEnabled: boolean;
  exchangeRates: Partial<Record<CurrencyCode, number>>;
  stateSupply: Record<string, number>;
  stateDemand: Record<string, number>;
  statePrices: Record<string, number>;
  nationalSupply?: Record<string, number>;
  nationalDemand?: Record<string, number>;
  stateCountryMap: Record<string, string>;
  capacityByState?: Record<string, number>;
  mode: MapMode;
  onModeChange: (mode: MapMode) => void;
  onDrillDown: (countryId: CountryId) => void;
  onViewCountryPage: (countryId: CountryId) => void;
}

export default function CommodityWorldMapView({
  commodityLabel,
  unit,
  basePrice,
  globalPrice,
  forexEnabled,
  exchangeRates,
  stateSupply,
  stateDemand,
  statePrices,
  nationalSupply,
  nationalDemand,
  stateCountryMap,
  capacityByState,
  mode,
  onModeChange,
  onDrillDown,
  onViewCountryPage,
}: CommodityWorldMapViewProps) {
  // --- Country-level aggregated data ---
  const countryMap = useMemo(
    () => new Map(Object.entries(stateCountryMap)) as Map<string, CountryId>,
    [stateCountryMap]
  );
  const countryData = useMemo(
    () =>
      aggregateByCountry(
        stateSupply,
        stateDemand,
        statePrices,
        countryMap,
        basePrice,
        globalPrice,
        nationalSupply,
        nationalDemand
      ),
    [
      stateSupply,
      stateDemand,
      statePrices,
      countryMap,
      basePrice,
      globalPrice,
      nationalSupply,
      nationalDemand,
    ]
  );

  // Aggregate capacityByState → capacity per CountryId
  const countryCapacity = useMemo((): Record<string, number> => {
    if (!capacityByState) return {};
    const result: Record<string, number> = {};
    for (const [stateId, cap] of Object.entries(capacityByState)) {
      const cid = stateCountryMap[stateId];
      if (!cid) continue;
      result[cid] = (result[cid] ?? 0) + cap;
    }
    return result;
  }, [capacityByState, stateCountryMap]);

  const maxCapacity = useMemo(() => {
    if (!capacityByState) return 1;
    return Math.max(1, ...Object.values(countryCapacity));
  }, [capacityByState, countryCapacity]);

  const maxVal = useMemo(() => {
    if (mode === "price") {
      return getMaxPriceDeviation(countryData, basePrice) || 1;
    }
    if (mode === "capacity") return maxCapacity;
    return getMaxValue(countryData, mode);
  }, [countryData, mode, basePrice, maxCapacity]);

  // --- React state ---
  const [hovered, setHovered] = useState<string | null>(null);
  const [isAnimating, _setIsAnimating] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [paths, setPaths] = useState<Map<string, string | null>>(new Map());
  const [selectedCountry, setSelectedCountry] = useState<{
    countryId: CountryId;
    data: CountryCommodityData;
    position: { x: number; y: number };
  } | null>(null);

  // --- Refs ---
  const cardRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRefsMap = useRef<Map<string, SVGPathElement>>(new Map());
  const sphereRef = useRef<SVGCircleElement>(null);
  const graticuleRef = useRef<SVGPathElement>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const featuresRef = useRef<any[]>([]);
  const centroidsRef = useRef<Map<string, [number, number]>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graticuleDataRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d3Ref = useRef<any>(null);
  const eeScaleRef = useRef(148);

  const viewModeRef = useRef<"map" | "globe">("map");
  const rotationRef = useRef<[number, number, number]>([0, 0, 0]);
  const mapPanRef = useRef<[number, number]>([0, 0]);
  const zoomRef = useRef(1);
  const hoveredRef = useRef<string | null>(null);
  const isDraggingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const isAnimatingRef = useRef(false);
  const animFrameRef = useRef(0);
  const dragFrameRef = useRef(0);
  const autoRotateRef = useRef(0);

  // --- Get commodity color for a country ---
  const getCountryFill = useCallback(
    (isoNumeric: string): string | null => {
      const countryId = ISO_NUMERIC_TO_COUNTRY[isoNumeric];
      if (!countryId) return null;
      if (mode === "capacity") {
        const cap = countryCapacity[countryId] ?? 0;
        if (cap <= 0) return null;
        return capacityColor(cap, maxVal);
      }
      const data = countryData[countryId];
      if (!data) return null;
      if (mode === "price") {
        if (data.avgPrice == null) return null;
        const currencyCode = getCommodityDisplayCurrency(countryId);
        const displayPrice = convertCommodityPrice(
          data.avgPrice,
          currencyCode,
          forexEnabled,
          exchangeRates
        );
        const displayBasePrice = convertCommodityPrice(
          basePrice,
          currencyCode,
          forexEnabled,
          exchangeRates
        );
        return priceColor(displayPrice, displayBasePrice, maxVal);
      }
      const value = mode === "supply" ? data.supply : data.demand;
      if (value <= 0) return null;
      return commodityColor(value, maxVal, mode);
    },
    [countryData, countryCapacity, mode, maxVal, basePrice, forexEnabled, exchangeRates]
  );

  // --- Imperative path update ---
  const imperativeUpdate = useCallback(() => {
    const d3 = d3Ref.current;
    if (!d3 || !featuresRef.current.length) return;

    const z = zoomRef.current;
    let proj;
    if (viewModeRef.current === "map") {
      proj = d3
        .geoEqualEarth()
        .scale(eeScaleRef.current * z)
        .translate([TRANSLATE[0] + mapPanRef.current[0], TRANSLATE[1] + mapPanRef.current[1]]);
    } else {
      proj = d3
        .geoOrthographic()
        .scale(ORTHO_SCALE * z)
        .translate(TRANSLATE)
        .rotate(rotationRef.current)
        .clipAngle(90 + 1e-6);
    }

    const pathGen = d3.geoPath(proj);
    for (const feature of featuresRef.current) {
      const id = String(feature.id);
      const el = pathRefsMap.current.get(id);
      if (!el) continue;
      const d = pathGen(feature);
      if (d) {
        el.setAttribute("d", d);
        el.style.opacity = "1";
      } else {
        el.style.opacity = "0";
      }
    }

    if (graticuleRef.current && graticuleDataRef.current) {
      const d = pathGen(graticuleDataRef.current);
      if (d) graticuleRef.current.setAttribute("d", d);
    }

    if (sphereRef.current && viewModeRef.current === "globe") {
      sphereRef.current.setAttribute("r", String(ORTHO_SCALE * z));
    }
  }, []);

  // --- Sync React paths state ---
  const syncPathsState = useCallback(() => {
    const d3 = d3Ref.current;
    if (!d3 || !featuresRef.current.length) return;

    const z = zoomRef.current;
    let proj;
    if (viewModeRef.current === "map") {
      proj = d3
        .geoEqualEarth()
        .scale(eeScaleRef.current * z)
        .translate([TRANSLATE[0] + mapPanRef.current[0], TRANSLATE[1] + mapPanRef.current[1]]);
    } else {
      proj = d3
        .geoOrthographic()
        .scale(ORTHO_SCALE * z)
        .translate(TRANSLATE)
        .rotate(rotationRef.current)
        .clipAngle(90 + 1e-6);
    }

    const pathGen = d3.geoPath(proj);
    const newPaths = new Map<string, string | null>();
    for (const feature of featuresRef.current) {
      newPaths.set(String(feature.id), pathGen(feature));
    }

    if (graticuleRef.current && graticuleDataRef.current) {
      graticuleRef.current.setAttribute("d", pathGen(graticuleDataRef.current) || "");
      graticuleRef.current.style.opacity = viewModeRef.current === "globe" ? "0.3" : "0";
    }
    if (sphereRef.current) {
      sphereRef.current.style.opacity = viewModeRef.current === "globe" ? "1" : "0";
      if (viewModeRef.current === "globe") {
        sphereRef.current.setAttribute("r", String(ORTHO_SCALE * z));
      }
    }
    for (const [id, el] of pathRefsMap.current) {
      if (el) el.style.opacity = newPaths.get(id) !== null ? "1" : "0";
    }

    setPaths(newPaths);
  }, []);

  // --- Load geo data on mount ---
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [d3, topojson] = await Promise.all([import("d3-geo"), import("topojson-client")]);
      if (cancelled) return;
      d3Ref.current = d3;

      const resp = await fetch(WORLD_GEO_URL);
      const topo = await resp.json();
      if (cancelled) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const geojson = (topojson as any).feature(topo, topo.objects.countries);
      featuresRef.current = geojson.features;

      const centroids = new Map<string, [number, number]>();
      for (const f of geojson.features) {
        centroids.set(String(f.id), d3.geoCentroid(f));
      }
      centroidsRef.current = centroids;

      const eeProj = d3.geoEqualEarth().fitSize([SVG_W, SVG_H], { type: "Sphere" });
      eeScaleRef.current = eeProj.scale();

      graticuleDataRef.current = d3.geoGraticule10();

      const initProj = d3
        .geoEqualEarth()
        .scale(eeScaleRef.current)
        .translate([SVG_W / 2, SVG_H / 2]);
      const pathGen = d3.geoPath(initProj);
      const initialPaths = new Map<string, string | null>();
      for (const f of geojson.features) {
        initialPaths.set(String(f.id), pathGen(f));
      }
      setPaths(initialPaths);
      setIsLoaded(true);
    }

    load();

    /* rAF handles live on refs and must be read at unmount; not DOM nodes. */
    /* eslint-disable react-hooks/exhaustive-deps -- intentional ref.current reads in teardown */
    return () => {
      cancelled = true;
      const animFrame = animFrameRef.current;
      const dragFrame = dragFrameRef.current;
      const autoRotate = autoRotateRef.current;
      if (animFrame) cancelAnimationFrame(animFrame);
      if (dragFrame) cancelAnimationFrame(dragFrame);
      if (autoRotate) cancelAnimationFrame(autoRotate);
    };
    /* eslint-enable react-hooks/exhaustive-deps */
  }, []);

  // --- Auto-rotation ---
  useEffect(() => {
    if (!isLoaded) return;

    const spin = () => {
      if (
        viewModeRef.current === "globe" &&
        !isDraggingRef.current &&
        !isAnimatingRef.current &&
        !hoveredRef.current
      ) {
        rotationRef.current = [rotationRef.current[0] + 0.12, rotationRef.current[1], 0];
        imperativeUpdate();
      }
      autoRotateRef.current = requestAnimationFrame(spin);
    };

    autoRotateRef.current = requestAnimationFrame(spin);
    return () => {
      if (autoRotateRef.current) cancelAnimationFrame(autoRotateRef.current);
    };
  }, [isLoaded, imperativeUpdate]);

  // --- Wheel zoom ---
  useEffect(() => {
    const el = cardRef.current;
    if (!el || !isLoaded) return;

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      if (isAnimatingRef.current) return;
      const factor = e.deltaY > 0 ? 0.94 : 1.06;
      zoomRef.current = Math.max(0.8, Math.min(3, zoomRef.current * factor));
      imperativeUpdate();
    };

    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [isLoaded, imperativeUpdate]);

  // --- Mouse handlers ---
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isAnimatingRef.current) {
      const svg = svgRef.current;
      if (svg && svg.contains(e.target as Node)) {
        isDraggingRef.current = true;
        setIsDragging(true);
        lastPosRef.current = { x: e.clientX, y: e.clientY };
      }
    }
  };

  const handleMouseUp = () => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      setIsDragging(false);
      lastPosRef.current = null;
      syncPathsState();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDraggingRef.current && lastPosRef.current) {
      const dx = e.clientX - lastPosRef.current.x;
      const dy = e.clientY - lastPosRef.current.y;

      if (viewModeRef.current === "globe") {
        rotationRef.current = [
          rotationRef.current[0] + dx * 0.4,
          Math.max(-90, Math.min(90, rotationRef.current[1] - dy * 0.4)),
          0,
        ];
      } else {
        mapPanRef.current = [mapPanRef.current[0] + dx, mapPanRef.current[1] + dy];
      }

      lastPosRef.current = { x: e.clientX, y: e.clientY };

      if (!dragFrameRef.current) {
        dragFrameRef.current = requestAnimationFrame(() => {
          imperativeUpdate();
          dragFrameRef.current = 0;
        });
      }
    }
  };

  // --- Touch handlers ---
  const lastTouchDistRef = useRef<number | null>(null);
  const touchMovedRef = useRef(false);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isAnimatingRef.current) return;
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDistRef.current = Math.sqrt(dx * dx + dy * dy);
      return;
    }
    const touch = e.touches[0];
    isDraggingRef.current = true;
    setIsDragging(true);
    lastPosRef.current = { x: touch.clientX, y: touch.clientY };
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
    touchMovedRef.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastTouchDistRef.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const factor = dist / lastTouchDistRef.current;
      zoomRef.current = Math.max(0.8, Math.min(3, zoomRef.current * factor));
      lastTouchDistRef.current = dist;
      imperativeUpdate();
      return;
    }

    if (!isDraggingRef.current || !lastPosRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - lastPosRef.current.x;
    const dy = touch.clientY - lastPosRef.current.y;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) touchMovedRef.current = true;

    if (viewModeRef.current === "globe") {
      rotationRef.current = [
        rotationRef.current[0] + dx * 0.4,
        Math.max(-90, Math.min(90, rotationRef.current[1] - dy * 0.4)),
        0,
      ];
    } else {
      mapPanRef.current = [mapPanRef.current[0] + dx, mapPanRef.current[1] + dy];
    }

    lastPosRef.current = { x: touch.clientX, y: touch.clientY };

    if (!dragFrameRef.current) {
      dragFrameRef.current = requestAnimationFrame(() => {
        imperativeUpdate();
        dragFrameRef.current = 0;
      });
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    lastTouchDistRef.current = null;
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      setIsDragging(false);
      lastPosRef.current = null;
      syncPathsState();

      if (!touchMovedRef.current && touchStartPosRef.current && e.changedTouches.length > 0) {
        const touch = e.changedTouches[0];
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        if (el) {
          const pathEl = el.closest("path");
          if (pathEl) {
            pathEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          }
        }
      }
    }
    touchStartPosRef.current = null;
  };

  // --- Country click handler ---
  const handleCountryClick = (id: string, e: React.MouseEvent) => {
    if (isAnimatingRef.current) return;

    const countryId = ISO_NUMERIC_TO_COUNTRY[id];
    if (!countryId) return;

    const data = countryData[countryId];
    if (!data) return;

    const rect = cardRef.current?.getBoundingClientRect();
    const position = rect
      ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
      : { x: e.clientX, y: e.clientY };

    setSelectedCountry({ countryId, data, position });
  };

  // --- Zoom controls ---
  const zoomIn = () => {
    const nextZoom = Math.min(zoomRef.current * 1.5, 8);
    const startZoom = zoomRef.current;
    const startTime = performance.now();
    const duration = 300;

    const animateZoom = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = easeInOutCubic(progress);
      zoomRef.current = startZoom + (nextZoom - startZoom) * ease;
      imperativeUpdate();
      if (progress < 1) {
        requestAnimationFrame(animateZoom);
      } else {
        syncPathsState();
      }
    };
    requestAnimationFrame(animateZoom);
  };

  const zoomOut = () => {
    const nextZoom = Math.max(zoomRef.current / 1.5, 1);
    const startZoom = zoomRef.current;
    const startTime = performance.now();
    const duration = 300;

    const animateZoom = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = easeInOutCubic(progress);
      zoomRef.current = startZoom + (nextZoom - startZoom) * ease;
      imperativeUpdate();
      if (progress < 1) {
        requestAnimationFrame(animateZoom);
      } else {
        syncPathsState();
      }
    };
    requestAnimationFrame(animateZoom);
  };

  return (
    <div
      ref={cardRef}
      className="relative overflow-visible rounded-xl border border-card-border bg-card shadow-lg"
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => {
        handleMouseUp();
        hoveredRef.current = null;
        setHovered(null);
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      style={{ cursor: isDragging ? "grabbing" : "grab", touchAction: "none" }}
    >
      {/* Controls: top-right */}
      <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-2 pointer-events-none">
        {/* Mode toggle */}
        <div className="pointer-events-auto">
          <CommodityMapModeToggle
            mode={mode}
            onModeChange={onModeChange}
            showCapacity={!!capacityByState}
          />
        </div>

        {/* Zoom */}
        <div className="flex flex-col gap-1 bg-card/90 backdrop-blur-md p-1 rounded-lg border border-card-border shadow-sm pointer-events-auto">
          <button
            onClick={zoomIn}
            className="w-8 h-8 flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-card-elevated transition-colors"
            title="Zoom In"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <div className="h-px w-full bg-card-border" />
          <button
            onClick={zoomOut}
            className="w-8 h-8 flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-card-elevated transition-colors"
            title="Zoom Out"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Legend: bottom-left */}
      <div className="absolute bottom-3 left-3 z-10">
        <CommodityMapLegend
          mode={mode}
          label={commodityLabel}
          unit={unit}
          priceLabel="National Price"
        />
      </div>

      {/* Grid Background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_800px_at_50%_50%,var(--primary-dark)_0%,transparent_100%)] opacity-5 pointer-events-none" />

      {!isLoaded && (
        <div
          className="w-full flex items-center justify-center text-muted text-sm"
          style={{ aspectRatio: `${SVG_W}/${SVG_H}` }}
        >
          Loading map...
        </div>
      )}

      {isLoaded && (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          className="w-full block"
          style={{ pointerEvents: isAnimating ? "none" : "auto", display: "block" }}
        >
          <defs>
            <radialGradient id="commodity-globe-atmosphere" cx="40%" cy="35%" r="65%">
              <stop offset="0%" stopColor="#4a9fd4" stopOpacity="1" />
              <stop offset="60%" stopColor="#1a6fa8" stopOpacity="1" />
              <stop offset="100%" stopColor="#0d4a78" stopOpacity="1" />
            </radialGradient>
          </defs>

          <circle
            ref={sphereRef}
            cx={TRANSLATE[0]}
            cy={TRANSLATE[1]}
            r={ORTHO_SCALE}
            fill="url(#commodity-globe-atmosphere)"
            stroke="#0a3d62"
            strokeWidth={1}
            style={{ opacity: 0, pointerEvents: "none" }}
          />

          <path
            ref={graticuleRef}
            fill="none"
            stroke="#5bb8f5"
            strokeWidth={0.3}
            style={{ opacity: 0, pointerEvents: "none" }}
          />

          {featuresRef.current.map((feature) => {
            const id = String(feature.id);
            const isHov = hovered === id && !isAnimating;
            const commodityFill = getCountryFill(id);
            const hasData = !!commodityFill;

            let fillColor = commodityFill ?? "var(--card-elevated)";
            let strokeColor = "var(--card-border)";
            let strokeWidth = 0.5;

            if (isHov && hasData) {
              fillColor = "var(--primary)";
              strokeColor = "var(--foreground)";
              strokeWidth = 1.5;
            } else if (isHov) {
              fillColor = "var(--card-border)";
            }

            return (
              <path
                key={id}
                ref={(el) => {
                  if (el) pathRefsMap.current.set(id, el);
                }}
                d={paths.get(id) ?? ""}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                style={{
                  outline: "none",
                  cursor: hasData && !isAnimating ? "pointer" : "default",
                  transition: isAnimating ? "none" : "fill 0.15s ease",
                }}
                tabIndex={-1}
                focusable="false"
                onMouseEnter={() => {
                  if (!isAnimatingRef.current) {
                    hoveredRef.current = id;
                    setHovered(id);
                    if (viewModeRef.current === "globe") syncPathsState();
                  }
                }}
                onMouseLeave={() => {
                  hoveredRef.current = null;
                  setHovered(null);
                }}
                onClick={(e) => handleCountryClick(id, e)}
              />
            );
          })}
        </svg>
      )}

      {/* Country stat card */}
      {selectedCountry && (
        <CommodityCountryStatCard
          countryId={selectedCountry.countryId}
          commodityLabel={commodityLabel}
          unit={unit}
          data={selectedCountry.data}
          mode={mode}
          onModeChange={onModeChange}
          forexEnabled={forexEnabled}
          exchangeRates={exchangeRates}
          position={selectedCountry.position}
          onClose={() => setSelectedCountry(null)}
          onViewCountryPage={() => {
            onViewCountryPage(selectedCountry.countryId);
            setSelectedCountry(null);
          }}
          onViewCountryMap={() => {
            onDrillDown(selectedCountry.countryId);
            setSelectedCountry(null);
          }}
        />
      )}
    </div>
  );
}
