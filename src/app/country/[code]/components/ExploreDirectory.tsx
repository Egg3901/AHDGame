"use client";

import Link from "next/link";

export interface DirectoryRow {
  label: string;
  href: string;
  available: boolean;
  /** Live figure (e.g. "6 active", "4 bills", "4.25%"); null/undefined shows no figure. */
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
 * The country's directory: four plain columns (politics, government, economy,
 * nation), each a sentence-case heading over a list of links. A row's live
 * figure sits on the right in body type; a row without one is just its link,
 * and an unavailable row reads "Coming soon".
 *
 * One column on a phone (most players are on one), two on a tablet, and one
 * per group on a wide screen. Rows keep a 44px tap target at every width, so
 * the phone layout is the same directory rather than a squeezed-down copy.
 */
export function ExploreDirectory({ groups }: { groups: DirectoryGroup[] }) {
  return (
    <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2 xl:grid-cols-4">
      {groups.map((group) => (
        <section key={group.label} className="min-w-0">
          <h3 className="text-body-lg font-semibold text-foreground">{group.label}</h3>
          <ul className="mt-1 divide-y divide-card-border/60">
            {group.rows.map((row) => (
              <li key={row.label}>
                {row.available ? (
                  <Link
                    href={row.href}
                    className="group flex min-h-[44px] items-center justify-between gap-3 py-2"
                  >
                    <span
                      className={`truncate text-body text-foreground underline-offset-4 group-hover:underline ${
                        row.highlight ? "font-semibold" : "font-medium"
                      }`}
                    >
                      {row.label}
                    </span>
                    {row.figure && (
                      <span
                        className={`shrink-0 text-body-sm tabular-nums ${
                          row.figureTone === "warning" ? "text-warning" : "text-muted"
                        }`}
                      >
                        {row.figure}
                      </span>
                    )}
                  </Link>
                ) : (
                  <div className="flex min-h-[44px] items-center justify-between gap-3 py-2">
                    <span className="truncate text-body font-medium text-muted">{row.label}</span>
                    <span className="shrink-0 text-body-sm text-muted">Coming soon</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
