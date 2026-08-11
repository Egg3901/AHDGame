"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { CommodityData } from "../types";
import {
  buildShortageRows,
  type ShortageRow,
  type ShortageScope,
  type ShortageTone,
} from "../lib/shortageRows";
import { getCountryDisplayName } from "@/lib/constants/countries";
import { logger } from "@/lib/observability/logger";
import type { CountryId } from "@/lib/constants/countries";
import { getStateDisplayName } from "@/lib/commodity-map/commodityRegionMappings";

/**
 * Diverging ranked heat of what a scope is short on. Warm (hot) = shortage,
 * gray = balanced, cool = oversupplied. Bars grow right of a center line for
 * shortage and left for oversupply, length by intensity. Every row is direct
 * labelled (dataviz rule); the detailed table below is the accessibility view.
 *
 * The scope lens (Global / Country / State) re-ranks the same commodities from
 * the chosen level's supply and demand, so "short where?" is one click away.
 * Country and State levels need the scope=full payload, fetched once on mount;
 * until it arrives (or if it fails) the map falls back to the global data the
 * tab already passed in.
 *
 * Palette is validated (dataviz validate_palette). The app ships 10+ named
 * data-theme surfaces, not a light/dark binary, so a per-theme override would
 * mis-fire on the themes it doesn't name. Instead we use ONE validated mid-tone
 * diverging set for every theme; the surface/ink tokens (bg-card,
 * text-foreground) already adapt, and the fill-contrast relief the method
 * requires is met by the direct labels on every row plus the detail table.
 */

const PALETTE_CSS = `
.cshm {
  --cshm-short-strong: #D64545;
  --cshm-short-mild: #E8A33D;
  --cshm-balanced: #8A8F98;
  --cshm-oversupplied: #3E7CB1;
}
`;

const TONE_VAR: Record<ShortageTone, string> = {
  "short-strong": "var(--cshm-short-strong)",
  "short-mild": "var(--cshm-short-mild)",
  balanced: "var(--cshm-balanced)",
  oversupplied: "var(--cshm-oversupplied)",
};

type ScopeLevel = "global" | "country" | "state";

interface ScopeMeta {
  countryIds: string[];
  statesByCountry: Record<string, string[]>;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function HeatRow({ row }: { row: ShortageRow }) {
  const isSurplus = row.tone === "oversupplied";
  const pct = Math.max(4, Math.round(row.intensity * 100)); // min sliver so a tiny signal still shows
  const color = TONE_VAR[row.tone];
  const ratioText = row.noSupply
    ? "no local supply"
    : row.dsRatio == null
      ? "no data"
      : `D/S ${row.dsRatio.toFixed(2)}`;
  const premiumText =
    row.premiumPct >= 0
      ? `+${row.premiumPct.toFixed(0)}% vs base`
      : `${row.premiumPct.toFixed(0)}% vs base`;
  const title = row.noSupply
    ? `${row.label}
Demand ${fmt(row.demand)} ${row.unit}
Supply 0 ${row.unit} (no local supply)
Price ${premiumText}`
    : row.dsRatio == null
      ? `${row.label}: no supply/demand signal at this scope`
      : `${row.label}
Demand ${fmt(row.demand)} ${row.unit}
Supply ${fmt(row.supply)} ${row.unit}
D/S ratio ${row.dsRatio.toFixed(2)}
Price ${premiumText}`;

  return (
    <div className="flex items-center gap-2 py-1" title={title}>
      <div className="w-28 shrink-0 truncate text-xs font-medium text-foreground sm:w-36">
        {row.label}
      </div>
      {/* diverging track: center line, bar grows right (short) or left (surplus) */}
      <div className="relative h-4 flex-1">
        <div className="absolute inset-y-0 left-1/2 w-px bg-card-border" />
        <div
          className="absolute inset-y-0 rounded-[3px]"
          style={{
            width: `${pct / 2}%`,
            background: color,
            ...(isSurplus ? { right: "50%" } : { left: "50%" }),
          }}
        />
      </div>
      <div className="w-32 shrink-0 text-right text-[11px] tabular-nums text-muted sm:w-40">
        <span className="text-foreground">{ratioText}</span>
        <span className="ml-1">{premiumText}</span>
      </div>
    </div>
  );
}

function Swatch({ tone, label }: { tone: ShortageTone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5 rounded-[2px]"
        style={{ background: TONE_VAR[tone] }}
      />
      <span className="text-[11px] text-muted">{label}</span>
    </span>
  );
}

const LEVELS: { key: ScopeLevel; label: string }[] = [
  { key: "global", label: "Global" },
  { key: "country", label: "Country" },
  { key: "state", label: "State" },
];

const selectClass =
  "rounded-md border border-card-border bg-card px-2 py-1 text-xs text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

export function ShortageHeatMap({ commodities }: { commodities: CommodityData[] }) {
  const params = useParams();
  const pageCode = String(params?.code ?? "").toUpperCase();

  const [enriched, setEnriched] = useState<CommodityData[] | null>(null);
  const [scopeMeta, setScopeMeta] = useState<ScopeMeta | null>(null);
  const [level, setLevel] = useState<ScopeLevel>("global");
  const [countryId, setCountryId] = useState<string>("");
  const [stateId, setStateId] = useState<string>("");

  // Fetch the scope=full payload once so Country/State switch instantly.
  useEffect(() => {
    let alive = true;
    fetch("/api/commodities?scope=full")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!alive || !json) return;
        if (Array.isArray(json.commodities)) setEnriched(json.commodities as CommodityData[]);
        if (json.scopeMeta) setScopeMeta(json.scopeMeta as ScopeMeta);
      })
      .catch((err) => {
        // Non-critical background prefetch: fall back to the props data already
        // rendered, but surface persistent failures to Logs rather than hiding them.
        logger.warn("ShortageHeatMap", "commodities scope=full prefetch failed", { err });
      });
    return () => {
      alive = false;
    };
  }, []);

  const data = enriched ?? commodities;
  const scopeReady = !!scopeMeta;

  // Derived selection (no setState-in-effect): the effective country defaults
  // to the page's own country until the user picks one; the effective state
  // falls back to the country's first state when the current pick doesn't
  // belong to it. Deriving avoids stale-picker effects entirely.
  const effectiveCountryId = useMemo(() => {
    if (countryId) return countryId;
    if (!scopeMeta) return "";
    return (
      scopeMeta.countryIds.find((c) => c.toUpperCase() === pageCode) ??
      scopeMeta.countryIds[0] ??
      ""
    );
  }, [countryId, scopeMeta, pageCode]);

  const stateOptions = scopeMeta?.statesByCountry[effectiveCountryId] ?? [];
  const effectiveStateId =
    stateId && stateOptions.includes(stateId) ? stateId : (stateOptions[0] ?? "");

  const scope: ShortageScope = useMemo(() => {
    if (level === "country" && effectiveCountryId)
      return { level: "country", countryId: effectiveCountryId };
    if (level === "state" && effectiveStateId) return { level: "state", stateId: effectiveStateId };
    return { level: "global" };
  }, [level, effectiveCountryId, effectiveStateId]);

  const rows = useMemo(() => buildShortageRows(data, scope), [data, scope]);

  const heading =
    scope.level === "country"
      ? `What ${getCountryDisplayName(effectiveCountryId as CountryId)} is short on`
      : scope.level === "state"
        ? `What ${getStateDisplayName(effectiveCountryId as CountryId, effectiveStateId)} is short on`
        : "What the world is short on";

  return (
    <div className="cshm rounded-xl border border-card-border bg-card p-4 shadow-sm sm:p-5">
      <style>{PALETTE_CSS}</style>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-foreground">{heading}</h3>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <Swatch tone="short-strong" label="In shortage (buy premium)" />
          <Swatch tone="balanced" label="Balanced" />
          <Swatch tone="oversupplied" label="Oversupplied" />
        </div>
      </div>

      {/* Scope lens: whole world, one country, or one state. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Shortage scope"
          className="inline-flex rounded-lg border border-card-border bg-card-elevated p-0.5"
        >
          {LEVELS.map((l) => {
            const active = level === l.key;
            const disabled = l.key !== "global" && !scopeReady;
            return (
              <button
                key={l.key}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={disabled}
                onClick={() => setLevel(l.key)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                  active
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                }`}
                title={disabled ? "Loading scope data" : undefined}
              >
                {l.label}
              </button>
            );
          })}
        </div>

        {(level === "country" || level === "state") && scopeMeta && (
          <select
            aria-label="Country"
            className={selectClass}
            value={effectiveCountryId}
            onChange={(e) => setCountryId(e.target.value)}
          >
            {scopeMeta.countryIds.map((c) => (
              <option key={c} value={c}>
                {getCountryDisplayName(c as CountryId)}
              </option>
            ))}
          </select>
        )}

        {level === "state" && scopeMeta && (
          <select
            aria-label="State"
            className={selectClass}
            value={effectiveStateId}
            onChange={(e) => setStateId(e.target.value)}
            disabled={stateOptions.length === 0}
          >
            {stateOptions.length === 0 && <option value="">No states</option>}
            {stateOptions.map((s) => (
              <option key={s} value={s}>
                {getStateDisplayName(countryId as CountryId, s)}
              </option>
            ))}
          </select>
        )}
      </div>

      <p className="mb-3 text-[11px] text-muted">
        Longer and hotter means scarcer, which sells at a premium. Supply these.
      </p>

      {rows.length === 0 ? (
        <p className="py-4 text-xs text-muted">No supply or demand data at this scope yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[320px]">
            {rows.map((row) => (
              <HeatRow key={row.commodity} row={row} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default ShortageHeatMap;
