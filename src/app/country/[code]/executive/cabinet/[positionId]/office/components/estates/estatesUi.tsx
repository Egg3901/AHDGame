"use client";

import type { ReactNode } from "react";

// Simple inline-SVG glyphs keyed to the estate archetype icon keys (matches the
// militaryUi inline-icon pattern; no external icon dependency).
const ICON_PATHS: Record<string, string> = {
  school: "M3 21h18M5 21V8l7-4 7 4v13M9 21v-5h6v5",
  graduation: "M12 3L2 8l10 5 10-5-10-5zM6 11v5c0 1 3 2 6 2s6-1 6-2v-5",
  wrench: "M14 7a4 4 0 00-5 5l-6 6 2 2 6-6a4 4 0 005-5l-3 3-2-2 3-3z",
  hospital: "M4 21V5a1 1 0 011-1h14a1 1 0 011 1v16M10 8h4M12 6v4m-2 2h4",
  stethoscope: "M5 4v5a4 4 0 008 0V4M9 13v3a4 4 0 008 0v-2m0-3a2 2 0 100 4 2 2 0 000-4z",
  microscope: "M6 18h10M9 18l-1-4M15 8l-4 6M14 4l3 3-5 5-3-3 5-5zM5 21h14",
  shield: "M12 3l8 3v6c0 4-3 7-8 9-5-2-8-5-8-9V6l8-3z",
  scale: "M12 3v18M6 21h12M4 7l8-2 8 2M6 7l-2 6h4l-2-6zm12 0l-2 6h4l-2-6z",
  gavel: "M14 4l6 6-3 3-6-6 3-3zM9 9l-6 6 3 3 6-6M4 21h8",
  tree: "M12 2l5 7h-3l4 6h-4v5h-4v-5H6l4-6H7l5-7z",
  recycle: "M12 3l3 5h-6l3-5zM5 14l-2 4 4 1m12-5l2 4-4 1",
  leaf: "M5 21c0-8 6-14 14-14 0 8-6 14-14 14zM5 21c4-4 7-7 9-9",
  sprout: "M12 22V11M12 11C12 7 9 5 5 5c0 4 3 6 7 6zm0 0c0-3 3-5 7-5 0 3-3 5-7 5z",
  tractor:
    "M7 17a3 3 0 106 0 3 3 0 00-6 0zM18 18a2 2 0 104 0 2 2 0 00-4 0zM4 17V8h6l2 4h6v4M7 8V5h3",
  wheat:
    "M12 22V9m0 0c-2-1-2-4 0-6 2 2 2 5 0 6zm0 4c-2-1-4-1-5 1 2 1 4 1 5-1zm0 0c2-1 4-1 5 1-2 1-4 1-5-1z",
  briefcase: "M3 8h18v11a1 1 0 01-1 1H4a1 1 0 01-1-1V8zm6 0V5a1 1 0 011-1h4a1 1 0 011 1v3",
  package: "M12 3l8 4v10l-8 4-8-4V7l8-4zM4 7l8 4 8-4M12 11v10",
  lightbulb: "M9 18h6m-5 3h4M12 3a6 6 0 00-4 10c1 1 1 2 1 3h6c0-1 0-2 1-3a6 6 0 00-4-10z",
  users:
    "M9 11a3 3 0 100-6 3 3 0 000 6zm7 0a3 3 0 100-6M3 20v-1a5 5 0 015-5h2a5 5 0 015 5v1m2 0v-1a5 5 0 00-3-4.6",
  hardhat: "M4 17h16v2H4zM5 16a7 7 0 0114 0M10 6h4v3h-4z",
  home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  siren: "M7 18v-5a5 5 0 0110 0v5M5 21h14M12 3v2M5 8L4 7m15 1l1-1",
  mapPin: "M12 22s7-6 7-12a7 7 0 10-14 0c0 6 7 12 7 12zm0-9a3 3 0 100-6 3 3 0 000 6z",
  landmark: "M3 21h18M4 21V10m4 11V10m4 11V10m4 11V10m4 11V10M2 10l10-6 10 6H2z",
  building: "M5 21V4a1 1 0 011-1h8a1 1 0 011 1v17M15 21V9h4v12M8 7h2m-2 4h2m-2 4h2",
  palette:
    "M12 3a9 9 0 000 18c1 0 2-1 2-2s-1-2-1-3 1-1 2-1h2a4 4 0 004-4c0-4-4-8-9-8zm-4 9a1 1 0 110-2 1 1 0 010 2zm2-4a1 1 0 110-2 1 1 0 010 2zm5 0a1 1 0 110-2 1 1 0 010 2z",
  factory: "M3 21h18M4 21V10l5 3v-3l5 3v-3l5 3v8M7 7V3h3v4",
  book: "M4 5a2 2 0 012-2h12v16H6a2 2 0 00-2 2V5zM8 7h8M8 11h5",
  film: "M3 5h18v14H3V5zm0 4h18M3 15h18M7 5v14m10-14v14",
};

/** Icon keys with a glyph, exported so the estate catalog test can pin them. */
export const ICON_KEYS = Object.keys(ICON_PATHS);

/** Format a millions-denominated figure (upkeep) into a currency string. */
export function fmtMoneyM(sym: string, millions: number): string {
  const v = millions * 1e6;
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${sym}${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sym}${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sym}${(v / 1e6).toFixed(0)}M`;
  return `${sym}${Math.round(v).toLocaleString("en-US")}`;
}

/** Format an absolute-currency figure (the portfolio envelope) into a string. */
export function fmtMoneyAbs(sym: string, v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${sym}${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sym}${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sym}${(v / 1e6).toFixed(0)}M`;
  return `${sym}${Math.round(v).toLocaleString("en-US")}`;
}

export function EstateIcon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
        d={ICON_PATHS[name] || ICON_PATHS.building}
      />
    </svg>
  );
}

function conditionHex(v: number): string {
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
  const col = conditionHex(value);
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
