"use client";

import { useState } from "react";
import { GROUND_GAME_PRESETS } from "@/lib/constants/groundGamePresets";

const card = "rounded-2xl border border-card-border bg-card p-5 shadow-card";

/**
 * Preset-card ground-game spender for an eligible same-nation viewer. Officials
 * spend Political Strength; volunteers spend Actions + Campaign Funds. The
 * active target (whole electorate or a tapped cohort) comes from the page via
 * `?target=`. Posts the chosen preset + target and reloads; the backend
 * authorizes + debits.
 */
export function GroundGameControl({
  countryId,
  referendumId,
  mode,
  target,
  targetName,
  saturation,
  labels,
}: {
  countryId: string;
  referendumId: string;
  mode: "official" | "volunteer";
  target: "whole" | { groupId: string };
  targetName: string;
  saturation: number;
  labels: { yes: string; no: string };
}) {
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saturated = saturation >= 0.99;

  async function run(presetId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/country/${countryId.toLowerCase()}/referendum/${referendumId}/ground-game`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ side, presetId, target, mode }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Action failed.");
        setBusy(false);
        return;
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
      setBusy(false);
    }
  }

  const sideBtn = (s: "yes" | "no", tone: string) =>
    `flex-1 rounded-lg border px-3 py-2 text-[12.5px] font-bold transition-colors ${
      side === s ? `${tone} text-white` : "border-card-border text-muted hover:text-foreground"
    }`;

  return (
    <div className={card}>
      <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted">
        Ground game · {mode}
      </div>
      {error && (
        <div className="mb-2 rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-500">
          {error}
        </div>
      )}

      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted">
        You are campaigning for
      </div>
      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => setSide("yes")}
          className={sideBtn("yes", "border-[var(--ref-yes)] bg-[var(--ref-yes)]")}
        >
          {labels.yes}
        </button>
        <button
          type="button"
          onClick={() => setSide("no")}
          className={sideBtn("no", "border-[var(--ref-no)] bg-[var(--ref-no)]")}
        >
          {labels.no}
        </button>
      </div>

      <div className="mb-3 text-[11px] text-muted">
        Targeting: <span className="font-semibold text-foreground">{targetName}</span> · campaign
        saturation {Math.round(saturation * 100)}%
      </div>

      <div className="flex flex-col gap-2">
        {GROUND_GAME_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={busy || saturated}
            onClick={() => run(p.id)}
            className="flex items-center gap-3 rounded-xl border border-card-border px-4 py-3 text-left transition-colors hover:border-primary/50 disabled:opacity-50"
          >
            <span
              data-ref="gg-icon"
              className="h-2.5 w-2.5 flex-none rounded-full"
              style={{
                background: p.effect === "mobilize" ? "var(--ref-amber)" : "var(--ref-yes)",
              }}
            />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-bold">{p.label}</div>
              <div className="mt-0.5 text-[11px] text-muted">
                {p.effect === "mobilize"
                  ? `≈${p.nominalSwing.toFixed(2)}% · mobilize · your base`
                  : `+${p.nominalSwing.toFixed(2)}% swing · persuade`}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold">
                {mode === "official" ? (
                  <span className="rounded-md bg-primary/10 px-2 py-0.5 text-primary">
                    {p.ps} PS
                  </span>
                ) : (
                  <>
                    <span className="rounded-md border border-card-border px-2 py-0.5 text-muted">
                      £{(p.funds / 1000).toFixed(0)}k
                    </span>
                    <span className="rounded-md border border-card-border px-2 py-0.5 text-[var(--ref-amber)]">
                      {p.actions} AP
                    </span>
                  </>
                )}
              </div>
            </div>
            <span className="flex-none text-[12px] font-bold text-[var(--ref-yes)]">
              {p.effect === "mobilize" ? "≈" : "+"}
              {p.nominalSwing.toFixed(2)}%
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
