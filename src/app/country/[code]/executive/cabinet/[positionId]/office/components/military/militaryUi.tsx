"use client";

import type { ReactNode } from "react";
import type { UnitDomain } from "@/lib/db/types/militaryUnit";

const ICON_PATHS: Record<string, string> = {
  tank: "M3 13h18v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3zm2-3h8l2 3H5l0-3zm9-2h6v2h-6V8z",
  soldier: "M12 4a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM7 21v-6l-2-1 1-4h12l1 4-2 1v6",
  artillery: "M3 17h7l8-6 2 2-7 6H3v-2zm10-7l4-3",
  missile: "M12 2c2 2 3 5 3 9l-1 7h-4l-1-7c0-4 1-7 3-9zM7 15l-2 4m12-4l2 4",
  carrier: "M2 16h20l-2 4H4l-2-4zm4-2V8h3v6m3-6v6m3-9v9",
  ship: "M3 16h18l-2 4H5l-2-4zm3-2V9h12v5M10 9V5h4v4",
  sub: "M3 13c4-3 14-3 18 0-4 3-14 3-18 0zm9-3V6m-3 7v3m6-3v3",
  jet: "M12 3l2 8 7 3v2l-7-1-1 5 2 2v1l-3-1-3 1v-1l2-2-1-5-7 1v-2l7-3 2-8z",
  transport: "M2 14h20l-3 3H5l-3-3zm5-2V8h10v4M9 8V6h6v2",
  drone: "M5 7h14M12 7v6m-4 4h8M6 5l2 2m10-2l-2 2",
  satellite: "M5 12l-2-2 3-3 2 2m4 4l2 2 3-3-2-2m-7-1l3 3M9 9l-2 5 5-2",
};

/** Format a millions-denominated figure (upkeep) into a currency string. */
/**
 * Force upkeep in REAL money.
 *
 * `upkeepBase`/`effectiveUpkeep` are an abstract index shared by every country — a British
 * and an American division both cost 70 — so they are NOT currency, and pushing them through
 * a money formatter prints a 4,400-point index as "$4.4B". `perIndexUnit` is the country's
 * real per-turn appropriation charge divided by its total index, which converts any share of
 * the index into the money that share actually costs.
 */
export function fmtUpkeepMoney(sym: string, index: number, perIndexUnit: number): string {
  return fmtMoneyAbs(sym, index * perIndexUnit);
}

export function fmtMoneyM(sym: string, millions: number): string {
  const v = millions * 1e6;
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${sym}${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sym}${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sym}${(v / 1e6).toFixed(0)}M`;
  return `${sym}${Math.round(v).toLocaleString("en-US")}`;
}

/** Format an absolute-currency figure (the defence appropriation) into a string. */
export function fmtMoneyAbs(sym: string, v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${sym}${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sym}${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sym}${(v / 1e6).toFixed(0)}M`;
  return `${sym}${Math.round(v).toLocaleString("en-US")}`;
}

export function MilIcon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
        d={ICON_PATHS[name] || ICON_PATHS.soldier}
      />
    </svg>
  );
}

export function domainIcon(domain: UnitDomain): string {
  return (
    {
      ground: "tank",
      naval: "ship",
      air: "jet",
      rocket: "missile",
      space: "satellite",
      marine: "soldier",
    }[domain] || "soldier"
  );
}

function readyHex(v: number): string {
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
  const col = readyHex(value);
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

/**
 * Signed money for balance lines. `fmtMoneyAbs` would render -1.5e9 as "$-1.5B";
 * a balance reads correctly only as "-$1.5B".
 */
export function fmtMoneySigned(sym: string, v: number): string {
  return v < 0 ? `-${fmtMoneyAbs(sym, -v)}` : fmtMoneyAbs(sym, v);
}
