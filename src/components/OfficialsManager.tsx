"use client";

import { useEffect, useCallback } from "react";
import { useOfficialsState } from "./officials/useOfficialsState";
import { getMessageStyle } from "@/lib/utils/formatters";
import { US_STATES } from "@/lib/constants";
import { OfficialsFilters } from "./officials/OfficialsFilters";
import { OfficialsList } from "./officials/OfficialsList";

interface ElectedOfficial {
  _id: string;
  officeType: string;
  state?: string;
  senateClass?: number;
  district?: number;
  seatsHeld?: number;
  characterId: string | null;
  characterName?: string;
  party?: string;
}

export function OfficialsManager() {
  const [state, dispatch] = useOfficialsState();

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/officials/init");
      if (res.ok) {
        const data = await res.json();
        dispatch({ type: "SET_STATUS", payload: data });
      }
    } catch (error) {
      console.error("Failed to fetch officials status:", error);
    }
  }, [dispatch]);

  const fetchCharacters = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/officials/appoint");
      if (res.ok) {
        const data = await res.json();
        dispatch({ type: "SET_CHARACTERS", payload: data.characters || [] });
      }
    } catch (error) {
      console.error("Failed to fetch characters:", error);
    }
  }, [dispatch]);

  useEffect(() => {
    fetchStatus();
    fetchCharacters();
  }, [fetchStatus, fetchCharacters]);

  const fetchOfficials = async () => {
    dispatch({ type: "SET_LOADING", payload: true });
    try {
      const params = new URLSearchParams();
      if (state.selectedState) params.append("state", state.selectedState);
      if (state.selectedOfficeType) params.append("officeType", state.selectedOfficeType);
      if (state.showOnlyVacant) params.append("vacant", "true");

      const res = await fetch(`/api/admin/officials/list?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        dispatch({ type: "SET_OFFICIALS", payload: data.officials || [] });
      }
    } catch (error) {
      console.error("Failed to fetch officials:", error);
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  };

  const handleInitialize = async (type?: "senate" | "house" | "executive") => {
    const confirmMsg =
      type === "senate"
        ? "This will create all Senate positions (100 seats). Continue?"
        : type === "house"
          ? "This will create all House positions (435 seats). Continue?"
          : type === "executive"
            ? "Create President and Vice President slots?"
            : "This will create all Senate (100) and House (435) positions. Continue?";

    if (!confirm(confirmMsg)) {
      return;
    }

    dispatch({ type: "SET_LOADING", payload: true });
    dispatch({ type: "SET_MESSAGE", payload: "" });
    try {
      const url = type ? `/api/admin/officials/init?type=${type}` : "/api/admin/officials/init";
      const res = await fetch(url, { method: "POST" });
      const data = await res.json();

      if (res.ok) {
        dispatch({ type: "SET_MESSAGE", payload: `✓ ${data.message}` });
        await fetchStatus();
      } else {
        dispatch({
          type: "SET_MESSAGE",
          payload: `✗ ${data.error || `Failed to initialize ${type ?? "all"} positions`}`,
        });
      }
    } catch {
      dispatch({ type: "SET_MESSAGE", payload: "✗ Network error" });
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  };

  const handleResetOfficials = async () => {
    if (
      !confirm(
        "Reset ALL elected officials?\n\nThis will:\n" +
          "• Delete every elected official (Senate, House, Governor, State Senate)\n" +
          "• Clear currentOffice on all characters and NPPs\n\n" +
          "Elections and other game data are NOT affected. You can re-initialize positions afterward.\n\nContinue?"
      )
    ) {
      return;
    }

    dispatch({ type: "SET_LOADING", payload: true });
    dispatch({ type: "SET_MESSAGE", payload: "" });
    try {
      const res = await fetch("/api/admin/officials/reset", { method: "POST" });
      const data = await res.json();

      if (res.ok) {
        dispatch({ type: "SET_MESSAGE", payload: `✓ ${data.message}` });
        await fetchStatus();
        await fetchOfficials();
        await fetchCharacters();
      } else {
        dispatch({
          type: "SET_MESSAGE",
          payload: `✗ ${data.error || "Failed to reset officials"}`,
        });
      }
    } catch {
      dispatch({ type: "SET_MESSAGE", payload: "✗ Network error" });
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  };

  const handleAppoint = async () => {
    if (!state.appointingOfficial) return;

    dispatch({ type: "SET_LOADING", payload: true });
    dispatch({ type: "SET_MESSAGE", payload: "" });
    try {
      const res = await fetch("/api/admin/officials/appoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          officialId: state.appointingOfficial._id,
          characterId: state.selectedCharacterId || null,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        dispatch({ type: "SET_MESSAGE", payload: `✓ ${data.message}` });
        dispatch({ type: "CLOSE_APPOINTMENT_MODAL" });
        dispatch({ type: "SET_SELECTED_CHARACTER", id: "" });
        await fetchStatus();
        await fetchOfficials();
        await fetchCharacters();
      } else {
        dispatch({ type: "SET_MESSAGE", payload: `✗ ${data.error || "Failed to appoint"}` });
      }
    } catch {
      dispatch({ type: "SET_MESSAGE", payload: "✗ Network error" });
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  };

  const handleCreateHouseRep = async () => {
    if (!state.houseState || !state.houseCharacterId || state.houseSeats < 1) {
      dispatch({ type: "SET_MESSAGE", payload: "✗ Please fill all fields" });
      return;
    }

    dispatch({ type: "SET_LOADING", payload: true });
    dispatch({ type: "SET_MESSAGE", payload: "" });
    try {
      const res = await fetch("/api/admin/officials/appoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          officeType: "house",
          state: state.houseState,
          seatsHeld: state.houseSeats,
          characterId: state.houseCharacterId,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        dispatch({ type: "SET_MESSAGE", payload: `✓ ${data.message}` });
        dispatch({ type: "CLOSE_HOUSE_FORM" });
        dispatch({ type: "SET_HOUSE_STATE", state: "" });
        dispatch({ type: "SET_HOUSE_SEATS", seats: 1 });
        dispatch({ type: "SET_HOUSE_CHARACTER", id: "" });
        await fetchStatus();
        await fetchOfficials();
        await fetchCharacters();
      } else {
        dispatch({
          type: "SET_MESSAGE",
          payload: `✗ ${data.error || "Failed to create house representative"}`,
        });
      }
    } catch {
      dispatch({ type: "SET_MESSAGE", payload: "✗ Network error" });
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  };

  const handleDuplicateCleanup = async () => {
    if (!confirm("This will remove duplicate ElectedOfficial records from the database. Continue?"))
      return;
    dispatch({ type: "SET_LOADING", payload: true });
    dispatch({ type: "SET_CLEANUP_RESULT", result: null });
    try {
      const res = await fetch("/api/admin/officials/cleanup", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        dispatch({
          type: "SET_CLEANUP_RESULT",
          result: {
            ok: true,
            message: data.message,
            details: {
              vacantRowsDeleted: data.vacantRowsDeleted,
              duplicatesRemoved: data.duplicatesRemoved,
              orphanedOfficesCleared: data.orphanedOfficesCleared,
            },
          },
        });
      } else {
        dispatch({
          type: "SET_CLEANUP_RESULT",
          result: { ok: false, message: data.error ?? "Unknown error" },
        });
      }
    } catch {
      dispatch({ type: "SET_CLEANUP_RESULT", result: { ok: false, message: "Network error" } });
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  };

  const getOfficialLabel = (official: ElectedOfficial) => {
    let label = official.officeType.charAt(0).toUpperCase() + official.officeType.slice(1);
    if (official.state) label += ` - ${official.state}`;
    if (official.senateClass) label += ` (Class ${official.senateClass})`;
    if (official.district) label += ` District ${official.district}`;
    if (official.seatsHeld)
      label += ` (${official.seatsHeld} seat${official.seatsHeld > 1 ? "s" : ""})`;
    return label;
  };

  const positionsNotFullyInitialized =
    !state.status?.initialized ||
    !state.status?.byOfficeType?.senate ||
    !state.status?.byOfficeType?.house ||
    !state.status?.byOfficeType?.president ||
    !state.status?.byOfficeType?.vicePresident;

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      {/* Zone 1 — Compact status bar */}
      {state.status && (
        <div className="mb-6 flex flex-wrap gap-6 border-b border-card-border pb-4">
          <div>
            <div className="text-xs text-muted">Total</div>
            <div className="text-sm font-semibold text-foreground">
              {state.status.summary.total}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">Filled</div>
            <div className="text-sm font-semibold text-green-400">
              {state.status.summary.filled}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">Vacant</div>
            <div className="text-sm font-semibold text-yellow-400">
              {state.status.summary.vacant}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">Status</div>
            <div
              className={`text-sm font-semibold ${state.status.initialized ? "text-green-400" : "text-red-400"}`}
            >
              {state.status.initialized ? "Initialized" : "Not initialized"}
            </div>
          </div>
        </div>
      )}

      {/* Zone 2 — Setup banner */}
      {positionsNotFullyInitialized && (
        <div className="mb-6 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
          <div className="mb-3 flex items-center gap-2">
            <svg
              className="h-4 w-4 shrink-0 text-yellow-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
            <span className="text-sm font-medium text-yellow-400">
              Office positions not fully initialized
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {!state.status?.initialized && (
              <button
                onClick={() => handleInitialize()}
                disabled={state.loading}
                className="rounded border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
              >
                Initialize All
              </button>
            )}
            {!state.status?.byOfficeType?.senate && (
              <button
                onClick={() => handleInitialize("senate")}
                disabled={state.loading}
                className="rounded border border-card-border px-3 py-1.5 text-sm font-medium hover:bg-background disabled:opacity-50"
              >
                Senate Only
              </button>
            )}
            {!state.status?.byOfficeType?.house && (
              <button
                onClick={() => handleInitialize("house")}
                disabled={state.loading}
                className="rounded border border-card-border px-3 py-1.5 text-sm font-medium hover:bg-background disabled:opacity-50"
              >
                House Only
              </button>
            )}
            {(!state.status?.byOfficeType?.president ||
              !state.status?.byOfficeType?.vicePresident) && (
              <button
                onClick={() => handleInitialize("executive")}
                disabled={state.loading}
                className="rounded border border-card-border px-3 py-1.5 text-sm font-medium hover:bg-background disabled:opacity-50"
              >
                President & VP
              </button>
            )}
          </div>
        </div>
      )}

      {/* Zone 3 — Filters + table */}
      {state.status?.initialized && (
        <>
          <OfficialsFilters
            selectedState={state.selectedState}
            onStateChange={(value) => dispatch({ type: "SET_FILTER", filter: "state", value })}
            selectedOfficeType={state.selectedOfficeType}
            onOfficeTypeChange={(value) =>
              dispatch({ type: "SET_FILTER", filter: "officeType", value })
            }
            showOnlyVacant={state.showOnlyVacant}
            onShowOnlyVacantChange={(value) =>
              dispatch({ type: "SET_FILTER", filter: "vacant", value })
            }
            loading={state.loading}
            onSearch={fetchOfficials}
            onAddHouseRep={() => dispatch({ type: "OPEN_HOUSE_FORM" })}
          />

          {/* House Representative Form */}
          {state.showHouseForm && (
            <div className="mb-4 rounded-lg border border-card-border bg-background p-4">
              <h3 className="mb-3 text-sm font-medium">Appoint House Representative</h3>
              <div className="flex flex-wrap gap-3">
                <select
                  value={state.houseState}
                  onChange={(e) => dispatch({ type: "SET_HOUSE_STATE", state: e.target.value })}
                  className="rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
                >
                  <option value="">Select State</option>
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>

                <input
                  type="number"
                  min="1"
                  value={state.houseSeats}
                  onChange={(e) =>
                    dispatch({ type: "SET_HOUSE_SEATS", seats: parseInt(e.target.value) || 1 })
                  }
                  placeholder="Seats"
                  className="w-24 rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
                />

                <select
                  value={state.houseCharacterId}
                  onChange={(e) => dispatch({ type: "SET_HOUSE_CHARACTER", id: e.target.value })}
                  className="flex-1 rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
                >
                  <option value="">Select Character</option>
                  {state.characters
                    .filter((c) => !c.currentOffice)
                    .map((char) => (
                      <option key={char._id} value={char._id}>
                        {char.name} ({char.party}) - {char.homeState}
                      </option>
                    ))}
                </select>

                <button
                  onClick={handleCreateHouseRep}
                  disabled={state.loading}
                  className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                >
                  Appoint
                </button>
                <button
                  onClick={() => dispatch({ type: "CLOSE_HOUSE_FORM" })}
                  className="rounded-lg border border-card-border px-3 py-1.5 text-sm hover:bg-card"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <OfficialsList
            officials={state.officials}
            getOfficialLabel={getOfficialLabel}
            onAppoint={(official) => {
              dispatch({ type: "OPEN_APPOINTMENT_MODAL", official });
              dispatch({ type: "SET_SELECTED_CHARACTER", id: official.characterId || "" });
            }}
          />

          {/* Maintenance accordion */}
          <details className="group mt-2">
            <summary className="flex cursor-pointer select-none list-none items-center gap-2 py-1 text-xs font-medium text-muted hover:text-foreground">
              <svg
                className="h-3 w-3 transition-transform group-open:rotate-90"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              Maintenance
            </summary>
            <div className="mt-3 space-y-4 border-t border-card-border pt-3">
              {/* Remove Duplicate Officials */}
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="text-sm font-medium text-yellow-400">
                    Remove Duplicate Officials
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    Deletes vacant placeholder rows for House/State Senate races and clears orphaned
                    office fields on characters. Safe to run multiple times.
                  </p>
                  {state.cleanupResult && (
                    <div
                      className={`mt-2 text-xs ${state.cleanupResult.ok ? "text-green-400" : "text-red-400"}`}
                    >
                      {state.cleanupResult.message}
                      {state.cleanupResult.ok && state.cleanupResult.details && (
                        <span className="ml-2 text-muted">
                          (vacant: {state.cleanupResult.details.vacantRowsDeleted}, dupes:{" "}
                          {state.cleanupResult.details.duplicatesRemoved}, orphans:{" "}
                          {state.cleanupResult.details.orphanedOfficesCleared})
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={handleDuplicateCleanup}
                  disabled={state.loading}
                  className="shrink-0 rounded border border-yellow-500/40 bg-yellow-500/10 px-3 py-1.5 text-sm font-medium text-yellow-400 hover:bg-yellow-500/20 disabled:opacity-50"
                >
                  Run Cleanup
                </button>
              </div>

              {/* Reset All Officials */}
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="text-sm font-medium text-red-400">Reset All Officials</div>
                  <p className="mt-0.5 text-xs text-muted">
                    Deletes every elected official and clears currentOffice on all characters and
                    NPPs. Elections are unaffected. Cannot be undone.
                  </p>
                </div>
                <button
                  onClick={handleResetOfficials}
                  disabled={state.loading}
                  className="shrink-0 rounded border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                >
                  Reset All
                </button>
              </div>
            </div>
          </details>
        </>
      )}

      {/* Appointment Modal */}
      {state.appointingOfficial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-card-border bg-card p-6">
            <h3 className="mb-4 text-lg font-semibold">
              Appoint to {getOfficialLabel(state.appointingOfficial)}
            </h3>

            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium">Select Character</label>
              <select
                value={state.selectedCharacterId}
                onChange={(e) => dispatch({ type: "SET_SELECTED_CHARACTER", id: e.target.value })}
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2"
              >
                <option value="">-- Vacate Position --</option>
                {state.characters.map((char) => (
                  <option key={char._id} value={char._id}>
                    {char.name} ({char.party}) - {char.homeState}
                    {char.currentOffice && " [Has Office]"}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  dispatch({ type: "CLOSE_APPOINTMENT_MODAL" });
                  dispatch({ type: "SET_SELECTED_CHARACTER", id: "" });
                }}
                className="rounded-lg border border-card-border px-4 py-2 text-sm hover:bg-background"
              >
                Cancel
              </button>
              <button
                onClick={handleAppoint}
                disabled={state.loading}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {state.selectedCharacterId ? "Appoint" : "Vacate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Status Message */}
      {state.message && (
        <div className={`mt-4 rounded-lg p-3 text-sm ${getMessageStyle(state.message)}`}>
          {state.message}
        </div>
      )}
    </div>
  );
}
