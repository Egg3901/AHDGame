"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import { partyApiUrl, regionPartyApiUrl, regionPartyUrl } from "@/lib/urls";
import type { StatePartyRow } from "@/lib/states/buildStatePartyRows";
import { StatePartyTable, type StatePartySortKey } from "./StatePartyTable";
import { StateDrawer } from "./StateDrawer";
import { StatePartyMap, countryHasMap, type MapColorBy } from "./StatePartyMap";
import { sumBulkEstimate, type BulkMode, type BulkPreview } from "./bulkEstimate";
import { orgTier, toneColor } from "./orgTier";

export interface StatePartyHQProps {
  countryId: string;
  partyId: string;
  partyColor: string;
  /** Chair / vice-chair / admin — may fund + set priority. */
  canManage: boolean;
  /** Chair / vice-chair / admin — may spend national PS (bulk Build Org). */
  canSpendPs: boolean;
  /**
   * National party Political Strength reserve. Bulk Build Org always debits
   * this pool (not the per-state totals shown in the table) — ticket #1059.
   */
  nationalPoliticalStrength: number;
  /** Refresh national party data after a bulk national-PS spend. */
  onNationalPsSpent?: () => void;
}

function fmtMoney(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export function StatePartyHQ({
  countryId,
  partyId,
  partyColor,
  canManage,
  canSpendPs,
  nationalPoliticalStrength,
  onNationalPsSpent,
}: StatePartyHQProps) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<StatePartyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"table" | "map">("table");
  const [colorBy, setColorBy] = useState<MapColorBy>("org");
  const [sortKey, setSortKey] = useState<StatePartySortKey>("organization");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [bulkMode, setBulkMode] = useState<BulkMode | null>(null);
  const [busy, setBusy] = useState(false);
  // Local copy so the bulk bar updates immediately after spends without waiting
  // on a parent refetch (activity recovery means we can't subtract exactly).
  const [nationalPs, setNationalPs] = useState(nationalPoliticalStrength);
  useEffect(() => {
    setNationalPs(nationalPoliticalStrength);
  }, [nationalPoliticalStrength]);

  // Per-region preview cache for the live bulk Build Org estimate.
  const [buildPreviews, setBuildPreviews] = useState<Record<string, BulkPreview>>({});
  const inFlight = useRef<Set<string>>(new Set());

  const hasMap = countryHasMap(countryId);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${partyApiUrl(countryId, partyId)}/state-parties`);
      const d = await r.json();
      setRows(Array.isArray(d.rows) ? d.rows : []);
    } catch {
      showToast("Failed to load state parties", "error");
    } finally {
      setLoading(false);
    }
  }, [countryId, partyId, showToast]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  // Lazily fetch a Build Org preview for newly-selected regions when bulk mode is active.
  useEffect(() => {
    if (!bulkMode || !canSpendPs) return;
    for (const region of sel) {
      const key = `${bulkMode}:${region}`;
      if (buildPreviews[region] || inFlight.current.has(key)) continue;
      inFlight.current.add(key);
      void (async () => {
        try {
          const base = regionPartyApiUrl(countryId, region, partyId);
          const res = await fetch(`${base}/build-org/preview`);
          const d = await res.json();
          setBuildPreviews((c) => ({ ...c, [region]: d }));
        } catch {
          setBuildPreviews((c) => ({ ...c, [region]: { ok: false, reason: "error" } }));
        } finally {
          inFlight.current.delete(key);
        }
      })();
    }
  }, [bulkMode, sel, canSpendPs, countryId, partyId, buildPreviews]);

  const sortedRows = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * sortDir;
      return ((av as number) - (bv as number)) * sortDir;
    });
    return out;
  }, [rows, sortKey, sortDir]);

  const onSort = (k: StatePartySortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setSortDir(k === "name" ? 1 : -1);
    }
  };

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSel((s) => (s.size === rows.length ? new Set() : new Set(rows.map((r) => r.regionId))));

  // Aggregate tiles.
  const totals = useMemo(() => {
    const n = rows.length || 1;
    const avgOrg = rows.reduce((s, r) => s + r.organization, 0) / n;
    const treasury = rows.reduce((s, r) => s + r.treasury, 0);
    const ps = rows.reduce((s, r) => s + r.politicalStrength, 0);
    return { avgOrg, treasury, ps };
  }, [rows]);

  const weak = useMemo(
    () =>
      rows
        .filter((r) => r.organization < 35 && r.lean > 5)
        .sort((a, b) => a.organization - b.organization),
    [rows]
  );

  // ── Mutations ──
  const onFund = async (regionId: string, amount: number) => {
    try {
      const res = await fetch(`${partyApiUrl(countryId, partyId)}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateId: regionId, amount }),
      });
      const d = await res.json().catch(() => ({}));
      showToast(
        res.ok ? (d.message ?? `Transferred ${fmtMoney(amount)}`) : (d.error ?? "Transfer failed"),
        res.ok ? "success" : "error"
      );
      if (res.ok) await fetchRows();
    } catch {
      showToast("Network error", "error");
    }
  };

  const onTogglePriority = async (regionId: string) => {
    const current = rows.filter((r) => r.isTarget).map((r) => r.regionId);
    const next = current.includes(regionId)
      ? current.filter((id) => id !== regionId)
      : [...current, regionId];
    try {
      const res = await fetch(`${partyApiUrl(countryId, partyId)}/priority-region`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateIds: next }),
      });
      const d = await res.json().catch(() => ({}));
      showToast(
        res.ok ? "Priority region updated" : (d.error ?? "Could not update priority"),
        res.ok ? "success" : "error"
      );
      if (res.ok) await fetchRows();
    } catch {
      showToast("Network error", "error");
    }
  };

  const onRecruit = (regionId: string) => {
    window.location.href = `${regionPartyUrl(countryId, regionId, partyId)}?tab=actions&sub=recruitment`;
  };

  const bulkFund = async () => {
    setBusy(true);
    try {
      for (const region of sel) await onFund(region, 25000);
      showToast(`Funded ${sel.size} states $25K each`, "success");
      setSel(new Set());
    } finally {
      setBusy(false);
    }
  };

  const bulkPriority = async () => {
    const current = new Set(rows.filter((r) => r.isTarget).map((r) => r.regionId));
    for (const r of sel) current.add(r);
    try {
      const res = await fetch(`${partyApiUrl(countryId, partyId)}/priority-region`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateIds: [...current] }),
      });
      showToast(
        res.ok ? `Flagged ${sel.size} states as priority` : "Could not update priority",
        res.ok ? "success" : "error"
      );
      if (res.ok) await fetchRows();
    } catch {
      showToast("Network error", "error");
    }
  };

  const runBulkSpend = async () => {
    const eligible = [...sel].filter((id) => buildPreviews[id]?.ok);
    if (eligible.length === 0) {
      showToast("No eligible states in selection", "info");
      return;
    }
    if (estimate && estimate.totalPS > nationalPs + 1e-6) {
      showToast(
        `Not enough national PS: need ${estimate.totalPS}, have ${nationalPs.toFixed(1)}`,
        "error"
      );
      return;
    }
    setBusy(true);
    try {
      let done = 0;
      let failed = 0;
      let spent = 0;
      let firstError = "";
      const noteFail = async (res?: Response) => {
        failed += 1;
        if (!firstError && res) {
          const d = await res.json().catch(() => ({}));
          if (d?.error) firstError = d.error;
        }
      };
      for (const region of eligible) {
        const base = regionPartyApiUrl(countryId, region, partyId);
        const res = await fetch(`${base}/build-org`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // National HQ bulk Build Org always spends the national reserve —
          // never the per-state PS column shown in the table.
          body: JSON.stringify({ psPool: "national" }),
        });
        if (res.ok) {
          done += 1;
          const d = await res.json().catch(() => ({}));
          if (typeof d?.psCost === "number") spent += d.psCost;
          if (typeof d?.newPS === "number") setNationalPs(d.newPS);
        } else await noteFail(res);
      }

      if (done === 0) {
        // Nothing succeeded — surface the real reason (e.g. insufficient PS) and
        // keep the selection so the player can retry after fixing it.
        showToast(firstError || "Build Org failed in all selected states", "error");
        return;
      }

      showToast(
        failed > 0
          ? `Built org in ${done} states from national PS · ${failed} failed`
          : `Built org in ${done} states from national PS` +
              (spent > 0 ? ` (−${spent.toFixed(0)} Nat'l PS before recovery)` : ""),
        failed > 0 ? "info" : "success"
      );
      setBulkMode(null);
      setSel(new Set());
      setBuildPreviews({});
      await fetchRows();
      onNationalPsSpent?.();
    } finally {
      setBusy(false);
    }
  };

  const estimate = useMemo(() => {
    if (!bulkMode) return null;
    return sumBulkEstimate({ selected: [...sel], previews: buildPreviews });
  }, [bulkMode, sel, buildPreviews]);

  const openRow = openId ? (rows.find((r) => r.regionId === openId) ?? null) : null;

  if (loading) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 text-sm text-muted">
        Loading state parties…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Aggregate tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Avg organization" value={`${totals.avgOrg.toFixed(1)}%`} accent={partyColor} />
        <Tile label="Total treasury" value={fmtMoney(totals.treasury)} />
        <Tile label="State PS (sum)" value={totals.ps.toFixed(0)} />
        <Tile label="National PS" value={nationalPs.toFixed(1)} accent={partyColor} />
      </div>

      {/* Priority banner */}
      {weak.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-2 text-sm">
          <span className="font-semibold text-warning">
            {weak.length} winnable states are under-organized
          </span>
          <div className="flex flex-wrap gap-1.5">
            {weak.slice(0, 6).map((r) => {
              const t = orgTier(r.organization);
              return (
                <button
                  key={r.regionId}
                  onClick={() => setOpenId(r.regionId)}
                  className="rounded-full border border-card-border px-2 py-0.5 text-xs"
                >
                  {r.regionId}{" "}
                  <span style={{ color: toneColor(t.tone) }}>{r.organization.toFixed(0)}%</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">State parties</h3>
        <div className="flex items-center gap-2">
          {view === "map" && (
            <div className="inline-flex rounded-lg border border-card-border p-0.5 text-xs">
              {(["org", "reg"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setColorBy(c)}
                  className={`rounded px-2 py-1 ${colorBy === c ? "bg-primary text-white" : "text-muted"}`}
                >
                  {c === "org" ? "Org%" : "Reg%"}
                </button>
              ))}
            </div>
          )}
          {hasMap && (
            <div className="inline-flex rounded-lg border border-card-border p-0.5 text-xs">
              {(["table", "map"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`rounded px-2 py-1 capitalize ${view === v ? "bg-primary text-white" : "text-muted"}`}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bulk bar (top) */}
      {sel.size > 0 && (
        <div className="sticky top-2 z-10 space-y-2 rounded-xl border border-card-border bg-card-elevated px-4 py-2 shadow-lg">
          {canSpendPs && bulkMode && estimate && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-card-border pb-2 text-xs">
              <span className="font-medium">
                Build Org · Nat&apos;l PS · {estimate.states} states · Est.{" "}
                <b className="tabular-nums">{estimate.totalPS} Nat&apos;l PS</b>
                <span className="text-muted"> (have {nationalPs.toFixed(1)})</span> ·{" "}
                {estimate.states > 1 ? (
                  <>
                    avg{" "}
                    <b className="tabular-nums">
                      +{(estimate.totalDelta / estimate.states).toFixed(2)} Org
                    </b>{" "}
                    each
                  </>
                ) : (
                  <b className="tabular-nums">+{estimate.totalDelta.toFixed(2)} Org</b>
                )}
                {estimate.skipped.length > 0 ? ` · ${estimate.skipped.length} skipped` : ""}
                {estimate.pending.length > 0 ? " · estimating…" : ""}
                {estimate.totalPS > nationalPs + 1e-6 ? (
                  <span className="ml-2 font-semibold text-error">Insufficient national PS</span>
                ) : null}
              </span>
              <span className="flex gap-2">
                <button
                  disabled={busy || estimate.states === 0 || estimate.totalPS > nationalPs + 1e-6}
                  onClick={() => runBulkSpend()}
                  className="rounded-md bg-primary px-3 py-1 font-medium text-white disabled:opacity-50"
                >
                  {busy ? "Working…" : `Confirm (${estimate.totalPS} Nat'l PS)`}
                </button>
                <button
                  className="text-muted hover:text-foreground"
                  onClick={() => setBulkMode(null)}
                >
                  Cancel
                </button>
              </span>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold">{sel.size} states</span>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {canManage && (
                <>
                  <button
                    onClick={bulkFund}
                    disabled={busy}
                    className="rounded-md border border-card-border bg-card px-3 py-1.5 font-semibold shadow-sm transition-colors hover:border-primary/60 hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                  >
                    Fund $25K each
                  </button>
                  <button
                    onClick={bulkPriority}
                    disabled={busy}
                    className="rounded-md border border-card-border bg-card px-3 py-1.5 font-semibold shadow-sm transition-colors hover:border-primary/60 hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                  >
                    Set priority
                  </button>
                </>
              )}
              {canSpendPs && (
                <button
                  onClick={() => setBulkMode("build")}
                  className={`rounded-md border px-3 py-1.5 font-semibold shadow-sm transition-colors ${bulkMode === "build" ? "border-primary bg-primary/15 text-primary" : "border-card-border bg-card hover:border-primary/60 hover:bg-primary/10"}`}
                >
                  Build Org
                </button>
              )}
              <button
                className="text-muted hover:text-foreground"
                onClick={() => {
                  setSel(new Set());
                  setBulkMode(null);
                }}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {view === "map" && hasMap ? (
        <StatePartyMap
          countryId={countryId}
          rows={rows}
          colorBy={colorBy}
          selected={openId}
          onSelect={(id) => setOpenId(id)}
        />
      ) : (
        <StatePartyTable
          rows={sortedRows}
          sel={sel}
          onToggle={toggle}
          onToggleAll={toggleAll}
          onOpen={setOpenId}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
        />
      )}

      {openRow && (
        <StateDrawer
          row={openRow}
          countryCode={countryId}
          partyId={partyId}
          canManage={canManage}
          priorityLocked={false}
          onClose={() => setOpenId(null)}
          onFund={onFund}
          onTogglePriority={onTogglePriority}
          onRecruit={onRecruit}
        />
      )}
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div
        className="text-lg font-bold tabular-nums"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
