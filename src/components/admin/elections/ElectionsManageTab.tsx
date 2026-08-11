"use client";

import { useReducer, useEffect, useCallback, useMemo, useState } from "react";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { CountryId } from "@/lib/constants/countries";
import { useRegisteredCountries } from "@/contexts/RegisteredCountriesContext";
import { getMessageStyle } from "@/lib/utils/formatters";
import {
  initialElectionsManageState,
  electionsManageReducer,
  type CountrySelection,
  type ElectionData,
} from "./electionsAdminTypes";
import { ElectionStatsCards } from "./ElectionStatsCards";
import { ElectionBreakdown } from "./ElectionBreakdown";
import { NextResolving } from "./NextResolving";
import { ElectionTimerForm } from "./ElectionTimerForm";
import { ElectionQuickActions } from "./ElectionQuickActions";
import { ElectionFilterBar } from "./ElectionFilterBar";
import { ElectionCycleTable } from "./ElectionCycleTable";
import { CountryFlag } from "@/components/CountryFlag";

const PAGE_SIZE = 24;

export function ElectionsManageTab() {
  const registered = useRegisteredCountries();
  const [state, dispatch] = useReducer(electionsManageReducer, initialElectionsManageState);
  const [nowMs] = useState(() => Date.now());
  // Country tabs derive from the runtime registered set so an activated SCO/WAL
  // gets an admin tab without a redeploy. "Global" stays pinned first.
  const COUNTRY_TABS: { id: CountrySelection; label: string }[] = useMemo(
    () => [
      { id: "global", label: "Global" },
      ...registered.map((id) => ({
        id: id as CountrySelection,
        label: COUNTRY_CONFIGS[id].name,
      })),
    ],
    [registered]
  );
  const {
    elections,
    currentTurn,
    lastTurnProcessed,
    startingYear,
    preset,
    loading,
    message,
    messageDetails,
    selectedCountry,
    filterType,
    filterState,
    timerForm,
    page,
    nextResolvingExpanded,
  } = state;

  // ─── Data fetching ──────────────────────────────────────────────────
  const fetchElections = useCallback(async () => {
    try {
      dispatch({ type: "LOAD_START" });

      if (selectedCountry === "global") {
        // Fetch from all countries in parallel
        const responses = await Promise.all(
          registered.map(async (cid) => {
            const res = await fetch(`/api/admin/country/${cid.toLowerCase()}/elections`);
            if (!res.ok)
              return {
                elections: [] as ElectionData[],
                currentTurn: null,
                lastTurnProcessed: null,
                startingYear: null,
                preset: null,
              };
            return res.json();
          })
        );
        const allElections = responses.flatMap((r) => (r.elections ?? []) as ElectionData[]);
        const first = responses[0];
        dispatch({
          type: "LOAD_SUCCESS",
          elections: allElections,
          currentTurn: first?.currentTurn ?? null,
          lastTurnProcessed: first?.lastTurnProcessed ?? null,
          startingYear: first?.startingYear ?? null,
          preset: first?.preset ?? null,
        });
      } else {
        const params = new URLSearchParams();
        if (filterState) params.set("state", filterState);
        const res = await fetch(
          `/api/admin/country/${selectedCountry.toLowerCase()}/elections?${params.toString()}`
        );
        const data = await res.json();
        if (res.ok) {
          dispatch({
            type: "LOAD_SUCCESS",
            elections: data.elections || [],
            currentTurn: data.currentTurn ?? null,
            lastTurnProcessed: data.lastTurnProcessed ?? null,
            startingYear: data.startingYear ?? null,
            preset: data.preset ?? null,
          });
        } else {
          dispatch({ type: "LOAD_END" });
        }
      }
    } catch (error) {
      console.error("Failed to fetch elections:", error);
      dispatch({ type: "LOAD_END" });
    }
  }, [selectedCountry, filterState, registered]);

  useEffect(() => {
    fetchElections();
  }, [fetchElections]);

  // ─── Timer update with multi-country support ────────────────────────
  const handleTimerUpdate = async () => {
    if (timerForm.primaryHours === "" && timerForm.generalHours === "") {
      dispatch({ type: "SET_MESSAGE", payload: "✗ Please enter primary and/or general hours" });
      return;
    }
    const filterDesc = [
      timerForm.electionType || "all types",
      selectedCountry === "global" ? "all countries" : COUNTRY_CONFIGS[selectedCountry]?.name,
      timerForm.state || "all regions",
      timerForm.senateClass ? `class ${timerForm.senateClass}` : "",
      timerForm.chamberClass ? `chamber class ${timerForm.chamberClass}` : "",
    ]
      .filter(Boolean)
      .join(", ");

    const actionLabel =
      timerForm.action === "set" ? "Set" : timerForm.action === "add" ? "Add to" : "Subtract from";
    if (!confirm(`${actionLabel} timers for ${filterDesc}?`)) return;

    dispatch({ type: "LOAD_START" });
    dispatch({ type: "SET_MESSAGE", payload: "" });

    try {
      const body: Record<string, unknown> = { action: timerForm.action };
      if (timerForm.electionType) body.electionType = timerForm.electionType;
      if (timerForm.state) body.state = timerForm.state;
      if (timerForm.senateClass) body.senateClass = parseInt(timerForm.senateClass);
      if (timerForm.chamberClass) body.chamberClass = parseInt(timerForm.chamberClass);
      if (timerForm.primaryHours !== "") body.primaryHours = timerForm.primaryHours;
      if (timerForm.generalHours !== "") body.generalHours = timerForm.generalHours;

      const countries =
        selectedCountry === "global" ? [...registered] : [selectedCountry as CountryId];

      const results: string[] = [];
      let totalUpdated = 0;

      for (const cid of countries) {
        const res = await fetch(`/api/admin/country/${cid.toLowerCase()}/elections`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (res.ok) {
          totalUpdated += data.updatedCount ?? 0;
          results.push(`${cid}: ${data.updatedCount} updated`);
        } else {
          results.push(`${cid}: ${data.error ?? "failed"}`);
        }
      }

      const summary =
        countries.length > 1
          ? `✓ Updated ${totalUpdated} election(s) across ${countries.length} countries`
          : `✓ Updated ${totalUpdated} election(s)`;
      dispatch({
        type: "SET_MESSAGE",
        payload: summary,
        details: countries.length > 1 ? results : [],
      });
      await fetchElections();
    } catch {
      dispatch({ type: "SET_MESSAGE", payload: "✗ Network error" });
      dispatch({ type: "LOAD_END" });
    }
  };

  // ─── Action handlers ───────────────────────────────────────────────
  const countryUrlBase = (fallback: string = "us") => {
    if (selectedCountry === "global") return `/api/admin/country/${fallback}/elections`;
    return `/api/admin/country/${selectedCountry.toLowerCase()}/elections`;
  };

  const handleAction = async (url: string, method: string, confirmMsg: string) => {
    if (!confirm(confirmMsg)) return;
    dispatch({ type: "LOAD_START" });
    dispatch({ type: "SET_MESSAGE", payload: "" });
    try {
      const res = await fetch(url, { method });
      const data = await res.json();
      dispatch({
        type: "SET_MESSAGE",
        payload: res.ok ? `✓ ${data.message}` : `✗ ${data.error}`,
      });
      if (res.ok) await fetchElections();
      else dispatch({ type: "LOAD_END" });
    } catch {
      dispatch({ type: "SET_MESSAGE", payload: "✗ Network error" });
      dispatch({ type: "LOAD_END" });
    }
  };

  const handleRecalibrateTimers = () =>
    handleAction(
      "/api/admin/elections/recalibrate-timers",
      "POST",
      "Recalibrate all election timers to the canonical LARP schedule?\n\nThis resets each election's endTime/primaryEndTime based on its type, senate class, and cycle number relative to the current game turn."
    );

  const handleSnapTimers = () =>
    handleAction(
      "/api/admin/elections/snap-timers",
      "POST",
      "Snap all active election timers to the nearest turn-fire boundary?"
    );

  const handleFillNPPs = () =>
    handleAction(
      "/api/admin/elections/fill-npps",
      "POST",
      "Run NPP election entry pass? Idle NPPs will consider joining unopposed or vacant races."
    );

  const handleTriggerPrimaries = () =>
    handleAction(
      `${countryUrlBase()}/trigger-primaries`,
      "POST",
      "End all active primaries NOW and advance them to the general election phase?"
    );

  const handleResolvePrimaries = () =>
    handleAction(
      "/api/admin/elections/resolve-primaries",
      "POST",
      "DESTRUCTIVE: Remove primary losers from all elections whose primary has already closed?\n\nWithdraws all but the top-scoring candidate per party. Cannot be undone."
    );

  const handleDeleteCycle = async (cycle: number) => {
    if (
      !confirm(
        `Delete ALL elections for cycle ${cycle}? This will also remove all candidate entries.`
      )
    )
      return;
    dispatch({ type: "LOAD_START" });
    dispatch({ type: "SET_MESSAGE", payload: "" });
    try {
      const res = await fetch(`${countryUrlBase()}?cycle=${cycle}`, { method: "DELETE" });
      const data = await res.json();
      dispatch({
        type: "SET_MESSAGE",
        payload: res.ok ? `✓ ${data.message}` : `✗ ${data.error}`,
      });
      if (res.ok) await fetchElections();
      else dispatch({ type: "LOAD_END" });
    } catch {
      dispatch({ type: "SET_MESSAGE", payload: "✗ Network error" });
      dispatch({ type: "LOAD_END" });
    }
  };

  // ─── Filtering and pagination ───────────────────────────────────────
  const filtered = useMemo(() => {
    return elections.filter((e) => {
      if (filterType && e.electionType !== filterType) return false;
      if (filterState && e.state !== filterState) return false;
      return true;
    });
  }, [elections, filterType, filterState]);

  // Paginate the flat list first, then group by cycle
  const totalElections = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalElections / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const paginatedElections = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  const paginatedCycles = useMemo(() => {
    const uniqueCycles = [...new Set(paginatedElections.map((e) => e.cycle))].sort((a, b) => b - a);
    return uniqueCycles.map((c) => ({
      cycle: c,
      elections: paginatedElections.filter((e) => e.cycle === c),
    }));
  }, [paginatedElections]);

  // ─── Render ─────────────────────────────────────────────────────────
  return (
    <div>
      {/* Country pills */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {COUNTRY_TABS.map((tab, i) => (
          <span key={tab.id} className="contents">
            {i === 1 && <span className="mx-0.5 h-5 border-l border-card-border" />}
            <button
              onClick={() => dispatch({ type: "SET_SELECTED_COUNTRY", value: tab.id })}
              className={`rounded-lg border px-3 py-1.5 text-[11px] transition-colors ${
                selectedCountry === tab.id
                  ? "border-primary/50 bg-primary/20 text-primary"
                  : "border-card-border text-muted hover:border-card-border/80 hover:text-foreground"
              }`}
            >
              {tab.id !== "global" && <CountryFlag country={tab.id} size="sm" className="mr-1" />}
              {tab.label}
            </button>
          </span>
        ))}
        <span className="ml-auto text-[11px] text-muted">
          {currentTurn !== null && `Turn ${currentTurn}`}
        </span>
      </div>

      {/* Stats cards */}
      <ElectionStatsCards elections={elections} currentTurn={currentTurn} />

      {/* Two-column: Breakdown + Next Resolving */}
      <div className="mb-3 grid gap-2 md:grid-cols-2 md:gap-3">
        <ElectionBreakdown
          elections={elections}
          selectedCountry={selectedCountry}
          currentTurn={currentTurn}
        />
        <NextResolving
          elections={elections}
          selectedCountry={selectedCountry}
          expanded={nextResolvingExpanded}
          nowMs={nowMs}
          currentTurn={currentTurn}
          onToggle={() => dispatch({ type: "TOGGLE_NEXT_RESOLVING" })}
        />
      </div>

      {/* Modify Timers */}
      <ElectionTimerForm
        timerForm={timerForm}
        selectedCountry={selectedCountry}
        loading={loading}
        dispatch={dispatch}
        onApply={handleTimerUpdate}
      />

      {/* Quick Actions */}
      <ElectionQuickActions
        loading={loading}
        onRecalibrate={handleRecalibrateTimers}
        onSnap={handleSnapTimers}
        onTriggerPrimaries={handleTriggerPrimaries}
        onResolvePrimaries={handleResolvePrimaries}
        onFillNPPs={handleFillNPPs}
      />

      {/* Filter + Election List */}
      <div className="rounded-lg border border-card-border bg-card p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
            Election List
          </span>
          <ElectionFilterBar
            filterCountry={
              selectedCountry === "global" ? "" : (selectedCountry as "US" | "UK" | "DE" | "JP")
            }
            filterType={filterType}
            filterState={filterState}
            loading={loading}
            dispatch={dispatch}
            onRefresh={fetchElections}
          />
        </div>

        <ElectionCycleTable
          byCycle={paginatedCycles}
          currentTurn={currentTurn}
          lastTurnProcessed={lastTurnProcessed}
          startingYear={startingYear}
          preset={preset}
          loading={loading}
          onDeleteCycle={handleDeleteCycle}
        />

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-3 flex items-center justify-center gap-2 text-xs">
            <button
              onClick={() => dispatch({ type: "SET_PAGE", value: currentPage - 1 })}
              disabled={currentPage <= 1}
              className="rounded border border-card-border px-2 py-1 disabled:opacity-30"
            >
              ← Prev
            </button>
            <span className="tabular-nums text-muted">
              Page {currentPage} of {totalPages} ({totalElections} elections)
            </span>
            <button
              onClick={() => dispatch({ type: "SET_PAGE", value: currentPage + 1 })}
              disabled={currentPage >= totalPages}
              className="rounded border border-card-border px-2 py-1 disabled:opacity-30"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Feedback message */}
      {message && (
        <div className={`mt-3 rounded-lg p-3 text-sm ${getMessageStyle(message)}`}>
          {message}
          {messageDetails.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-muted">Per-country details</summary>
              <ul className="mt-1 text-xs text-muted">
                {messageDetails.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
