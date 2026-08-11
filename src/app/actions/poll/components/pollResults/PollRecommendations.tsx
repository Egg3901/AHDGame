"use client";

import type { StoredPoll, PollData } from "../../types";

/**
 * Generates 2–3 brief, vague recommendations based on what's hurting the player's poll numbers most.
 * Intentionally avoids exact numbers or prescriptive actions — just directional hints.
 */
export function PollRecommendations({ poll, pollData }: { poll: StoredPoll; pollData: PollData }) {
  const tips = generateTips(poll, pollData);

  if (tips.length === 0) return null;

  return (
    <div className="mb-6 rounded-xl border border-secondary/20 bg-secondary/5 p-4">
      <div className="text-xs text-secondary uppercase tracking-wide mb-2 font-medium">
        Pollster&apos;s Notes
      </div>
      <ul className="space-y-1.5">
        {tips.map((tip, i) => (
          <li key={i} className="flex gap-2 text-sm text-muted/80">
            <span className="text-secondary shrink-0">&#x2022;</span>
            <span>{tip}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function generateTips(poll: StoredPoll, pollData: PollData): string[] {
  const tips: string[] = [];
  const { favorability, politicalInfluence, partyOrg, economicPosition, socialPosition } =
    pollData.character;

  // 1. Identify the weakest stat
  const stats: { name: string; value: number; tip: string }[] = [
    {
      name: "influence",
      value: politicalInfluence,
      tip: "Your name recognition is low — most voters don't know who you are yet. Building influence should be a priority.",
    },
    {
      name: "favorability",
      value: favorability,
      tip: "Your favorability is dragging you down — even voters who know you aren't sold. Focus on improving your public image.",
    },
  ];

  if (partyOrg != null) {
    stats.push({
      name: "partyOrg",
      value: partyOrg,
      tip: "Your party's ground game in this state is weak. Investing in organization could help mobilize more supporters.",
    });
  }

  // Find the weakest stat (normalize: influence/fav are 0–100, org is 0–100)
  const weakest = stats.reduce((min, s) => (s.value < min.value ? s : min), stats[0]);
  if (weakest.value < 40) {
    tips.push(weakest.tip);
  }

  // 2. Position alignment — check if there's a directional opportunity
  // Look at the top groups by population to see where the voters are
  const allGroups = (poll.categories ?? []).flatMap((c) => c.groups);
  if (allGroups.length > 0) {
    // Weight each group's lean by its turnout population to find the electorate center
    const totalTurnout = allGroups.reduce((s, g) => s + g.turnoutPop, 0) || 1;
    const avgEconLean =
      allGroups.reduce((s, g) => s + g.economicLean * g.turnoutPop, 0) / totalTurnout;
    const avgSocialLean =
      allGroups.reduce((s, g) => s + g.socialLean * g.turnoutPop, 0) / totalTurnout;

    const econGap = avgEconLean - economicPosition;
    const socialGap = avgSocialLean - socialPosition;

    // Only suggest if the gap is meaningful (> 1.5 points)
    if (Math.abs(econGap) > 1.5 && Math.abs(econGap) >= Math.abs(socialGap)) {
      const direction = econGap > 0 ? "right" : "left";
      tips.push(
        `Your state's electorate leans further ${direction} economically than your current position. Shifting that way could broaden your appeal.`
      );
    } else if (Math.abs(socialGap) > 1.5) {
      const direction = socialGap > 0 ? "more traditional" : "more liberal";
      tips.push(
        `Socially, your state's voters are ${direction} than your current stance. Adjusting could help with several voter groups.`
      );
    }
  }

  // 3. If appeal is decent but influence is the bottleneck
  if (poll.overallAppeal >= 25 && politicalInfluence < 30) {
    tips.push(
      "Your positions resonate well, but too few voters know you. Raising your profile would convert appeal into actual votes."
    );
  }

  // 4. If everything is reasonable, give a positive note
  if (tips.length === 0) {
    if (poll.overallAppeal >= 30) {
      tips.push(
        "Your polling looks solid. Maintain your current approach and focus on keeping favorability high."
      );
    } else {
      tips.push(
        "There's room to grow. Consider which voter groups matter most and whether your positions align with theirs."
      );
    }
  }

  // Cap at 3 tips
  return tips.slice(0, 3);
}
