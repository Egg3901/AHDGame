"use client";

import { useState } from "react";
import type { Character } from "@/lib/db/types";
import { ElectionComparisonPanel } from "./ElectionComparisonPanel";
import type { StoredPoll, PollData } from "../types";
import { PollTimestampBanner } from "./pollResults/PollTimestampBanner";
import { StatCards } from "./pollResults/StatCards";
import { PositionsPanel } from "./pollResults/PositionsPanel";
import { TopBottomGroups } from "./pollResults/TopBottomGroups";
import { ToplineByVoterGroup } from "./pollResults/ToplineByVoterGroup";
import { DemographicTurnoutPanel } from "./pollResults/DemographicTurnoutPanel";
import { VoterGroupBreakdown } from "./pollResults/VoterGroupBreakdown";
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
  const [toplineOpen, setToplineOpen] = useState(false);
  const [demoTurnoutOpen, setDemoTurnoutOpen] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);

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

      {/* Archetype-based panels — hidden when the granular electorate is active
          (the granular panel + segment explorer supersede them). */}
      {!poll.granular && <PollRecommendations poll={poll} pollData={pollData} />}

      <PositionsPanel pollData={pollData} />

      {!poll.granular && <TopBottomGroups poll={poll} />}

      {selectedTier === "large" && poll.categories ? (
        <div className="space-y-3">
          {/* When the granular electorate is active, it IS the poll — lead with
              it and drop the legacy 12-archetype Topline/Breakdown so the view
              matches the engine that actually computes the vote. */}
          {poll.granular && <GranularPollPanel poll={poll} pollData={pollData} />}

          {!poll.granular && (
            <ToplineByVoterGroup
              poll={poll}
              toplineOpen={toplineOpen}
              setToplineOpen={setToplineOpen}
            />
          )}

          {pollData.demographicTurnout && (
            <DemographicTurnoutPanel
              demographicTurnout={pollData.demographicTurnout}
              demoTurnoutOpen={demoTurnoutOpen}
              setDemoTurnoutOpen={setDemoTurnoutOpen}
            />
          )}

          {!poll.granular && (
            <VoterGroupBreakdown
              poll={poll}
              breakdownOpen={breakdownOpen}
              setBreakdownOpen={setBreakdownOpen}
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
