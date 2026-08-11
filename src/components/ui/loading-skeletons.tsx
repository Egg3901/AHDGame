"use client";

import { Skeleton } from "./Skeleton";

// ── Shared skeleton primitives ──────────────────────────────────────────────
// Every data-dense route in the app uses these building blocks to construct
// layout-matching loading states. Keep them thin — 5-15 lines each. The
// complexity lives in the loading.tsx files that compose them.

// ── Card container ──────────────────────────────────────────────────────────

interface CardSkeletonProps {
  className?: string;
  children: React.ReactNode;
}

/**
 * Skeleton card wrapper — a rounded container with border, padding, and
 * shadow that matches the loaded card look. Wrap inner skeleton lines,
 * stat grids, or list rows inside this.
 */
export function CardSkeleton({ className = "", children }: CardSkeletonProps) {
  return (
    <div className={`rounded-xl border border-card-border bg-card p-5 shadow-card ${className}`}>
      {children}
    </div>
  );
}

// ── Stat chip grid ──────────────────────────────────────────────────────────

interface StatGridSkeletonProps {
  /** Grid columns. Default: 2 */
  cols?: number;
  /** Number of chips to render. Default: 4 */
  count?: number;
  className?: string;
}

/**
 * Grid of stat chips — each chip has a label, a value, and a delta line.
 * Used in dashboards, profiles, region pages, and any data-dense header.
 */
export function StatGridSkeleton({ cols = 2, count = 4, className = "" }: StatGridSkeletonProps) {
  return (
    <div
      className={`grid gap-3 ${className}`}
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-card-border p-3 space-y-1">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-2.5 w-12" />
        </div>
      ))}
    </div>
  );
}

// ── List row ────────────────────────────────────────────────────────────────

interface ListRowSkeletonProps {
  /** Number of text lines after the icon. Default: 2 */
  lines?: number;
  /** Whether to include a rounded badge on the right. Default: false */
  withBadge?: boolean;
  className?: string;
}

/**
 * A single row with an icon circle + text lines, optionally with a badge
 * on the far right. Used in politician lists, election candidate panels,
 * and anywhere rows show avatar + name + meta.
 */
export function ListRowSkeleton({
  lines = 2,
  withBadge = false,
  className = "",
}: ListRowSkeletonProps) {
  return (
    <div
      className={`flex items-center gap-3 py-3 border-b border-card-border last:border-0 ${className}`}
    >
      <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
      <div className="flex-1 min-w-0 space-y-1">
        <Skeleton className="h-4 w-40" />
        {lines >= 2 && <Skeleton className="h-3 w-24" />}
        {lines >= 3 && <Skeleton className="h-3 w-32" />}
      </div>
      {withBadge && <Skeleton className="h-6 w-16 rounded-full shrink-0" />}
    </div>
  );
}

// ── Tab row ─────────────────────────────────────────────────────────────────

interface TabRowSkeletonProps {
  /** Number of tab placeholders. Default: 5 */
  count?: number;
  className?: string;
}

/**
 * Horizontal tab bar skeleton. Used in state, region, admin, and legislature
 * pages that have tabbed navigation.
 */
export function TabRowSkeleton({ count = 5, className = "" }: TabRowSkeletonProps) {
  return (
    <div className={`border-b border-card-border ${className}`}>
      <div className="flex gap-6 pb-px overflow-x-auto">
        {Array.from({ length: count }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-20 shrink-0" />
        ))}
      </div>
    </div>
  );
}

// ── Page header ─────────────────────────────────────────────────────────────

interface PageHeaderSkeletonProps {
  /** Whether to show a back nav link skeleton at the top */
  withBackNav?: boolean;
  className?: string;
}

/**
 * Simple page header skeleton — title + subtitle block. Optionally includes
 * a back-navigation link line above.
 */
export function PageHeaderSkeleton({
  withBackNav = false,
  className = "",
}: PageHeaderSkeletonProps) {
  return (
    <div className={`space-y-4 ${className}`}>
      {withBackNav && <Skeleton className="h-4 w-24" />}
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>
    </div>
  );
}
