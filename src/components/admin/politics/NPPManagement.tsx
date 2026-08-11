"use client";

import { useState, useEffect, useCallback } from "react";
import { Avatar } from "@/components/Avatar";
import { getMessageStyle } from "@/lib/utils/formatters";
import { US_STATES } from "@/lib/constants";
import { UK_REGIONS } from "@/lib/constants/uk";
import { JP_REGIONS } from "@/lib/constants/japan";
import { deRegions } from "@/lib/seeds/de/deRegions";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { useRegisteredCountries } from "@/contexts/RegisteredCountriesContext";
import { NppEconomyPanel } from "@/components/admin/politics/NppEconomyPanel";
import { partiesApiUrl } from "@/lib/urls";

const UK_REGION_IDS = UK_REGIONS.map((r) => r.id);
const JP_REGION_IDS = JP_REGIONS.map((r) => r.id);
const DE_LAND_IDS = deRegions.map((r) => r._id);

type CountryScope = CountryId | "all";

interface PartyInfo {
  id: string;
  countryId: CountryId;
  name: string;
  color: string;
  isDefault: boolean;
}

/** Create a unique key for a party that includes country */
function partyKey(party: PartyInfo): string {
  return `${party.countryId}:${party.id}`;
}

export function NPPManagement() {
  const registered = useRegisteredCountries();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [countryScope, setCountryScope] = useState<CountryScope>("all");
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [selectedParties, setSelectedParties] = useState<string[]>([]);
  const [parties, setParties] = useState<PartyInfo[]>([]);
  const [stats, setStats] = useState<{
    totalNPPs: number;
    nppCandidates: number;
    nppsByParty: { party: string; count: number }[];
    nppsByPartyGrouped?: Record<
      string,
      { partyId: string; partyName: string; color: string; count: number }[]
    >;
    recentNPPs?: {
      _id: string;
      name: string;
      homeState: string;
      party: string;
      politicalInfluence: number;
      avatarUrl?: string;
    }[];
  } | null>(null);

  const [spawnCount, setSpawnCount] = useState(10);
  const [spawnParty, setSpawnParty] = useState("");
  const [spawnMode, setSpawnMode] = useState<"lean" | "members" | "both">("both");
  const [spawnResult, setSpawnResult] = useState<{
    topStates: { state: string; count: number }[];
  } | null>(null);
  const [showStateSelector, setShowStateSelector] = useState(false);
  const [nppAutonomyEnabled, setNppAutonomyEnabled] = useState<boolean | null>(null);
  const [togglingNppAutonomy, setTogglingNppAutonomy] = useState(false);

  const fetchParties = useCallback(async () => {
    try {
      // Fetch all countries when "all" selected; countries without data return empty arrays
      const countriesToFetch: CountryId[] =
        countryScope === "all" ? [...registered] : [countryScope as CountryId];
      const urls = countriesToFetch.map((c) => partiesApiUrl(c));
      const results = await Promise.all(urls.map((u) => fetch(u)));
      const allParties: PartyInfo[] = [];
      for (const res of results) {
        if (res.ok) {
          const data = await res.json();
          const mapped =
            data.parties
              ?.filter(
                (p: { id: string; countryId: string }) => p.id !== "independent" && p.countryId
              )
              .map(
                (p: {
                  id: string;
                  countryId: CountryId;
                  name: string;
                  color: string;
                  isDefault: boolean;
                }) => ({
                  id: p.id,
                  countryId: p.countryId,
                  name: p.name,
                  color: p.color,
                  isDefault: p.isDefault,
                })
              ) ?? [];
          allParties.push(...mapped);
        }
      }
      setParties(allParties);
    } catch (error) {
      console.error("Failed to fetch parties:", error);
    }
  }, [countryScope, registered]);

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/admin/npps");
      if (res.ok) setStats(await res.json());
    } catch (error) {
      console.error("Failed to fetch NPP stats:", error);
    }
  };

  const fetchNppAutonomy = async () => {
    try {
      const res = await fetch("/api/admin/npp-autonomy/toggle");
      if (res.ok) {
        const data = await res.json();
        setNppAutonomyEnabled(data.nppAutonomyEnabled === true);
      }
    } catch (error) {
      console.error("Failed to fetch NPP autonomy state:", error);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchParties();
    fetchNppAutonomy();
  }, [fetchParties]);

  const handleToggleNppAutonomy = async () => {
    const next = !nppAutonomyEnabled;
    if (
      !confirm(
        `${next ? "Enable" : "Disable"} NPP autonomy?\n\n` +
          "When on, NPPs in disabled or econ-only countries form governments, pass laws, " +
          "and run the central bank autonomously. Has no effect in player-enabled countries."
      )
    )
      return;
    setTogglingNppAutonomy(true);
    try {
      const res = await fetch("/api/admin/npp-autonomy/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json();
      if (res.ok) {
        setNppAutonomyEnabled(data.nppAutonomyEnabled === true);
        setMessage(data.nppAutonomyEnabled ? "✓ NPP autonomy enabled" : "✓ NPP autonomy disabled");
      } else {
        setMessage(`✗ ${data.error ?? "Failed to toggle NPP autonomy"}`);
      }
    } catch {
      setMessage("✗ Failed to toggle NPP autonomy");
    } finally {
      setTogglingNppAutonomy(false);
    }
  };

  const post = async (body: Record<string, unknown>) => {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/npps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(`✓ ${data.message}`);
        await fetchStats();
      } else setMessage(`✗ ${data.error}`);
      return { ok: res.ok, data };
    } catch {
      setMessage("✗ Network error");
      return { ok: false, data: {} };
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateNPPs = async () => {
    const stateDesc = selectedStates.length > 0 ? selectedStates.join(", ") : "all states";
    if (!confirm(`Generate NPP candidates for ${stateDesc}?`)) return;
    if (selectedParties.length === 0) {
      setMessage("✗ Select at least one party.");
      return;
    }
    // selectedParties are in format "US:1", "UK:2", etc.
    // Extract party IDs grouped by country for the API
    const partyData = selectedParties.map((key) => {
      const [countryId, partyId] = key.split(":");
      return { countryId, partyId };
    });
    await post({
      action: "generate",
      states: selectedStates.length > 0 ? selectedStates : undefined,
      partyData,
    });
  };

  const handleSpawnNPPs = async () => {
    if (!spawnParty) {
      setMessage("✗ Select a party first.");
      return;
    }
    // spawnParty is in format "US:1" or "UK:2", extract the party ID
    const [countryId, partyId] = spawnParty.split(":");
    const partyInfo = parties.find((p) => partyKey(p) === spawnParty);
    if (
      !confirm(
        `Spawn ${spawnCount} NPPs for ${partyInfo?.name ?? spawnParty} (${countryId}) using "${spawnMode}" weighting?`
      )
    )
      return;
    setSpawnResult(null);
    const { ok, data } = await post({
      action: "spawn",
      count: spawnCount,
      party: partyId,
      countryId,
      preferMode: spawnMode,
    });
    if (ok) setSpawnResult({ topStates: data.topStates ?? [] });
  };

  const handleRemoveNPPs = async () => {
    const stateDesc = selectedStates.length > 0 ? selectedStates.join(", ") : "all states";
    if (!confirm(`Remove all NPP candidates from elections in ${stateDesc}?`)) return;
    await post({
      action: "remove",
      states: selectedStates.length > 0 ? selectedStates : undefined,
    });
  };

  const handleDeleteAllNPPs = async (
    mode: "candidates_only" | "retire_all" | "vacate_seats" | "independents_only"
  ) => {
    const stateDesc = selectedStates.length > 0 ? selectedStates.join(", ") : "all states";
    const actionDesc =
      mode === "candidates_only"
        ? `remove NPP candidates from elections in ${stateDesc}`
        : mode === "vacate_seats"
          ? `remove retired NPPs from elected positions in ${stateDesc}`
          : mode === "independents_only"
            ? `retire all Independent NPPs (those not in parties), remove them from elections, and recalculate affected elections in ${stateDesc}`
            : `retire all NPPs, remove them from elections, and vacate their seats in ${stateDesc}`;
    if (!confirm(`Are you sure you want to ${actionDesc}? This cannot be undone.`)) return;

    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      if (selectedStates.length > 0) params.set("states", selectedStates.join(","));
      if (mode === "candidates_only") params.set("candidates_only", "true");
      if (mode === "vacate_seats") params.set("vacate_seats_only", "true");
      if (mode === "independents_only") params.set("independents_only", "true");
      const res = await fetch(`/api/admin/npps?${params}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage(`✓ ${data.message}`);
        await fetchStats();
      } else setMessage(`✗ ${data.error}`);
    } catch {
      setMessage("✗ Network error");
    } finally {
      setLoading(false);
    }
  };

  const toggleState = (state: string) =>
    setSelectedStates((prev) =>
      prev.includes(state) ? prev.filter((s) => s !== state) : [...prev, state]
    );

  const toggleParty = (party: string) =>
    setSelectedParties((prev) =>
      prev.includes(party) ? prev.filter((p) => p !== party) : [...prev, party]
    );

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        Generate or remove Non-Player Politicians from elections. State preference weighting
        controls where free-floating NPPs are placed.
      </p>

      {/* NPP Autonomy — disabled/econ-only countries self-govern (CB chair, laws, government) */}
      <div className="rounded-xl border border-card-border bg-card p-4 shadow-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="font-serif text-lg text-foreground">NPP Autonomy</h3>
            <p className="mt-0.5 max-w-xl text-sm text-muted">
              When on, NPPs in disabled or econ-only countries govern themselves — an autonomous
              technocrat runs the central bank toward the dual mandate (and, as later phases ship,
              they pass laws and form governments). Has no effect in player-enabled countries.
            </p>
          </div>
          <button
            className={`inline-flex shrink-0 items-center justify-center rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
              nppAutonomyEnabled
                ? "border-green-500 bg-green-500/10 text-green-400 hover:bg-green-500/20"
                : "border-card-border bg-background text-muted hover:bg-accent"
            }`}
            onClick={handleToggleNppAutonomy}
            disabled={togglingNppAutonomy || nppAutonomyEnabled === null}
            title="NPP Autonomy (disabled/econ-only countries)"
          >
            NPP Autonomy: {nppAutonomyEnabled === null ? "…" : nppAutonomyEnabled ? "On" : "Off"}
          </button>
        </div>
      </div>

      <NppEconomyPanel />

      {/* Message */}
      {message && (
        <div className={`rounded-lg p-3 text-sm ${getMessageStyle(message)}`}>{message}</div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-card-border bg-card p-4">
            <div className="text-sm text-muted">Total NPPs</div>
            <div className="mt-1 text-3xl font-bold tabular-nums">{stats.totalNPPs}</div>
          </div>
          <div className="rounded-lg border border-card-border bg-card p-4">
            <div className="text-sm text-muted">In Elections</div>
            <div className="mt-1 text-3xl font-bold tabular-nums text-blue-400">
              {stats.nppCandidates}
            </div>
          </div>
          <div className="rounded-lg border border-card-border bg-card p-4 sm:col-span-3">
            <div className="text-sm text-muted mb-3">By Party</div>
            {stats.nppsByPartyGrouped ? (
              <div className="space-y-4">
                {Object.entries(stats.nppsByPartyGrouped)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([countryId, partyList]) => (
                    <div key={countryId}>
                      <div className="text-xs font-semibold text-muted mb-2">{countryId}</div>
                      <div className="flex flex-wrap gap-2">
                        {partyList.map((p) => (
                          <span
                            key={`${countryId}-${p.partyId}`}
                            className="rounded-full border border-card-border bg-background px-2.5 py-1 text-xs font-medium"
                            style={{ color: p.color }}
                          >
                            {p.partyName}: {p.count}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {stats.nppsByParty.map((p) => {
                  const party = parties.find((pt) => pt.id === p.party);
                  return (
                    <span
                      key={p.party}
                      className="rounded-full border border-card-border bg-background px-2 py-0.5 text-xs font-medium"
                      style={{ color: party?.color || "#888" }}
                    >
                      {p.party.charAt(0).toUpperCase()}: {p.count}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Target selection */}
      <div className="rounded-xl border border-card-border bg-card p-5">
        <h3 className="mb-4 font-semibold">Target Selection</h3>

        {/* Country scope */}
        <div className="mb-4">
          <label className="mb-2 block text-sm font-medium">Country Scope</label>
          <div className="flex flex-wrap gap-2">
            {["all" as const, ...registered].map((scope) => (
              <button
                key={scope}
                onClick={() => {
                  setCountryScope(scope);
                  setSelectedStates([]);
                  setSelectedParties([]);
                }}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  countryScope === scope
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-card-border bg-card text-muted hover:text-foreground"
                }`}
              >
                {scope === "all" ? "All" : (COUNTRY_CONFIGS[scope as CountryId]?.name ?? scope)}
              </button>
            ))}
          </div>
        </div>

        {/* State / Region selector */}
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium">
              {countryScope === "US"
                ? "States"
                : countryScope === "all"
                  ? "States / Regions"
                  : (COUNTRY_CONFIGS[countryScope as CountryId]?.regionLabelPlural ?? "Regions")}
            </label>
            <button
              onClick={() => setShowStateSelector(!showStateSelector)}
              className="text-xs text-primary hover:underline"
            >
              {showStateSelector ? "Hide" : "Show"} Selector
            </button>
          </div>
          {selectedStates.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selectedStates.map((state) => (
                <button
                  key={state}
                  onClick={() => toggleState(state)}
                  className="group flex items-center gap-1.5 rounded-full border border-primary/50 bg-primary/10 px-3 py-1 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
                >
                  {state}
                  <svg
                    className="h-3 w-3 opacity-60 group-hover:opacity-100"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              ))}
              <button
                onClick={() => setSelectedStates([])}
                className="text-xs text-red-400 hover:text-red-300"
              >
                Clear all
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted">
              All{" "}
              {countryScope === "US"
                ? "states"
                : countryScope === "all"
                  ? "states/regions"
                  : (
                      COUNTRY_CONFIGS[countryScope as CountryId]?.regionLabelPlural ?? "regions"
                    ).toLowerCase()}{" "}
              selected
            </p>
          )}
          {showStateSelector && (
            <div className="mt-3 space-y-3">
              {(countryScope === "US" || countryScope === "all") && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted">US States</p>
                  <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-card-border bg-background p-3 sm:grid-cols-4 md:grid-cols-6">
                    {US_STATES.map((state) => (
                      <button
                        key={state}
                        onClick={() => toggleState(state)}
                        className={`rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                          selectedStates.includes(state)
                            ? "bg-primary text-primary-foreground"
                            : "border border-card-border bg-card text-muted hover:text-foreground"
                        }`}
                      >
                        {state}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(countryScope === "UK" || countryScope === "all") && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted">UK Regions</p>
                  <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-card-border bg-background p-3 sm:grid-cols-4 md:grid-cols-6">
                    {UK_REGION_IDS.map((state) => (
                      <button
                        key={state}
                        onClick={() => toggleState(state)}
                        className={`rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                          selectedStates.includes(state)
                            ? "bg-primary text-primary-foreground"
                            : "border border-card-border bg-card text-muted hover:text-foreground"
                        }`}
                      >
                        {state}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(countryScope === "JP" || countryScope === "all") && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted">JP Regions</p>
                  <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-card-border bg-background p-3 sm:grid-cols-4 md:grid-cols-6">
                    {JP_REGION_IDS.map((state) => (
                      <button
                        key={state}
                        onClick={() => toggleState(state)}
                        className={`rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                          selectedStates.includes(state)
                            ? "bg-primary text-primary-foreground"
                            : "border border-card-border bg-card text-muted hover:text-foreground"
                        }`}
                      >
                        {state}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(countryScope === "DE" || countryScope === "all") && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted">DE Länder</p>
                  <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-card-border bg-background p-3 sm:grid-cols-4 md:grid-cols-6">
                    {DE_LAND_IDS.map((state) => (
                      <button
                        key={state}
                        onClick={() => toggleState(state)}
                        className={`rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                          selectedStates.includes(state)
                            ? "bg-primary text-primary-foreground"
                            : "border border-card-border bg-card text-muted hover:text-foreground"
                        }`}
                      >
                        {state}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Party selector */}
        <div>
          <label className="mb-2 block text-sm font-medium">Parties to Generate</label>
          <div className="flex flex-wrap gap-2">
            {parties.map((party) => {
              const key = partyKey(party);
              return (
                <button
                  key={key}
                  onClick={() => toggleParty(key)}
                  style={{
                    backgroundColor: selectedParties.includes(key)
                      ? party.color
                      : `${party.color}20`,
                    borderColor: `${party.color}80`,
                    color: selectedParties.includes(key) ? "white" : party.color,
                  }}
                  className="rounded-lg border px-4 py-2 text-sm font-medium transition-all hover:shadow-sm"
                >
                  {party.name.replace(" Party", "")}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Generate button */}
      <button
        onClick={handleGenerateNPPs}
        disabled={loading || selectedParties.length === 0}
        className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? "Generating..." : "Generate NPPs for Elections"}
      </button>

      {/* Spawn free NPPs */}
      <div className="rounded-xl border border-card-border bg-card p-5">
        <h3 className="mb-2 font-semibold">Spawn Free-Floating NPPs</h3>
        <p className="mb-4 text-xs text-muted">
          Creates NPPs not tied to any election. State selection is weighted by party ideology
          alignment, existing party presence, or both.
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-2 block text-sm font-medium">Count</label>
            <input
              type="number"
              min={1}
              max={500}
              value={spawnCount}
              onChange={(e) =>
                setSpawnCount(Math.max(1, Math.min(500, parseInt(e.target.value) || 1)))
              }
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">Party</label>
            <select
              value={spawnParty}
              onChange={(e) => setSpawnParty(e.target.value)}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="">— Select party —</option>
              {parties.map((p) => {
                const key = partyKey(p);
                return (
                  <option key={key} value={key}>
                    {p.name} ({p.countryId})
                  </option>
                );
              })}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">State Preference</label>
            <select
              value={spawnMode}
              onChange={(e) => setSpawnMode(e.target.value as "lean" | "members" | "both")}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="both">Both (lean + members)</option>
              <option value="lean">Party Lean Match</option>
              <option value="members">Existing Members</option>
            </select>
          </div>
        </div>

        <button
          onClick={handleSpawnNPPs}
          disabled={loading || !spawnParty}
          className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {loading ? "Spawning…" : `Spawn ${spawnCount} NPP${spawnCount !== 1 ? "s" : ""}`}
        </button>

        {spawnResult && spawnResult.topStates.length > 0 && (
          <div className="mt-4 space-y-2 rounded-lg border border-card-border bg-background p-3">
            <p className="text-xs font-medium">Distribution (top states):</p>
            <div className="flex flex-wrap gap-2">
              {spawnResult.topStates.map(({ state, count }) => (
                <span
                  key={state}
                  className="rounded-full bg-primary/10 border border-primary/30 px-2.5 py-1 text-xs font-medium"
                >
                  {state} × {count}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Destructive actions */}
      <details className="group rounded-xl border border-red-500/30 bg-red-500/5">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm font-medium text-red-400 hover:text-red-300">
          <svg
            className="h-4 w-4 transition-transform group-open:rotate-90"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          Remove / Retire NPPs
        </summary>
        <div className="space-y-2 px-5 pb-4">
          <button
            onClick={handleRemoveNPPs}
            disabled={loading}
            className="w-full rounded-lg bg-yellow-500/20 px-4 py-2 text-sm font-medium text-yellow-400 border border-yellow-500/50 transition-colors hover:bg-yellow-500/30 disabled:opacity-50"
          >
            {loading ? "..." : "Remove NPP Candidates"}
          </button>
          <button
            onClick={() => handleDeleteAllNPPs("candidates_only")}
            disabled={loading}
            className="w-full rounded-lg bg-orange-500/20 px-4 py-2 text-sm font-medium text-orange-400 border border-orange-500/50 transition-colors hover:bg-orange-500/30 disabled:opacity-50"
          >
            {loading ? "..." : "Clear Election Entries Only"}
          </button>
          <button
            onClick={() => handleDeleteAllNPPs("vacate_seats")}
            disabled={loading}
            className="w-full rounded-lg bg-purple-500/20 px-4 py-2 text-sm font-medium text-purple-400 border border-purple-500/50 transition-colors hover:bg-purple-500/30 disabled:opacity-50"
          >
            {loading ? "..." : "Vacate Retired NPP Seats"}
          </button>
          <button
            onClick={() => handleDeleteAllNPPs("independents_only")}
            disabled={loading}
            className="w-full rounded-lg bg-cyan-500/20 px-4 py-2 text-sm font-medium text-cyan-400 border border-cyan-500/50 transition-colors hover:bg-cyan-500/30 disabled:opacity-50"
          >
            {loading ? "..." : "Retire Independent NPPs Only"}
          </button>
          <button
            onClick={() => handleDeleteAllNPPs("retire_all")}
            disabled={loading}
            className="w-full rounded-lg bg-red-500/20 px-4 py-2 text-sm font-medium text-red-400 border border-red-500/50 transition-colors hover:bg-red-500/30 disabled:opacity-50"
          >
            {loading ? "..." : "Retire All NPPs"}
          </button>
        </div>
      </details>

      {/* Recent NPPs */}
      {stats?.recentNPPs && stats.recentNPPs.length > 0 && (
        <div>
          <h3 className="mb-3 font-semibold">Recently Active NPPs</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {stats.recentNPPs.map((npp) => (
              <div
                key={String(npp._id)}
                className="flex items-center gap-3 rounded-lg border border-card-border bg-card p-3 transition-shadow hover:shadow-md"
              >
                <Avatar
                  url={npp.avatarUrl}
                  name={npp.name}
                  size="h-10 w-10"
                  className="text-muted"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{npp.name}</div>
                  <div className="text-xs text-muted">
                    {npp.homeState} · {npp.party.charAt(0).toUpperCase() + npp.party.slice(1)}
                  </div>
                </div>
                <div className="flex-shrink-0 text-sm font-medium text-primary">
                  {npp.politicalInfluence.toFixed(1)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Utilities */}
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-muted hover:text-foreground">
          <svg
            className="h-4 w-4 transition-transform group-open:rotate-90"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          Utilities
        </summary>
        <div className="mt-2">
          <button
            onClick={async () => {
              if (
                !confirm(
                  "Backfill avatars for all legacy NPPs? This will assign random images to those without one."
                )
              )
                return;
              await post({ action: "backfill_images" });
            }}
            disabled={loading}
            className="rounded-lg border border-card-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-card disabled:opacity-50"
          >
            {loading ? "..." : "Backfill Missing Avatars"}
          </button>
        </div>
      </details>
    </div>
  );
}
