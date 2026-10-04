import type { ReactNode } from "react";

/**
 * Shared type and identity styles for the parties list and the party hub, so
 * both pages build their hierarchy from size, weight and spacing alone.
 */

/** Page title: 30px on phones, 36px from the small breakpoint up. */
export const PARTY_PAGE_TITLE_CLASS =
  "break-words text-display font-bold leading-tight tracking-tight text-foreground sm:text-[2.25rem]";

/** Main section heading, 24px. Sections are separated by spacing, not rules. */
export const PARTY_SECTION_HEADING_CLASS =
  "text-heading-lg font-semibold tracking-tight text-foreground";

/** Heading for a block inside a section, 16px. */
export const PARTY_SUBHEADING_CLASS = "text-body-lg font-semibold text-foreground";

/** Small muted label that names a value. */
export const PARTY_LABEL_CLASS = "text-body-sm text-muted";

/** Primary figure: foreground, semibold, tabular sans. */
export const PARTY_VALUE_CLASS = "text-heading font-semibold tabular-nums text-foreground";

/** Secondary figure, one step down from the primary one. */
export const PARTY_SMALL_VALUE_CLASS = "text-body-lg font-semibold tabular-nums text-foreground";

/** Quiet text link with an underline, for navigation inside a section. */
export const PARTY_LINK_CLASS =
  "font-medium text-foreground underline decoration-card-border underline-offset-4 transition-colors hover:decoration-foreground";

/** Underline tab: the active tab carries a foreground rule on the bottom edge. */
export function partyTabClass(active: boolean): string {
  return `shrink-0 whitespace-nowrap border-b-2 py-3 text-body font-medium transition-colors ${
    active
      ? "border-foreground font-semibold text-foreground"
      : "border-transparent text-muted hover:text-foreground"
  }`;
}

/** A row of labelled figures under a page header, wrapping on narrow screens. */
export function PartyStatsRow({
  children,
  className = "px-4 sm:px-7",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <dl className={`flex flex-wrap gap-x-10 gap-y-4 border-t border-card-border py-4 ${className}`}>
      {children}
    </dl>
  );
}

/** One figure in a PartyStatsRow: a small muted label above the value. */
export function PartyStat({
  label,
  detail,
  children,
}: {
  label: ReactNode;
  /** Optional muted line under the value. */
  detail?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className={PARTY_LABEL_CLASS}>{label}</dt>
      <dd className="mt-0.5">{children}</dd>
      {detail ? <dd className="text-body-sm text-muted">{detail}</dd> : null}
    </div>
  );
}

/**
 * The one place a party's color appears: a small square beside its name.
 * Decorative, because the name next to it carries the meaning.
 */
export function PartySwatch({ color, className = "" }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-[2px] ${className}`.trim()}
      style={{ backgroundColor: color }}
    />
  );
}

const REGIME_STATUS_LABELS = {
  ruling: "Ruling",
  approved: "Approved",
  banned: "Banned",
} as const;

/** Regime status in a one-party state as plain words, or null elsewhere. */
export function regimeStatusLabel(
  status: keyof typeof REGIME_STATUS_LABELS | null | undefined
): string | null {
  return status ? REGIME_STATUS_LABELS[status] : null;
}
