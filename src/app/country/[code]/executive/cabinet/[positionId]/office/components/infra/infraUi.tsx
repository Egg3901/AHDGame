"use client";

import type { ReactNode } from "react";

// Inline-SVG glyphs keyed to the infra archetype icon keys (matches the energyUi /
// estatesUi inline-icon pattern; no external icon dependency).
const ICON_PATHS: Record<string, string> = {
  road: "M4 21l3-18M20 21l-3-18M12 5v2m0 4v2m0 4v2",
  train:
    "M6 3h12a2 2 0 012 2v9a3 3 0 01-3 3H7a3 3 0 01-3-3V5a2 2 0 012-2zm0 6h12M8 21l-2-2m12 2l-2-2M9 13h.01M15 13h.01",
  bridge: "M2 9h20M2 9c4 0 4 8 4 8m16-8c-4 0-4 8-4 8M6 9v8m12-8v8M9 9v4m6-4v4M2 17h20",
  wifi: "M5 12a10 10 0 0114 0M8 15a6 6 0 018 0M11 18a2 2 0 012 0",
  truck: "M3 16V6h11v10M14 9h4l3 3v4h-7M7 19a2 2 0 100-0.01M18 19a2 2 0 100-0.01",
  plane: "M21 15l-9-3V5a2 2 0 00-4 0v7l-5 2v2l5-1v3l-2 1v1l4-1 4 1v-1l-2-1v-3l6 1z",
};

/** Format a millions-denominated figure into a currency string. */
export function fmtMoneyM(sym: string, millions: number): string {
  const v = millions * 1e6;
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${sym}${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sym}${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sym}${(v / 1e6).toFixed(0)}M`;
  return `${sym}${Math.round(v).toLocaleString("en-US")}`;
}

/** Format an absolute-currency figure into a string. */
export function fmtMoneyAbs(sym: string, v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${sym}${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sym}${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sym}${(v / 1e6).toFixed(0)}M`;
  return `${sym}${Math.round(v).toLocaleString("en-US")}`;
}

export function InfraIcon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
        d={ICON_PATHS[name] || ICON_PATHS.road}
      />
    </svg>
  );
}

export function AggTile({
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
    <div className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-3.5">
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
