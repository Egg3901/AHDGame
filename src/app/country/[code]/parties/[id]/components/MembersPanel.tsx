"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui";
import type { PartyData } from "./types";
import { getOfficeLabel } from "@/lib/utils/politics";

type RosterFilter = "all" | "player" | "npp";

export function MembersPanel({ party }: { party: PartyData }) {
  const [filter, setFilter] = useState<RosterFilter>("all");
  const [search, setSearch] = useState("");

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return party.members.filter((m) => {
      if (filter === "player" && m.isNPP) return false;
      if (filter === "npp" && !m.isNPP) return false;
      if (q && !m.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [party.members, filter, search]);

  const playerCount = party.members.filter((m) => !m.isNPP).length;
  const nppCount = party.members.length - playerCount;

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
      <div className="border-b border-card-border px-6 py-4 flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-bold text-lg">Party Members</h3>
          <span className="rounded-full bg-card-elevated px-2.5 py-1 text-xs font-medium text-muted">
            {filteredMembers.length} of {party.members.length}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-md border border-card-border bg-background px-3 py-1.5 text-xs"
          />
          <div
            className="flex rounded-md border border-card-border overflow-hidden text-xs"
            role="tablist"
            aria-label="Filter roster"
          >
            <FilterButton
              label="All"
              count={party.members.length}
              active={filter === "all"}
              onClick={() => setFilter("all")}
            />
            <FilterButton
              label="Players"
              count={playerCount}
              active={filter === "player"}
              onClick={() => setFilter("player")}
            />
            <FilterButton
              label="NPPs"
              count={nppCount}
              active={filter === "npp"}
              onClick={() => setFilter("npp")}
            />
          </div>
        </div>
      </div>

      {filteredMembers.length === 0 ? (
        <div className="p-6">
          <EmptyState
            title={party.members.length === 0 ? "No members yet" : "No matching members"}
            description={
              party.members.length === 0
                ? "Members will appear here once they join this party."
                : "Try clearing the search or selecting a different filter."
            }
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border bg-card-muted/30 text-left text-xs uppercase tracking-wider text-muted/70">
                <th className="px-6 py-3 font-semibold">Name</th>
                <th className="px-6 py-3 font-semibold">Home State</th>
                <th className="px-6 py-3 font-semibold">Office</th>
                <th className="px-6 py-3 font-semibold">Role</th>
                <th className="px-6 py-3 font-semibold">Party Influence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border bg-card">
              {filteredMembers.map((m) => {
                const isCampaigner = !m.isNPP && party.campaigners.some((c) => c.id === m.id);
                const role =
                  !m.isNPP && m.id === party.chair?.id
                    ? "Chair"
                    : !m.isNPP && m.id === party.viceChair?.id
                      ? "Vice Chair"
                      : !m.isNPP && m.id === party.treasurer?.id
                        ? "Treasurer"
                        : isCampaigner
                          ? "Campaigner"
                          : null;
                return (
                  <tr
                    key={m.isNPP ? `npp-${m.id}` : m.id}
                    className="group transition-colors hover:bg-card-elevated/50"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Link
                          href={
                            m.isNPP
                              ? `/politicians/npp/${m.sequentialId ?? m.id}`
                              : `/character/${m.sequentialId ?? m.id}`
                          }
                          className="font-medium text-foreground hover:text-primary hover:underline"
                        >
                          {m.name}
                        </Link>
                        {m.isNPP && (
                          <span className="rounded-full border border-card-border bg-card-muted px-1.5 py-0.5 text-[10px] font-medium text-muted">
                            NPP
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-muted">{m.homeState}</td>
                    <td className="px-6 py-4">
                      {m.currentOffice ? (
                        <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                          {getOfficeLabel(m.currentOffice, party.countryId)}
                        </span>
                      ) : (
                        <span className="text-muted/50">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {role ? (
                        <span
                          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide shadow-sm"
                          style={{ backgroundColor: `${party.color}20`, color: party.color }}
                        >
                          {role}
                        </span>
                      ) : (
                        <span className="text-muted text-xs">Member</span>
                      )}
                    </td>
                    <td className="px-6 py-4 tabular-nums text-sm">
                      {m.isNPP ? (
                        <span className="text-muted/50">—</span>
                      ) : (
                        <span className="font-medium">{(m.partyInfluence ?? 0).toFixed(1)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-3 py-1.5 transition-colors ${
        active ? "bg-card-border text-foreground" : "bg-card text-muted hover:text-foreground"
      }`}
    >
      {label}
      <span className="ml-1.5 text-[10px] text-muted">{count}</span>
    </button>
  );
}
