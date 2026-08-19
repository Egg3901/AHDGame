"use client";

import { useEffect, useMemo, useCallback, useState } from "react";
import { getMessageStyle } from "@/lib/utils/formatters";
import { Skeleton } from "@/components/ui";
import { US_STATES } from "@/lib/constants";
import { useDemographicsState } from "./demographics/useDemographicsState";

/**
 * Reseed targets. Countries are those with a Layer-1 model plus US; eras match
 * `EraId`. The endpoint validates both, so an unsupported pair fails loudly
 * rather than silently seeding the default.
 */
const RESEED_COUNTRIES = ["US", "UK", "DE", "RU", "DD", "JP", "IE", "BR", "CN", "NG"] as const;
const RESEED_ERAS = ["1953", "1979", "1991", "1999", "2007", "2019", "2023"] as const;

/**
 * Read-only view of the live demographic categories and one region's stored
 * weights and groups, plus the reseed and overwrite-defaults tools.
 *
 * Hand-editing `categoryWeights` and `groups` was removed along with the
 * PATCH endpoint behind it: both are derived from the seeds and the Layer-1
 * census, so an edit here could only put a region out of step with the
 * substrate the vote engine reads.
 */
export function DemographicsManager() {
  const [reseedCountry, setReseedCountry] = useState<string>("US");
  const [reseedEra, setReseedEra] = useState<string>("2019");
  const [state, dispatch] = useDemographicsState();
  const {
    categories,
    selectedState,
    loading,
    message,
    expandedCategories,
    editWeights,
    editGroups,
    showOverwriteConfirm,
    overwriteConfirmText,
    overwriteLoading,
    overwriteMessage,
    reseedLoading,
    reseedMessage,
  } = state;

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/demographics");
      if (res.ok) {
        const data = await res.json();
        dispatch({ type: "SET_CATEGORIES", payload: data.categories || [] });
      }
    } catch (error) {
      console.error("Failed to fetch categories:", error);
    }
  }, [dispatch]);

  // Fetch categories on mount
  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const initializeDefaults = useCallback(() => {
    const defaultWeights: Record<string, number> = {};
    categories.forEach((cat) => {
      defaultWeights[cat._id] = cat.defaultWeight ?? Math.floor(100 / categories.length);
    });
    if (Object.keys(defaultWeights).length === 1) {
      defaultWeights[Object.keys(defaultWeights)[0]] = 100;
    }
    const defaultGroups: Record<
      string,
      { population: number; economicLean: number; socialLean: number }
    > = {};
    categories.forEach((cat) => {
      const equalPop = Math.floor(100 / cat.groups.length);
      cat.groups.forEach((g, idx) => {
        defaultGroups[g.id] = {
          population: idx === 0 ? 100 - equalPop * (cat.groups.length - 1) : equalPop,
          economicLean: (g as { defaultEconomicLean?: number }).defaultEconomicLean ?? 0,
          socialLean: (g as { defaultSocialLean?: number }).defaultSocialLean ?? 0,
        };
      });
    });
    dispatch({ type: "SET_EDIT", weights: defaultWeights, groups: defaultGroups });
  }, [categories, dispatch]);

  const fetchDemographics = useCallback(
    async (stateId: string) => {
      dispatch({ type: "SET_LOADING", payload: true });
      dispatch({ type: "SET_MESSAGE", payload: "" });
      try {
        const res = await fetch(`/api/admin/demographics?state=${stateId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.stateDemographics) {
            dispatch({
              type: "SET_EDIT",
              weights: { ...data.stateDemographics.categoryWeights },
              groups: { ...data.stateDemographics.groups },
            });
          } else {
            initializeDefaults();
          }
        }
      } catch (error) {
        console.error("Failed to fetch demographics:", error);
        dispatch({ type: "SET_MESSAGE", payload: "Failed to fetch demographics" });
      } finally {
        dispatch({ type: "SET_LOADING", payload: false });
      }
    },
    [initializeDefaults, dispatch]
  );

  // Fetch demographics when state changes
  useEffect(() => {
    if (selectedState) {
      fetchDemographics(selectedState);
    } else {
      dispatch({ type: "CLEAR_EDIT" });
    }
  }, [selectedState, fetchDemographics, dispatch]);

  // Calculate totals
  const weightsSum = useMemo(() => {
    if (!editWeights) return 0;
    const vals = Object.values(editWeights).filter((v): v is number => typeof v === "number");
    return vals.reduce((sum, b) => sum + b, 0);
  }, [editWeights]);

  const categoryPopulationSums = useMemo(() => {
    if (!editGroups) return {};
    const sums: Record<string, number> = {};
    categories.forEach((cat) => {
      sums[cat._id] = cat.groups.reduce((sum, g) => sum + (editGroups[g.id]?.population || 0), 0);
    });
    return sums;
  }, [editGroups, categories]);

  // Calculate preview lean
  const previewLean = useMemo(() => {
    if (!editWeights || !editGroups) return null;
    let totalEconomic = 0;
    let totalSocial = 0;

    categories.forEach((cat) => {
      const weight = (editWeights[cat._id] ?? 0) / 100;
      let catEconomic = 0;
      let catSocial = 0;

      cat.groups.forEach((g) => {
        const group = editGroups[g.id];
        if (group) {
          const pop = group.population / 100;
          catEconomic += pop * group.economicLean;
          catSocial += pop * group.socialLean;
        }
      });

      totalEconomic += weight * catEconomic;
      totalSocial += weight * catSocial;
    });

    return {
      economic: Math.round(totalEconomic * 100) / 100,
      social: Math.round(totalSocial * 100) / 100,
    };
  }, [editWeights, editGroups, categories]);

  const toggleCategory = (catId: string) => dispatch({ type: "TOGGLE_CATEGORY", catId });

  const handleReseedDemographics = async () => {
    dispatch({ type: "SET_RESEED_LOADING", payload: true });
    dispatch({ type: "SET_RESEED_MESSAGE", payload: "" });
    try {
      // The endpoint defaults to US/2019 when given no body. Sending the target
      // explicitly is what makes non-US backfills (e.g. RU/DD 1953, #3752)
      // reachable from the UI at all.
      const res = await fetch("/api/admin/demographics/reseed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countryId: reseedCountry, era: reseedEra }),
      });
      const data = await res.json();
      if (res.ok) {
        dispatch({ type: "SET_RESEED_MESSAGE", payload: `✓ ${data.message}` });
        await fetchCategories();
        if (selectedState) await fetchDemographics(selectedState);
      } else {
        dispatch({ type: "SET_RESEED_MESSAGE", payload: `✗ ${data.error ?? "Reseed failed"}` });
      }
    } catch {
      dispatch({ type: "SET_RESEED_MESSAGE", payload: "✗ Network error" });
    } finally {
      dispatch({ type: "SET_RESEED_LOADING", payload: false });
    }
  };

  const handleOverwriteDefaults = async () => {
    if (overwriteConfirmText !== "OVERWRITE") {
      dispatch({ type: "SET_OVERWRITE_MESSAGE", payload: "✗ Please type OVERWRITE to confirm" });
      return;
    }

    dispatch({ type: "SET_OVERWRITE_LOADING", payload: true });
    dispatch({ type: "SET_OVERWRITE_MESSAGE", payload: "" });

    try {
      const res = await fetch("/api/admin/demographics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmText: overwriteConfirmText }),
      });
      const data = await res.json();

      if (res.ok) {
        dispatch({ type: "SET_OVERWRITE_MESSAGE", payload: `✓ ${data.message}` });
        dispatch({ type: "CLOSE_OVERWRITE" });
      } else {
        dispatch({ type: "SET_OVERWRITE_MESSAGE", payload: `✗ ${data.error}` });
      }
    } catch {
      dispatch({ type: "SET_OVERWRITE_MESSAGE", payload: "✗ Network error" });
    } finally {
      dispatch({ type: "SET_OVERWRITE_LOADING", payload: false });
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-card-border bg-card p-6">
        {/* Reseed + State Selector */}
        <div className="mb-6 flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-2 block text-sm font-medium">Select State</label>
            <select
              value={selectedState}
              onChange={(e) => dispatch({ type: "SET_SELECTED_STATE", payload: e.target.value })}
              className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm w-48"
            >
              <option value="">-- Select State --</option>
              {US_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted" htmlFor="reseed-country">
              Reseed target
            </label>
            <select
              id="reseed-country"
              value={reseedCountry}
              onChange={(e) => setReseedCountry(e.target.value)}
              className="rounded-lg border border-card-border bg-background px-2 py-2 text-sm"
            >
              {RESEED_COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              id="reseed-era"
              aria-label="Reseed era"
              value={reseedEra}
              onChange={(e) => setReseedEra(e.target.value)}
              className="rounded-lg border border-card-border bg-background px-2 py-2 text-sm"
            >
              {RESEED_ERAS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleReseedDemographics}
            disabled={reseedLoading}
            className="rounded-lg border border-green-500/50 bg-green-500/10 px-4 py-2 text-sm font-medium text-green-400 hover:bg-green-500/20 disabled:opacity-50 transition-colors"
            title="Re-derive demographics and region leans for the selected country and era. Snapshots before writing."
          >
            {reseedLoading ? "Reseeding..." : `Reseed ${reseedCountry} ${reseedEra}`}
          </button>
          {reseedMessage && (
            <span
              className={`text-sm ${reseedMessage.startsWith("✓") ? "text-green-400" : "text-red-400"}`}
            >
              {reseedMessage}
            </span>
          )}
        </div>

        {loading && (
          <div className="min-h-72">
            <div className="mb-6 rounded-lg border border-card-border p-4">
              <Skeleton className="mb-3 h-5 w-40" />
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="space-y-1">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-7 w-full" />
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-card-border p-3"
                >
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Show message if no categories are loaded */}
        {!loading && categories.length === 0 && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 text-yellow-400">
            <p className="font-medium">No demographic categories found.</p>
            <p className="mt-1 text-sm text-muted">
              Please run the seed script to populate demographic data:{" "}
              <code className="bg-background px-1 rounded">npm run seed</code>
            </p>
          </div>
        )}

        {selectedState && editWeights && editGroups && !loading && categories.length > 0 && (
          <>
            {/* Category Weights */}
            <div className="mb-6 rounded-lg border border-primary/30 bg-primary/10 p-4">
              <h3 className="mb-3 font-medium flex items-center justify-between">
                <span>Category Weights</span>
                <span className={weightsSum === 100 ? "text-green-400" : "text-red-400"}>
                  Sum: {weightsSum}/100
                </span>
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                {categories.map((cat) => (
                  <div key={cat._id}>
                    <label className="block text-xs text-muted mb-1">{cat.name}</label>
                    <div className="w-full rounded-lg border border-card-border bg-background px-2 py-1 text-sm text-center tabular-nums">
                      {editWeights[cat._id] ?? 0}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Demographics by Category */}
            <div className="mb-6 space-y-3">
              {categories.map((cat) => {
                const isExpanded = expandedCategories.has(cat._id);
                const popSum = categoryPopulationSums[cat._id] || 0;
                return (
                  <div key={cat._id} className="rounded-lg border border-card-border">
                    <button
                      onClick={() => toggleCategory(cat._id)}
                      className="w-full flex items-center justify-between p-3 hover:bg-background/50 transition-colors"
                    >
                      <span className="font-medium">{cat.name}</span>
                      <div className="flex items-center gap-4">
                        <span
                          className={
                            popSum === 100 ? "text-green-400 text-sm" : "text-red-400 text-sm"
                          }
                        >
                          Pop: {popSum}%
                        </span>
                        <span className="text-muted">{isExpanded ? "▼" : "▶"}</span>
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-card-border p-3">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs text-muted">
                              <th className="pb-2 w-1/4">Group</th>
                              <th className="pb-2 text-center w-1/4">Population %</th>
                              <th className="pb-2 text-center w-1/4">Economic Lean</th>
                              <th className="pb-2 text-center w-1/4">Social Lean</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cat.groups.map((g) => (
                              <tr key={g.id}>
                                <td className="py-2">{g.name}</td>
                                <td className="py-2 text-center tabular-nums">
                                  {editGroups[g.id]?.population ?? 0}
                                </td>
                                <td className="py-2 text-center tabular-nums">
                                  {editGroups[g.id]?.economicLean ?? 0}
                                </td>
                                <td className="py-2 text-center tabular-nums">
                                  {editGroups[g.id]?.socialLean ?? 0}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Calculated Preview */}
            {previewLean && (
              <div className="mb-6 rounded-lg bg-background p-4">
                <h3 className="mb-3 font-medium">Calculated State Lean</h3>
                <div className="flex gap-8">
                  <div>
                    <span className="text-sm text-muted">Economic: </span>
                    <span
                      className={
                        previewLean.economic < 0
                          ? "text-blue-400 font-medium"
                          : previewLean.economic > 0
                            ? "text-red-400 font-medium"
                            : "text-purple-400 font-medium"
                      }
                    >
                      {previewLean.economic >= 0 ? "+" : ""}
                      {previewLean.economic.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-sm text-muted">Social: </span>
                    <span
                      className={
                        previewLean.social < 0
                          ? "text-blue-400 font-medium"
                          : previewLean.social > 0
                            ? "text-red-400 font-medium"
                            : "text-purple-400 font-medium"
                      }
                    >
                      {previewLean.social >= 0 ? "+" : ""}
                      {previewLean.social.toFixed(2)}
                    </span>
                  </div>
                </div>
                {/* Visual lean bars */}
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 flex justify-between text-xs text-muted">
                      <span>Economic Left</span>
                      <span>Economic Right</span>
                    </div>
                    <div className="relative h-3 rounded-full bg-gradient-to-r from-blue-600 via-purple-500 to-red-600">
                      <div
                        className="absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-2 border-foreground bg-foreground shadow-lg"
                        style={{
                          left: `${((previewLean.economic + 5) / 10) * 100}%`,
                          transform: "translate(-50%, -50%)",
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-xs text-muted">
                      <span>Social Left</span>
                      <span>Social Right</span>
                    </div>
                    <div className="relative h-3 rounded-full bg-gradient-to-r from-blue-600 via-purple-500 to-red-600">
                      <div
                        className="absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-2 border-foreground bg-foreground shadow-lg"
                        style={{
                          left: `${((previewLean.social + 5) / 10) * 100}%`,
                          transform: "translate(-50%, -50%)",
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Read-only notice. Hand-editing these was removed, see the
                module comment above. */}
            <div className="rounded-lg border border-card-border bg-background p-3 text-sm text-muted">
              These values are derived from the seeds and the Layer-1 census. Use Reseed
              Demographics above to change them.
            </div>
          </>
        )}

        {/* Message */}
        {message && (
          <div className={`mt-4 rounded-lg p-3 text-sm ${getMessageStyle(message)}`}>{message}</div>
        )}

        {/* Overwrite Defaults — Danger Zone accordion */}
        {categories.length > 0 && (
          <details className="group mt-6 border-t border-card-border pt-4">
            <summary className="cursor-pointer list-none flex items-center gap-2 text-xs font-medium text-muted hover:text-foreground py-1 select-none">
              <svg
                className="h-3 w-3 transition-transform group-open:rotate-90"
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
              Danger Zone
            </summary>
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 p-4">
              <p className="text-sm font-medium text-red-400 mb-1">
                Overwrite Default Demographics
              </p>
              <p className="text-sm text-muted mb-4">
                Save current demographics as the new defaults. When the game is reset, demographics
                will revert to these values.
              </p>

              {!showOverwriteConfirm ? (
                <button
                  onClick={() => dispatch({ type: "SET_OVERWRITE_CONFIRM", payload: true })}
                  className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-700"
                >
                  Overwrite Default Demographics
                </button>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg border border-orange-500/30 bg-orange-500/20 p-4">
                    <p className="mb-3 text-sm font-medium text-orange-300">
                      This will save all current state demographics as the new defaults. These
                      values will be used when the game is reset.
                    </p>
                    <div className="mb-3">
                      <label className="mb-1 block text-sm text-muted">
                        Type <span className="font-mono font-bold text-orange-400">OVERWRITE</span>{" "}
                        to confirm:
                      </label>
                      <input
                        type="text"
                        value={overwriteConfirmText}
                        onChange={(e) =>
                          dispatch({ type: "SET_OVERWRITE_CONFIRM_TEXT", payload: e.target.value })
                        }
                        className="w-48 rounded-lg border border-card-border bg-background px-3 py-2 text-sm font-mono"
                        placeholder="OVERWRITE"
                        disabled={overwriteLoading}
                      />
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={handleOverwriteDefaults}
                        disabled={overwriteLoading || overwriteConfirmText !== "OVERWRITE"}
                        className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-700 disabled:opacity-50"
                      >
                        {overwriteLoading ? "Saving..." : "Confirm Overwrite"}
                      </button>
                      <button
                        onClick={() => dispatch({ type: "CLOSE_OVERWRITE" })}
                        disabled={overwriteLoading}
                        className="rounded-lg border border-card-border px-4 py-2 text-sm font-medium transition-colors hover:bg-background disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {overwriteMessage && (
                <div className={`mt-4 rounded-lg p-3 text-sm ${getMessageStyle(overwriteMessage)}`}>
                  {overwriteMessage}
                </div>
              )}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
