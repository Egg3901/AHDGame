"use client";

import { useState, type ReactNode } from "react";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { REGION_CENSUS_LABELS } from "@/lib/constants/regionCensusLabels";
import { LocalTime } from "@/components/time/LocalTime";
import { LivePopulationPanel } from "@/components/demographics/LivePopulationPanel";
import { ElectorateDossier } from "./demographics/ElectorateDossier";
import type { BucketProfileSection } from "@/lib/demographics/bucketProfile";
import type { DemographicCategory } from "@/lib/db/types";
import type { RegionPartyPosition } from "@/lib/demographics/preferredParty";
import type {
  SerializedStateDemographics,
  Layer1Config,
  ArchetypeRegionCensus,
} from "./StatePageTabsTypes";

interface TurnoutData {
  baseline: number;
  modifier: number;
  actual: number;
}

interface TurnoutResponse {
  stateId: string;
  turnout: {
    race?: Record<string, TurnoutData>;
    age?: Record<string, TurnoutData>;
    education?: Record<string, TurnoutData>;
    wealth?: Record<string, TurnoutData>;
    ideology?: Record<string, TurnoutData>;
    /** Non-US models use their own dimensions (ethnicity/income/urbanization). */
    [key: string]: Record<string, TurnoutData> | undefined;
  };
  lastUpdated: string | null;
  lastDecayApplied: string | null;
}

// ─── SVG donut chart ─────────────────────────────────────────────────────────

function xy(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
}

function donutSlice(
  cx: number,
  cy: number,
  ro: number,
  ri: number,
  startDeg: number,
  endDeg: number
) {
  const sweep = Math.min(endDeg - startDeg, 359.9999);
  const [ox1, oy1] = xy(cx, cy, ro, startDeg);
  const [ox2, oy2] = xy(cx, cy, ro, startDeg + sweep);
  const [ix1, iy1] = xy(cx, cy, ri, startDeg + sweep);
  const [ix2, iy2] = xy(cx, cy, ri, startDeg);
  const large = sweep > 180 ? 1 : 0;
  return [
    `M ${ox1} ${oy1}`,
    `A ${ro} ${ro} 0 ${large} 1 ${ox2} ${oy2}`,
    `L ${ix1} ${iy1}`,
    `A ${ri} ${ri} 0 ${large} 0 ${ix2} ${iy2}`,
    "Z",
  ].join(" ");
}

interface Slice {
  label: string;
  pct: number;
  color: string;
}

function DonutChart({ slices, size = 96 }: { slices: Slice[]; size?: number }) {
  const cx = size / 2,
    cy = size / 2;
  const ro = size / 2 - 4;
  const ri = ro * 0.56;
  const total = slices.reduce((s, sl) => s + sl.pct, 0) || 100;
  const [hovered, setHovered] = useState<number | null>(null);

  let angle = 0;
  const arcs = slices.map((sl) => {
    const sweep = (sl.pct / total) * 360;
    const start = angle;
    // eslint-disable-next-line react-hooks/immutability
    angle += sweep;
    return { ...sl, start, sweep };
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ width: size, height: size, flexShrink: 0 }}
    >
      {arcs.map((a, i) => {
        if (a.sweep < 0.3) return null;
        const isHov = hovered === i;
        return (
          <path
            key={i}
            d={donutSlice(
              cx,
              cy,
              isHov ? ro + 3 : ro,
              isHov ? ri - 2 : ri,
              a.start,
              a.start + a.sweep
            )}
            fill={a.color}
            opacity={hovered !== null && !isHov ? 0.5 : 1}
            style={{ transition: "opacity 0.15s, d 0.15s", cursor: "pointer" }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <title>{`${a.label}: ${a.pct}%`}</title>
          </path>
        );
      })}
      {hovered !== null && (
        <>
          <text
            x={cx}
            y={cy + 4}
            textAnchor="middle"
            fontSize="12"
            fontWeight="600"
            fill="currentColor"
          >
            {arcs[hovered].pct}%
          </text>
        </>
      )}
    </svg>
  );
}

// ─── color palettes (hex for SVG) ────────────────────────────────────────────

const RACE_COLORS = ["#60a5fa", "#34d399", "#f472b6", "#a78bfa", "#fb923c"];
const EDU_COLORS = ["#6ee7b7", "#34d399", "#059669"];
const WEALTH_COLORS = ["#fbbf24", "#f59e0b", "#d97706"];
const AGE_COLORS = ["#a78bfa", "#818cf8", "#6366f1", "#4f46e5"];
const IDEO_COLORS = ["#f87171", "#ef4444", "#fb923c", "#60a5fa", "#34d399", "#94a3b8"];
const ETH_COLORS = ["#60a5fa", "#34d399", "#f472b6", "#a78bfa", "#fb923c"];
const INC_COLORS = ["#f87171", "#fb923c", "#22c55e"];
const URB_COLORS = ["#38bdf8", "#7dd3fc", "#4ade80"];

// ─── KPI strip ───────────────────────────────────────────────────────────────

function fmtPopulation(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

function computeAvgTurnout(turnoutData: TurnoutResponse | null): number | null {
  if (!turnoutData) return null;
  const allActuals: number[] = [];
  for (const cat of Object.values(turnoutData.turnout)) {
    if (!cat) continue;
    for (const group of Object.values(cat)) {
      if (group && typeof group.actual === "number") {
        allActuals.push(group.actual);
      }
    }
  }
  if (allActuals.length === 0) return null;
  return allActuals.reduce((s, v) => s + v, 0) / allActuals.length;
}

function KpiCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-3 shadow-card">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">{label}</div>
      <div className="mt-1 text-base font-bold text-foreground">{children}</div>
    </div>
  );
}

function KpiStrip({
  population,
  economicLean,
  socialLean,
  avgTurnout,
  categoryCount,
}: {
  population: number | null;
  economicLean: number | null;
  socialLean: number | null;
  avgTurnout: number | null;
  categoryCount: number;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <KpiCell label="Population">{population !== null ? fmtPopulation(population) : "—"}</KpiCell>
      <KpiCell label="Political Lean">
        {economicLean !== null || socialLean !== null ? (
          <div className="flex flex-wrap items-center gap-1">
            {economicLean !== null && (
              <span
                className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-semibold ${leanTextClass(economicLean)}`}
              >
                Econ {fmtLean(economicLean)}
              </span>
            )}
            {socialLean !== null && (
              <span
                className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-semibold ${leanTextClass(socialLean)}`}
              >
                Soc {fmtLean(socialLean)}
              </span>
            )}
          </div>
        ) : (
          "—"
        )}
      </KpiCell>
      <KpiCell label="Turnout">{avgTurnout !== null ? `${avgTurnout.toFixed(1)}%` : "—"}</KpiCell>
      <KpiCell label="Demographic Categories">{categoryCount}</KpiCell>
    </div>
  );
}

function computeKpiProps({
  demographics,
  categories,
  turnoutData,
}: {
  demographics: SerializedStateDemographics | null;
  categories: DemographicCategory[];
  turnoutData: TurnoutResponse | null;
}) {
  const population = demographics
    ? Object.values(demographics.groups).reduce((s, g) => s + (g.population ?? 0), 0)
    : null;
  const economicLean =
    demographics && typeof demographics.cachedEconomicLean === "number"
      ? demographics.cachedEconomicLean
      : null;
  const socialLean =
    demographics && typeof demographics.cachedSocialLean === "number"
      ? demographics.cachedSocialLean
      : null;
  const avgTurnout = computeAvgTurnout(turnoutData);
  const categoryCount = categories.length;
  return { population, economicLean, socialLean, avgTurnout, categoryCount };
}

// ─── census card with integrated turnout ─────────────────────────────────────

interface CensusRow {
  label: string;
  pct: number;
  color: string;
  turnout?: TurnoutData;
}

interface CensusCardProps {
  title: string;
  rows: CensusRow[];
  viewMode: "chart" | "table" | "combined";
}

function CensusCard({ title, rows, viewMode }: CensusCardProps) {
  const slices: Slice[] = rows.map((r) => ({ label: r.label, pct: r.pct, color: r.color }));

  if (viewMode === "combined") {
    return (
      <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-card">
        <div className="border-b border-card-border px-4 py-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            {title}
          </h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-card-muted/50 border-b border-card-border uppercase text-muted font-semibold">
              <tr>
                <th className="px-4 py-2">Group</th>
                <th className="px-4 py-2 text-right">Share</th>
                <th className="px-4 py-2 text-right" title="Party GOTV / canvassing modifier">
                  GOTV ±
                </th>
                <th className="px-4 py-2 text-right" title="Baseline + modifier">
                  Turnout %
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border/40">
              {rows.map((r) => (
                <tr key={r.label} className="hover:bg-card-elevated/30 transition-colors">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: r.color }}
                      />
                      <span className="font-medium text-foreground" title={r.label}>
                        {r.label}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted">{r.pct}%</td>
                  <td className="px-4 py-2 text-right">
                    {r.turnout ? (
                      <span
                        className={`text-[10px] font-semibold ${
                          r.turnout.modifier > 0
                            ? "text-success"
                            : r.turnout.modifier < 0
                              ? "text-error"
                              : "text-muted"
                        }`}
                      >
                        {r.turnout.modifier > 0 ? "+" : ""}
                        {r.turnout.modifier.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-foreground">
                    {r.turnout ? `${r.turnout.actual.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 shadow-card">
      <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted">
        {title}
      </h4>

      {viewMode === "chart" ? (
        /* ── chart mode: donut left, legend right ── */
        <div className="flex items-center gap-4">
          <DonutChart slices={slices} size={88} />
          <div className="flex-1 space-y-1 min-w-0">
            {rows.map((r) => (
              <div key={r.label} className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: r.color }}
                />
                <span className="flex-1 truncate text-[11px] text-foreground/75" title={r.label}>
                  {r.label}
                </span>
                <span className="text-[11px] tabular-nums text-muted">{r.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* ── table mode: bars ── */
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center gap-2">
              <span className="w-24 shrink-0 truncate text-xs text-foreground/75" title={r.label}>
                {r.label}
              </span>
              <div className="h-2 flex-1 rounded-full bg-card-border/40 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(r.pct, 100)}%`, backgroundColor: r.color }}
                />
              </div>
              <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted">
                {r.pct}%
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Turnout summary footer. Chart and table modes have no turnout column,
          so the footer carries the turnout rate itself and shows the GOTV swing
          only where a party has actually moved it. A row of zeroes reads as
          "turnout is zero" and it is not. */}
      {rows.some((r) => r.turnout) && (
        <div className="mt-3 pt-3 border-t border-card-border/50">
          <div className="flex items-center justify-between gap-3 text-[10px] text-muted uppercase tracking-wider">
            <span className="shrink-0" title="Baseline turnout plus any GOTV swing">
              Turnout %
            </span>
            <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
              {rows
                .filter((r) => r.turnout)
                .map((r) => (
                  <span key={r.label} className="flex items-center gap-1">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: r.color }}
                    />
                    <span className="tabular-nums text-foreground/80">
                      {r.label}: {r.turnout!.actual.toFixed(1)}%
                    </span>
                    {r.turnout!.modifier !== 0 && (
                      <span
                        className={`tabular-nums ${
                          r.turnout!.modifier > 0 ? "text-success" : "text-error"
                        }`}
                        title="GOTV / canvassing swing vs baseline"
                      >
                        ({r.turnout!.modifier > 0 ? "+" : ""}
                        {r.turnout!.modifier.toFixed(1)})
                      </span>
                    )}
                  </span>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── voter groups collapsible ────────────────────────────────────────────────

function leanBarColor(v: number) {
  if (v < -0.4) return "#60a5fa";
  if (v > 0.4) return "#f87171";
  return "#94a3b8";
}
function leanTextClass(v: number) {
  if (v < -0.4) return "text-info";
  if (v > 0.4) return "text-error";
  return "text-secondary";
}
function fmtLean(v: number) {
  return (v >= 0 ? "+" : "") + v.toFixed(1);
}

/**
 * Per-bucket electorate table — the Layer-1 replacement for the archetype
 * roster. Buckets are what the vote engine counts, so these shares and leans are
 * the ones that decide the result rather than a composite derived from them.
 */
function ElectorateBucketsSection({ profile }: { profile: BucketProfileSection[] }) {
  const [open, setOpen] = useState(false);
  const [dim, setDim] = useState<string>(profile[0]?.dim ?? "");
  const section = profile.find((s) => s.dim === dim) ?? profile[0];
  if (!section) return null;
  const buckets = [...section.buckets].sort((a, b) => b.sharePct - a.sharePct);

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-card">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-card-elevated/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            Electorate
          </span>
          <span className="rounded-full bg-card-border/50 px-1.5 py-0.5 text-[10px] text-muted tabular-nums">
            {buckets.length} groups
          </span>
        </div>
        <svg
          className={`h-4 w-4 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-card-border">
          <div className="flex flex-wrap gap-1.5 border-b border-card-border px-4 py-2">
            {profile.map((sec) => (
              <button
                key={sec.dim}
                onClick={() => setDim(sec.dim)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  sec.dim === section.dim
                    ? "bg-primary/15 text-primary"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {sec.dimLabel}
              </button>
            ))}
          </div>
          <div className="bg-card-muted/30 px-4 py-2 text-[11px] text-muted/70 border-b border-card-border">
            The groups the election model actually counts. Shares are of this region&apos;s
            electorate and add up to 100% within each cut.
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-card-muted/50 border-b border-card-border uppercase text-muted font-semibold">
                <tr>
                  <th className="px-4 py-2 w-1/4">{section.dimLabel}</th>
                  <th className="px-4 py-2">Lean</th>
                  <th className="px-4 py-2 text-right">Share</th>
                  <th className="px-4 py-2 text-right">Turnout</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border/40">
                {buckets.map((b) => (
                  <tr key={b.id} className="hover:bg-card-elevated/30 transition-colors">
                    <td className="px-4 py-2 font-medium text-foreground" title={b.label}>
                      {b.label}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 rounded-full bg-card-border/40 overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(Math.abs(b.economicLean) / 5, 1) * 100}%`,
                              backgroundColor: leanBarColor(b.economicLean),
                              marginLeft: b.economicLean < 0 ? 0 : "auto",
                              marginRight: b.economicLean > 0 ? 0 : "auto",
                            }}
                          />
                        </div>
                        <span
                          className={`text-[10px] font-semibold tabular-nums w-8 text-right ${leanTextClass(b.economicLean)}`}
                        >
                          {fmtLean(b.economicLean)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted">
                      {b.sharePct.toFixed(1)}%
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-foreground font-semibold">
                      {b.turnout.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Shown wherever the electorate breakdown would go when the region has no
 * Layer-1 substrate to build it from. Deliberately states what is missing
 * rather than falling back to a different, non-authoritative breakdown.
 */
function NoElectorateSubstrateNotice() {
  return (
    <div className="rounded-xl border border-card-border bg-card p-4 shadow-card">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted mb-2">
        Electorate
      </p>
      <p className="text-xs text-muted/80">
        No electorate breakdown for this region yet. It appears once the region has census data.
      </p>
    </div>
  );
}

// ─── main export ─────────────────────────────────────────────────────────────

type ViewMode = "chart" | "table" | "combined";

export function DemographicsAndTurnoutTab({
  stateId,
  demographics,
  categories,
  censusData,
  turnoutData,
  countryId,
  regionParties = [],
  bucketProfile = null,
}: {
  stateId: string;
  demographics: SerializedStateDemographics | null;
  categories: DemographicCategory[];
  censusData: Layer1Config | ArchetypeRegionCensus | null;
  /**
   * Per-bucket electorate profile, computed server-side from the same granular
   * units the vote engine uses. Null when the region has no Layer-1 substrate,
   * in which case the archetype fallback below still renders.
   */
  bucketProfile?: BucketProfileSection[] | null;
  turnoutData: TurnoutResponse | null;
  countryId?: string;
  regionParties?: RegionPartyPosition[];
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("combined");
  const kpi = computeKpiProps({ demographics, categories, turnoutData });
  // Archetype-based view applies to every country whose demographicProfileId
  // is `<cc>_archetypes` (UK, JP, DE, IE, CN, BR). Single config-driven gate; no
  // caller has to pass a per-country boolean.
  const upperCountryId = countryId?.toUpperCase() as CountryId | undefined;
  const profileId = upperCountryId
    ? COUNTRY_CONFIGS[upperCountryId]?.demographicProfileId
    : undefined;
  const isArchetypeBased = /^[a-z]{2}_archetypes$/.test(profileId ?? "");

  if (!censusData && !demographics) {
    // Census-share / polling demographics are unconfigured — but the LIVE cohort
    // data is a separate collection (regionDemographics + state.population), so
    // still surface the live panel. The empty-state note below is scoped to the
    // census/polling layer so it reads coherently above a populated panel.
    return (
      <div className="space-y-3">
        {countryId && <LivePopulationPanel stateId={stateId} countryId={countryId} />}
        <KpiStrip {...kpi} />
        <div className="rounded-xl border border-card-border bg-card p-6">
          <div className="py-12 text-center text-muted">
            <svg
              className="mx-auto h-12 w-12 mb-4 opacity-50"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <p className="font-medium">No census or polling data</p>
            <p className="text-sm mt-1">
              Census and polling demographics have not been configured for this region.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const buildRows = (
    data: Record<string, number>,
    colors: string[],
    labels: Record<string, string>,
    turnoutCategory?: keyof NonNullable<TurnoutResponse["turnout"]>
  ): CensusRow[] => {
    if (!data) return [];
    return Object.entries(data).map(([key, pct], i) => ({
      label: labels[key] || key,
      pct,
      color: colors[i % colors.length],
      // Turnout is keyed by census dimension and bucket for every country
      // (see `buildRegionTurnoutResponse`), so a card reads its own dimension
      // directly with no per-country conversion.
      turnout: turnoutCategory ? turnoutData?.turnout[turnoutCategory]?.[key] : undefined,
    }));
  };

  // Archetype-based census cards (UK, JP, DE, IE, CN, BR, DD) — labels resolved
  // per country from REGION_CENSUS_LABELS.
  if (isArchetypeBased && censusData && "ethnicity" in censusData) {
    const data = censusData as unknown as Record<string, Record<string, number>>;
    const labels = upperCountryId ? REGION_CENSUS_LABELS[upperCountryId] : undefined;

    const ethnicityRows = buildRows(
      data.ethnicity,
      ETH_COLORS,
      labels?.ethnicity ?? {},
      "ethnicity"
    );
    const ageRows = buildRows(data.age, AGE_COLORS, labels?.age ?? {}, "age");
    const educationRows = buildRows(
      data.education,
      EDU_COLORS,
      labels?.education ?? {},
      "education"
    );
    const incomeRows = buildRows(data.income, INC_COLORS, labels?.income ?? {}, "income");
    const urbanizationRows = buildRows(
      data.urbanization,
      URB_COLORS,
      labels?.urbanization ?? {},
      "urbanization"
    );

    return (
      <div className="space-y-3">
        {/* P1d-3: live cohort population + age pyramid + census notice, atop the
            static census-share cards (different data layer). */}
        {countryId && <LivePopulationPanel stateId={stateId} countryId={countryId} />}
        <KpiStrip {...kpi} />
        {/* ── electorate dossier (read-only flagship) ── */}
        {bucketProfile && bucketProfile.length > 0 && (
          <ElectorateDossier profile={bucketProfile} regionParties={regionParties} />
        )}
        {/* ── toolbar ── */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setViewMode("chart")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "chart"
                  ? "bg-primary/15 text-primary"
                  : "text-muted hover:text-foreground hover:bg-card-border/30"
              }`}
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
                <path d="M22 12A10 10 0 0 0 12 2v10z" />
              </svg>
              Chart
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "table"
                  ? "bg-primary/15 text-primary"
                  : "text-muted hover:text-foreground hover:bg-card-border/30"
              }`}
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M3 15h18M9 3v18" />
              </svg>
              Table
            </button>
            <button
              onClick={() => setViewMode("combined")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "combined"
                  ? "bg-primary/15 text-primary"
                  : "text-muted hover:text-foreground hover:bg-card-border/30"
              }`}
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M9 3v18M3 15h18" />
                <circle cx="15" cy="9" r="2" />
              </svg>
              Combined
            </button>
          </div>
          {turnoutData && (
            <div className="text-[10px] text-muted">
              Turnout updated:{" "}
              <LocalTime value={turnoutData.lastUpdated!} options={{ dateStyle: "medium" }} />
            </div>
          )}
        </div>

        {/* ── census cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <CensusCard
            title={labels?.cardTitles.ethnicity ?? "Ethnicity"}
            rows={ethnicityRows}
            viewMode={viewMode}
          />
          <CensusCard
            title={labels?.cardTitles.age ?? "Age Distribution"}
            rows={ageRows}
            viewMode={viewMode}
          />
          <CensusCard
            title={labels?.cardTitles.education ?? "Education"}
            rows={educationRows}
            viewMode={viewMode}
          />
          <CensusCard
            title={labels?.cardTitles.income ?? "Household Income"}
            rows={incomeRows}
            viewMode={viewMode}
          />
          <CensusCard
            title={labels?.cardTitles.urbanization ?? "Urbanization"}
            rows={urbanizationRows}
            viewMode={viewMode}
          />
        </div>

        {/* ── electorate buckets + how-to-read grid ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {bucketProfile && bucketProfile.length > 0 ? (
            <ElectorateBucketsSection profile={bucketProfile} />
          ) : (
            <NoElectorateSubstrateNotice />
          )}

          {/* ── how to read ── */}
          {turnoutData && (
            <div className="rounded-xl border border-card-border bg-card-muted/30 p-4 shadow-card">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted mb-2">
                How to read turnout data
              </p>
              <ul className="text-xs text-muted/80 space-y-1">
                <li>
                  <strong>Turnout %</strong> = Baseline + GOTV modifier (expected turnout for this
                  group)
                </li>
                <li>
                  <strong>GOTV ±</strong> = party boost or suppression vs baseline
                </li>
                <li>
                  <span className="text-success">Green</span> = Higher than baseline
                  (GOTV/canvassing boost)
                </li>
                <li>
                  <span className="text-error">Red</span> = Lower than baseline
                </li>
                <li>Modifiers decay 2% per turn toward 0</li>
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  }

  // US census data
  if (censusData && "race" in censusData) {
    const usData = censusData as Layer1Config;
    const raceRows = buildRows(
      usData.race,
      RACE_COLORS,
      { white: "White", hispanic: "Hispanic", black: "Black", asian: "Asian", other: "Other" },
      "race"
    );
    const eduRows = buildRows(
      usData.education,
      EDU_COLORS,
      { no_college: "No College", college: "College", graduate: "Graduate" },
      "education"
    );
    const wealthRows = buildRows(
      usData.wealth,
      WEALTH_COLORS,
      { low: "Low Income", middle: "Middle Income", high: "High Income" },
      "wealth"
    );
    const ageRows = buildRows(
      usData.age,
      AGE_COLORS,
      {
        young: "Young (18-29)",
        mid: "Mid (30-44)",
        mature: "Mature (45-64)",
        senior: "Senior (65+)",
      },
      "age"
    );
    const ideoRows = buildRows(
      usData.ideology,
      IDEO_COLORS,
      {
        evangelicals: "Evangelicals",
        patriots: "Patriots",
        gunowners: "Gun Owners",
        progressives: "Progressives",
        environmentalists: "Environmentalists",
        libertarians: "Libertarians",
      },
      "ideology"
    );

    return (
      <div className="space-y-3">
        {/* P1d-3: live cohort population + age pyramid + census notice, atop the
            static census-share cards (different data layer). */}
        {countryId && <LivePopulationPanel stateId={stateId} countryId={countryId} />}
        <KpiStrip {...kpi} />
        {/* ── electorate dossier (read-only flagship) ── */}
        {bucketProfile && bucketProfile.length > 0 && (
          <ElectorateDossier profile={bucketProfile} regionParties={regionParties} />
        )}
        {/* ── toolbar ── */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setViewMode("chart")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "chart"
                  ? "bg-primary/15 text-primary"
                  : "text-muted hover:text-foreground hover:bg-card-border/30"
              }`}
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
                <path d="M22 12A10 10 0 0 0 12 2v10z" />
              </svg>
              Chart
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "table"
                  ? "bg-primary/15 text-primary"
                  : "text-muted hover:text-foreground hover:bg-card-border/30"
              }`}
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M3 15h18M9 3v18" />
              </svg>
              Table
            </button>
            <button
              onClick={() => setViewMode("combined")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "combined"
                  ? "bg-primary/15 text-primary"
                  : "text-muted hover:text-foreground hover:bg-card-border/30"
              }`}
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M9 3v18M3 15h18" />
                <circle cx="15" cy="9" r="2" />
              </svg>
              Combined
            </button>
          </div>
          {turnoutData && (
            <div className="text-[10px] text-muted">
              Turnout updated:{" "}
              <LocalTime value={turnoutData.lastUpdated!} options={{ dateStyle: "medium" }} />
            </div>
          )}
        </div>

        {/* ── census cards with integrated turnout ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <CensusCard title="Race / Ethnicity" rows={raceRows} viewMode={viewMode} />
          <CensusCard title="Education" rows={eduRows} viewMode={viewMode} />
          <CensusCard title="Income" rows={wealthRows} viewMode={viewMode} />
          <CensusCard title="Age" rows={ageRows} viewMode={viewMode} />
          <CensusCard title="Ideological Tendencies" rows={ideoRows} viewMode={viewMode} />
        </div>

        {/* ── electorate buckets + how-to-read grid ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {bucketProfile && bucketProfile.length > 0 ? (
            <ElectorateBucketsSection profile={bucketProfile} />
          ) : (
            <NoElectorateSubstrateNotice />
          )}

          {/* ── how to read ── */}
          {turnoutData && (
            <div className="rounded-xl border border-card-border bg-card-muted/30 p-4 shadow-card">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted mb-2">
                How to read turnout data
              </p>
              <ul className="text-xs text-muted/80 space-y-1">
                <li>
                  <strong>Turnout %</strong> = Baseline + GOTV modifier (expected turnout for this
                  demographic)
                </li>
                <li>
                  <strong>GOTV ±</strong> = party boost or suppression vs baseline
                </li>
                <li>
                  <span className="text-success">Green</span> = Higher than baseline
                  (GOTV/canvassing boost)
                </li>
                <li>
                  <span className="text-error">Red</span> = Lower than baseline
                </li>
                <li>Modifiers decay 2% per turn toward 0</li>
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Fallback: an archetype-profile country with demographics stored but no
  // Layer-1 census file yet. Renders the live panel and an explicit notice so
  // the tab is never blank and never claims data it does not have.
  if (isArchetypeBased && demographics) {
    return (
      <div className="space-y-3">
        {countryId && <LivePopulationPanel stateId={stateId} countryId={countryId} />}
        <KpiStrip {...kpi} />
        {bucketProfile && bucketProfile.length > 0 && (
          <ElectorateDossier profile={bucketProfile} regionParties={regionParties} />
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {bucketProfile && bucketProfile.length > 0 ? (
            <ElectorateBucketsSection profile={bucketProfile} />
          ) : (
            <NoElectorateSubstrateNotice />
          )}
        </div>
      </div>
    );
  }

  return null;
}
