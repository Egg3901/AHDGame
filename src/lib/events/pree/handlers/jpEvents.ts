/**
 * Country-scoped player random events — Japan.
 * Seeded with requiresCountryIds: ["JP"] in countryDefinitions.ts.
 */
import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { buildCeoCorpPayload } from "../payload";
import { threeTierTable } from "./tiers";

const apply: EventHandler["applyEffects"] = async (ctx) => {
  await applyDeclarativeEffects(ctx, ctx.tier.effects);
};

// ── ALL ──────────────────────────────────────────────────────────────────────

registerEventHandler({
  kind: "pree.jp.furusatoNozei",
  defaultOptionId: "skip",
  options: [
    {
      id: "hometown",
      label: "Donate to your struggling hometown",
      description: "Send your hometown-tax there.",
      outcomeTable: threeTierTable(
        "Local hero back home",
        "Warmly received",
        "Quiet gesture",
        [
          { type: "favorability", delta: 4 },
          { type: "personalWealth", deltaAnchor: -10_000 },
        ],
        [
          { type: "favorability", delta: 2 },
          { type: "personalWealth", deltaAnchor: -10_000 },
        ],
        [{ type: "personalWealth", deltaAnchor: -10_000 }]
      ),
    },
    {
      id: "gifts",
      label: "Chase the best gift returns",
      description: "Optimise for the regional gifts.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "Shrewd and rewarded",
        "Nice haul",
        '"Gaming the system" whispers',
        [{ type: "personalWealth", deltaAnchor: 15_000 }],
        [{ type: "personalWealth", deltaAnchor: 10_000 }],
        [{ type: "infamy", delta: 2 }]
      ),
    },
    {
      id: "disaster",
      label: "Give to a disaster-hit prefecture",
      description: "Direct it where it's needed most.",
      outcomeTable: threeTierTable(
        "Compassion celebrated",
        "Well regarded",
        "Modest notice",
        [{ type: "favorability", delta: 5 }],
        [{ type: "favorability", delta: 3 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "skip",
      label: "Skip it this year",
      description: "Do nothing.",
      isDefault: true,
      outcomeTable: threeTierTable("No change", "No change", "No change", [], [], []),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.jp.bosaiDrill",
  defaultOptionId: "skip",
  options: [
    {
      id: "takeCharge",
      label: "Take charge and help neighbors",
      description: "Lead when the tremor hits.",
      primaryStat: "energy",
      outcomeTable: threeTierTable(
        "Pillar of the community",
        "Steady hand praised",
        "Well-meant but chaotic",
        [{ type: "favorability", delta: 8 }],
        [{ type: "favorability", delta: 4 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "follow",
      label: "Quietly follow instructions",
      description: "Do your part without fuss.",
      outcomeTable: threeTierTable(
        "Quiet credit",
        "Unremarkable",
        "Forgettable",
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }],
        []
      ),
    },
    {
      id: "slipAway",
      label: "Slip away early",
      description: "Duck out of the drill.",
      outcomeTable: threeTierTable(
        "Unnoticed",
        "Mild side-eye",
        "Neighbors disapprove",
        [],
        [{ type: "favorability", delta: -1 }],
        [{ type: "favorability", delta: -2 }]
      ),
    },
    {
      id: "skip",
      label: "Skip the drill entirely",
      description: "Don't show up.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Goes unseen",
        "Absence noted",
        "Branded antisocial",
        [],
        [{ type: "favorability", delta: -1 }],
        [{ type: "infamy", delta: 2 }]
      ),
    },
  ],
  applyEffects: apply,
});

// ── CEO ──────────────────────────────────────────────────────────────────────

registerEventHandler({
  kind: "pree.jp.keiretsu",
  defaultOptionId: "mainBank",
  options: [
    {
      id: "bailout",
      label: "Bail them out for group harmony",
      description: "Step in via cross-shareholding.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Loyalty honored",
        "Group held together",
        "Markets punish the drag",
        [
          { type: "favorability", delta: 4 },
          { type: "corpSentiment", delta: -2 },
          { type: "personalWealth", deltaAnchor: -50_000 },
        ],
        [
          { type: "favorability", delta: 2 },
          { type: "corpSentiment", delta: -4 },
          { type: "personalWealth", deltaAnchor: -50_000 },
        ],
        [
          { type: "corpSentiment", delta: -8 },
          { type: "personalWealth", deltaAnchor: -100_000 },
        ],
        {
          low: {
            category: "general",
            title: "Markets sour on {corp} keiretsu bailout",
            template:
              "Shares in {corp} came under pressure after CEO {name} committed the company to rescuing a struggling affiliate, a move investors called value-destructive.",
          },
        }
      ),
    },
    {
      id: "cutTies",
      label: "Refuse and cut ties",
      description: "Let the affiliate fail.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Disciplined, markets approve",
        "Clean break",
        "Branded disloyal",
        [{ type: "corpSentiment", delta: 5 }],
        [
          { type: "corpSentiment", delta: 2 },
          { type: "favorability", delta: -2 },
        ],
        [
          { type: "favorability", delta: -4 },
          { type: "infamy", delta: 3 },
        ]
      ),
    },
    {
      id: "restructure",
      label: "Restructure them under your terms",
      description: "Absorb the affiliate on your terms.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Masterful consolidation",
        "Workable merger",
        "Messy integration",
        [{ type: "corpSentiment", delta: 6 }],
        [{ type: "corpSentiment", delta: 1 }],
        [
          { type: "corpSentiment", delta: -3 },
          { type: "personalWealth", deltaAnchor: -50_000 },
        ]
      ),
    },
    {
      id: "mainBank",
      label: "Defer to the main bank",
      description: "Let the lead bank decide.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Tidy hand-off",
        "Neutral",
        "Looks passive",
        [],
        [],
        [{ type: "corpSentiment", delta: -2 }]
      ),
    },
  ],
  buildPayload: buildCeoCorpPayload,
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.jp.sokaiya",
  defaultOptionId: "hope",
  options: [
    {
      id: "police",
      label: "Refuse and call the police",
      description: "Report the racketeers.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Clean AGM, lauded",
        "Handled correctly",
        "AGM disrupted",
        [{ type: "corpSentiment", delta: 5 }],
        [{ type: "corpSentiment", delta: 2 }],
        [{ type: "corpSentiment", delta: -3 }]
      ),
    },
    {
      id: "payoff",
      label: "Quietly pay them off",
      description: "Make the problem disappear.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Smooth meeting",
        "No disruption",
        "Payoff exposed",
        [{ type: "corpSentiment", delta: 1 }],
        [],
        [
          { type: "corpSentiment", delta: -6 },
          { type: "infamy", delta: 6 },
        ],
        {
          low: {
            category: "general",
            title: "{corp} chief tied to sōkaiya payoff",
            template:
              "Prosecutors are examining {corp} after revelations that CEO {name} paid corporate racketeers to keep the shareholders' meeting quiet.",
          },
        }
      ),
    },
    {
      id: "handlers",
      label: "Hire professional meeting-handlers",
      description: "Bring in specialists for the AGM.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Flawless meeting",
        "Orderly",
        "Costly precaution",
        [
          { type: "corpSentiment", delta: 3 },
          { type: "personalWealth", deltaAnchor: -25_000 },
        ],
        [{ type: "personalWealth", deltaAnchor: -25_000 }],
        [{ type: "personalWealth", deltaAnchor: -25_000 }]
      ),
    },
    {
      id: "hope",
      label: "Hope they don't show",
      description: "Do nothing and pray.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "They never appear",
        "Tense but fine",
        "Meeting hijacked",
        [],
        [{ type: "corpSentiment", delta: -1 }],
        [
          { type: "corpSentiment", delta: -5 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
  ],
  buildPayload: buildCeoCorpPayload,
  applyEffects: apply,
});

// ── POLITICIAN ───────────────────────────────────────────────────────────────

registerEventHandler({
  kind: "pree.jp.koenkai",
  defaultOptionId: "skip",
  options: [
    {
      id: "headline",
      label: "Headline it generously",
      description: "Be the main draw and spend.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Base electrified",
        "Faithful pleased",
        "Pricey night",
        [
          { type: "favorability", delta: 5 },
          { type: "personalWealth", deltaAnchor: -25_000 },
        ],
        [
          { type: "favorability", delta: 3 },
          { type: "personalWealth", deltaAnchor: -25_000 },
        ],
        [
          { type: "favorability", delta: 1 },
          { type: "personalWealth", deltaAnchor: -25_000 },
        ]
      ),
    },
    {
      id: "attend",
      label: "Attend modestly",
      description: "Show your face, keep it lean.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Solid turnout",
        "Steady support",
        "Underwhelms",
        [
          { type: "favorability", delta: 2 },
          { type: "politicalInfluence", delta: 1 },
        ],
        [{ type: "favorability", delta: 1 }],
        []
      ),
    },
    {
      id: "video",
      label: "Send a video and a gift",
      description: "Skip in person, send warmth.",
      outcomeTable: threeTierTable(
        "Gracious touch",
        "Acceptable",
        "Absence felt",
        [{ type: "favorability", delta: 1 }],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "skip",
      label: "Skip it",
      description: "Don't attend.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Forgiven",
        "Supporters grumble",
        "Loyalists offended",
        [],
        [{ type: "favorability", delta: -1 }],
        [{ type: "favorability", delta: -3 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.jp.nhkDebate",
  defaultOptionId: "decline",
  options: [
    {
      id: "bold",
      label: "Take a bold policy stance",
      description: "Stake out clear ground on air.",
      primaryStat: "debate",
      outcomeTable: threeTierTable(
        "Commands the debate",
        "Makes an impression",
        "Alienates the middle",
        [
          { type: "politicalInfluence", delta: 5 },
          { type: "favorability", delta: 2 },
        ],
        [{ type: "politicalInfluence", delta: 2 }],
        [{ type: "favorability", delta: -4 }]
      ),
    },
    {
      id: "safe",
      label: "Play it safe and statesmanlike",
      description: "Calm, broad, reassuring.",
      primaryStat: "debate",
      outcomeTable: threeTierTable(
        "Looks prime-ministerial",
        "Steady showing",
        "A touch bland",
        [
          { type: "favorability", delta: 3 },
          { type: "politicalInfluence", delta: 1 },
        ],
        [{ type: "favorability", delta: 1 }],
        []
      ),
    },
    {
      id: "talkingPoints",
      label: "Send talking points, skip the seat",
      description: "Provide a statement, don't appear.",
      outcomeTable: threeTierTable(
        "No harm",
        "Mildly absent",
        "Empty chair noticed",
        [],
        [{ type: "politicalInfluence", delta: -1 }],
        [{ type: "politicalInfluence", delta: -1 }]
      ),
    },
    {
      id: "decline",
      label: "Decline",
      description: "Pass on the invitation.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "No one minds",
        "Quietly cautious",
        "Read as ducking",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});
