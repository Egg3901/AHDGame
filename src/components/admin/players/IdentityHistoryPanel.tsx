"use client";

import { useCallback, useEffect, useState } from "react";
import { LocalTime } from "@/components/time/LocalTime";

type Track = "ip" | "fingerprint";

/** Mirrors `IdentityHistoryRow` in @/lib/identityHistory/loadHistory.
 * Declared locally rather than imported: that module reaches the database, and
 * a client component importing it would pull the driver into the bundle. */
interface HistoryRow {
  value: string;
  firstSeen: string | null;
  lastSeen: string | null;
  observations: number;
  source: string;
  datesKnown: boolean;
  sharedWithCount: number;
}

interface HistoryPage {
  rows: HistoryRow[];
  page: number;
  totalPages: number;
  total: number;
}

const LABELS: Record<Track, string> = { ip: "IP history", fingerprint: "Fingerprint history" };

/** Rendered through `<LocalTime>` rather than `toLocaleString()`: the server
 * renders in UTC and the viewer's browser does not, which is a hydration
 * mismatch and shows a moderator the wrong clock. A backfilled row with no
 * timestamp says so instead of showing an invented one. */
function SeenAt({ value, known }: { value: string | null; known: boolean }) {
  if (!known || !value) return <span className="italic text-muted">date unknown</span>;
  return <LocalTime value={value} options={{ dateStyle: "medium", timeStyle: "short" }} />;
}

function TrackSection({
  userId,
  track,
  isModeratorContext,
}: {
  userId: string;
  track: Track;
  isModeratorContext: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HistoryPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // `context` tells the server which surface is asking, so the moderator
      // panel gets masked addresses even when an admin is the one looking.
      // Without it this table printed a raw IP directly beneath the same card's
      // "Network details hidden" label.
      const context = isModeratorContext ? "moderator" : "admin";
      const res = await fetch(
        `/api/admin/players/${userId}/identity-history?track=${track}&page=${page}&context=${context}`
      );
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setData((await res.json()) as HistoryPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load history");
    } finally {
      setLoading(false);
    }
  }, [userId, track, page, isModeratorContext]);

  // Lazy: nothing is fetched until the section is opened, so a collapsed panel
  // costs nothing on a list that already loads up to 500 accounts.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <div className="rounded border border-card-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted transition-colors hover:text-foreground"
      >
        <svg
          className={`h-3 w-3 flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {LABELS[track]}
        {data ? <span className="text-muted">({data.total})</span> : null}
      </button>

      {open && (
        <div className="border-t border-card-border px-3 py-2">
          {loading && <p className="text-xs text-muted">Loading...</p>}
          {error && <p className="text-xs text-red-400">{error}</p>}
          {data && !loading && data.rows.length === 0 && (
            <p className="text-xs text-muted">No recorded history.</p>
          )}
          {data && data.rows.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted">
                    <tr>
                      <th className="py-1 pr-3 text-left font-medium">Value</th>
                      <th className="py-1 pr-3 text-left font-medium">First seen</th>
                      <th className="py-1 pr-3 text-left font-medium">Last seen</th>
                      <th className="py-1 pr-3 text-right font-medium">Seen</th>
                      <th className="py-1 text-left font-medium">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row, i) => (
                      <tr
                        key={`${row.value}-${row.firstSeen ?? "undated"}-${i}`}
                        className={row.sharedWithCount > 0 ? "bg-amber-500/10" : undefined}
                      >
                        <td className="py-1 pr-3 font-mono">
                          {row.value}
                          {row.sharedWithCount > 0 && (
                            <span
                              className="ml-2 whitespace-nowrap rounded bg-amber-500/20 px-1.5 py-0.5 font-sans text-amber-400"
                              title="Another account in this game has also been seen on this value within the retention window."
                            >
                              also used by {row.sharedWithCount} other account
                              {row.sharedWithCount === 1 ? "" : "s"}
                            </span>
                          )}
                        </td>
                        <td className="py-1 pr-3 whitespace-nowrap">
                          <SeenAt value={row.firstSeen} known={row.datesKnown} />
                        </td>
                        <td className="py-1 pr-3 whitespace-nowrap">
                          <SeenAt value={row.lastSeen} known={row.datesKnown} />
                        </td>
                        <td className="py-1 pr-3 text-right">{row.observations}</td>
                        <td className="py-1 text-muted">{row.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {data.totalPages > 1 && (
                <div className="mt-2 flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    disabled={data.page <= 1 || loading}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded border border-card-border px-2 py-0.5 transition-colors hover:text-foreground disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="text-muted">
                    Page {data.page} of {data.totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={data.page >= data.totalPages || loading}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded border border-card-border px-2 py-0.5 transition-colors hover:text-foreground disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Collapsed-by-default IP and fingerprint run history for one account.
 *
 * Each track pages independently, so a moderator can hold IP page 2 and
 * fingerprint page 1 open at once. Rows a second account has also been seen on
 * are highlighted, which is what makes rotation visible without diffing hashes
 * by eye.
 */
export function IdentityHistoryPanel({
  userId,
  isModeratorContext,
}: {
  userId: string;
  isModeratorContext: boolean;
}) {
  return (
    <div className="mt-2 space-y-1">
      <TrackSection userId={userId} track="ip" isModeratorContext={isModeratorContext} />
      <TrackSection userId={userId} track="fingerprint" isModeratorContext={isModeratorContext} />
    </div>
  );
}
