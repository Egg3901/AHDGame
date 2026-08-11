"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";

interface IndividualVote {
  id: string;
  name: string;
  party: string;
  partyName: string;
  partyColor: string;
  vote: "for" | "against" | "abstain";
  isNPP: boolean;
  seatsHeld: number;
  sequentialId?: number;
}

interface VoteListTableProps {
  billId: string;
  chamber: "origin" | "other";
  /** Whether to show the seatsHeld column. True for multi-seat chambers (UK Commons, US House, state legislature). False for US Senate. */
  showSeats: boolean;
}

type VoteFilter = "all" | "for" | "against" | "abstain";
type TypeFilter = "all" | "players" | "npps";

export function VoteListTable({ billId, chamber, showSeats }: VoteListTableProps) {
  const [voters, setVoters] = useState<IndividualVote[]>([]);
  const [loading, setLoading] = useState(true);
  const [partyFilter, setPartyFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [voteFilter, setVoteFilter] = useState<VoteFilter>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/congress/bills/${billId}/votes?chamber=${chamber}`)
      .then((res) => res.json())
      .then((data: { voters: IndividualVote[] }) => {
        if (!cancelled) {
          setVoters(data.voters ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [billId, chamber]);

  const uniqueParties = useMemo(() => {
    const seen = new Map<string, { partyName: string; partyColor: string }>();
    for (const v of voters) {
      if (!seen.has(v.party)) {
        seen.set(v.party, { partyName: v.partyName, partyColor: v.partyColor });
      }
    }
    return Array.from(seen.entries())
      .map(([key, val]) => ({ key, ...val }))
      .sort((a, b) => a.partyName.localeCompare(b.partyName));
  }, [voters]);

  const filtered = useMemo(() => {
    let result = voters;

    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter((v) => v.name.toLowerCase().includes(q));
    }
    if (partyFilter !== "all") {
      result = result.filter((v) => v.party === partyFilter);
    }
    if (typeFilter === "players") {
      result = result.filter((v) => !v.isNPP);
    } else if (typeFilter === "npps") {
      result = result.filter((v) => v.isNPP);
    }
    if (voteFilter !== "all") {
      result = result.filter((v) => v.vote === voteFilter);
    }

    const VOTE_ORDER: Record<IndividualVote["vote"], number> = { for: 0, against: 1, abstain: 2 };
    return [...result].sort(
      (a, b) =>
        VOTE_ORDER[a.vote] - VOTE_ORDER[b.vote] ||
        a.partyName.localeCompare(b.partyName) ||
        a.name.localeCompare(b.name)
    );
  }, [voters, partyFilter, typeFilter, voteFilter, query]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="space-y-2">
        {/* Name search */}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search members by name…"
          className="w-full rounded-lg border border-card-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted/60 focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {/* Party filter */}
        <div className="flex flex-wrap gap-1.5">
          <FilterPill active={partyFilter === "all"} onClick={() => setPartyFilter("all")}>
            All Parties
          </FilterPill>
          {uniqueParties.map((p) => (
            <FilterPill
              key={p.key}
              active={partyFilter === p.key}
              onClick={() => setPartyFilter(p.key)}
              activeStyle={{
                backgroundColor: `${p.partyColor}20`,
                color: p.partyColor,
              }}
            >
              {p.partyName}
            </FilterPill>
          ))}
        </div>

        {/* Type filter */}
        <div className="flex flex-wrap gap-1.5">
          <FilterPill active={typeFilter === "all"} onClick={() => setTypeFilter("all")}>
            All
          </FilterPill>
          <FilterPill active={typeFilter === "players"} onClick={() => setTypeFilter("players")}>
            Players
          </FilterPill>
          <FilterPill active={typeFilter === "npps"} onClick={() => setTypeFilter("npps")}>
            NPPs
          </FilterPill>
        </div>

        {/* Vote filter */}
        <div className="flex flex-wrap gap-1.5">
          <FilterPill active={voteFilter === "all"} onClick={() => setVoteFilter("all")}>
            All
          </FilterPill>
          <FilterPill
            active={voteFilter === "for"}
            onClick={() => setVoteFilter("for")}
            activeClassName="bg-success/20 text-success"
          >
            For
          </FilterPill>
          <FilterPill
            active={voteFilter === "against"}
            onClick={() => setVoteFilter("against")}
            activeClassName="bg-error/20 text-error"
          >
            Against
          </FilterPill>
          <FilterPill
            active={voteFilter === "abstain"}
            onClick={() => setVoteFilter("abstain")}
            activeClassName="bg-muted/20 text-muted"
          >
            Abstain
          </FilterPill>
        </div>
      </div>

      {/* Result count */}
      <span className="text-xs text-muted">
        {filtered.length} voter{filtered.length !== 1 ? "s" : ""}
      </span>

      {/* Table */}
      {filtered.length === 0 ? (
        <p className="text-xs text-muted py-4 text-center">No votes match the current filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-card-border text-muted">
                <th className="text-left py-2 pr-4 font-medium">Name</th>
                <th className="text-left py-2 px-2 font-medium">Party</th>
                {voteFilter === "all" && <th className="text-left py-2 px-2 font-medium">Vote</th>}
                {showSeats && <th className="text-right py-2 pl-2 font-medium">Seats</th>}
              </tr>
            </thead>
            <tbody>
              {voteFilter === "all"
                ? (() => {
                    const sections: {
                      label: string;
                      vote: IndividualVote["vote"];
                      colorClass: string;
                      bgClass: string;
                    }[] = [
                      {
                        label: "Aye",
                        vote: "for",
                        colorClass: "text-success",
                        bgClass: "bg-success/5",
                      },
                      {
                        label: "Nay",
                        vote: "against",
                        colorClass: "text-error",
                        bgClass: "bg-error/5",
                      },
                      {
                        label: "Abstain",
                        vote: "abstain",
                        colorClass: "text-muted",
                        bgClass: "bg-muted/5",
                      },
                    ];
                    return sections.flatMap(({ label, vote, colorClass, bgClass }) => {
                      const group = filtered.filter((v) => v.vote === vote);
                      if (group.length === 0) return [];
                      return [
                        <tr
                          key={`header-${vote}`}
                          className={`border-b border-card-border ${bgClass}`}
                        >
                          <td
                            colSpan={showSeats ? 4 : 3}
                            className={`py-1.5 pr-4 font-semibold ${colorClass}`}
                          >
                            {label} — {group.length}
                          </td>
                        </tr>,
                        ...group.map((v) => (
                          <tr
                            key={v.id}
                            className="border-b border-card-border/50 hover:bg-background/50"
                          >
                            <td className="py-1.5 pr-4">
                              {v.isNPP ? (
                                <span>
                                  {v.name} <span className="text-muted">(NPP)</span>
                                </span>
                              ) : (
                                <Link
                                  href={`/character/${v.sequentialId}`}
                                  className="font-medium text-primary hover:underline"
                                >
                                  {v.name}
                                </Link>
                              )}
                            </td>
                            <td className="py-1.5 px-2">
                              <span className="inline-flex items-center gap-1.5">
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: v.partyColor }}
                                />
                                {v.partyName}
                              </span>
                            </td>
                            <td className={`py-1.5 px-2 font-medium ${colorClass}`}>{label}</td>
                            {showSeats && (
                              <td className="text-right py-1.5 pl-2 tabular-nums">{v.seatsHeld}</td>
                            )}
                          </tr>
                        )),
                      ];
                    });
                  })()
                : filtered.map((v) => (
                    <tr
                      key={v.id}
                      className="border-b border-card-border/50 hover:bg-background/50"
                    >
                      <td className="py-1.5 pr-4">
                        {v.isNPP ? (
                          <span>
                            {v.name} <span className="text-muted">(NPP)</span>
                          </span>
                        ) : (
                          <Link
                            href={`/character/${v.sequentialId}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {v.name}
                          </Link>
                        )}
                      </td>
                      <td className="py-1.5 px-2">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: v.partyColor }}
                          />
                          {v.partyName}
                        </span>
                      </td>
                      {showSeats && (
                        <td className="text-right py-1.5 pl-2 tabular-nums">{v.seatsHeld}</td>
                      )}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Filter Pill ─── */

function FilterPill({
  active,
  onClick,
  children,
  activeClassName,
  activeStyle,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  activeClassName?: string;
  activeStyle?: React.CSSProperties;
}) {
  const base = "px-3 py-1 rounded-full text-xs font-medium transition-colors";

  if (active) {
    const colorClass = activeClassName ?? (activeStyle ? "" : "bg-primary/20 text-primary");
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} ${colorClass}`}
        style={activeStyle}
      >
        {children}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} bg-card text-muted hover:text-foreground border border-card-border`}
    >
      {children}
    </button>
  );
}
