"use client";

import type { ReactNode } from "react";
import type { EnergySource } from "@/lib/db/types/energyPlant";

// Inline-SVG glyphs keyed to the energy source icon keys (matches the estatesUi /
// militaryUi inline-icon pattern; no external icon dependency).
const ICON_PATHS: Record<string, string> = {
  coal: "M5 17a4 4 0 011-7 5 5 0 019-2 4 4 0 011 9H6a3 3 0 01-1-0zM8 21l1-2m3 2l1-2m3 2l1-2",
  flame: "M12 3c1 3 4 4 4 8a4 4 0 01-8 0c0-2 1-3 2-4 1 1 1 2 2 2 1-2-1-4 0-6z",
  atom: "M12 12a2 2 0 100-0.01M4 12c4-6 12-6 16 0-4 6-12 6-16 0zm8-8c6 4 6 12 0 16-6-4-6-12 0-16z",
  droplet: "M12 3c4 5 6 8 6 11a6 6 0 01-12 0c0-3 2-6 6-11z",
  wind: "M3 8h10a2 2 0 100-4M3 12h14a2 2 0 110 4M3 16h7a2 2 0 110 4",
  sun: "M12 7a5 5 0 100 10 5 5 0 000-10zM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19",
};

export const SOURCE_COLOR: Record<EnergySource, string> = {
  coal: "#6b7280",
  gas: "#f59e0b",
  nuclear: "#a855f7",
  hydro: "#38bdf8",
  wind: "#4ade80",
  solar: "#fbbf24",
};

/** Format a millions-denominated figure (upkeep) into a currency string. */
export function fmtMoneyM(sym: string, millions: number): string {
  const v = millions * 1e6;
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${sym}${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sym}${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sym}${(v / 1e6).toFixed(0)}M`;
  return `${sym}${Math.round(v).toLocaleString("en-US")}`;
}

/** Format an absolute-currency figure (the energy envelope) into a string. */
export function fmtMoneyAbs(sym: string, v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${sym}${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sym}${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sym}${(v / 1e6).toFixed(0)}M`;
  return `${sym}${Math.round(v).toLocaleString("en-US")}`;
}

/** Format a megawatt capacity into a GW/MW string. */
export function fmtCapacity(mw: number): string {
  if (mw >= 1000) return `${(mw / 1000).toFixed(1)} GW`;
  return `${Math.round(mw)} MW`;
}

export function EnergyIcon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
        d={ICON_PATHS[name] || ICON_PATHS.flame}
      />
    </svg>
  );
}

function condHex(v: number): string {
  return v >= 80 ? "#22c55e" : v >= 60 ? "#4ade80" : v >= 40 ? "#eab308" : "#f59e0b";
}

export function Ring({
  value,
  size = 44,
  stroke = 5,
}: {
  value: number;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const col = condHex(value);
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--card-muted,#11111a)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={col}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - value / 100)}
        />
      </svg>
      <span className="tabular absolute font-bold" style={{ color: col, fontSize: size * 0.3 }}>
        {value}
      </span>
    </div>
  );
}

export function AggTile({
  label,
  value,
  tone,
  ring,
}: {
  label: string;
  value: string | number;
  tone?: "gov" | "up" | "down" | "warning";
  ring?: number;
}) {
  const toneClass =
    tone === "up"
      ? "text-success"
      : tone === "down"
        ? "text-error"
        : tone === "warning"
          ? "text-warning"
          : tone === "gov"
            ? "text-gov-soft"
            : "text-foreground";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-3.5">
      {ring != null && <Ring value={ring} size={42} stroke={5} />}
      <div>
        <div className="dossier-label text-muted">{label}</div>
        <div className={`tabular mt-0.5 text-lg font-bold ${toneClass}`}>{value}</div>
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "gov" | "up" | "down" | "warning";
}) {
  const toneClass =
    tone === "up"
      ? "text-success"
      : tone === "down"
        ? "text-error"
        : tone === "warning"
          ? "text-warning"
          : tone === "gov"
            ? "text-gov-soft"
            : "text-foreground";
  return (
    <div>
      <div className="dossier-label !text-[9px] text-muted">{label}</div>
      <div className={`tabular mt-0.5 text-[14px] font-bold ${toneClass}`}>{value}</div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl border border-card-border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <div className="mt-2 text-[13px] leading-relaxed text-muted">{body}</div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-card-border px-4 py-2 text-[13px] font-medium text-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg border border-error/40 bg-error/10 px-4 py-2 text-[13px] font-semibold text-error hover:bg-error/20"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
