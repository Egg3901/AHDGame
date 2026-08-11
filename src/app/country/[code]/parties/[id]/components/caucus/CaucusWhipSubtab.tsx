"use client";

import { WhipTabs, type WhipEndpointConfig } from "@/components/party/WhipTabs";

export function CaucusWhipSubtab({
  countryCode,
  partyId,
  partyColor,
  endpointConfig,
  canUseWhips,
  eligibleStates,
}: {
  countryCode: string;
  partyId: string;
  partyColor: string;
  endpointConfig: WhipEndpointConfig;
  canUseWhips: boolean;
  eligibleStates: Array<{ id: string; name: string }>;
}) {
  if (!canUseWhips) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 text-sm italic text-muted">
        Whip directives are restricted to the Caucus Chair.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-card-border bg-card px-4 py-3">
        <p className="text-sm text-muted">
          Issue bill-by-bill and vote-by-vote whips for caucus members only. Player whips can be
          sent as soft recommendations or hard overrides, while NPP whips still resolve immediately
          through the existing vote-pressure rules.
        </p>
      </div>

      <WhipTabs
        showPlayerTab={true}
        isNational={true}
        countryId={countryCode.toUpperCase()}
        partyId={partyId}
        partyColor={partyColor}
        eligibleStates={eligibleStates}
        endpointConfig={endpointConfig}
      />
    </div>
  );
}
