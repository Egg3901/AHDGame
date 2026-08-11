import Link from "next/link";

export interface WireRow {
  turn: number;
  kind: string;
  side?: "yes" | "no";
  delta?: number;
  summary: string;
}

/** Dot colour: Yes/No tint by side, else amber for milestones. */
function dotColor(side?: "yes" | "no"): string {
  if (side === "yes") return "var(--ref-yes)";
  if (side === "no") return "var(--ref-no)";
  return "var(--ref-amber)";
}

const navBtn = "rounded-lg border border-card-border px-3 py-1.5 text-sm";

/**
 * Paginated campaign wire — a newest-first timeline of curated, fully-named
 * referendum events. Pagination is driven by the page's `?wire=N` searchParam
 * via `pageHref`.
 */
export function CampaignWire({
  events,
  page,
  totalPages,
  pageHref,
  labels = { yes: "Yes", no: "No" },
}: {
  events: WireRow[];
  page: number;
  totalPages: number;
  pageHref: (p: number) => string;
  labels?: { yes: string; no: string };
}) {
  return (
    <div className="rounded-2xl border border-card-border bg-card p-5 shadow-card">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted">
        Campaign wire
      </h2>
      {events.length === 0 ? (
        <div className="text-[12.5px] font-bold text-muted">No campaign activity yet.</div>
      ) : (
        <ul className="space-y-3">
          {events.map((e, i) => (
            <li key={`${e.turn}-${i}`} className="flex items-start gap-3">
              <span
                className="mt-1.5 h-2.5 w-2.5 flex-none rounded-full"
                style={{ background: dotColor(e.side) }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Turn {e.turn}
                </div>
                <div className="text-[13px] text-foreground">{e.summary}</div>
              </div>
              {e.delta != null ? (
                <span
                  className="ml-2 flex-none rounded-md px-2 py-0.5 text-[11px] font-bold"
                  style={{
                    color: e.delta >= 0 ? "var(--ref-yes)" : "var(--ref-no)",
                    background:
                      e.delta >= 0
                        ? "color-mix(in srgb, var(--ref-yes) 14%, transparent)"
                        : "color-mix(in srgb, var(--ref-no) 14%, transparent)",
                  }}
                >
                  {e.delta >= 0 ? "+" : ""}
                  {e.delta.toFixed(1)} {e.delta >= 0 ? labels.yes : labels.no}
                </span>
              ) : (
                <span className="ml-2 flex-none rounded-md border border-card-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {e.kind}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center gap-2">
          {page > 1 ? (
            <Link
              href={pageHref(page - 1)}
              className={`${navBtn} text-muted hover:text-foreground`}
            >
              ‹ Prev
            </Link>
          ) : (
            <span className={`${navBtn} cursor-not-allowed text-muted/40`}>‹ Prev</span>
          )}
          {page < totalPages ? (
            <Link
              href={pageHref(page + 1)}
              className={`${navBtn} text-muted hover:text-foreground`}
            >
              Next ›
            </Link>
          ) : (
            <span className={`${navBtn} cursor-not-allowed text-muted/40`}>Next ›</span>
          )}
          <span className="ml-2 text-xs text-muted">
            Page {page} of {totalPages}
          </span>
        </div>
      )}
    </div>
  );
}
