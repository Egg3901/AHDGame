"use client";

import { Tooltip } from "@/components/Tooltip";
import { EconomicPositionPip, SocialPositionPip } from "../PollCharts";
import type { PollData } from "../../types";

export function PositionsPanel({ pollData }: { pollData: PollData }) {
  return (
    <div className="mb-6 rounded-xl border border-card-border bg-card p-4">
      <div className="text-xs text-muted uppercase tracking-wide mb-3">
        Your Positions (at time of poll)
      </div>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
        <div>
          <div className="text-xs text-muted mb-0.5">
            <Tooltip content="Your economic position at the time this poll was taken (left ↔ right).">
              Economic
            </Tooltip>
          </div>
          <EconomicPositionPip value={pollData.character.economicPosition} />
        </div>
        <div>
          <div className="text-xs text-muted mb-0.5">
            <Tooltip content="Your social position at the time this poll was taken (liberal ↔ traditional).">
              Social
            </Tooltip>
          </div>
          <SocialPositionPip value={pollData.character.socialPosition} />
        </div>
        <div>
          <div className="text-xs text-muted mb-0.5">
            <Tooltip content="Favorability (0–100%) scales your votes — voters who don't approve of you won't support you.">
              Favorability
            </Tooltip>
          </div>
          <span className="text-sm font-medium text-yellow-400">
            {pollData.character.favorability.toFixed(1)}%
          </span>
        </div>
        <div>
          <div className="text-xs text-muted mb-0.5">
            <Tooltip content="Political influence determines your reach — the fraction of voters who know you exist. Higher influence = more voters reached.">
              Political Influence
            </Tooltip>
          </div>
          <span className="text-sm font-medium text-purple-400">
            {pollData.character.politicalInfluence.toFixed(1)}%
          </span>
        </div>
        {pollData.character.partyOrg != null && (
          <div>
            <div className="text-xs text-muted mb-0.5">
              <Tooltip content="Your party's ground-game strength in this state (0–100). Higher organization means better voter mobilization. Independents are unaffected.">
                Party Org
              </Tooltip>
            </div>
            <span className="text-sm font-medium text-emerald-400">
              {pollData.character.partyOrg.toFixed(0)}
              <span className="text-xs text-muted ml-0.5">/ 100</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
