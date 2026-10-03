"use client";

import { useState } from "react";
import Link from "next/link";
import type { State } from "@/lib/db/types";
import { buildCharacterHref } from "@/lib/utils/profileUrls";
import { Avatar } from "@/components/Avatar";
import { PartyChip } from "@/app/congress/components/CongressShared";
import { officeLabelFor } from "@/lib/utils/officeLabel";
import type { SerializedPlayer, PartyOrgDisplay } from "../StatePageTabsTypes";

export function PlayersList({
  state,
  players,
  partyOrg,
}: {
  state: State;
  players: SerializedPlayer[];
  partyOrg: PartyOrgDisplay[];
}) {
  const [playersExpanded, setPlayersExpanded] = useState(false);

  const getPartyInfo = (partyId: string) => {
    const party = partyOrg.find((p) => p.partyId === partyId);
    return {
      color: party?.partyColor || null,
      name: party?.partyName || null,
    };
  };

  return (
    <section className="min-w-0 rounded-xl border border-card-border bg-card p-5 sm:p-6">
      <h2 className="mb-3 text-heading-sm font-semibold text-foreground">Players</h2>
      {players.length > 0 ? (
        <>
          <div className={`overflow-x-auto overflow-y-auto ${!playersExpanded ? "max-h-60" : ""}`}>
            <div className="flex items-center border-b border-card-border py-2 text-body-sm text-muted">
              <div className="flex-1">Name</div>
              <div className="w-24 text-center">Party</div>
              <div className="w-16 text-right">Influence</div>
            </div>
            {players.map((player) => (
              <div
                key={player._id.toString()}
                className="flex items-center gap-3 border-b border-card-border py-3 last:border-b-0"
              >
                <Avatar
                  url={player.avatarUrl}
                  name={player.name}
                  size="h-9 w-9"
                  borderKey={player.borderKey}
                  tintColor={player.tintColor}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Link
                      href={buildCharacterHref(player)}
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {player.name}
                    </Link>
                    {player.isAdmin && (
                      <span className="shrink-0 text-body-sm text-warning">Admin</span>
                    )}
                    {player.isModerator && !player.isAdmin && (
                      <span className="shrink-0 text-body-sm text-info">Moderator</span>
                    )}
                  </div>
                  <div className="text-body-sm text-muted">
                    {officeLabelFor(player.countryId, player.currentOffice)}
                  </div>
                </div>
                <div className="w-32 flex justify-center">
                  {(() => {
                    const partyInfo = getPartyInfo(player.party);
                    if (player.party === "independent") {
                      return (
                        <PartyChip
                          partyName="Independent"
                          partyColor="#888888"
                          partyId="independent"
                        />
                      );
                    }
                    if (partyInfo.name && partyInfo.color) {
                      // Find the full party data to get countryId
                      const partyData = partyOrg.find((p) => p.partyId === player.party);
                      return (
                        <PartyChip
                          partyName={partyInfo.name}
                          partyColor={partyInfo.color}
                          partyId={player.party}
                          countryId={partyData?.countryId}
                        />
                      );
                    }
                    // Fallback for unknown parties
                    return (
                      <PartyChip
                        partyName={player.party}
                        partyColor="#888888"
                        partyId={player.party}
                      />
                    );
                  })()}
                </div>
                <div className="w-16 text-right">
                  <span className="text-body font-medium tabular-nums text-foreground">
                    {(player.politicalInfluence || 0).toFixed(2)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
          {players.length > 6 && (
            <button
              type="button"
              onClick={() => setPlayersExpanded((v) => !v)}
              className="mt-2 text-body font-medium text-foreground underline decoration-card-border underline-offset-4 hover:decoration-foreground"
            >
              {playersExpanded ? "Show less" : `Show all ${players.length} players`}
            </button>
          )}
        </>
      ) : (
        <p className="py-3 text-body text-muted">No players based in {state.name} yet.</p>
      )}
    </section>
  );
}
