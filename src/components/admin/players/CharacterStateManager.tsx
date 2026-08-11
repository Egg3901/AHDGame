"use client";

import { useEffect, useMemo, useState } from "react";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { useRegisteredCountries } from "@/contexts/RegisteredCountriesContext";
import { PlayerSelector } from "@/components/PlayerSelector";

interface Region {
  id: string;
  name: string;
}

/**
 * Region options for a country, read from the world rather than hardcoded.
 *
 * This panel used to carry a 50-entry US state table and offer nothing else,
 * so no non-US player could be relocated through it at all — the server was
 * rejecting those ids too, which hid the gap. `GET /api/country/[code]/states`
 * already exists for exactly this (it backs the corporation relocation
 * dropdown), so every country's regions come from one source.
 */
function useCountryRegions(countryId: CountryId): { regions: Region[]; loading: boolean } {
  // The loaded country is stored WITH its regions so `loading` is derived
  // rather than set in the effect. That keeps the two in lockstep: switching
  // country can never briefly render the previous country's regions as though
  // they belonged to the new one.
  const [loaded, setLoaded] = useState<{ countryId: CountryId | null; regions: Region[] }>({
    countryId: null,
    regions: [],
  });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/country/${countryId}/states`)
      .then((res) => (res.ok ? res.json() : { states: [] }))
      .then((data: { states?: Region[] }) => {
        if (cancelled) return;
        setLoaded({
          countryId,
          regions: [...(data.states ?? [])].sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
          ),
        });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ countryId, regions: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [countryId]);

  const loading = loaded.countryId !== countryId;
  return { regions: loading ? [] : loaded.regions, loading };
}

interface CharacterStateManagerProps {
  context?: "admin" | "moderator";
}

const POSITION_LABELS: Record<number, string> = {
  [-5]: "Far Left / Far Liberal",
  [-4]: "Strong Left / Strong Liberal",
  [-3]: "Left / Liberal",
  [-2]: "Lean Left / Lean Liberal",
  [-1]: "Center-Left / Center-Liberal",
  [0]: "Centrist / Moderate",
  [1]: "Center-Right / Center-Trad",
  [2]: "Lean Right / Lean Trad",
  [3]: "Right / Traditional",
  [4]: "Strong Right / Strong Trad",
  [5]: "Far Right / Far Traditional",
};

export function CharacterStateManager({ context = "admin" }: CharacterStateManagerProps) {
  const registered = useRegisteredCountries();
  // Derived from the runtime registered set so an activated country (via the
  // `countryGameStates` activation pathway) flows through without edits here.
  // The backend route still validates enablement (`isCountryEnabledForPlayers`).
  const COUNTRIES = useMemo<{ id: CountryId; label: string }[]>(
    () => registered.map((id) => ({ id, label: COUNTRY_CONFIGS[id].name })),
    [registered]
  );
  const apiBase = context === "moderator" ? "/api/moderator" : "/api/admin";
  const [username, setUsername] = useState("");
  // Which country's regions to offer. The server resolves `homeState` against
  // the CHARACTER's country, so a mismatch here is rejected there with a clear
  // message — this only decides what the dropdown lists.
  const [stateCountryId, setStateCountryId] = useState<CountryId>("US");
  const [homeState, setHomeState] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const { regions: stateRegions, loading: stateRegionsLoading } = useCountryRegions(stateCountryId);

  // Country form state
  const [countryUsername, setCountryUsername] = useState("");
  const [countryId, setCountryId] = useState<CountryId>("US");
  const [countryHomeState, setCountryHomeState] = useState("");
  const { regions: countryRegions, loading: countryRegionsLoading } = useCountryRegions(countryId);
  const [countryLoading, setCountryLoading] = useState(false);
  const [countryResult, setCountryResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Positions form state
  const [posCharacter, setPosCharacter] = useState<{ id: string; name: string } | null>(null);
  const [economic, setEconomic] = useState<number | null>(null);
  const [social, setSocial] = useState<number | null>(null);
  const [posLoading, setPosLoading] = useState(false);
  const [posResult, setPosResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !homeState) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch(`${apiBase}/characters/update-state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), homeState }),
      });
      const data = (await res.json()) as { success?: boolean; message?: string; error?: string };

      if (res.ok && data.success) {
        setResult({ ok: true, message: data.message ?? "State updated." });
        setUsername("");
        setHomeState("");
      } else {
        setResult({ ok: false, message: data.error ?? "Unknown error" });
      }
    } catch {
      setResult({ ok: false, message: "Network error — request failed" });
    } finally {
      setLoading(false);
    }
  }

  async function handleCountrySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!countryUsername.trim() || !countryId) return;

    setCountryLoading(true);
    setCountryResult(null);

    try {
      const res = await fetch(`${apiBase}/characters/update-country`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: countryUsername.trim(),
          countryId,
          homeState: countryHomeState || undefined,
        }),
      });
      const data = (await res.json()) as { success?: boolean; message?: string; error?: string };

      if (res.ok && data.success) {
        setCountryResult({ ok: true, message: data.message ?? "Country updated." });
        setCountryUsername("");
        setCountryId("US");
        setCountryHomeState("");
      } else {
        setCountryResult({ ok: false, message: data.error ?? "Unknown error" });
      }
    } catch {
      setCountryResult({ ok: false, message: "Network error — request failed" });
    } finally {
      setCountryLoading(false);
    }
  }

  async function handlePositionsSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!posCharacter) return;
    if (economic === null && social === null) return;

    setPosLoading(true);
    setPosResult(null);

    try {
      const body: Record<string, unknown> = { characterId: posCharacter.id };
      if (economic !== null) body.economic = economic;
      if (social !== null) body.social = social;

      const res = await fetch(`${apiBase}/characters/update-positions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { success?: boolean; message?: string; error?: string };

      if (res.ok && data.success) {
        setPosResult({ ok: true, message: data.message ?? "Positions updated." });
        setPosCharacter(null);
        setEconomic(null);
        setSocial(null);
      } else {
        setPosResult({ ok: false, message: data.error ?? "Unknown error" });
      }
    } catch {
      setPosResult({ ok: false, message: "Network error — request failed" });
    } finally {
      setPosLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* State Update Card */}
      <div className="rounded-xl border border-card-border bg-card p-6 shadow-sm">
        <h3 className="text-base font-semibold text-foreground mb-1">Change Home Region</h3>
        <p className="text-sm text-muted mb-5">
          Update a character&apos;s home region by their username. Regions are per-country — US
          states, UK regions, Soviet republics and so on.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5" htmlFor="cs-username">
              Username
            </label>
            <input
              id="cs-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. rainforest"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1.5" htmlFor="cs-country">
              Country
            </label>
            <select
              id="cs-country"
              value={stateCountryId}
              onChange={(e) => {
                setStateCountryId(e.target.value as CountryId);
                setHomeState("");
              }}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {COUNTRIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted">
              Picks which regions to list. The move must stay inside the character&apos;s own
              country.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1.5" htmlFor="cs-state">
              New Home Region
            </label>
            <select
              id="cs-state"
              value={homeState}
              onChange={(e) => setHomeState(e.target.value)}
              disabled={stateRegionsLoading || stateRegions.length === 0}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            >
              <option value="">
                {stateRegionsLoading
                  ? "Loading regions…"
                  : stateRegions.length === 0
                    ? "No regions for this country"
                    : "— Select a region —"}
              </option>
              {stateRegions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.id})
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={!username.trim() || !homeState || loading}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? "Updating…" : "Update State"}
          </button>
        </form>

        {result && (
          <p className={`mt-4 text-sm font-medium ${result.ok ? "text-success" : "text-error"}`}>
            {result.ok ? "✓ " : "✗ "}
            {result.message}
          </p>
        )}
      </div>

      {/* Country Update Card */}
      <div className="rounded-xl border border-card-border bg-card p-6 shadow-sm">
        <h3 className="text-base font-semibold text-foreground mb-1">Change Home Country</h3>
        <p className="text-sm text-muted mb-5">
          Relocate a character to a different country by their username.
        </p>

        <form onSubmit={handleCountrySubmit} className="space-y-4 max-w-sm">
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5" htmlFor="cc-username">
              Username
            </label>
            <input
              id="cc-username"
              type="text"
              value={countryUsername}
              onChange={(e) => setCountryUsername(e.target.value)}
              placeholder="e.g. rainforest"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1.5" htmlFor="cc-country">
              New Country
            </label>
            <select
              id="cc-country"
              value={countryId}
              onChange={(e) => {
                setCountryId(e.target.value as CountryId);
                // Regions are per-country, so a carried-over id would be a
                // region of the country they just switched away from.
                setCountryHomeState("");
              }}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {COUNTRIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {(countryRegionsLoading || countryRegions.length > 0) && (
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5" htmlFor="cc-state">
                Home Region
              </label>
              <select
                id="cc-state"
                value={countryHomeState}
                onChange={(e) => setCountryHomeState(e.target.value)}
                disabled={countryRegionsLoading}
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
              >
                <option value="">
                  {countryRegionsLoading ? "Loading regions…" : "— Select a region —"}
                </option>
                {countryRegions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.id})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/*
            Blocked while regions load, and while a region-bearing country has
            none chosen: submitting without one makes `update-country` fall back
            to the character's CURRENT region, which by definition belongs to the
            country they are leaving, so the move can only 400.
          */}
          <button
            type="submit"
            disabled={
              !countryUsername.trim() ||
              countryLoading ||
              countryRegionsLoading ||
              (countryRegions.length > 0 && !countryHomeState)
            }
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {countryLoading ? "Updating…" : "Update Country"}
          </button>
        </form>

        {countryResult && (
          <p
            className={`mt-4 text-sm font-medium ${countryResult.ok ? "text-success" : "text-error"}`}
          >
            {countryResult.ok ? "✓ " : "✗ "}
            {countryResult.message}
          </p>
        )}
      </div>

      {/* Positions Update Card */}
      <div className="rounded-xl border border-card-border bg-card p-6 shadow-sm">
        <h3 className="text-base font-semibold text-foreground mb-1">Change Policy Positions</h3>
        <p className="text-sm text-muted mb-5">
          Adjust a character&apos;s economic and/or social policy positions. Values range from
          &minus;5 (far left/liberal) to +5 (far right/traditional). Leave an axis unchanged by
          clicking &quot;Skip&quot;.
        </p>

        <form onSubmit={handlePositionsSubmit} className="space-y-4 max-w-sm">
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Character</label>
            {posCharacter ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm">
                  <span className="font-medium">{posCharacter.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPosCharacter(null);
                    setEconomic(null);
                    setSocial(null);
                    setPosResult(null);
                  }}
                  className="rounded-md border border-card-border bg-card px-3 py-2 text-xs text-muted hover:text-foreground"
                >
                  Clear
                </button>
              </div>
            ) : (
              <PlayerSelector
                onSelect={(char) => {
                  setPosCharacter({ id: char.id, name: char.name });
                  setPosResult(null);
                }}
                placeholder="Search for a character…"
              />
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-muted" htmlFor="pos-economic">
                Economic Position
              </label>
              {economic !== null && (
                <button
                  type="button"
                  onClick={() => setEconomic(null)}
                  className="text-[10px] text-muted hover:text-foreground underline"
                >
                  Skip
                </button>
              )}
            </div>
            {economic !== null ? (
              <>
                <span className="text-xs font-normal text-foreground">
                  {economic > 0 ? `+${economic}` : economic} —{" "}
                  {POSITION_LABELS[economic]?.split(" / ")[0]}
                </span>
                <input
                  id="pos-economic"
                  type="range"
                  min={-5}
                  max={5}
                  step={1}
                  value={economic}
                  onChange={(e) => setEconomic(Number(e.target.value))}
                  className="w-full accent-primary mt-1"
                />
              </>
            ) : (
              <button
                type="button"
                onClick={() => setEconomic(0)}
                className="w-full rounded-lg border border-dashed border-card-border bg-background px-3 py-2 text-xs text-muted hover:text-foreground hover:border-foreground/30 transition-colors"
              >
                + Set economic position
              </button>
            )}
            {economic !== null && (
              <div className="flex justify-between text-xs text-muted mt-1">
                <span>−5</span>
                <span>0</span>
                <span>+5</span>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-muted" htmlFor="pos-social">
                Social Position
              </label>
              {social !== null && (
                <button
                  type="button"
                  onClick={() => setSocial(null)}
                  className="text-[10px] text-muted hover:text-foreground underline"
                >
                  Skip
                </button>
              )}
            </div>
            {social !== null ? (
              <>
                <span className="text-xs font-normal text-foreground">
                  {social > 0 ? `+${social}` : social} — {POSITION_LABELS[social]?.split(" / ")[1]}
                </span>
                <input
                  id="pos-social"
                  type="range"
                  min={-5}
                  max={5}
                  step={1}
                  value={social}
                  onChange={(e) => setSocial(Number(e.target.value))}
                  className="w-full accent-primary mt-1"
                />
              </>
            ) : (
              <button
                type="button"
                onClick={() => setSocial(0)}
                className="w-full rounded-lg border border-dashed border-card-border bg-background px-3 py-2 text-xs text-muted hover:text-foreground hover:border-foreground/30 transition-colors"
              >
                + Set social position
              </button>
            )}
            {social !== null && (
              <div className="flex justify-between text-xs text-muted mt-1">
                <span>−5</span>
                <span>0</span>
                <span>+5</span>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={!posCharacter || (economic === null && social === null) || posLoading}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {posLoading ? "Updating…" : "Update Positions"}
          </button>
        </form>

        {posResult && (
          <p className={`mt-4 text-sm font-medium ${posResult.ok ? "text-success" : "text-error"}`}>
            {posResult.ok ? "✓ " : "✗ "}
            {posResult.message}
          </p>
        )}
      </div>
    </div>
  );
}
