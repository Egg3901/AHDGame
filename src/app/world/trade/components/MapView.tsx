"use client";

import { useState, useEffect, useRef } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { WorldTradeLedger } from "@/lib/trade/queries/worldTradeLedger";
import { ISO_NUMERIC_TO_COUNTRY } from "@/lib/commodity-map/commodityRegionMappings";
import { WORLD_GEO_URL, SVG_W, SVG_H } from "@/app/world/worldConstants";
import { directionMark } from "../lib/ledgerFormat";

/**
 * World Trade Map — a real geographic map (Equal Earth projection). Non-playable
 * countries are darkened; playable countries are filled by surplus (green) /
 * deficit (red). The fill responds to the selector: with "All flows" each
 * country shows its overall net balance; when a country is focused, the others
 * recolor to their bilateral balance vs. that country. Top net flows are drawn
 * as arcs between real country centroids. Flow gradient colors are the isolated
 * raw-color exception (a chart); country fills use semantic success/error
 * tokens via CSS color-mix so they track the theme.
 */
const GRN = "#22c55e";
const RED = "#ef4444";
const TOP_FLOWS = 14;

/** Playable countries that cluster too tightly in Western Europe to read on the
 *  world map — shown enlarged in an Alaska/Hawaii-style inset when focused. */
const EUROPE_INSET = new Set(["UK", "DE", "IE"]);
const INSET_W = 210;
const INSET_H = 185;
const INSET_PAD = 18;

export default function MapView({ ledger }: { ledger: WorldTradeLedger }) {
  const { formatAmountChip } = useCurrency();
  const [focus, setFocus] = useState<string | null>(null);
  const [paths, setPaths] = useState<Array<{ id: string; d: string }>>([]);
  const [centroids, setCentroids] = useState<Map<string, [number, number]>>(new Map());
  const [insetPaths, setInsetPaths] = useState<Array<{ id: string; d: string }>>([]);
  const [insetCentroids, setInsetCentroids] = useState<Map<string, [number, number]>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const cancelledRef = useRef(false);

  const playable = new Set(ledger.meta.countries.map((c) => c.code));
  const netByCode = new Map<string, number>(ledger.nations.map((n) => [n.code, n.net]));

  // Load + project the world geometry once.
  useEffect(() => {
    cancelledRef.current = false;
    async function load() {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [d3, topojson]: [any, any] = await Promise.all([
          import("d3-geo"),
          import("topojson-client"),
        ]);
        if (cancelledRef.current) return;
        const resp = await fetch(WORLD_GEO_URL);
        const topo = await resp.json();
        if (cancelledRef.current) return;
        const geojson = topojson.feature(topo, topo.objects.countries);
        const proj = d3.geoEqualEarth().fitSize([SVG_W, SVG_H], { type: "Sphere" });
        const pathGen = d3.geoPath(proj);
        const nextPaths: Array<{ id: string; d: string }> = [];
        const nextCentroids = new Map<string, [number, number]>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const f of geojson.features as any[]) {
          const id = String(f.id);
          const d = pathGen(f);
          if (d) nextPaths.push({ id, d });
          const countryId = ISO_NUMERIC_TO_COUNTRY[id];
          if (countryId) {
            const c = pathGen.centroid(f);
            if (c && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
              nextCentroids.set(countryId, [c[0], c[1]]);
            }
          }
        }
        // Europe inset: a projection zoomed to the clustered European playable
        // countries. All features are reprojected through it (neighbours show as
        // dim context) and clipped to the inset box at render time.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const europeFeatures = (geojson.features as any[]).filter((f) =>
          EUROPE_INSET.has(ISO_NUMERIC_TO_COUNTRY[String(f.id)] ?? "")
        );
        const nextInsetPaths: Array<{ id: string; d: string }> = [];
        const nextInsetCentroids = new Map<string, [number, number]>();
        if (europeFeatures.length > 0) {
          const insetProj = d3.geoEqualEarth().fitExtent(
            [
              [INSET_PAD, INSET_PAD],
              [INSET_W - INSET_PAD, INSET_H - INSET_PAD],
            ],
            { type: "FeatureCollection", features: europeFeatures }
          );
          const insetGen = d3.geoPath(insetProj);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const f of geojson.features as any[]) {
            const id = String(f.id);
            const d = insetGen(f);
            if (d) nextInsetPaths.push({ id, d });
            const countryId = ISO_NUMERIC_TO_COUNTRY[id];
            if (countryId && EUROPE_INSET.has(countryId)) {
              const c = insetGen.centroid(f);
              if (c && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
                nextInsetCentroids.set(countryId, [c[0], c[1]]);
              }
            }
          }
        }

        if (cancelledRef.current) return;
        setPaths(nextPaths);
        setCentroids(nextCentroids);
        setInsetPaths(nextInsetPaths);
        setInsetCentroids(nextInsetCentroids);
        setLoaded(true);
      } catch {
        // Geo data unavailable (offline/test) — chips + labels still render
        // from ledger data; the map shapes simply stay empty.
      }
    }
    load();
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  // Per-country value driving the fill, given the active selector.
  const valueFor = (code: string): number => {
    if (focus && focus !== code) return ledger.bilateral[code]?.[focus] ?? 0;
    return netByCode.get(code) ?? 0;
  };
  const maxFill = Math.max(
    1,
    ...ledger.meta.countries.filter((c) => c.code !== focus).map((c) => Math.abs(valueFor(c.code)))
  );

  const fillFor = (code: string): string => {
    if (focus === code) return "color-mix(in srgb, var(--primary) 30%, var(--card-elevated))";
    const v = valueFor(code);
    const inten = Math.min(1, Math.abs(v) / maxFill);
    const tone = v >= 0 ? "var(--success)" : "var(--error)";
    return `color-mix(in srgb, ${tone} ${(15 + inten * 55).toFixed(0)}%, var(--card-elevated))`;
  };

  // Net-flow pairs (exporter = surplus side) for the arcs.
  const codes = ledger.meta.countries.map((c) => c.code);
  const pairs: Array<{ a: string; b: string; exC: string; imC: string; mag: number }> = [];
  for (let i = 0; i < codes.length; i++) {
    for (let j = i + 1; j < codes.length; j++) {
      const a = codes[i];
      const b = codes[j];
      const nv = ledger.bilateral[a]?.[b] ?? 0;
      pairs.push({ a, b, exC: nv >= 0 ? a : b, imC: nv >= 0 ? b : a, mag: Math.abs(nv) });
    }
  }
  const maxMag = Math.max(1, ...pairs.map((p) => p.mag));
  const shown = (focus ? pairs.filter((p) => p.a === focus || p.b === focus) : [...pairs])
    .filter((p) => centroids.has(p.exC) && centroids.has(p.imC) && p.mag > 0)
    .sort((x, y) => y.mag - x.mag)
    .slice(0, focus ? 99 : TOP_FLOWS);

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-foreground">
          World Trade Map{" "}
          <span className="font-normal text-muted">
            · {focus ? `balance vs. ${focus}` : "net balance by nation"}
          </span>
        </h3>
        <span className="inline-flex items-center gap-3 text-[10px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-success" />
            surplus
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-error" />
            deficit
          </span>
        </span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setFocus(null)}
          aria-pressed={focus === null}
          className={`rounded-full border px-3 py-1 text-[11.5px] font-semibold transition-colors ${
            focus === null
              ? "border-primary/60 bg-primary/15 text-foreground"
              : "border-card-border bg-card-elevated text-muted hover:text-foreground"
          }`}
        >
          All flows
        </button>
        {ledger.meta.countries.map((c) => {
          const active = focus === c.code;
          return (
            <button
              key={c.code}
              onClick={() => setFocus((f) => (f === c.code ? null : c.code))}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
                active
                  ? "border-primary/60 bg-primary/15 text-foreground"
                  : "border-card-border bg-card-elevated text-muted hover:text-foreground"
              }`}
            >
              <span
                className="flex h-4 w-4 items-center justify-center rounded-full font-mono text-[8px]"
                style={{ border: `1.5px solid ${c.hue}`, color: c.hue }}
              >
                {c.code}
              </span>
              {c.code}
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-xl border border-card-border bg-card-elevated">
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          className="block h-auto w-full"
          role="img"
          aria-label="World trade balance map"
        >
          <defs>
            {shown.map((p, idx) => {
              const [x1, y1] = centroids.get(p.exC)!;
              const [x2, y2] = centroids.get(p.imC)!;
              return (
                <linearGradient
                  key={idx}
                  id={`tradeflow-geo-${idx}`}
                  gradientUnits="userSpaceOnUse"
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                >
                  <stop offset="0" stopColor={GRN} />
                  <stop offset="0.52" stopColor="#caa23e" />
                  <stop offset="1" stopColor={RED} />
                </linearGradient>
              );
            })}
          </defs>

          {!loaded && (
            <text x={SVG_W / 2} y={SVG_H / 2} textAnchor="middle" fill="var(--muted)" fontSize="13">
              Loading map…
            </text>
          )}

          {/* Country shapes — non-playable darkened, playable filled by selector. */}
          {paths.map(({ id, d }, idx) => {
            const countryId = ISO_NUMERIC_TO_COUNTRY[id];
            const isPlayable = !!countryId && playable.has(countryId);
            return (
              <path
                key={idx}
                d={d}
                fill={
                  isPlayable
                    ? fillFor(countryId!)
                    : "color-mix(in srgb, var(--foreground) 7%, transparent)"
                }
                stroke="var(--card-border)"
                strokeWidth={isPlayable ? 0.8 : 0.4}
                style={{ cursor: isPlayable ? "pointer" : "default" }}
                onClick={
                  isPlayable
                    ? () => setFocus((f) => (f === countryId ? null : countryId!))
                    : undefined
                }
              >
                {isPlayable && (
                  <title>{ledger.meta.countries.find((c) => c.code === countryId)?.name}</title>
                )}
              </path>
            );
          })}

          {/* Flow arcs between real country centroids. */}
          {shown.map((p, idx) => {
            const [x1, y1] = centroids.get(p.exC)!;
            const [x2, y2] = centroids.get(p.imC)!;
            const dx = x2 - x1;
            const dy = y2 - y1;
            const len = Math.hypot(dx, dy) || 1;
            const bow = 0.18 * len;
            const mx = (x1 + x2) / 2 + (-dy / len) * bow;
            const my = (y1 + y2) / 2 + (dx / len) * bow;
            const w = 1.2 + (p.mag / maxMag) * 4.5;
            const stroke = focus ? (p.exC === focus ? GRN : RED) : `url(#tradeflow-geo-${idx})`;
            const op = focus ? 0.95 : 0.3 + 0.5 * (p.mag / maxMag);
            return (
              <path
                key={idx}
                d={`M${x1.toFixed(1)},${y1.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`}
                fill="none"
                stroke={stroke}
                strokeWidth={w.toFixed(1)}
                strokeLinecap="round"
                opacity={op}
              >
                <title>{`${p.exC} → ${p.imC} · net ${Math.round(p.mag)}`}</title>
              </path>
            );
          })}

          {/* Country code + net labels at centroids. */}
          {ledger.meta.countries.map((c) => {
            const cen = centroids.get(c.code);
            if (!cen) return null;
            const net = netByCode.get(c.code) ?? 0;
            const ncol = net >= 0 ? "var(--success)" : "var(--error)";
            return (
              <g
                key={c.code}
                style={{ cursor: "pointer" }}
                onClick={() => setFocus((f) => (f === c.code ? null : c.code))}
              >
                <text
                  x={cen[0]}
                  y={cen[1]}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontFamily="monospace"
                  fontSize="10"
                  fontWeight="700"
                  fill="var(--foreground)"
                  style={{ paintOrder: "stroke", stroke: "var(--card-elevated)", strokeWidth: 2.5 }}
                >
                  {c.code}
                </text>
                <text
                  x={cen[0]}
                  y={cen[1] + 11}
                  textAnchor="middle"
                  fontFamily="monospace"
                  fontSize="8.5"
                  fontWeight="700"
                  fill={ncol}
                  style={{ paintOrder: "stroke", stroke: "var(--card-elevated)", strokeWidth: 2.5 }}
                >
                  {directionMark(net)} {formatAmountChip(Math.abs(net))}
                </text>
              </g>
            );
          })}

          {/* Europe inset ("closer view") — appears when a clustered European
              nation is focused, like Alaska/Hawaii insets on US maps. */}
          {focus && EUROPE_INSET.has(focus) && insetPaths.length > 0 && (
            <g>
              <rect
                x={8}
                y={SVG_H - INSET_H - 8}
                width={INSET_W}
                height={INSET_H}
                rx={8}
                fill="var(--card)"
                stroke="var(--primary)"
                strokeOpacity={0.5}
                strokeWidth={1.5}
              />
              <svg
                x={8}
                y={SVG_H - INSET_H - 8}
                width={INSET_W}
                height={INSET_H}
                viewBox={`0 0 ${INSET_W} ${INSET_H}`}
              >
                {insetPaths.map(({ id, d }, idx) => {
                  const cid = ISO_NUMERIC_TO_COUNTRY[id];
                  const isPlayable = !!cid && EUROPE_INSET.has(cid);
                  return (
                    <path
                      key={idx}
                      d={d}
                      fill={
                        isPlayable
                          ? fillFor(cid!)
                          : "color-mix(in srgb, var(--foreground) 7%, transparent)"
                      }
                      stroke="var(--card-border)"
                      strokeWidth={isPlayable ? 0.8 : 0.4}
                      style={{ cursor: isPlayable ? "pointer" : "default" }}
                      onClick={
                        isPlayable ? () => setFocus((f) => (f === cid ? null : cid!)) : undefined
                      }
                    />
                  );
                })}
                {/* Intra-European flow arcs for the focused nation, between the
                    inset's own centroids (solid focus coloring, like the main map). */}
                {shown
                  .filter((p) => insetCentroids.has(p.exC) && insetCentroids.has(p.imC))
                  .map((p, idx) => {
                    const [x1, y1] = insetCentroids.get(p.exC)!;
                    const [x2, y2] = insetCentroids.get(p.imC)!;
                    const dx = x2 - x1;
                    const dy = y2 - y1;
                    const len = Math.hypot(dx, dy) || 1;
                    const bow = 0.18 * len;
                    const mx = (x1 + x2) / 2 + (-dy / len) * bow;
                    const my = (y1 + y2) / 2 + (dx / len) * bow;
                    const w = 1.2 + (p.mag / maxMag) * 3.5;
                    return (
                      <path
                        key={`inset-arc-${idx}`}
                        d={`M${x1.toFixed(1)},${y1.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`}
                        fill="none"
                        stroke={p.exC === focus ? GRN : RED}
                        strokeWidth={w.toFixed(1)}
                        strokeLinecap="round"
                        opacity={0.95}
                      >
                        <title>{`${p.exC} → ${p.imC} · net ${Math.round(p.mag)}`}</title>
                      </path>
                    );
                  })}
                {[...insetCentroids].map(([code, cen]) => {
                  const net = netByCode.get(code) ?? 0;
                  const ncol = net >= 0 ? "var(--success)" : "var(--error)";
                  return (
                    <g key={code}>
                      <text
                        x={cen[0]}
                        y={cen[1]}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontFamily="monospace"
                        fontSize="11"
                        fontWeight="700"
                        fill="var(--foreground)"
                        style={{ paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 3 }}
                      >
                        {code}
                      </text>
                      <text
                        x={cen[0]}
                        y={cen[1] + 12}
                        textAnchor="middle"
                        fontFamily="monospace"
                        fontSize="9"
                        fontWeight="700"
                        fill={ncol}
                        style={{ paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 3 }}
                      >
                        {directionMark(net)} {formatAmountChip(Math.abs(net))}
                      </text>
                    </g>
                  );
                })}
              </svg>
              <text
                x={16}
                y={SVG_H - INSET_H + 6}
                fontFamily="monospace"
                fontSize="9"
                fontWeight="700"
                fill="var(--muted)"
                style={{ letterSpacing: "0.12em" }}
              >
                EUROPE · CLOSER VIEW
              </text>
            </g>
          )}
        </svg>
      </div>

      <p className="mt-2.5 text-[11.5px] text-muted">
        {focus
          ? `${ledger.meta.countries.find((c) => c.code === focus)?.name ?? focus} selected · other nations shaded by their balance with it (green = surplus, red = deficit); arcs show its flows.`
          : "Playable nations shaded by net balance (green = surplus, red = deficit); other countries dimmed. Arc runs exporter → importer. Click a nation to focus."}
      </p>
    </div>
  );
}
