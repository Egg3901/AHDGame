"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  COMMODITY_LABELS,
  COMMODITY_UNITS,
  EXTRACTABLE_RESOURCES,
  type ExtractableResource,
} from "@/lib/constants/commodities";
import { type CountryId } from "@/lib/constants/countries";
import { useRegisteredCountries } from "@/contexts/RegisteredCountriesContext";
import { Button } from "@/components/ui";

interface CapacityRow {
  stateId: string;
  countryId: CountryId;
  resources: Partial<Record<ExtractableResource, number>>;
  updatedAt?: string;
}

interface StateRef {
  _id: string;
  name: string;
  countryId?: string;
}

type DraftMap = Record<string, Partial<Record<ExtractableResource, string>>>;

export function ResourceCapacityAdminPanel() {
  const registered = useRegisteredCountries();
  const [rows, setRows] = useState<CapacityRow[]>([]);
  const [statesById, setStatesById] = useState<Record<string, StateRef>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [savingStateId, setSavingStateId] = useState<string | null>(null);
  const [countryFilter, setCountryFilter] = useState<CountryId | "ALL">("ALL");
  const [onlyNonZero, setOnlyNonZero] = useState(true);
  const [drafts, setDrafts] = useState<DraftMap>({});

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [capRes, stateRes] = await Promise.all([
        fetch("/api/admin/resource-capacity"),
        fetch("/api/game/states"),
      ]);
      if (!capRes.ok) throw new Error(`capacity: HTTP ${capRes.status}`);
      if (!stateRes.ok) throw new Error(`states: HTTP ${stateRes.status}`);
      const capJson = await capRes.json();
      const stateJson: StateRef[] = await stateRes.json();
      setRows(capJson.capacities ?? []);
      setStatesById(Object.fromEntries(stateJson.map((s) => [s._id, s])));
      setDrafts({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleSeed = async () => {
    if (seeding) return;
    setSeeding(true);
    setSeedMsg(null);
    setActionError(null);
    try {
      const res = await fetch("/api/admin/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: ["stateResourceCapacity"] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setSeedMsg(json.logs?.join("\n") ?? json.message ?? "Seeded");
      await fetchAll();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Seed failed");
    } finally {
      setSeeding(false);
    }
  };

  const filtered = useMemo(() => {
    return rows
      .filter((r) => countryFilter === "ALL" || r.countryId === countryFilter)
      .filter((r) => {
        if (!onlyNonZero) return true;
        const hasAny = EXTRACTABLE_RESOURCES.some((res) => (r.resources[res] ?? 0) > 0);
        return hasAny;
      })
      .sort((a, b) => {
        if (a.countryId !== b.countryId) return a.countryId.localeCompare(b.countryId);
        const an = statesById[a.stateId]?.name ?? a.stateId;
        const bn = statesById[b.stateId]?.name ?? b.stateId;
        return an.localeCompare(bn);
      });
  }, [rows, statesById, countryFilter, onlyNonZero]);

  const setDraft = (stateId: string, resource: ExtractableResource, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [stateId]: { ...(prev[stateId] ?? {}), [resource]: value },
    }));
  };

  const rowHasDraft = (stateId: string) => {
    const d = drafts[stateId];
    return !!d && Object.keys(d).length > 0;
  };

  const resolvedResources = (row: CapacityRow): Partial<Record<ExtractableResource, number>> => {
    const draft = drafts[row.stateId];
    if (!draft) return row.resources;
    const next: Partial<Record<ExtractableResource, number>> = { ...row.resources };
    for (const [k, v] of Object.entries(draft)) {
      const resource = k as ExtractableResource;
      const parsed = v === "" ? 0 : Number(v);
      if (Number.isFinite(parsed) && parsed >= 0) {
        next[resource] = parsed;
      }
    }
    return next;
  };

  const saveRow = async (row: CapacityRow) => {
    if (savingStateId) return;
    setSavingStateId(row.stateId);
    setActionError(null);
    try {
      const resources = resolvedResources(row);
      const cleaned: Record<string, number> = {};
      for (const res of EXTRACTABLE_RESOURCES) {
        const v = resources[res] ?? 0;
        if (v > 0) cleaned[res] = v;
      }
      const res = await fetch(`/api/admin/resource-capacity/${encodeURIComponent(row.stateId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resources: cleaned }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[row.stateId];
        return next;
      });
      await fetchAll();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingStateId(null);
    }
  };

  const resetRow = (stateId: string) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[stateId];
      return next;
    });
  };

  const totalsByResource = useMemo(() => {
    const totals: Record<ExtractableResource, number> = {
      oil: 0,
      coal: 0,
      iron: 0,
      natural_gas: 0,
      timber: 0,
      rare_earth: 0,
    };
    for (const r of filtered) {
      for (const res of EXTRACTABLE_RESOURCES) {
        totals[res] += r.resources[res] ?? 0;
      }
    }
    return totals;
  }, [filtered]);

  return (
    <div className="space-y-6">
      {/* Header + seed */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-heading-sm font-semibold">Resource Capacity</h2>
          <p className="text-body-sm text-muted">
            Per-state extraction ceilings (units/turn) for the 7 extractable commodities. Unseeded
            or zero values cap extraction at 0, which is what bounds commodity supply and keeps
            margin math sane.
          </p>
        </div>
        <Button variant="primary" onClick={handleSeed} isLoading={seeding}>
          {seeding ? "Seeding…" : "Seed Resource Capacity"}
        </Button>
      </div>

      {seedMsg && (
        <pre className="rounded-lg bg-success/10 text-success px-4 py-3 text-body-sm whitespace-pre-wrap">
          {seedMsg}
        </pre>
      )}
      {error && <p className="text-body-sm text-error bg-error/10 rounded-lg px-4 py-3">{error}</p>}
      {actionError && (
        <p className="text-body-sm text-error bg-error/10 rounded-lg px-4 py-3">{actionError}</p>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-body-sm">
          <span className="text-muted">Country:</span>
          <select
            value={countryFilter}
            onChange={(e) => setCountryFilter(e.target.value as CountryId | "ALL")}
            className="h-9 rounded-lg border border-card-border bg-card px-2 text-body-sm"
          >
            <option value="ALL">All</option>
            {registered.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-body-sm">
          <input
            type="checkbox"
            checked={onlyNonZero}
            onChange={(e) => setOnlyNonZero(e.target.checked)}
          />
          <span>Only states with capacity</span>
        </label>
        <div className="ml-auto text-body-sm text-muted">
          {rows.length} states total, {filtered.length} shown
        </div>
      </div>

      {/* Totals strip */}
      <div className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="flex overflow-x-auto divide-x divide-card-border">
          {EXTRACTABLE_RESOURCES.map((res) => (
            <div key={res} className="flex flex-col px-4 py-2 min-w-max">
              <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
                {COMMODITY_LABELS[res]}
              </span>
              <span className="text-body-lg font-bold tabular-nums">
                {totalsByResource[res].toLocaleString("en-US")}
              </span>
              <span className="text-body-xs text-muted">{COMMODITY_UNITS[res]}/turn</span>
            </div>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-muted text-body-sm py-8 text-center">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-8 text-center text-body-sm text-muted">
          No capacity records. Click <strong>Seed Resource Capacity</strong> above to populate every
          state.
        </div>
      ) : (
        <div className="rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead className="bg-background/50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">State</th>
                  <th className="px-3 py-2 text-left font-semibold">Country</th>
                  {EXTRACTABLE_RESOURCES.map((res) => (
                    <th key={res} className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                      {COMMODITY_LABELS[res]}
                      <div className="text-body-xs text-muted font-normal">
                        {COMMODITY_UNITS[res]}
                      </div>
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const state = statesById[row.stateId];
                  const dirty = rowHasDraft(row.stateId);
                  const saving = savingStateId === row.stateId;
                  return (
                    <tr
                      key={row.stateId}
                      className="border-t border-card-border hover:bg-background/30"
                    >
                      <td className="px-3 py-2 font-medium whitespace-nowrap">
                        {state?.name ?? row.stateId}
                        <div className="text-body-xs text-muted">{row.stateId}</div>
                      </td>
                      <td className="px-3 py-2 text-muted">{row.countryId}</td>
                      {EXTRACTABLE_RESOURCES.map((res) => {
                        const draftVal = drafts[row.stateId]?.[res];
                        const current = row.resources[res] ?? 0;
                        const value = draftVal ?? (current > 0 ? String(current) : "");
                        return (
                          <td key={res} className="px-2 py-1 text-right">
                            <input
                              type="number"
                              min={0}
                              step={100}
                              value={value}
                              onChange={(e) => setDraft(row.stateId, res, e.target.value)}
                              placeholder="0"
                              className="w-24 h-8 rounded border border-card-border bg-background px-2 text-right tabular-nums text-body-sm focus:outline-none focus:border-primary/60"
                            />
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {dirty && (
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => resetRow(row.stateId)}
                              disabled={saving}
                              className="text-body-xs px-2 py-1 rounded border border-card-border hover:bg-background/60 transition-colors disabled:opacity-50"
                            >
                              Reset
                            </button>
                            <button
                              onClick={() => saveRow(row)}
                              disabled={saving}
                              className="text-body-xs px-3 py-1 rounded bg-primary text-white font-semibold hover:bg-primary-dark transition-colors disabled:opacity-50"
                            >
                              {saving ? "Saving…" : "Save"}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
