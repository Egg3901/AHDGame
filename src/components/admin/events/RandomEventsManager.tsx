"use client";

import React, { useCallback, useEffect, useState } from "react";
import { PlayerSelector } from "@/components/PlayerSelector";

interface OutcomeEffect {
  type: string;
  delta?: number;
  deltaAnchor?: number;
  deltaLocal?: number;
}

interface OutcomeTierRow {
  minRoll: number;
  maxRoll: number;
  label: string;
  effects: OutcomeEffect[];
  newsWire?: { category: string; title: string; template: string };
}

interface DefinitionOption {
  id: string;
  label: string;
  description: string;
  isDefault?: boolean;
  outcomes?: OutcomeTierRow[] | null;
}

interface DefinitionRow {
  _id: string;
  kind: string;
  status: "draft" | "approved" | "retired";
  version: number;
  title: string;
  headline: string;
  body: string;
  eligibility: string[];
  baseWeight: number;
  requiresCountryIds?: string[];
  defaultOptionId: string;
  options: DefinitionOption[];
}

function formatEffect(e: OutcomeEffect): string {
  const n = e.delta ?? e.deltaAnchor ?? e.deltaLocal ?? 0;
  const signed = `${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString("en-US")}`;
  const label: Record<string, string> = {
    favorability: "favorability",
    infamy: "infamy",
    politicalInfluence: "political influence",
    personalWealth: "personal wealth",
    campaignFunds: "campaign funds",
    campaignSupport: "campaign support",
    corpSentiment: "corp sentiment",
  };
  return `${signed} ${label[e.type] ?? e.type}`;
}

function rollBandLabel(t: OutcomeTierRow): string {
  if (t.minRoll >= 80) return "Best";
  if (t.maxRoll <= 39) return "Worst";
  return "Typical";
}

interface InstanceRow {
  instanceId: string;
  kind: string;
  title: string;
  status: "pending" | "resolved" | "expired";
  roll: number;
  offeredAtTurn: number;
  offeredAt: string;
  expiresAtRealtimeMs: number;
  resolvedAt: string | null;
  resolvedOptionId: string | null;
  resolvedOptionLabel: string | null;
  resolvedTierLabel: string | null;
  resolveReason: "player" | "timeout" | null;
}

interface CooldownInfo {
  lastExpiredAtTurn: number;
  nextEligibleTurn: number;
}

interface SelectedCharacter {
  id: string;
  name: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted/15 text-muted",
  approved: "bg-green-500/15 text-green-500",
  retired: "bg-red-500/15 text-red-400",
  pending: "bg-amber-500/15 text-amber-500",
  resolved: "bg-green-500/15 text-green-500",
  expired: "bg-red-500/15 text-red-400",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[status] ?? "bg-muted/15 text-muted"}`}
    >
      {status}
    </span>
  );
}

export function RandomEventsManager() {
  const [definitions, setDefinitions] = useState<DefinitionRow[]>([]);
  const [flagEnabled, setFlagEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const [expandedDefId, setExpandedDefId] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedCharacter | null>(null);
  const [history, setHistory] = useState<InstanceRow[] | null>(null);
  const [cooldown, setCooldown] = useState<CooldownInfo | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [triggerKind, setTriggerKind] = useState("");

  const fetchDefinitions = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/events/definitions");
      if (res.ok) {
        const data = await res.json();
        setDefinitions(data.definitions ?? []);
      }
    } catch {
      // surfaced via empty table
    }
  }, []);

  const fetchFlag = useCallback(async () => {
    try {
      const res = await fetch("/api/game/turn/status", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setFlagEnabled(data.playerRandomEventsEnabled === true);
      }
    } catch {
      // badge stays unknown
    }
  }, []);

  useEffect(() => {
    fetchDefinitions();
    fetchFlag();
  }, [fetchDefinitions, fetchFlag]);

  const callAdmin = async (path: string, body?: unknown) => {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(path, {
        method: "POST",
        ...(body !== undefined
          ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
          : {}),
      });
      const data = await res.json();
      if (res.ok) {
        return data;
      }
      setMessage(`✗ ${data.error ?? "Request failed"}`);
      return null;
    } catch {
      setMessage("✗ Network error");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const toggleFlag = async () => {
    const enabling = flagEnabled !== true;
    if (
      enabling &&
      !confirm(
        "Enable player random events? Approved templates will begin firing on the next turn cycle."
      )
    ) {
      return;
    }
    const data = await callAdmin("/api/admin/events/pree/toggle", { enabled: enabling });
    if (data) {
      setFlagEnabled(data.playerRandomEventsEnabled === true);
      setMessage(
        data.warning ? `⚠ ${data.warning}` : `✓ Random events ${enabling ? "enabled" : "disabled"}`
      );
    }
  };

  const seedDrafts = async () => {
    const data = await callAdmin("/api/admin/events/pree/seed");
    if (data) {
      setMessage(`✓ Seeded ${data.upserted ?? 0} new draft definition(s)`);
      await fetchDefinitions();
    }
  };

  const approveOrRetire = async (id: string, action: "approve" | "retire") => {
    const data = await callAdmin(`/api/admin/events/definitions/${id}/${action}`);
    if (data) {
      setMessage(`✓ Definition ${action}d`);
      await fetchDefinitions();
    }
  };

  const approveAll = async () => {
    const draftCount = definitions.filter((d) => d.status === "draft").length;
    if (draftCount === 0) {
      setMessage("No draft templates to approve.");
      return;
    }
    if (
      !confirm(
        `Approve all ${draftCount} draft template(s)? Approved events become eligible to fire.`
      )
    ) {
      return;
    }
    const data = await callAdmin("/api/admin/events/definitions/approve-all");
    if (data) {
      const skipped = (data.skipped ?? []) as { kind: string; reason: string }[];
      setMessage(
        `✓ Approved ${data.approved ?? 0} template(s)` +
          (skipped.length > 0
            ? ` · skipped ${skipped.length} (${skipped.map((s) => s.kind).join(", ")})`
            : "")
      );
      await fetchDefinitions();
    }
  };

  const reseedAndApproveAll = async () => {
    if (
      !confirm(
        "Reseed all event definitions from code and approve them all? This is safe to run multiple times."
      )
    ) {
      return;
    }
    const data = await callAdmin("/api/admin/events/pree/reseed");
    if (data) {
      setMessage(
        `✓ Reseeded ${data.upserted ?? 0} new definition(s), approved ${data.approved ?? 0} total`
      );
      await fetchDefinitions();
    }
  };

  const loadHistory = useCallback(async (characterId: string) => {
    setHistoryLoading(true);
    setHistory(null);
    setCooldown(null);
    try {
      const res = await fetch(`/api/admin/events/instances?characterId=${characterId}`);
      const data = await res.json();
      if (res.ok) {
        setHistory(data.items ?? []);
        setCooldown(data.cooldown ?? null);
      } else {
        setHistory([]);
      }
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const triggerEvent = async () => {
    if (!selected || !triggerKind) return;
    const data = await callAdmin("/api/admin/events/trigger", {
      characterId: selected.id,
      kind: triggerKind,
    });
    if (data) {
      setMessage(`✓ Triggered "${data.instance?.title ?? triggerKind}" for ${selected.name}`);
      await loadHistory(selected.id);
    }
  };

  // Manual trigger can fire any non-retired template regardless of weight.
  const triggerableDefinitions = definitions.filter((d) => d.status !== "retired");

  const activeInstance = history?.find(
    (i) => i.status === "pending" && i.expiresAtRealtimeMs > Date.now()
  );

  return (
    <div className="space-y-6">
      {/* Feature gate */}
      <div className="rounded-xl border border-card-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-foreground">Player random events</h3>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  flagEnabled === null
                    ? "bg-muted/15 text-muted"
                    : flagEnabled
                      ? "bg-amber-500/15 text-amber-500"
                      : "bg-muted/15 text-muted"
                }`}
              >
                {flagEnabled === null ? "…" : flagEnabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Master switch. Disabling stops new offers; pending events still sweep to their default
              option. Per-turn results are logged to the turn log under{" "}
              <code className="text-[11px]">phaseResults.playerRandomEvents</code>.
            </p>
            {flagEnabled === true &&
              definitions.length > 0 &&
              definitions.every((d) => d.status !== "approved") && (
                <p className="mt-2 text-xs font-semibold text-amber-500">
                  ⚠ Events are enabled but no templates are approved — nothing will fire until at
                  least one template below is approved.
                </p>
              )}
          </div>
          <button
            onClick={toggleFlag}
            disabled={busy || flagEnabled === null}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-35 ${
              flagEnabled
                ? "border-red-500/50 text-red-400 hover:bg-red-500/10"
                : "border-primary/50 text-primary hover:bg-primary/10"
            }`}
          >
            {flagEnabled ? "Disable Events" : "Enable Events"}
          </button>
        </div>
        {message && <p className="mt-3 text-sm text-foreground">{message}</p>}
      </div>

      {/* Template catalog */}
      <div className="rounded-xl border border-card-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-foreground">Event templates</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={seedDrafts}
              disabled={busy}
              className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:text-foreground disabled:opacity-35"
            >
              Seed PREE drafts
            </button>
            <button
              onClick={approveAll}
              disabled={busy || definitions.every((d) => d.status !== "draft")}
              className="rounded-lg border border-green-500/50 px-3 py-1.5 text-xs font-semibold text-green-500 transition-colors hover:bg-green-500/10 disabled:opacity-35"
            >
              Enable all events
            </button>
            <button
              onClick={reseedAndApproveAll}
              disabled={busy}
              className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
            >
              Reseed &amp; Approve All
            </button>
          </div>
        </div>
        <p className="mb-3 text-xs text-muted">
          Click any row to see its description, country scope, options, and every possible outcome.
        </p>
        {definitions.length === 0 ? (
          <p className="text-sm text-muted">
            No definitions yet — seed the PREE drafts to get started.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-card-border text-left text-xs uppercase tracking-wider text-muted">
                  <th className="py-2 pr-3">Template</th>
                  <th className="py-2 pr-3">Kind</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Eligibility</th>
                  <th className="py-2 pr-3">Weight</th>
                  <th className="py-2 pr-3">v</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {definitions.map((def) => {
                  const expanded = expandedDefId === def._id;
                  const scope =
                    def.requiresCountryIds && def.requiresCountryIds.length > 0
                      ? def.requiresCountryIds.join(", ")
                      : "All countries";
                  return (
                    <React.Fragment key={def._id}>
                      <tr
                        className="cursor-pointer border-b border-card-border/50 hover:bg-card-elevated/40"
                        onClick={() => setExpandedDefId(expanded ? null : def._id)}
                      >
                        <td className="py-2 pr-3 font-semibold text-foreground">
                          <span className="mr-1.5 inline-block text-muted">
                            {expanded ? "▾" : "▸"}
                          </span>
                          {def.title}
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs text-muted">{def.kind}</td>
                        <td className="py-2 pr-3">
                          <StatusPill status={def.status} />
                        </td>
                        <td className="py-2 pr-3 text-xs text-muted">
                          {def.eligibility.join(", ")}
                        </td>
                        <td className="py-2 pr-3 text-muted">{def.baseWeight}</td>
                        <td className="py-2 pr-3 text-muted">{def.version}</td>
                        <td className="py-2 text-right" onClick={(e) => e.stopPropagation()}>
                          {def.status === "draft" && (
                            <button
                              onClick={() => approveOrRetire(def._id, "approve")}
                              disabled={busy}
                              className="rounded border border-green-500/50 px-2 py-1 text-xs font-semibold text-green-500 hover:bg-green-500/10 disabled:opacity-35"
                            >
                              Approve
                            </button>
                          )}
                          {def.status === "approved" && (
                            <button
                              onClick={() => approveOrRetire(def._id, "retire")}
                              disabled={busy}
                              className="rounded border border-red-500/50 px-2 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/10 disabled:opacity-35"
                            >
                              Retire
                            </button>
                          )}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-b border-card-border/50 bg-card-elevated/20">
                          <td colSpan={7} className="px-4 py-3">
                            <p className="text-sm font-semibold text-foreground">{def.headline}</p>
                            <p className="mt-1 text-sm text-muted">{def.body}</p>
                            <p className="mt-2 text-[11px] uppercase tracking-wider text-muted">
                              Scope: <span className="text-foreground">{scope}</span>
                            </p>
                            <div className="mt-3 space-y-3">
                              {def.options.map((opt) => (
                                <div
                                  key={opt.id}
                                  className="rounded-lg border border-card-border bg-card px-3 py-2"
                                >
                                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                    {opt.label}
                                    {opt.isDefault && (
                                      <span className="rounded-full bg-muted/15 px-2 py-0.5 text-[10px] font-medium text-muted">
                                        Default
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted">{opt.description}</p>
                                  {opt.outcomes && opt.outcomes.length > 0 ? (
                                    <div className="mt-2 space-y-1">
                                      {opt.outcomes.map((t, i) => (
                                        <div
                                          key={i}
                                          className="flex flex-wrap items-baseline gap-x-2 text-xs"
                                        >
                                          <span className="font-semibold text-amber-600">
                                            {rollBandLabel(t)} ({t.minRoll}–{t.maxRoll})
                                          </span>
                                          <span className="text-foreground">{t.label}</span>
                                          <span className="text-muted">
                                            {t.effects.length > 0
                                              ? t.effects.map(formatEffect).join(", ")
                                              : "no effect"}
                                          </span>
                                          {t.newsWire && (
                                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                              📰 wire
                                            </span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="mt-1 text-[11px] italic text-muted">
                                      No registered handler — outcomes unavailable.
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Event debugger */}
      <div className="rounded-xl border border-card-border bg-card p-5">
        <h3 className="text-sm font-bold text-foreground">Event debugger</h3>
        <p className="mt-1 text-xs text-muted">
          Look up a character to inspect their active event and full event history (choice, roll,
          outcome).
        </p>
        <div className="mt-3 max-w-md">
          <PlayerSelector
            placeholder="Search for a character…"
            onSelect={(c) => {
              setSelected({ id: c.id, name: c.name });
              loadHistory(c.id);
            }}
          />
        </div>

        {selected && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-semibold text-foreground">{selected.name}</span>
              {cooldown && (
                <span className="rounded-full bg-card-elevated px-2.5 py-1 text-xs text-muted">
                  Next eligible turn: {cooldown.nextEligibleTurn} (last event turn{" "}
                  {cooldown.lastExpiredAtTurn})
                </span>
              )}
              {history && !activeInstance && (
                <span className="text-xs text-muted">No active event</span>
              )}
            </div>

            {/* Manual trigger */}
            <div className="rounded-lg border border-card-border bg-card-elevated px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                Manual trigger
              </div>
              <p className="mt-1 text-xs text-muted">
                Force-offer any template to {selected.name}, bypassing weight, cooldown, and
                eligibility. Outcome roll is random. Fails if they already have a pending event.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  value={triggerKind}
                  onChange={(e) => setTriggerKind(e.target.value)}
                  className="min-w-[16rem] rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground"
                >
                  <option value="">Select an event…</option>
                  {triggerableDefinitions.map((def) => (
                    <option key={def._id} value={def.kind}>
                      {def.title} ({def.eligibility.join(", ")})
                      {def.status === "draft" ? " · draft" : ""}
                    </option>
                  ))}
                </select>
                <button
                  onClick={triggerEvent}
                  disabled={busy || !triggerKind || !!activeInstance}
                  className="rounded-lg border border-primary/50 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  Trigger event
                </button>
              </div>
              {activeInstance && (
                <p className="mt-2 text-xs text-amber-500">
                  Resolve or expire the active event before triggering a new one.
                </p>
              )}
            </div>

            {historyLoading && <p className="text-sm text-muted">Loading…</p>}

            {activeInstance && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-amber-600">
                  Active event
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-semibold text-foreground">{activeInstance.title}</span>
                  <span className="text-xs text-muted">
                    offered turn {activeInstance.offeredAtTurn} · roll {activeInstance.roll} ·
                    expires {new Date(activeInstance.expiresAtRealtimeMs).toLocaleString("en-US")}
                  </span>
                </div>
              </div>
            )}

            {history && history.length === 0 && !historyLoading && (
              <p className="text-sm text-muted">No event history for this character.</p>
            )}

            {history && history.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-card-border text-left text-xs uppercase tracking-wider text-muted">
                      <th className="py-2 pr-3">Turn</th>
                      <th className="py-2 pr-3">Event</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Choice</th>
                      <th className="py-2 pr-3">Outcome</th>
                      <th className="py-2 pr-3">Roll</th>
                      <th className="py-2">Resolved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => (
                      <tr key={row.instanceId} className="border-b border-card-border/50">
                        <td className="py-2 pr-3 text-muted">{row.offeredAtTurn}</td>
                        <td className="py-2 pr-3 font-semibold text-foreground">{row.title}</td>
                        <td className="py-2 pr-3">
                          <StatusPill status={row.status} />
                        </td>
                        <td className="py-2 pr-3 text-foreground">
                          {row.resolvedOptionLabel ?? "—"}
                          {row.resolveReason === "timeout" && (
                            <span className="ml-1.5 text-[10px] text-red-400">(timeout)</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-muted">{row.resolvedTierLabel ?? "—"}</td>
                        <td className="py-2 pr-3 text-muted">{row.roll}</td>
                        <td className="py-2 text-xs text-muted">
                          {row.resolvedAt ? new Date(row.resolvedAt).toLocaleString("en-US") : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
