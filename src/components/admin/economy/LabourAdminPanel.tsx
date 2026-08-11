"use client";

import { useState, useEffect, useCallback } from "react";

type LabourMode = "off" | "wages" | "macro" | "unions" | "full";

const MODE_INFO: Record<LabourMode, { label: string; description: string; live: boolean }> = {
  off: { label: "Off", description: "Today's economy, unchanged.", live: true },
  wages: {
    label: "Wages",
    description:
      "Explicit labor cost (baseline-invariant), CEO wage slider, minimum wage, and automation tech.",
    live: true,
  },
  macro: {
    label: "Macro",
    description: "Wages feed unemployment / migration / politics.",
    live: true,
  },
  unions: {
    label: "Unions",
    description:
      "NPC unionization and strikes (concede or wait it out), plus CEO union-busting as a paid, backfire-prone action.",
    live: true,
  },
  full: {
    label: "Full",
    description:
      "Player-run unions: players claim an industry, recruit, call strikes, demand wages, and weigh in on legislation.",
    live: true,
  },
};

const MODE_ORDER: LabourMode[] = ["off", "wages", "macro", "unions", "full"];

export function LabourAdminPanel() {
  const [mode, setMode] = useState<LabourMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Minimum wage (per-country Kaitz ratio).
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const [country, setCountry] = useState("US");
  const [kaitz, setKaitz] = useState(0.4);
  const [mwSaving, setMwSaving] = useState(false);
  const [mwMessage, setMwMessage] = useState("");

  const fetchStatus = useCallback(async () => {
    try {
      const [modeRes, mwRes] = await Promise.all([
        fetch("/api/admin/config/labour"),
        fetch("/api/admin/config/minimum-wage"),
      ]);
      if (modeRes.ok) setMode(((await modeRes.json()) as { mode: LabourMode }).mode);
      if (mwRes.ok) setRatios(((await mwRes.json()) as { ratios: Record<string, number> }).ratios);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleSetMode = async (newMode: LabourMode) => {
    if (mode === null || mode === newMode) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/admin/config/labour", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
      });
      if (!res.ok) {
        setError(((await res.json()) as { error?: string }).error || "Failed to update mode");
        return;
      }
      setMessage(`Labour system set to "${newMode}".`);
      await fetchStatus();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  };

  const handleSetMinWage = async () => {
    setMwSaving(true);
    setMwMessage("");
    try {
      const res = await fetch("/api/admin/config/minimum-wage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countryId: country.trim().toUpperCase(), kaitzRatio: kaitz }),
      });
      const data = (await res.json()) as {
        error?: string;
        countryId?: string;
        kaitzRatio?: number;
      };
      if (!res.ok) {
        setMwMessage(`Error: ${data.error || "Failed to set"}`);
        return;
      }
      setMwMessage(
        `${data.countryId}: minimum wage set to ${Math.round((data.kaitzRatio ?? 0) * 100)}% of median.`
      );
      await fetchStatus();
    } catch {
      setMwMessage("Error: Network error");
    } finally {
      setMwSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted">Loading labour settings…</span>
        </div>
      </div>
    );
  }

  const currentMode = mode ?? "off";

  return (
    <div className="space-y-6">
      {/* ─── Labour system mode ─── */}
      <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Labour system</h3>
          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${
              currentMode === "off" ? "bg-warning/15 text-warning" : "bg-success/15 text-success"
            }`}
          >
            {MODE_INFO[currentMode].label}
          </span>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-muted">
          {MODE_INFO[currentMode].description} Graduated — each tier is a superset of the previous.
          Off by default; all five tiers are implemented (see{" "}
          <code className="rounded bg-background px-1 py-0.5">src/lib/labour/featureFlag.ts</code>{" "}
          for exactly what each gates) — this world is currently running at &quot;{currentMode}
          &quot;.
        </p>

        {error ? (
          <p className="mb-3 text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="mb-3 text-xs text-success" role="status">
            {message}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {MODE_ORDER.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => void handleSetMode(m)}
              disabled={saving || currentMode === m}
              title={MODE_INFO[m].description}
              className={`rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                currentMode === m
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-card-border bg-background hover:bg-card"
              }`}
            >
              {MODE_INFO[m].label}
              {!MODE_INFO[m].live ? (
                <span className="ml-1 text-[10px] text-muted">(planned)</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Minimum wage (per country) ─── */}
      <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
        <h3 className="mb-1 text-sm font-semibold">Minimum wage</h3>
        <p className="mb-4 text-xs leading-relaxed text-muted">
          Per-country Kaitz ratio (minimum wage ÷ median wage), 0–1. Floors low-pay sectors&apos;
          labor cost. Active only when the labour system is at Wages or above. 0 = no floor.
        </p>

        {Object.keys(ratios).length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {Object.entries(ratios).map(([cid, r]) => (
              <span
                key={cid}
                className="rounded-md border border-card-border bg-background px-2.5 py-1 text-xs"
              >
                <span className="font-semibold">{cid}</span>: {Math.round(r * 100)}%
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted">
            Country
            <input
              type="text"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="mt-1 block w-20 rounded-lg border border-card-border bg-background px-3 py-2 text-sm uppercase focus:border-primary/60 focus:outline-none"
            />
          </label>
          <label className="text-xs text-muted">
            Kaitz ratio
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={kaitz}
              onChange={(e) => setKaitz(Math.max(0, Math.min(1, Number(e.target.value))))}
              className="mt-1 block w-24 rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleSetMinWage()}
            disabled={mwSaving || !country.trim()}
            className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {mwSaving ? "Saving…" : "Set"}
          </button>
        </div>
        {mwMessage ? (
          <p
            className="mt-3 text-xs"
            role="status"
            style={{
              color: mwMessage.startsWith("Error") ? "var(--destructive)" : "var(--success)",
            }}
          >
            {mwMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}
