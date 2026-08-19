"use client";

import { useState } from "react";
import type { Character } from "@/lib/db/types";
import { ElectionComparisonPanel } from "./ElectionComparisonPanel";
import type { StoredPoll, PollData } from "../types";
import { PollTimestampBanner } from "./pollResults/PollTimestampBanner";
import { StatCards } from "./pollResults/StatCards";
import { PositionsPanel } from "./pollResults/PositionsPanel";
import { DemographicTurnoutPanel } from "./pollResults/DemographicTurnoutPanel";
import { GranularPollPanel } from "./pollResults/GranularPollPanel";
import { AppealLegend } from "./pollResults/AppealLegend";
import { PollRecommendations } from "./pollResults/PollRecommendations";

export function PollResults({
  poll,
  selectedTier,
  pollData,
  character,
}: {
  poll: StoredPoll;
  selectedTier: "small" | "large";
  pollData: PollData;
  character: Character;
}) {
  const [demoTurnoutOpen, setDemoTurnoutOpen] = useState(false);

  return (
    <>
      <PollTimestampBanner poll={poll} />

      {pollData.electionContext && (
        <ElectionComparisonPanel
          electionContext={pollData.electionContext}
          myPotentialVoters={poll.totalPotentialVoters}
          myAppeal={poll.overallAppeal}
          inRaceVoteShare={poll.inRaceVoteShare}
          myParty={character.party}
        />
      )}

      <StatCards poll={poll} />

      {/* Archetype-based panel, hidden when the granular electorate is active
          (the granular panel + segment explorer supersede it). */}
      {!poll.granular && <PollRecommendations poll={poll} pollData={pollData} />}

      <PositionsPanel pollData={pollData} />

      {selectedTier === "large" && poll.categories ? (
        <div className="space-y-3">
          {/* The granular electorate IS the poll: it is the substrate the vote
              engine counts, so it is the only per-group breakdown shown. The
              archetype Topline/Breakdown/TopBottom panels that used to sit here
              described a projection of the electorate, not the electorate. */}
          {poll.granular && <GranularPollPanel poll={poll} pollData={pollData} />}

          {pollData.demographicTurnout && (
            <DemographicTurnoutPanel
              demographicTurnout={pollData.demographicTurnout}
              demoTurnoutOpen={demoTurnoutOpen}
              setDemoTurnoutOpen={setDemoTurnoutOpen}
            />
          )}
        </div>
      ) : selectedTier === "large" && !poll.categories ? (
        <div className="rounded-xl border border-secondary/20 bg-secondary/5 p-6 text-center">
          <div className="text-secondary font-semibold mb-1">
            Full breakdown requires commissioning the Full Poll
          </div>
          <p className="text-sm text-muted">
            Commission the poll above to unlock the complete per-group analysis.
          </p>
        </div>
      ) : null}

      <AppealLegend poll={poll} />
    </>
  );
}
