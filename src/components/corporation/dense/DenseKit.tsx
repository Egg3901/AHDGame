"use client";

import type { ReactNode } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useLocalCurrency } from "@/hooks/useLocalCurrency";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { FillRateBand } from "@/lib/corporations/financialFogOfWar";
import {
  FILL_BAND_TEXT,
  fillBandSentence,
  fillBandShort,
  formatFillPercent,
} from "../plantsPresentation";

/**
 * Shared building blocks for the corporation page's tabular layout.
 *
 * The page reads like a financial terminal: sections are separated by a rule
 * and a heading, not boxed; figures sit in tables at body size; colour is
 * spent only where it carries meaning (sign of a P&L figure, an error, the
 * active control). Anything here should stay theme-token driven so every
 * site theme renders it.
 */

export function DenseSection({
  id,
  title,
  meta,
  actions,
  children,
  className = "",
}: {
  id?: string;
  title: ReactNode;
  /** Short muted text after the title (units, counts, period). */
  meta?: ReactNode;
  /** Right-aligned controls in the heading row. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`min-w-0 scroll-mt-24 ${className}`}>
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-card-border pb-1.5">
        {/* The meta sits beside the heading, not inside it, so the heading's
            accessible name is just the title. */}
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
          {meta != null && <span className="text-xs text-muted">{meta}</span>}
        </div>
        {actions != null && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
      <div className="pt-1">{children}</div>
    </section>
  );
}

/** One label / value line. Used inside `KVList`. */
export function KVRow({
  label,
  value,
  hint,
  action,
  title,
  mono = true,
}: {
  label: ReactNode;
  value: ReactNode;
  /** Small muted text under or beside the value (change, unit, basis). */
  hint?: ReactNode;
  /** Inline control (link or small button) at the end of the row. */
  action?: ReactNode;
  title?: string;
  /** Figures render in Geist Mono (design system tenet 2); pass false for words. */
  mono?: boolean;
}) {
  return (
    <div
      className="flex min-h-8 items-center justify-between gap-3 border-b border-card-border/60 py-1 last:border-b-0"
      title={title}
    >
      <dt className="min-w-0 truncate text-xs text-muted">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-2 text-right">
        <span
          className={`truncate text-[13px] font-medium tabular-nums text-foreground ${mono ? "font-mono" : ""}`}
        >
          {value}
        </span>
        {hint != null && (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">{hint}</span>
        )}
        {action}
      </dd>
    </div>
  );
}

export function KVList({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <dl className={`min-w-0 ${className}`}>{children}</dl>;
}

/** Table header cell. `align` defaults to left; numeric columns pass "right". */
export function Th({
  children,
  align = "left",
  className = "",
  title,
  onClick,
  sorted,
}: {
  children?: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  title?: string;
  onClick?: () => void;
  /** Sort indicator for a clickable header. */
  sorted?: "asc" | "desc" | null;
}) {
  const alignClass =
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  const content =
    onClick != null ? (
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-foreground ${
          align === "right" ? "flex-row-reverse" : ""
        } ${sorted ? "text-foreground" : ""}`}
      >
        <span>{children}</span>
        <span aria-hidden className="w-2 text-[9px]">
          {sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : ""}
        </span>
      </button>
    ) : (
      children
    );
  return (
    <th
      scope="col"
      title={title}
      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
      className={`whitespace-nowrap border-b border-card-border px-2 py-1.5 text-[11px] font-medium text-muted ${alignClass} ${className}`}
    >
      {content}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  className = "",
  title,
  colSpan,
  numeric = align === "right",
}: {
  children?: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  title?: string;
  colSpan?: number;
  /**
   * Figures render in Geist Mono (design system tenet 2). Right-aligned cells
   * are figures unless they hold controls or words; pass false for those.
   */
  numeric?: boolean;
}) {
  const alignClass =
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <td
      title={title}
      colSpan={colSpan}
      className={`whitespace-nowrap border-b border-card-border/60 px-2 py-1.5 text-[13px] tabular-nums ${numeric ? "font-mono" : ""} ${alignClass} ${className}`}
    >
      {children}
    </td>
  );
}

/**
 * Financial statement table: line, amount, share of revenue, note. The amount
 * and share columns are figures (Geist Mono); the note column hides on small
 * screens and the share column on phones.
 */
export function StatementTable({ children }: { children: ReactNode }) {
  return (
    <table className="w-full border-collapse">
      <thead className="sr-only">
        <tr>
          <th>Line</th>
          <th>Amount</th>
          <th>Share of revenue</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

export function StatementLine({
  label,
  amount,
  pct,
  note,
  strong,
  indent,
  amountClass = "text-foreground",
  title,
}: {
  label: ReactNode;
  amount: ReactNode;
  pct?: string | null;
  note?: ReactNode;
  strong?: boolean;
  indent?: boolean;
  amountClass?: string;
  title?: string;
}) {
  return (
    <tr className={strong ? "font-semibold" : undefined} title={title}>
      <td
        className={`border-b border-card-border/60 py-1.5 pr-2 text-[13px] ${
          indent ? "pl-4 text-muted" : "text-foreground"
        }`}
      >
        {label}
      </td>
      <td
        className={`whitespace-nowrap border-b border-card-border/60 px-2 py-1.5 text-right font-mono text-[13px] tabular-nums ${amountClass}`}
      >
        {amount}
      </td>
      <td className="hidden whitespace-nowrap border-b border-card-border/60 px-2 py-1.5 text-right font-mono text-xs tabular-nums text-muted sm:table-cell">
        {pct ?? ""}
      </td>
      <td className="hidden border-b border-card-border/60 py-1.5 pl-2 text-xs text-muted md:table-cell">
        {note}
      </td>
    </tr>
  );
}

export function StatementGroup({ children }: { children: ReactNode }) {
  return (
    <tr>
      <td colSpan={4} className="pb-1 pt-3 text-xs font-medium text-muted">
        {children}
      </td>
    </tr>
  );
}

/** Scroll wrapper so a wide table never widens the page on a phone. */
export function TableScroll({ children }: { children: ReactNode }) {
  return <div className="-mx-2 overflow-x-auto px-2">{children}</div>;
}

export function SmallButton({
  children,
  onClick,
  disabled,
  tone = "default",
  type = "button",
  title,
  ariaLabel,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "default" | "primary" | "danger";
  type?: "button" | "submit";
  title?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const toneClass =
    tone === "primary"
      ? "border-primary bg-primary text-white hover:bg-primary/90"
      : tone === "danger"
        ? "border-error/50 text-error hover:bg-error/10"
        : "border-card-border text-foreground hover:bg-card-elevated";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={`inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md border px-2.5 font-sans text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${toneClass} ${className}`}
    >
      {children}
    </button>
  );
}

/** Compact segmented control (period toggles, presets). */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled,
}: {
  options: ReadonlyArray<{ value: T; label: ReactNode; title?: string }>;
  value: T | null;
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex h-7 shrink-0 items-stretch overflow-hidden rounded-md border border-card-border"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.title}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={`border-r border-card-border px-2 text-xs tabular-nums transition-colors last:border-r-0 disabled:opacity-50 ${
              active
                ? "bg-foreground font-semibold text-background"
                : "text-muted hover:bg-card-elevated hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** One-line result text after an action. No box: the colour is the signal. */
export function InlineStatus({
  message,
  tone,
  className = "",
}: {
  message: string | null | undefined;
  tone: "success" | "error" | "muted";
  className?: string;
}) {
  if (!message) return null;
  const toneClass =
    tone === "success" ? "text-success" : tone === "error" ? "text-error" : "text-muted";
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`text-xs ${toneClass} ${className}`}>
      {message}
    </p>
  );
}

/** Text tone for a signed P&L figure. Zero stays neutral. */
export function signTone(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return "text-foreground";
  return value > 0 ? "text-success" : "text-error";
}

/**
 * Fill rate as table text. The band colour is the one thing a CEO scans a
 * long sector list for, so it is the only coloured cell in the row. Rivals
 * get the band word, never the exact rate.
 */
export function FillText({
  fill,
  band,
}: {
  fill: number | null | undefined;
  band: FillRateBand | null | undefined;
}) {
  if (band == null) {
    return (
      <span className="text-muted" title="Produced nothing last turn, so there is no fill rate.">
        n/a
      </span>
    );
  }
  const exact = fill != null && Number.isFinite(fill);
  return (
    <span
      className={`font-medium ${FILL_BAND_TEXT[band]}`}
      title={`${fillBandSentence(band)}. Fill rate is the share of output that sold.`}
    >
      {exact ? formatFillPercent(fill) : fillBandShort(band)}
    </span>
  );
}

/** Minimal line sparkline: one stroke, no fill, no glow. */
export function MiniSparkline({
  data,
  width = 96,
  height = 24,
  label,
}: {
  data: number[];
  width?: number;
  height?: number;
  label?: string;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - 2 - ((v - min) / span) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const up = data[data.length - 1] >= data[0];
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={up ? "text-success" : "text-error"}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Money formatting for figures stored in the corporation's own currency, on top
 * of `useLocalCurrency` (local -> anchor -> the viewer's display currency).
 * Adds a signed amount for P&L lines, and share prices in the listing currency.
 */
export function useCorpMoney(liquidCurrencyCode: string | null | undefined) {
  const { formatPriceIn, formatPrice } = useCurrency();
  const local = useLocalCurrency(liquidCurrencyCode ?? undefined);
  const code = (liquidCurrencyCode as CurrencyCode | undefined) ?? undefined;
  const fmtSigned = (amount: number) =>
    `${amount > 0 ? "+" : amount < 0 ? "-" : ""}${local.fmtAmount(Math.abs(amount))}`;
  /** A share trades in its listing currency, whatever the viewer's display preference. */
  const fmtPrice = (amount: number) =>
    code ? formatPriceIn(local.toAnchor(amount), code) : formatPrice(amount, code);
  return {
    code,
    toAnchor: local.toAnchor,
    fmt: local.fmtAmount,
    fmtFull: local.fmtFull,
    fmtSigned,
    fmtPrice,
  };
}
