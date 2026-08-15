"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { PartyChip } from "@/app/congress/components/CongressShared";
import { ResponsiveTable, type ResponsiveTableColumn, ListRowSkeleton } from "@/components/ui";
import { buildCharacterHref } from "@/lib/utils/profileUrls";
import { fetchJson } from "@/lib/observability/fetchJson";
import { regionApiSubUrl } from "@/lib/urls";
import type { CountryId } from "@/lib/constants/countries";
import type { StateRosterResult, StateRosterRow } from "@/lib/states/overview/getStateRoster";

/**
 * Front-and-center Overview tab table: every player whose character calls
 * this state home, sorted by influence (descending). Server-paginated
 * (page/pageSize query params) so a populous state never ships its full
 * roster to the client in one payload.
 *
 * Reuses `ResponsiveTable` (desktop table / mobile stacked cards) — the
 * same pattern the admin Users table and the election results panel use —
 * so this surface is mobile-friendly for free.
 */
export function PlayerRoster({ countryId, stateId }: { countryId: CountryId; stateId: string }) {
  const [page, setPage] = useState(1);
  const [resolved, setResolved] = useState<{ key: string; result: StateRosterResult } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  // Loading and error are derived from whether the in-flight request key
  // matches the latest resolved (or failed) one. Deriving them, instead of
  // calling setState synchronously in the effect, avoids a cascading render
  // on every page change (the repo lint rule that forbids sync setState in
  // an effect) while keeping the skeleton-on-page-change behaviour.
  const requestKey = `${countryId}|${stateId}|${page}`;

  useEffect(() => {
    let cancelled = false;
    const key = `${countryId}|${stateId}|${page}`;
    fetchJson<StateRosterResult>(
      `${regionApiSubUrl(countryId, stateId, "players")}?page=${page}&pageSize=20`,
      { feature: "state-overview-player-roster" }
    )
      .then((result) => {
        if (!cancelled) setResolved({ key, result });
      })
      .catch(() => {
        if (!cancelled) setFailedKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [countryId, stateId, page]);

  const error = failedKey === requestKey;
  const data = resolved && resolved.key === requestKey ? resolved.result : null;
  const loading = !error && data === null;

  const columns: ResponsiveTableColumn<StateRosterRow>[] = [
    {
      key: "player",
      header: "Player",
      render: (p) => (
        <div className="flex items-center gap-3">
          <Avatar
            url={p.avatarUrl}
            name={p.name}
            size="h-8 w-8"
            borderKey={p.borderKey}
            tintColor={p.tintColor}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Link
                href={buildCharacterHref({ sequentialId: p.sequentialId ?? undefined, _id: p.id })}
                className="truncate font-medium hover:text-primary transition-colors"
              >
                {p.name}
              </Link>
              {p.isAdmin && (
                <span className="shrink-0 rounded-full border border-warning/30 bg-warning/10 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-warning">
                  Admin
                </span>
              )}
              {p.isModerator && !p.isAdmin && (
                <span className="shrink-0 rounded-full border border-info/30 bg-info/10 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-info">
                  Moderator
                </span>
              )}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "influence",
      header: "Influence",
      render: (p) => (
        <span className="text-sm font-medium text-primary tabular-nums">
          {p.politicalInfluence.toFixed(2)}%
        </span>
      ),
    },
    {
      key: "party",
      header: "Party",
      render: (p) => (
        <PartyChip
          partyName={p.partyName ?? p.party}
          partyColor={p.partyColor ?? "#888888"}
          partyId={p.party}
          countryId={countryId}
        />
      ),
    },
    {
      key: "position",
      header: "Position / Race",
      mobileLabel: "Position / Race",
      render: (p) => <span className="text-sm text-muted">{p.positionLabel}</span>,
    },
  ];

  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 sm:p-6">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold sm:text-xl">Player Roster</h2>
        {!loading && !error && (
          <span className="shrink-0 text-xs text-muted">
            {total} player{total === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {loading ? (
        <div>
          {Array.from({ length: 5 }).map((_, i) => (
            <ListRowSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <div className="py-8 text-center text-sm text-muted">
          Couldn&apos;t load the player roster. Try again shortly.
        </div>
      ) : (
        <>
          <ResponsiveTable
            columns={columns}
            data={data?.players ?? []}
            keyExtractor={(p) => p.id}
            emptyMessage="No players in this state yet."
          />
          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-xs text-muted">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
