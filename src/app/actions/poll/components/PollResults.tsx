"use client";

import { useState } from "react";
import type { Character } from "@/lib/db/types";
import { ElectionComparisonPanel } from "./ElectionComparisonPanel";
import type { StoredPoll, PollData } from "../types";
import { StatCards } from "./pollResults/StatCards";
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
    <div className="space-y-8">
      <StatCards poll={poll} />

      {pollData.electionContext && (
        <ElectionComparisonPanel
          electionContext={pollData.electionContext}
          myPotentialVoters={poll.totalPotentialVoters}
          myAppeal={poll.overallAppeal}
          inRaceVoteShare={poll.inRaceVoteShare}
          myParty={character.party}
          partyColors={pollData.partyColors}
        />
      )}

      {/* Archetype-based panel, hidden when the granular electorate is active
          (the granular panel + segment explorer supersede it). */}
      {!poll.granular && <PollRecommendations poll={poll} pollData={pollData} />}

      {selectedTier === "large" && poll.categories ? (
        <>
          {/* The granular electorate IS the poll: it is the substrate the vote
              engine counts, so it is the only per-group breakdown shown. */}
          {poll.granular && <GranularPollPanel poll={poll} pollData={pollData} />}

          {pollData.demographicTurnout && (
            <DemographicTurnoutPanel
              demographicTurnout={pollData.demographicTurnout}
              demoTurnoutOpen={demoTurnoutOpen}
              setDemoTurnoutOpen={setDemoTurnoutOpen}
            />
          )}
        </>
      ) : selectedTier === "large" && !poll.categories ? (
        <section className="text-body">
          <h2 className="text-heading font-semibold">Full breakdown needs the Full Poll</h2>
          <p className="mt-1 text-muted">
            Commission the Full Poll above to unlock the per-group analysis.
          </p>
        </section>
      ) : null}

      <AppealLegend />
    </div>
  );
}
