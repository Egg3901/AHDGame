"use client";

import { WhipTabs } from "@/components/party/WhipTabs";

interface Props {
  countryId: string;
  partyId: string;
  partyColor: string;
  canUsePartyInfluence: boolean;
  eligibleStates?: Array<{ id: string; name: string }>;
}

export function WhipRoomTab({
  countryId,
  partyId,
  partyColor,
  canUsePartyInfluence,
  eligibleStates,
}: Props) {
  if (!canUsePartyInfluence) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 text-sm text-muted italic">
        Whip directives are restricted to the Chair and Vice Chair.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-card-border bg-card px-4 py-3">
        <p className="text-sm text-muted">
          Issue whips bill by bill and vote by vote from here. Player whips can be issued as soft
          recommendations or hard overrides, while NPP whips keep their existing immediate vote
          pressure rules.
        </p>
      </div>

      <WhipTabs
        showPlayerTab={true}
        isNational={true}
        countryId={countryId}
        partyId={partyId}
        partyColor={partyColor}
        eligibleStates={eligibleStates}
      />
    </div>
  );
}
