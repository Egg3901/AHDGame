"use client";

import { Tooltip } from "@/components/Tooltip";
import { EconomicPositionPip, SocialPositionPip } from "../PollCharts";
import { partyHex } from "../../pollHelpers";
import type { PollData } from "../../types";

function Fact({ label, tip, children }: { label: string; tip: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-body-sm text-muted">
        <Tooltip content={tip}>{label}</Tooltip>
      </dt>
      <dd className="mt-0.5 text-body-lg font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

/** Where the player stands: the inputs every appeal number is computed from. */
export function PositionsPanel({ pollData }: { pollData: PollData }) {
  const { character } = pollData;
  const orgColor = partyHex(pollData.partyColors, pollData.myParty);
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-4 border-t border-card-border px-5 py-5 sm:flex sm:flex-wrap sm:gap-x-12 sm:px-6">
      <Fact label="Economic" tip="Your economic position (left to right).">
        <EconomicPositionPip value={character.economicPosition} />
      </Fact>
      <Fact label="Social" tip="Your social position (liberal to traditional).">
        <SocialPositionPip value={character.socialPosition} />
      </Fact>
      <Fact
        label="Favorability"
        tip="Favorability (0 to 100%) scales your votes. Voters who don't approve of you won't support you."
      >
        <span className="text-warning">{character.favorability.toFixed(1)}%</span>
      </Fact>
      <Fact
        label="Political influence"
        tip="Influence sets your reach, the fraction of voters who know you exist."
      >
        <span className="text-secondary">{character.politicalInfluence.toFixed(1)}%</span>
      </Fact>
      {character.partyOrg != null && (
        <Fact
          label="Party organization"
          tip="Your party's ground game in this state (0 to 100). Independents are unaffected."
        >
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: orgColor }}
              aria-hidden
            />
            {character.partyOrg.toFixed(0)}
            <span className="text-body-sm font-normal text-muted">/ 100</span>
          </span>
        </Fact>
      )}
    </dl>
  );
}
