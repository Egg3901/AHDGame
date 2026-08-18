"use client";

import { useState } from "react";
import { COUNTRY_CONFIGS, COUNTRY_ORDER } from "@/lib/constants/countries";
import type { AutoCooldownRow, AutoTemplate } from "./crisisAdminTypes";

interface AutoCrisisPanelProps {
  autoTemplates: AutoTemplate[];
  autoCooldowns: AutoCooldownRow[];
  currentTurn: number | null;
  setMessage: (message: string) => void;
  onRefresh: () => void;
}

export function AutoCrisisPanel({
  autoTemplates,
  autoCooldowns,
  currentTurn,
  setMessage,
  onRefresh,
}: AutoCrisisPanelProps) {
  const [showAuto, setShowAuto] = useState(false);
  const [forceCountry, setForceCountry] = useState<string>(COUNTRY_ORDER[0]);
  const [forcingKey, setForcingKey] = useState<string | null>(null);
  const [startingVietnam, setStartingVietnam] = useState(false);

  const handleStartVietnam = async () => {
    setStartingVietnam(true);
    try {
      const res = await fetch("/api/admin/crises/vietnam-start", { method: "POST" });
      const data = await res.json();
      setMessage(data.message ?? (res.ok ? "Vietnam chain started" : "Failed to start Vietnam"));
      if (res.ok && data.started) onRefresh();
    } catch {
      setMessage("Failed to start Vietnam");
    } finally {
      setStartingVietnam(false);
    }
  };

  const handleForceTrigger = async (key: string, needsCountry: boolean) => {
    setForcingKey(key);
    try {
      const body: Record<string, unknown> = { templateKey: key };
      if (needsCountry) body.countryId = forceCountry;
      const res = await fetch("/api/admin/crises/force-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setMessage(res.ok ? "Crisis triggered" : (data.error ?? "Failed to trigger crisis"));
      if (res.ok) onRefresh();
    } catch {
      setMessage("Failed to trigger crisis");
    } finally {
      setForcingKey(null);
    }
  };

  return (
    <div className="rounded border border-border">
      <button
        onClick={() => setShowAuto((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold hover:bg-accent/40"
      >
        <span>Auto Crisis System</span>
        <span className="text-muted">{showAuto ? "▾" : "▸"}</span>
      </button>
      {showAuto && (
        <div className="space-y-4 border-t border-border p-3">
          <p className="text-xs text-muted">
            Gated by the Auto-Disasters master toggle above. Regional disasters spawn on a
            per-country cadence; economic and political crises trigger on national metrics
            (condition) or a deterministic per-turn roll (random). Each template has its own
            cooldown.
            {currentTurn != null && (
              <>
                {" "}
                Current turn: <span className="tabular-nums">{currentTurn}</span>.
              </>
            )}
          </p>

          <div className="rounded border border-border bg-accent/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Vietnam escalation chain</p>
                <p className="text-xs text-muted">
                  Starts the chain now instead of waiting for the turn loop: opens the advisory
                  rung, gives Washington and Moscow a commitment decision each with a 24 hour
                  window, and files the wire coverage. Safe to press twice; it only ever starts once
                  per world, and only inside the 1955 to 1975 window.
                </p>
              </div>
              <button
                onClick={handleStartVietnam}
                disabled={startingVietnam}
                className="shrink-0 rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                {startingVietnam ? "Starting..." : "Start Vietnam chain"}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <label className="text-muted">Force-trigger country:</label>
            <select
              value={forceCountry}
              onChange={(e) => setForceCountry(e.target.value)}
              className="rounded border border-border bg-background px-2 py-1 text-sm"
            >
              {COUNTRY_ORDER.map((c) => (
                <option key={c} value={c}>
                  {COUNTRY_CONFIGS[c].name}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted">(ignored for global crises)</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="py-2 pr-4">Template</th>
                  <th className="py-2 pr-4">Kind</th>
                  <th className="py-2 pr-4">Scope</th>
                  <th className="py-2 pr-4">Gating</th>
                  <th className="py-2 pr-4">Trigger</th>
                  <th className="py-2 pr-4">Cooldown</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {autoTemplates.map((t) => {
                  const gating = [
                    t.countries?.length ? t.countries.join("/") : "all",
                    t.excludeCountries?.length ? `−${t.excludeCountries.join("/")}` : "",
                    t.requiresRegionTags?.length ? `[${t.requiresRegionTags.join(",")}]` : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  const trigger =
                    t.kind === "random"
                      ? `${((t.spawnChance ?? 0) * 100).toFixed(1)}%/turn`
                      : t.kind === "condition"
                        ? (t.conditionSummary ?? "—")
                        : "cadence";
                  return (
                    <tr key={t.key} className="border-b border-border/50">
                      <td className="py-2 pr-4 font-medium">{t.name}</td>
                      <td className="py-2 pr-4">{t.kind}</td>
                      <td className="py-2 pr-4">{t.scope}</td>
                      <td className="py-2 pr-4 text-xs text-muted">{gating}</td>
                      <td className="py-2 pr-4 text-xs">{trigger}</td>
                      <td className="py-2 pr-4 tabular-nums">{t.cooldownTurns}</td>
                      <td className="py-2">
                        <button
                          className="text-primary hover:underline disabled:opacity-50"
                          disabled={forcingKey === t.key}
                          onClick={() => handleForceTrigger(t.key, t.scope !== "global")}
                        >
                          {forcingKey === t.key ? "Triggering…" : "Trigger now"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {autoTemplates.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-3 text-center text-muted">
                      No auto-templates
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {autoCooldowns.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-semibold">On cooldown</h4>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted">
                      <th className="py-1 pr-4">Template</th>
                      <th className="py-1 pr-4">Scope</th>
                      <th className="py-1 pr-4">Last spawn (turn)</th>
                      <th className="py-1">Turns remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {autoCooldowns.map((c) => (
                      <tr
                        key={`${c.templateKey}:${c.scopeKey}`}
                        className="border-b border-border/50"
                      >
                        <td className="py-1 pr-4">{c.templateKey}</td>
                        <td className="py-1 pr-4">{c.scopeKey}</td>
                        <td className="py-1 pr-4 tabular-nums">{c.lastSpawnTurn}</td>
                        <td className="py-1 tabular-nums">
                          {c.remaining > 0 ? c.remaining : "ready"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
