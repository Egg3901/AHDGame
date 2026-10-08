"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export function pctText(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

export function toneClass(value: number | null | undefined): string {
  if (value == null || value === 0) return "text-muted";
  return value > 0 ? "text-success" : "text-error";
}

/** Headline figure in the dashboard strip. */
export function StatTile({
  label,
  value,
  sub,
  tone,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="text-body-sm font-medium text-muted">{label}</span>
      <span className={`mt-1 block text-xl font-bold tabular-nums ${tone ?? "text-foreground"}`}>
        {value}
      </span>
      {sub && <span className="mt-0.5 block text-[11px] text-muted">{sub}</span>}
    </>
  );
  const cls = "block rounded-xl border border-card-border bg-card px-4 py-3 shadow-card";
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:border-foreground/30`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function PanelState({
  loading,
  error,
  empty,
  emptyText,
  children,
}: {
  loading: boolean;
  error: string;
  empty?: boolean;
  emptyText?: string;
  children: ReactNode;
}) {
  if (loading)
    return (
      <p role="status" className="py-6 text-sm text-muted">
        Loading...
      </p>
    );
  if (error) {
    return (
      <p role="alert" className="py-6 text-sm text-error">
        {error}
      </p>
    );
  }
  if (empty) return <p className="py-6 text-sm text-muted">{emptyText ?? "Nothing here yet."}</p>;
  return <>{children}</>;
}

/** Overview card: a short list and a link into the full tab. */
export function PreviewCard({
  title,
  detail,
  href,
  loading,
  error,
  empty,
  children,
}: {
  title: string;
  detail?: string;
  href: string;
  loading: boolean;
  error: string;
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-card-border bg-card p-4 shadow-card">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-heading-sm font-bold text-foreground">{title}</h2>
        <Link href={href} className="text-xs font-medium text-primary hover:underline">
          See all
        </Link>
      </div>
      {detail && <p className="mt-0.5 text-[11px] text-muted">{detail}</p>}
      <div className="mt-2">
        <PanelState loading={loading} error={error} empty={empty} emptyText="None right now.">
          {children}
        </PanelState>
      </div>
    </section>
  );
}

export function PreviewRow({
  href,
  left,
  right,
  rightTone,
}: {
  href?: string;
  left: ReactNode;
  right: ReactNode;
  rightTone?: string;
}) {
  const inner = (
    <>
      <span className="min-w-0 truncate text-sm text-foreground">{left}</span>
      <span
        className={`shrink-0 text-sm font-medium tabular-nums ${rightTone ?? "text-foreground"}`}
      >
        {right}
      </span>
    </>
  );
  const cls =
    "flex items-center justify-between gap-3 border-b border-card-border/50 py-1.5 last:border-b-0";
  return href ? (
    <Link href={href} className={`${cls} hover:bg-card-elevated`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
