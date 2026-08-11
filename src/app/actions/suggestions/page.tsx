"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Skeleton } from "@/components/ui";
import { HeroImage } from "@/components/HeroImage";
import { HeroStatsStrip } from "@/components/ui";
import { getActionImage } from "@/lib/images/actionImages";
import { useWorldFlags } from "@/hooks/useWorldFlags";
import { eraIdForYear } from "@/lib/seeds/eraInterpolation";
import { eraForPreset } from "@/lib/seeds/presetSelector";
import { RecommendationCard } from "../components/RecommendationCard";
import { SuggestionSettingsModal } from "./SuggestionSettingsModal";
import type { ActionRecommendation, RecommendationCategory } from "@/lib/actions/recommendations";
import type { Character } from "@/lib/db/types";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";

interface ExecuteActionPayload {
  actionType: string;
  stateId?: string;
  amount?: number;
}

const TOP_COUNT = 5;

const CATEGORY_CONFIG: Record<RecommendationCategory, { label: string; defaultOpen: boolean }> = {
  "getting-started": { label: "Getting Started", defaultOpen: true },
  "stat-recovery": { label: "Stat Recovery", defaultOpen: false },
  "resource-opt": { label: "Resource Optimization", defaultOpen: false },
  "market-opportunity": { label: "Market Opportunities", defaultOpen: false },
  competitive: { label: "Competitive", defaultOpen: false },
  party: { label: "Party Actions", defaultOpen: false },
};

const CATEGORY_ORDER: RecommendationCategory[] = [
  "getting-started",
  "stat-recovery",
  "resource-opt",
  "market-opportunity",
  "competitive",
  "party",
];

export default function SuggestedActionsPage() {
  const router = useRouter();
  const worldFlags = useWorldFlags();
  const [character, setCharacter] = useState<Character | null>(null);
  const [recommendations, setRecommendations] = useState<ActionRecommendation[]>([]);
  const [executing, setExecuting] = useState<string | null>(null);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [executeSuccess, setExecuteSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mutedTypes, setMutedTypes] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("mutedSuggestionTypes");
      return stored ? JSON.parse(stored) : [];
    }
    return [];
  });
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set(["getting-started"]));

  useEffect(() => {
    localStorage.setItem("mutedSuggestionTypes", JSON.stringify(mutedTypes));
  }, [mutedTypes]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [charRes, recRes] = await Promise.all([
          fetch("/api/auth/character"),
          fetch("/api/actions/recommendations"),
        ]);
        if (!charRes.ok && charRes.status === 401) {
          router.push("/login");
          return;
        }
        if (charRes.ok) setCharacter(await charRes.json());
        if (recRes.ok) {
          const data = await recRes.json();
          const recs: ActionRecommendation[] = data.recommendations ?? [];
          setRecommendations(recs);
          // Auto-open Getting Started only if it has items; otherwise keep defaults
          const hasGettingStarted = recs.some((r) => r.category === "getting-started");
          if (!hasGettingStarted) {
            setOpenCategories(new Set());
          }
        }
      } catch {
        setExecuteError("Failed to load recommendations");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [router]);

  const handleDismiss = useCallback((id: string) => {
    setRecommendations((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const handleMuteToggle = useCallback((type: string) => {
    setMutedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }, []);

  const toggleCategory = useCallback((category: string) => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const handleExecute = useCallback(
    async (recommendation: ActionRecommendation) => {
      const actionType = recommendation.action.type;
      if (!actionType) return;

      setExecuting(recommendation.id);
      setExecuteError(null);

      try {
        const response = await fetch("/api/actions/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actionType,
            stateId: recommendation.action.targetState,
          } as ExecuteActionPayload),
        });

        const result = await response.json();

        if (response.ok) {
          setExecuteSuccess(result.message ?? "Action executed successfully");
          handleDismiss(recommendation.id);
          setTimeout(() => setExecuteSuccess(null), 3000);
        } else {
          setExecuteError(result.error ?? "Failed to execute action");
          setTimeout(() => setExecuteError(null), 5000);
        }
      } catch {
        setExecuteError("Network error. Please try again.");
        setTimeout(() => setExecuteError(null), 5000);
      } finally {
        setExecuting(null);
      }
    },
    [handleDismiss]
  );

  const visible = recommendations.filter((r) => !mutedTypes.includes(r.category));
  const mutedCount = mutedTypes.length;

  const topFive = visible.slice(0, TOP_COUNT);
  const rest = visible.slice(TOP_COUNT);

  // Group the rest by category, preserving CATEGORY_ORDER
  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_CONFIG[cat].label,
    items: rest.filter((r) => r.category === cat),
  })).filter((g) => g.items.length > 0);

  const criticalCount = visible.filter((r) => r.priority === "critical").length;
  const highCount = visible.filter((r) => r.priority === "high").length;

  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 space-y-6">
          <Skeleton className="h-[220px] w-full rounded-2xl" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Hero */}
      <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-6">
        <header className="relative overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
          <div className="relative h-[175px] w-full sm:h-[220px]">
            <HeroImage
              // Same era/country art as /actions, so the two heroes match.
              src={getActionImage("hero", {
                // Live year, matching /actions — see the note there.
                era:
                  worldFlags.currentYear != null
                    ? eraIdForYear(worldFlags.currentYear)
                    : eraForPreset(worldFlags.preset),
                countryId: character?.countryId ?? null,
              })}
              alt="Suggested actions"
              fill
              className="object-cover object-[center_65%]"
              sizes="(max-width: 1024px) 100vw, 1024px"
              priority
            />
            <div
              className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent"
              aria-hidden
            />
            {/* Back button */}
            <div className="absolute top-4 left-4 sm:top-5 sm:left-5">
              <Link
                href="/actions"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/50 hover:bg-black/70 text-white text-sm font-medium transition-colors backdrop-blur-sm border border-white/20"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
                Actions
              </Link>
            </div>
            {/* Filter button */}
            <div className="absolute top-4 right-4 sm:top-5 sm:right-5">
              <button
                onClick={() => setSettingsOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/50 hover:bg-black/70 text-white text-sm font-medium transition-colors backdrop-blur-sm border border-white/20"
                title="Manage muted suggestion types"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                Filter
                {mutedCount > 0 && (
                  <span className="ml-0.5 w-4 h-4 flex items-center justify-center text-[10px] rounded-full bg-warning/80 text-black font-bold">
                    {mutedCount}
                  </span>
                )}
              </button>
            </div>
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-end px-6 pb-5 sm:px-8 sm:pb-7">
              <h1 className="text-2xl font-bold tracking-tight text-white drop-shadow-md sm:text-3xl">
                Action Suggestions
              </h1>
              <p className="mt-1.5 text-sm text-white/80 drop-shadow max-w-xl">
                Personalized recommendations based on your stats and opportunities.
              </p>
            </div>
          </div>

          {/* Stats strip */}
          <HeroStatsStrip variant="overlay">
            {character && (
              <>
                <div className="flex flex-col px-5 py-3 min-w-max">
                  <span className="text-[10px] uppercase tracking-widest text-muted font-bold">
                    Actions
                  </span>
                  <span className="text-base font-bold tabular-nums text-foreground">
                    {character.actions}
                    <span className="text-xs font-normal text-muted ml-1">AP</span>
                  </span>
                </div>
                <div className="flex flex-col px-5 py-3 min-w-max">
                  <span className="text-[10px] uppercase tracking-widest text-muted font-bold">
                    Funds
                  </span>
                  <span className="text-base font-bold tabular-nums text-success">
                    {formatCurrencyFaceAmount(
                      character.currencyBalances?.campaign ?? character.funds ?? 0,
                      getHomeCurrency(character)
                    )}
                  </span>
                </div>
                <div className="flex flex-col px-5 py-3 min-w-max">
                  <span className="text-[10px] uppercase tracking-widest text-muted font-bold">
                    Influence
                  </span>
                  <span className="text-base font-bold tabular-nums text-foreground">
                    {(character.politicalInfluence ?? 0).toFixed(1)}%
                  </span>
                </div>
                <div className="flex flex-col px-5 py-3 min-w-max">
                  <span className="text-[10px] uppercase tracking-widest text-muted font-bold">
                    Favorability
                  </span>
                  <span
                    className={`text-base font-bold tabular-nums ${(character.favorability ?? 0) < 40 ? "text-error" : (character.favorability ?? 0) < 60 ? "text-warning" : "text-success"}`}
                  >
                    {(character.favorability ?? 0).toFixed(1)}%
                  </span>
                </div>
              </>
            )}
            <div className="flex items-center gap-3 px-5 py-3 ml-auto">
              {criticalCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-error">
                  <span className="w-2 h-2 rounded-full bg-error animate-pulse inline-block" />
                  {criticalCount} Critical
                </span>
              )}
              {highCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-warning">
                  <span className="w-2 h-2 rounded-full bg-warning inline-block" />
                  {highCount} High
                </span>
              )}
              {visible.length === 0 && (
                <span className="text-xs font-semibold text-success">All clear</span>
              )}
            </div>
          </HeroStatsStrip>
        </header>
      </div>

      {/* Content */}
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-6">
        {/* Feedback messages */}
        {executeSuccess && (
          <div className="p-3 rounded-lg bg-success/10 border border-success/30 text-success text-sm font-medium">
            ✓ {executeSuccess}
          </div>
        )}
        {executeError && (
          <div className="p-3 rounded-lg bg-error/10 border border-error/30 text-error text-sm font-medium">
            ✗ {executeError}
          </div>
        )}

        {/* Empty state */}
        {visible.length === 0 && (
          <div className="rounded-xl border border-card-border bg-card p-12 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10 border border-success/30">
              <svg
                className="w-7 h-7 text-success"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-foreground">All Clear</h2>
            <p className="text-muted mt-2 max-w-sm mx-auto text-sm">
              No recommendations right now. Check back after taking actions or as conditions change.
            </p>
            <Link
              href="/actions"
              className="inline-block mt-6 text-sm font-medium px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Go to Actions
            </Link>
          </div>
        )}

        {/* Top 5 */}
        {topFive.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-foreground mb-3">Top Priorities</h2>
            <div className="space-y-2.5">
              {topFive.map((rec) => (
                <RecommendationCard
                  key={rec.id}
                  recommendation={rec}
                  onDismiss={handleDismiss}
                  onExecute={handleExecute}
                  executing={executing}
                  canExecuteInline={true}
                />
              ))}
            </div>
          </section>
        )}

        {/* Collapsible category sections */}
        {grouped.length > 0 && (
          <section className="space-y-2">
            {topFive.length > 0 && (
              <h2 className="text-sm font-semibold text-foreground mb-1">More Suggestions</h2>
            )}
            {grouped.map(({ category, label, items }) => {
              const isOpen = openCategories.has(category);
              return (
                <div
                  key={category}
                  className="rounded-xl border border-card-border bg-card overflow-hidden"
                >
                  <button
                    onClick={() => toggleCategory(category)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-card-elevated transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{label}</span>
                      <span className="text-xs text-muted">({items.length})</span>
                    </div>
                    <svg
                      className={`w-4 h-4 text-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>
                  {isOpen && (
                    <div className="border-t border-card-border p-3 space-y-2.5">
                      {items.map((rec) => (
                        <RecommendationCard
                          key={rec.id}
                          recommendation={rec}
                          onDismiss={handleDismiss}
                          onExecute={handleExecute}
                          executing={executing}
                          canExecuteInline={true}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}
      </main>

      <SuggestionSettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        mutedTypes={mutedTypes}
        onMuteToggle={handleMuteToggle}
      />
    </div>
  );
}
