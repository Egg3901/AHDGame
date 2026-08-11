"use client";

import { useState } from "react";
import { Slider } from "@/components/ui";

export function VoteShareCalculator() {
  const [influence, setInfluence] = useState(50);
  const [favorability, setFavorability] = useState(50);
  const [adSpend, setAdSpend] = useState(10);
  const [opponentInfluence, setOpponentInfluence] = useState(50);

  // Calculate estimated vote share
  const yourScore = influence * 0.4 + favorability * 0.3 + adSpend * 0.3;
  const opponentScore = opponentInfluence * 0.7;
  const totalScore = yourScore + opponentScore;
  const voteShare = totalScore > 0 ? (yourScore / totalScore) * 100 : 0;

  // Determine color and status based on vote share
  const getColorClass = () => {
    if (voteShare > 50) return "text-success";
    if (voteShare < 50) return "text-error";
    return "text-warning";
  };

  const getStatusText = () => {
    if (voteShare > 50) return "Likely Win";
    if (voteShare < 50) return "Likely Loss";
    return "Tied Race";
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      {/* Title */}
      <h3 className="text-xl font-bold text-foreground mb-6">Vote Share Calculator</h3>

      {/* Input Sliders */}
      <div className="space-y-6 mb-8">
        {/* Your Influence */}
        <div className="space-y-2">
          <label htmlFor="influence-slider" className="block text-sm font-medium text-foreground">
            Your Influence: <span className="text-muted">{influence}</span>
          </label>
          <Slider
            id="influence-slider"
            min={0}
            max={100}
            value={influence}
            onChange={(e) => setInfluence(Number(e.target.value))}
            variant="secondary"
            aria-label="Your influence level from 0 to 100"
          />
        </div>

        {/* Your Favorability */}
        <div className="space-y-2">
          <label
            htmlFor="favorability-slider"
            className="block text-sm font-medium text-foreground"
          >
            Your Favorability: <span className="text-muted">{favorability}</span>
          </label>
          <Slider
            id="favorability-slider"
            min={0}
            max={100}
            value={favorability}
            onChange={(e) => setFavorability(Number(e.target.value))}
            variant="secondary"
            aria-label="Your favorability rating from 0 to 100"
          />
        </div>

        {/* Your Ad Spend */}
        <div className="space-y-2">
          <label htmlFor="adspend-slider" className="block text-sm font-medium text-foreground">
            Your Ad Spend ($M): <span className="text-muted">{adSpend}</span>
          </label>
          <Slider
            id="adspend-slider"
            min={0}
            max={50}
            value={adSpend}
            onChange={(e) => setAdSpend(Number(e.target.value))}
            variant="success"
            aria-label="Your advertising spend in millions of dollars from 0 to 50"
          />
        </div>

        {/* Opponent Influence */}
        <div className="space-y-2">
          <label htmlFor="opponent-slider" className="block text-sm font-medium text-foreground">
            Opponent Influence: <span className="text-muted">{opponentInfluence}</span>
          </label>
          <Slider
            id="opponent-slider"
            min={0}
            max={100}
            value={opponentInfluence}
            onChange={(e) => setOpponentInfluence(Number(e.target.value))}
            variant="error"
            aria-label="Opponent influence level from 0 to 100"
          />
        </div>
      </div>

      {/* Result Display */}
      <div className="bg-muted/30 rounded-lg p-6 mb-4 text-center">
        <div className="mb-2">
          <span className="text-sm font-medium text-muted">Estimated Vote Share</span>
        </div>
        <div className={`text-5xl font-bold mb-2 ${getColorClass()}`}>{voteShare.toFixed(1)}%</div>
        <div className={`text-lg font-semibold ${getColorClass()}`}>{getStatusText()}</div>
      </div>

      {/* Disclaimer */}
      <div className="text-sm text-muted italic">
        This is a simplified estimation. Actual elections involve many more factors.
      </div>
    </div>
  );
}
