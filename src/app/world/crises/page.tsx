"use client";

// UN General Assembly — https://unsplash.com/photos/people-sitting-on-chairs-inside-building-41Wj4KxB7BA
const HERO_IMAGE =
  "https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?auto=format&fit=crop&w=1200&q=70";

import { useEffect, useState, useCallback } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";
import Link from "next/link";
import Image from "next/image";
import { rawTurnToLarpDate } from "@/lib/utils/formatters";
import type { CalendarClock } from "@/lib/utils/gameDate";
import { STARTING_YEAR } from "@/lib/constants/turnTime";
import type { Crisis } from "@/lib/db/types/crisis";
import { type CountryId } from "@/lib/constants/countries";
import { useRegisteredCountries } from "@/contexts/RegisteredCountriesContext";
import { crisisSeverity } from "@/lib/crises/severity";
import { formatCrisisEffectTarget } from "@/lib/crises/effectLabels";
import { SovereignDebtWatchPanel } from "@/components/world/SovereignDebtWatchPanel";
import { CountryFlag } from "@/components/CountryFlag";
import type { Conflict } from "@/app/world/conflicts/_coldwar/conflicts";
import { useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";

// Crisis effect magnitudes are floats and land with binary-rounding tails
// (0.15 * 3 = 0.44999999999999996). Show at most two decimals, no trailing zeros.
function formatEffectValue(v: number): string {
  return Number(v.toFixed(2)).toString();
}

const SEVERITY_BADGE: Record<"low" | "medium" | "high", string> = {
  high: "border-rose-500/30 bg-rose-500/10 text-rose-500 dark:text-rose-400",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  low: "border-zinc-400/30 bg-zinc-400/10 text-muted",
};

// Conflict severity rungs → the same badge palette the crisis cards use, so the merged
// Global feed reads as one surface. WINDING DOWN falls through to the muted low style.
const CONFLICT_SEVERITY_BADGE: Record<Conflict["sev"], string> = {
  CRITICAL: SEVERITY_BADGE.high,
  MAJOR: SEVERITY_BADGE.high,
  ACTIVE: SEVERITY_BADGE.medium,
  "WINDING DOWN": SEVERITY_BADGE.low,
};

type ScopeTab = "global" | "country" | "region" | "debt";

function getTurnLabel(crisis: Crisis, currentTurn: number): string {
  if (crisis.status === "resolved") return "Resolved";
  if (crisis.durationTurns === null) return "Ongoing";
  const elapsed = Math.max(1, currentTurn - crisis.startTurn + 1);
  return `Turn ${Math.min(elapsed, crisis.durationTurns)} of ${crisis.durationTurns}`;
}

function EffectPills({ effects }: { effects: Crisis["effects"] }) {
  const shown = effects.slice(0, 3);
  const overflow = effects.length - 3;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((e, i) => (
        <span
          key={i}
          title={e.label}
          className={`inline-flex items-center gap-0.5 text-xs px-2 py-0.5 rounded-full border ${
            e.value < 0
              ? "border-error/30 bg-error/5 text-error"
              : "border-success/30 bg-success/5 text-success"
          }`}
        >
          {e.effectType === "tick" && (
            <svg
              className="h-2.5 w-2.5 shrink-0 opacity-70"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          )}
          {e.value > 0 ? "+" : ""}
          {formatEffectValue(e.value)} {formatCrisisEffectTarget(e)}
        </span>
      ))}
      {overflow > 0 && (
        <span className="text-xs px-2 py-0.5 rounded-full border border-card-border text-muted">
          +{overflow} more
        </span>
      )}
    </div>
  );
}

function CrisisCard({
  crisis,
  currentTurn,
  startingYear,
  clock,
}: {
  crisis: Crisis;
  currentTurn: number;
  startingYear: number;
  /** Founding-phase clock, so stored RAW turns date on the world calendar (#1208). */
  clock: CalendarClock;
}) {
  const scopeLabel =
    crisis.scope === "country" ? "National" : crisis.scope === "region" ? "Regional" : "Global";
  const badgeClass =
    crisis.status === "resolved"
      ? "border-zinc-400/30 bg-zinc-400/10 text-zinc-400"
      : SEVERITY_BADGE[crisisSeverity(crisis)];

  return (
    <Link
      href={`/world/crises/${crisis._id.toString()}`}
      className="block rounded-xl border border-card-border bg-card shadow-card card-hover group overflow-hidden"
    >
      {crisis.heroImage ? (
        <div className="relative h-24 w-full overflow-hidden">
          <Image
            src={crisis.heroImage}
            alt=""
            fill
            className={`object-cover object-center transition-transform duration-300 group-hover:scale-105 ${crisis.status === "resolved" ? "grayscale" : ""}`}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between gap-2 px-3 pb-2">
            <h3 className="font-semibold text-white group-hover:text-primary/90 transition-colors line-clamp-1 leading-snug text-sm drop-shadow">
              {crisis.name}
            </h3>
            <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full border ${badgeClass}`}>
              {scopeLabel}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-0">
          <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-2 leading-snug">
            {crisis.name}
          </h3>
          <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full border ${badgeClass}`}>
            {scopeLabel}
          </span>
        </div>
      )}
      <div className={crisis.heroImage ? "px-4 pt-3 pb-4" : "px-5 pt-2 pb-5"}>
        <p className="text-xs text-muted leading-relaxed line-clamp-2 mb-3">{crisis.description}</p>
        <EffectPills effects={crisis.effects} />
        <div className="flex items-center justify-between mt-3 text-xs text-muted">
          <span>Started {rawTurnToLarpDate(crisis.startTurn, startingYear, clock)}</span>
          <span
            className={
              crisis.status === "resolved"
                ? "text-muted"
                : crisis.durationTurns
                  ? "text-warning"
                  : "text-success"
            }
          >
            {getTurnLabel(crisis, currentTurn)}
          </span>
        </div>
      </div>
    </Link>
  );
}

function ConflictCard({ conflict }: { conflict: Conflict }) {
  return (
    <Link
      href="/world/conflicts"
      className="block rounded-xl border border-card-border bg-card shadow-card card-hover group overflow-hidden"
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-0">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-rose-500 dark:text-rose-400">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z" />
              </svg>
              War
            </span>
            <span className="text-[10px] text-muted">{conflict.region}</span>
          </div>
          <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-2 leading-snug">
            {conflict.name}
          </h3>
        </div>
        <span
          className={`shrink-0 text-xs px-2 py-0.5 rounded-full border ${CONFLICT_SEVERITY_BADGE[conflict.sev]}`}
        >
          {conflict.sev === "WINDING DOWN" ? "Winding down" : "Global"}
        </span>
      </div>
      <div className="px-5 pt-2 pb-5">
        <p className="text-xs text-muted leading-relaxed line-clamp-2 mb-3">
          {conflict.west} vs {conflict.east}. {conflict.status}.
        </p>
        <div className="flex flex-wrap gap-1">
          <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full border border-error/30 bg-error/5 text-error">
            {conflict.deaths}
          </span>
          {conflict.escalating && (
            <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
              Escalating
            </span>
          )}
        </div>
        <div className="flex items-center justify-between mt-3 text-xs text-muted">
          <span>{conflict.years}</span>
          <span className="text-warning">Ongoing</span>
        </div>
      </div>
    </Link>
  );
}

function EmptyScope({ scope }: { scope: ScopeTab }) {
  const labels: Record<ScopeTab, string> = {
    global: "No active global crises or conflicts",
    country: "No active national crises",
    region: "No active regional crises",
    debt: "No sovereign debt on watch",
  };
  return (
    <div className="rounded-xl border border-card-border bg-card p-10 text-center">
      <p className="text-muted text-sm">{labels[scope]}</p>
    </div>
  );
}

function RegionLinks({
  countryId,
  regionIds,
  regionNames,
}: {
  countryId: string;
  regionIds: string[];
  regionNames: Record<string, string>;
}) {
  return (
    <p className="text-xs text-muted pl-1">
      Regions:{" "}
      {regionIds.map((id, i) => (
        <span key={id}>
          {i > 0 && ", "}
          <Link
            href={`/country/${countryId}/region/${id}`}
            className="text-foreground hover:text-primary transition-colors"
          >
            {regionNames[id] ?? id}
          </Link>
        </span>
      ))}
    </p>
  );
}

function CountryGroup({
  countryId,
  crises,
  currentTurn,
  startingYear,
  showRegions,
  regionNames,
  clock,
}: {
  countryId: string;
  crises: Crisis[];
  currentTurn: number;
  startingYear: number;
  showRegions?: boolean;
  regionNames: Record<string, string>;
  clock: CalendarClock;
}) {
  // Resolved per render rather than a module-level map: a compiled map is built
  // once at import and can never see a country renamed at runtime.
  const countryName = useCountryDisplayName();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <CountryFlag country={countryId} size="md" />
        <h3 className="text-sm font-semibold text-foreground">
          {countryName(countryId as CountryId)}
        </h3>
        <div className="flex-1 h-px bg-card-border" />
      </div>
      {showRegions ? (
        <div className="space-y-3">
          {crises.map((crisis) => (
            <div key={crisis._id.toString()} className="space-y-1">
              {crisis.regionIds.length > 0 && (
                <RegionLinks
                  countryId={countryId}
                  regionIds={crisis.regionIds}
                  regionNames={regionNames}
                />
              )}
              <CrisisCard
                crisis={crisis}
                currentTurn={currentTurn}
                startingYear={startingYear}
                clock={clock}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {crises.map((crisis) => (
            <CrisisCard
              key={crisis._id.toString()}
              crisis={crisis}
              currentTurn={currentTurn}
              startingYear={startingYear}
              clock={clock}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function CrisesPage() {
  const registered = useRegisteredCountries();
  const [activeTab, setActiveTab] = useState<ScopeTab>("global");
  const [showHistorical, setShowHistorical] = useState(false);
  const [crises, setCrises] = useState<Crisis[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [currentTurn, setCurrentTurn] = useState(0);
  const [startingYear, setStartingYear] = useState<number | undefined>(undefined);
  const [clock, setClock] = useState<CalendarClock>({});
  const [regionNames, setRegionNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetchJson<{ user?: { isAdmin?: boolean } }>("/api/auth/me", {
      feature: "world-crises-auth",
    })
      .then((d) => {
        if (d.user?.isAdmin) setIsAdmin(true);
      })
      .catch(() => {});
  }, []);

  const fetchCrises = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/crises?status=all`);
      if (!r.ok) {
        setError("Failed to load crisis data. Please try again.");
        return;
      }
      const d = await r.json();
      setCrises(d.crises ?? []);
      setRegionNames(d.regionNames ?? {});
      setCurrentTurn(d.currentTurn ?? 0);
      setStartingYear(d.startingYear);
      setClock({
        preIterationTurns: d.preIterationTurns,
        preIterationActive: d.preIterationActive,
      });
    } catch {
      setCrises([]);
      setError("Network error - could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCrises();
  }, [fetchCrises]);

  // Conflicts ride alongside global crises in the merged Global feed. Best-effort: a
  // world with the subsystem off returns an empty list, and any failure just leaves the
  // feed as crises-only rather than erroring the whole page.
  useEffect(() => {
    let cancelled = false;
    fetchJson<{ conflicts?: Conflict[] }>("/api/world/conflicts/feed", {
      feature: "world-crises-conflicts",
    })
      .then((d) => {
        if (!cancelled) setConflicts(d.conflicts ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const allActive = crises.filter((c) => c.status === "active");
  const allResolved = crises.filter((c) => c.status === "resolved");

  const activeByScopeTab = allActive.filter((c) => c.scope === activeTab);
  const historicalByScopeTab = allResolved.filter((c) => c.scope === activeTab);

  // Group by country for national + regional tabs
  const countryGroups = registered.reduce<Record<string, Crisis[]>>((acc, cId) => {
    const matches = activeByScopeTab.filter((c) => (c.countryIds as string[]).includes(cId));
    if (matches.length) acc[cId] = matches;
    return acc;
  }, {});

  const historicalCountryGroups = registered.reduce<Record<string, Crisis[]>>((acc, cId) => {
    const matches = historicalByScopeTab.filter((c) => (c.countryIds as string[]).includes(cId));
    if (matches.length) acc[cId] = matches;
    return acc;
  }, {});

  const tabs: { id: ScopeTab; label: string }[] = [
    { id: "global", label: "Global" },
    { id: "country", label: "National" },
    { id: "region", label: "Regional" },
    { id: "debt", label: "Debt Watch" },
  ];

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-6">
        {/* Hero */}
        <header className="relative overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
          <div className="relative h-[175px] w-full sm:h-[220px]">
            <Image
              src={HERO_IMAGE}
              alt=""
              fill
              className="object-cover object-center"
              priority
              sizes="(max-width: 1280px) 100vw, 1280px"
            />
            <div
              className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent"
              aria-hidden
            />
            <div className="absolute inset-0 flex flex-col justify-between px-5 sm:px-6 py-4 sm:py-5">
              <Link
                href="/world"
                className="flex items-center gap-1.5 text-xs font-medium text-white/70 hover:text-white transition-colors w-fit"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
                World
              </Link>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-purple-300">
                    World Events
                  </span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight">
                  Global Crises
                </h1>
                <p className="text-sm text-white/60 mt-1">
                  Active world events affecting nations, economies, and metrics.
                </p>
              </div>
            </div>
          </div>

          {/* Stats strip */}
          <div className="flex items-stretch overflow-x-auto divide-x divide-card-border border-t border-card-border">
            <div className="flex flex-col px-5 py-3 min-w-max">
              <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
                Active
              </span>
              <span className="text-base font-bold tabular-nums text-foreground">
                {loading || error ? "—" : allActive.length}
              </span>
            </div>
            <div className="flex flex-col px-5 py-3 min-w-max">
              <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
                Historical
              </span>
              <span className="text-base font-bold tabular-nums text-foreground">
                {loading || error ? "—" : allResolved.length}
              </span>
            </div>
            <div className="flex flex-col px-5 py-3 min-w-max">
              <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
                Countries Affected
              </span>
              <span className="text-base font-bold tabular-nums text-foreground">
                {loading || error
                  ? "—"
                  : allActive.some((c) => c.scope === "global")
                    ? "All"
                    : new Set(allActive.flatMap((c) => c.countryIds)).size || "—"}
              </span>
            </div>
          </div>
        </header>

        {/* Scope tabs + admin action */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex gap-1 rounded-xl border border-card-border bg-card p-1 w-fit">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-lg px-5 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "bg-card-elevated text-foreground shadow-sm border border-card-border"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {isAdmin && (
            <Link
              href="/admin?tab=world&sub=crises"
              className="flex items-center gap-1.5 rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-muted hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Manage Crises
            </Link>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-44 rounded-xl border border-card-border bg-card animate-pulse"
              />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-card-border bg-card p-10 text-center">
            <p className="mb-4 text-muted text-sm">{error}</p>
            <button
              onClick={fetchCrises}
              className="rounded-lg border border-card-border bg-card-elevated px-5 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:border-foreground/30"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Sovereign debt watch */}
            {activeTab === "debt" && <SovereignDebtWatchPanel />}

            {/* Merged Global feed: live conflicts sit alongside global crises. */}
            {activeTab === "global" &&
              (activeByScopeTab.length === 0 && conflicts.length === 0 ? (
                <EmptyScope scope="global" />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {conflicts.map((conflict) => (
                    <ConflictCard key={conflict.id} conflict={conflict} />
                  ))}
                  {activeByScopeTab.map((crisis) => (
                    <CrisisCard
                      key={crisis._id.toString()}
                      crisis={crisis}
                      currentTurn={currentTurn}
                      startingYear={startingYear ?? STARTING_YEAR}
                      clock={clock}
                    />
                  ))}
                </div>
              ))}

            {(activeTab === "country" || activeTab === "region") &&
              (Object.keys(countryGroups).length === 0 ? (
                <EmptyScope scope={activeTab} />
              ) : (
                <div className="space-y-8">
                  {registered
                    .filter((cId) => countryGroups[cId])
                    .map((cId) => (
                      <CountryGroup
                        key={cId}
                        countryId={cId}
                        crises={countryGroups[cId]}
                        currentTurn={currentTurn}
                        startingYear={startingYear ?? STARTING_YEAR}
                        clock={clock}
                        showRegions={activeTab === "region"}
                        regionNames={regionNames}
                      />
                    ))}
                </div>
              ))}

            {/* Historical */}
            {historicalByScopeTab.length > 0 && (
              <div>
                <button
                  onClick={() => setShowHistorical((v) => !v)}
                  className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
                >
                  <svg
                    className={`h-3.5 w-3.5 transition-transform ${showHistorical ? "rotate-90" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                  {showHistorical ? "Hide" : "Show"} Historical Crises
                  {!showHistorical && (
                    <span className="ml-1 rounded-full bg-card-elevated border border-card-border px-1.5 py-0.5 text-xs tabular-nums">
                      {historicalByScopeTab.length}
                    </span>
                  )}
                </button>

                {showHistorical && (
                  <div className="mt-4">
                    {activeTab === "global" ? (
                      historicalByScopeTab.length === 0 ? (
                        <p className="text-sm text-muted">No resolved global crises.</p>
                      ) : (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 opacity-60">
                          {historicalByScopeTab.map((crisis) => (
                            <CrisisCard
                              key={crisis._id.toString()}
                              crisis={crisis}
                              currentTurn={currentTurn}
                              startingYear={startingYear ?? STARTING_YEAR}
                              clock={clock}
                            />
                          ))}
                        </div>
                      )
                    ) : Object.keys(historicalCountryGroups).length === 0 ? (
                      <p className="text-sm text-muted">No resolved crises in this scope.</p>
                    ) : (
                      <div className="space-y-8 opacity-60">
                        {registered
                          .filter((cId) => historicalCountryGroups[cId])
                          .map((cId) => (
                            <CountryGroup
                              key={cId}
                              countryId={cId}
                              crises={historicalCountryGroups[cId]}
                              currentTurn={currentTurn}
                              startingYear={startingYear ?? STARTING_YEAR}
                              clock={clock}
                              showRegions={activeTab === "region"}
                              regionNames={regionNames}
                            />
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
