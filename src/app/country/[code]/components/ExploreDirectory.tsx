"use client";

import Link from "next/link";

export interface DirectoryRow {
  label: string;
  href: string;
  available: boolean;
  /** Live figure (e.g. "6 active", "4 bills", "4.25%"); null/undefined degrades to a plain chevron. */
  figure?: string | null;
  /** warning = live-attention figures (e.g. elections under way). */
  figureTone?: "default" | "warning";
  /** Highlighted row (e.g. an active presidential race). */
  highlight?: boolean;
}

export interface DirectoryGroup {
  label: string;
  rows: DirectoryRow[];
}

/**
 * N2 grouped directory (locked at design review) — replaces the icon
 * nav-card grid with group cards whose rows carry live figures.
 * Each row degrades independently: no figure → plain chevron; unavailable →
 * muted row with the Coming Soon pill.
 *
 * The grid is one column on a phone (most players are on one), two on a tablet,
 * and one column per group on a wide screen. Rows keep a 44px tap target at
 * every width, so the phone layout is the same directory rather than a
 * squeezed-down copy of the desktop one.
 */
export function ExploreDirectory({ groups }: { groups: DirectoryGroup[] }) {
  return (
    <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      {groups.map((group) => (
        <div
          key={group.label}
          className="overflow-hidden rounded-xl border border-card-border bg-card"
        >
          <div className="border-b border-card-border bg-card-muted px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-muted">
            {group.label}
          </div>
          {group.rows.map((row) =>
            row.available ? (
              <Link
                key={row.label}
                href={row.href}
                className={`flex min-h-[44px] items-center justify-between gap-3 border-b border-card-border/50 px-4 py-2.5 transition-colors last:border-b-0 hover:bg-card-elevated/40 ${
                  row.highlight ? "bg-primary/5" : ""
                }`}
              >
                <span
                  className={`truncate text-sm font-semibold ${
                    row.highlight ? "text-primary" : "text-foreground"
                  }`}
                >
                  {row.label}
                </span>
                <span
                  className={`shrink-0 font-mono text-xs ${
                    row.figureTone === "warning" ? "text-warning" : "text-muted"
                  }`}
                >
                  {row.figure ? `${row.figure} ›` : "›"}
                </span>
              </Link>
            ) : (
              <div
                key={row.label}
                className="flex min-h-[44px] items-center justify-between gap-3 border-b border-card-border/50 px-4 py-2.5 opacity-60 last:border-b-0"
              >
                <span className="truncate text-sm font-semibold text-muted">{row.label}</span>
                <span className="shrink-0 rounded-full bg-card-elevated px-2 py-0.5 text-[10px] font-medium text-muted">
                  Coming Soon
                </span>
              </div>
            )
          )}
        </div>
      ))}
    </div>
  );
}
