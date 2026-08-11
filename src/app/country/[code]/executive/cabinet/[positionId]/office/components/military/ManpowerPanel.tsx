"use client";

import { useState } from "react";
import type { ManpowerView } from "../../useCabinetOffice";
import { SectionCard, Tile, Badge, Meter } from "../dossier";

const MODE_LABEL: Record<ManpowerView["mode"], string> = {
  off: "No replacements",
  trained: "Trained replacements",
  conscript: "Conscripts",
};

/**
 * The replacement-manpower pool and how it feeds under-strength units.
 *
 * Conscription is a legislated capability, not a cabinet toggle — when the enacted
 * reserve law forbids it the option is disabled and the stance named, so the holder can
 * see *why* rather than finding the setting silently ignored at the turn tick.
 */
export function ManpowerPanel({
  manpower,
  countryCode,
  positionId,
  canWrite,
}: {
  manpower: ManpowerView;
  countryCode: string;
  positionId: string;
  canWrite: boolean;
}) {
  const [mode, setMode] = useState<ManpowerView["mode"]>(manpower.mode);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (next: ManpowerView["mode"]) => {
    const previous = mode;
    setMode(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/country/${countryCode}/executive/cabinet/${positionId}/manpower`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: next }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        // Surface the refusal and roll back rather than showing a mode that was rejected.
        setMode(previous);
        setError(body?.error ?? "Could not change the reinforcement mode.");
      }
    } catch {
      setMode(previous);
      setError("Could not change the reinforcement mode.");
    } finally {
      setSaving(false);
    }
  };

  const fmt = (n: number) => n.toLocaleString("en-US");

  return (
    <SectionCard
      title="Replacement manpower"
      sub="The pool under-strength units draw from each turn"
      right={<Badge tone="gov">{manpower.stanceLabel}</Badge>}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile label="Pool" value={fmt(manpower.pool)} />
        <Tile label="Per turn" value={`+${fmt(manpower.regenPerTurn)}`} tone="up" />
        <Tile label="Ceiling" value={fmt(manpower.poolCap)} tone="muted" />
      </div>

      <div className="mt-3">
        <Meter value={manpower.pool} max={Math.max(1, manpower.poolCap)} />
      </div>

      <div className="mt-4">
        <label htmlFor="reinforcement-mode" className="dossier-label mb-1.5 block text-muted">
          Reinforcement mode
        </label>
        {canWrite ? (
          <select
            id="reinforcement-mode"
            aria-label="Reinforcement mode"
            value={mode}
            disabled={saving}
            onChange={(e) => void save(e.target.value as ManpowerView["mode"])}
            className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-[13px] text-foreground"
          >
            <option value="off">{MODE_LABEL.off}</option>
            <option value="trained">{MODE_LABEL.trained}</option>
            <option value="conscript" disabled={!manpower.conscriptAllowed}>
              {MODE_LABEL.conscript}
              {manpower.conscriptAllowed ? "" : ` — not permitted under ${manpower.stanceLabel}`}
            </option>
          </select>
        ) : (
          <p className="text-[13px] text-foreground">{MODE_LABEL[mode]}</p>
        )}
        {!manpower.conscriptAllowed && (
          <p className="mt-1.5 text-[11px] text-muted">
            Conscription requires a reserve law that permits it.
          </p>
        )}
        {error && <p className="mt-1.5 text-[11px] text-error">{error}</p>}
      </div>
    </SectionCard>
  );
}
