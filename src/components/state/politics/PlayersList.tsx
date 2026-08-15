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
    <div className="rounded-xl border border-card-border bg-card p-6">
      <h2 className="mb-4 text-xl font-semibold">Players in {state.name}</h2>
      {players.length > 0 ? (
        <>
          <div className={`overflow-x-auto overflow-y-auto ${!playersExpanded ? "max-h-60" : ""}`}>
            <div className="flex items-center border-b border-card-border py-2 text-xs text-muted font-medium">
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
                      className="font-medium hover:text-primary transition-colors"
                    >
                      {player.name}
                    </Link>
                    {player.isAdmin && (
                      <span className="shrink-0 rounded-full border border-warning/30 bg-warning/10 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-warning">
                        Admin
                      </span>
                    )}
                    {player.isModerator && !player.isAdmin && (
                      <span className="shrink-0 rounded-full border border-info/30 bg-info/10 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-info">
                        Moderator
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted">
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
                  <span className="text-sm font-medium text-primary">
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
              className="mt-3 text-sm text-muted hover:text-foreground transition-colors"
            >
              {playersExpanded ? "Show less" : `Show all ${players.length} players`}
            </button>
          )}
        </>
      ) : (
        <div className="py-8 text-center text-muted">
          <p>No players in this state yet.</p>
        </div>
      )}
    </div>
  );
}
