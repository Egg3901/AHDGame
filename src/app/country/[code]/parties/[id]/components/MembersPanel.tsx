"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui";
import type { PartyData } from "./types";
import { getOfficeLabel } from "@/lib/utils/politics";
import { PARTY_SECTION_HEADING_CLASS } from "@/components/party/partyPageStyles";

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
    <section aria-labelledby="party-members-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="party-members-title" className={PARTY_SECTION_HEADING_CLASS}>
            Party members
          </h2>
          <span className="text-body-sm text-muted">
            {filteredMembers.length} of {party.members.length}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-md border border-card-border bg-background px-3 py-1.5 text-body"
          />
          <div
            className="flex overflow-hidden rounded-md border border-card-border text-body"
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
        <div className="border-y border-card-border py-6">
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
          <table className="w-full text-body">
            <thead>
              <tr className="border-y border-card-border text-left text-body-sm text-muted">
                <th className="py-2.5 pr-6 font-medium">Name</th>
                <th className="px-6 py-2.5 font-medium">Home state</th>
                <th className="px-6 py-2.5 font-medium">Office</th>
                <th className="px-6 py-2.5 font-medium">Role</th>
                <th className="py-2.5 pl-6 text-right font-medium">Party influence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border border-b border-card-border">
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
                    className="transition-colors hover:bg-card-elevated/50"
                  >
                    <td className="py-3 pr-6">
                      <div className="flex items-baseline gap-2">
                        <Link
                          href={
                            m.isNPP
                              ? `/politicians/npp/${m.sequentialId ?? m.id}`
                              : `/character/${m.sequentialId ?? m.id}`
                          }
                          className="font-medium text-foreground hover:underline"
                        >
                          {m.name}
                        </Link>
                        {m.isNPP && <span className="text-body-sm text-muted">NPP</span>}
                      </div>
                    </td>
                    <td className="px-6 py-3 text-muted">{m.homeState}</td>
                    <td className="px-6 py-3">
                      {m.currentOffice ? (
                        <span className="text-foreground">
                          {getOfficeLabel(m.currentOffice, party.countryId)}
                        </span>
                      ) : (
                        <span className="text-muted/50">—</span>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      {role ? (
                        <span className="font-semibold text-foreground">{role}</span>
                      ) : (
                        <span className="text-muted">Member</span>
                      )}
                    </td>
                    <td className="py-3 pl-6 text-right tabular-nums">
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
    </section>
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
      <span className="ml-1.5 text-body-sm tabular-nums text-muted">{count}</span>
    </button>
  );
}
