/**
 * Country-scoped player random events — United States.
 * Six events: 2 "all", 2 "ceo", 2 "politician". Seeded with
 * requiresCountryIds: ["US"] in countryDefinitions.ts. Option ids and the
 * default here MUST match the seed definition exactly (the approve route
 * rejects drift).
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
  kind: "pree.us.classAction",
  defaultOptionId: "ignore",
  options: [
    {
      id: "cashIt",
      label: "Cash the check",
      description: "Collect the settlement now.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "Tidy windfall",
        "Modest payout",
        "Small sum, looks litigious",
        [{ type: "personalWealth", deltaAnchor: 50_000 }],
        [{ type: "personalWealth", deltaAnchor: 25_000 }],
        [
          { type: "personalWealth", deltaAnchor: 10_000 },
          { type: "favorability", delta: -1 },
        ]
      ),
    },
    {
      id: "donate",
      label: "Donate it to a local cause",
      description: "Sign the check over to charity.",
      outcomeTable: threeTierTable(
        "Generosity noticed",
        "Quiet good deed",
        "Barely registers",
        [{ type: "favorability", delta: 4 }],
        [
          { type: "favorability", delta: 2 },
          { type: "personalWealth", deltaAnchor: -10_000 },
        ],
        [
          { type: "favorability", delta: 1 },
          { type: "personalWealth", deltaAnchor: -10_000 },
        ]
      ),
    },
    {
      id: "optOut",
      label: "Opt out to sue individually",
      description: "Roll the dice on your own suit.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "Big individual award",
        "Decent settlement",
        "Legal costs sink it",
        [{ type: "personalWealth", deltaAnchor: 150_000 }],
        [{ type: "personalWealth", deltaAnchor: 25_000 }],
        [{ type: "personalWealth", deltaAnchor: -50_000 }]
      ),
    },
    {
      id: "ignore",
      label: "Ignore the notice",
      description: "Do nothing.",
      isDefault: true,
      outcomeTable: threeTierTable("Forfeited", "Forfeited", "Forfeited", [], [], []),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.us.goFundMe",
  defaultOptionId: "stayQuiet",
  options: [
    {
      id: "accept",
      label: "Accept and thank donors publicly",
      description: "Embrace the fundraiser.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Outpouring of support",
        "Warmly received",
        "Read as grifting",
        [
          { type: "personalWealth", deltaAnchor: 50_000 },
          { type: "favorability", delta: 3 },
        ],
        [
          { type: "personalWealth", deltaAnchor: 25_000 },
          { type: "favorability", delta: 1 },
        ],
        [
          { type: "personalWealth", deltaAnchor: 15_000 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
    {
      id: "charity",
      label: "Redirect the funds to charity",
      description: "Send every dollar onward.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Selflessness praised",
        "Well regarded",
        "Politely noted",
        [{ type: "favorability", delta: 5 }],
        [{ type: "favorability", delta: 3 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "shutDown",
      label: "Shut it down as misinformation",
      description: "Disavow the fundraiser.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Integrity applauded",
        "Fair enough",
        "Comes off ungrateful",
        [{ type: "favorability", delta: 3 }],
        [{ type: "favorability", delta: 1 }],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "stayQuiet",
      label: "Stay quiet",
      description: "Let it run its course.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Fades quietly",
        "Mild grumbling",
        "Looks evasive",
        [],
        [{ type: "favorability", delta: -1 }],
        [{ type: "favorability", delta: -2 }]
      ),
    },
  ],
  applyEffects: apply,
});

// ── CEO ──────────────────────────────────────────────────────────────────────

registerEventHandler({
  kind: "pree.us.secComment",
  defaultOptionId: "ignore",
  options: [
    {
      id: "refile",
      label: "Refile and cooperate",
      description: "Open the books to the SEC.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Clean bill of health",
        "Matter closed",
        "Costly but contained",
        [
          { type: "corpSentiment", delta: 4 },
          { type: "personalWealth", deltaAnchor: -25_000 },
        ],
        [
          { type: "corpSentiment", delta: 1 },
          { type: "personalWealth", deltaAnchor: -25_000 },
        ],
        [
          { type: "corpSentiment", delta: -1 },
          { type: "personalWealth", deltaAnchor: -50_000 },
        ]
      ),
    },
    {
      id: "contest",
      label: "Lawyer up and contest",
      description: "Fight every line of the letter.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Vindicated",
        "Drags on",
        "Probe widens",
        [{ type: "corpSentiment", delta: 6 }],
        [
          { type: "corpSentiment", delta: 0 },
          { type: "personalWealth", deltaAnchor: -50_000 },
        ],
        [
          { type: "corpSentiment", delta: -10 },
          { type: "infamy", delta: 5 },
        ],
        {
          low: {
            category: "general",
            title: "SEC widens probe into {corp}",
            template:
              "Federal regulators have escalated their inquiry into {corp} after CEO {name} contested an SEC comment letter, people familiar with the matter said.",
          },
        }
      ),
    },
    {
      id: "restate",
      label: "Quietly restate earnings",
      description: "Issue a correction and move on.",
      outcomeTable: threeTierTable(
        "Cleared the air",
        "Market shrugs",
        "Credibility dented",
        [{ type: "corpSentiment", delta: -2 }],
        [{ type: "corpSentiment", delta: -3 }],
        [
          { type: "corpSentiment", delta: -5 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
    {
      id: "ignore",
      label: "Ignore the letter",
      description: "File it away.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Slips through",
        "Regulators press",
        "Enforcement referral",
        [{ type: "corpSentiment", delta: -3 }],
        [
          { type: "corpSentiment", delta: -6 },
          { type: "infamy", delta: 2 },
        ],
        [
          { type: "corpSentiment", delta: -9 },
          { type: "infamy", delta: 4 },
        ],
        {
          low: {
            category: "general",
            title: "SEC refers {corp} for enforcement",
            template:
              "The SEC has referred {corp} for potential enforcement after the company, led by {name}, failed to respond to a comment letter.",
          },
        }
      ),
    },
  ],
  buildPayload: buildCeoCorpPayload,
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.us.plantClosure",
  defaultOptionId: "defer",
  options: [
    {
      id: "keepOpen",
      label: "Keep it open, invest locally",
      description: "Bet on the Midwest plant.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Hailed as a job-saver",
        "Goodwill earned",
        "Costly loyalty",
        [
          { type: "favorability", delta: 6 },
          { type: "personalWealth", deltaAnchor: -50_000 },
        ],
        [
          { type: "favorability", delta: 3 },
          { type: "personalWealth", deltaAnchor: -50_000 },
        ],
        [
          { type: "favorability", delta: 1 },
          { type: "personalWealth", deltaAnchor: -100_000 },
        ]
      ),
    },
    {
      id: "offshore",
      label: "Offshore for margins",
      description: "Move the jobs overseas.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Street cheers the cuts",
        "Margins up, town furious",
        "Hometown betrayal",
        [
          { type: "corpSentiment", delta: 6 },
          { type: "favorability", delta: -8 },
          { type: "infamy", delta: 3 },
        ],
        [
          { type: "corpSentiment", delta: 4 },
          { type: "favorability", delta: -10 },
        ],
        [
          { type: "corpSentiment", delta: 2 },
          { type: "favorability", delta: -14 },
          { type: "infamy", delta: 5 },
        ],
        {
          high: {
            category: "general",
            title: "{corp} to shutter Midwest plant, move jobs overseas",
            template:
              "{corp}, under CEO {name}, will close its Rust Belt facility and relocate production abroad, drawing fierce backlash from workers and local officials.",
          },
          mid: {
            category: "general",
            title: "{corp} to shutter Midwest plant, move jobs overseas",
            template:
              "{corp}, under CEO {name}, will close its Rust Belt facility and relocate production abroad, drawing fierce backlash from workers and local officials.",
          },
          low: {
            category: "general",
            title: "{corp} to shutter Midwest plant, move jobs overseas",
            template:
              "{corp}, under CEO {name}, will close its Rust Belt facility and relocate production abroad, drawing fierce backlash from workers and local officials.",
          },
        }
      ),
    },
    {
      id: "negotiate",
      label: "Negotiate concessions with the union",
      description: "Find a middle path.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Deal lands well",
        "Workable compromise",
        "Talks sour",
        [
          { type: "corpSentiment", delta: 3 },
          { type: "favorability", delta: 2 },
        ],
        [{ type: "corpSentiment", delta: 1 }],
        [
          { type: "corpSentiment", delta: -1 },
          { type: "favorability", delta: -2 },
        ]
      ),
    },
    {
      id: "defer",
      label: "Defer the decision",
      description: "Kick it down the road.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "No harm yet",
        "Uncertainty drags",
        "Drift punished",
        [],
        [{ type: "corpSentiment", delta: -1 }],
        [{ type: "corpSentiment", delta: -2 }]
      ),
    },
  ],
  buildPayload: buildCeoCorpPayload,
  applyEffects: apply,
});

// ── POLITICIAN ───────────────────────────────────────────────────────────────

registerEventHandler({
  kind: "pree.us.filibuster",
  defaultOptionId: "noStance",
  options: [
    {
      id: "lead",
      label: "Lead the floor fight",
      description: "Hold the floor all night.",
      primaryStat: "debate",
      outcomeTable: threeTierTable(
        "Folk-hero moment",
        "Base energized",
        "Grandstanding backfires",
        [
          { type: "politicalInfluence", delta: 5 },
          { type: "favorability", delta: 4 },
        ],
        [
          { type: "politicalInfluence", delta: 3 },
          { type: "favorability", delta: 2 },
        ],
        [
          { type: "politicalInfluence", delta: 1 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
    {
      id: "compromise",
      label: "Cut a quiet compromise",
      description: "Deal behind the scenes.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Dealmaker praised",
        "Modest win",
        "Seen as a sellout",
        [
          { type: "politicalInfluence", delta: 3 },
          { type: "favorability", delta: 3 },
        ],
        [
          { type: "politicalInfluence", delta: 1 },
          { type: "favorability", delta: 1 },
        ],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "sitOut",
      label: "Sit it out",
      description: "Stay off the floor.",
      outcomeTable: threeTierTable(
        "Unnoticed",
        "Looks absent",
        "Punished for ducking",
        [],
        [{ type: "politicalInfluence", delta: -1 }],
        [
          { type: "politicalInfluence", delta: -2 },
          { type: "favorability", delta: -2 },
        ]
      ),
    },
    {
      id: "noStance",
      label: "Take no public stance",
      description: "Say nothing.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Flies under the radar",
        "Mildly invisible",
        "Looks rudderless",
        [],
        [{ type: "politicalInfluence", delta: -1 }],
        [{ type: "politicalInfluence", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.us.primetimeTownHall",
  defaultOptionId: "decline",
  options: [
    {
      id: "live",
      label: "Do it live, unscripted",
      description: "Take questions on national TV.",
      primaryStat: "debate",
      outcomeTable: threeTierTable(
        "Breakout primetime moment",
        "Solid showing",
        "Primetime gaffe",
        [
          { type: "favorability", delta: 8 },
          { type: "politicalInfluence", delta: 3 },
        ],
        [{ type: "favorability", delta: 4 }],
        [
          { type: "favorability", delta: -10 },
          { type: "infamy", delta: 4 },
        ],
        {
          high: {
            category: "general",
            title: "{name} electrifies primetime town hall",
            template:
              "{name} drew national attention with a commanding live town-hall performance that allies are already calling a breakout moment.",
          },
          low: {
            category: "general",
            title: "{name} stumbles in primetime town hall",
            template:
              "A widely shared gaffe overshadowed {name}'s live town hall, handing opponents fresh material.",
          },
        }
      ),
    },
    {
      id: "scripted",
      label: "Tightly scripted appearance",
      description: "Stay on message.",
      outcomeTable: threeTierTable(
        "Polished and safe",
        "Competent",
        "Forgettable",
        [{ type: "favorability", delta: 4 }],
        [{ type: "favorability", delta: 2 }],
        []
      ),
    },
    {
      id: "surrogate",
      label: "Send a surrogate",
      description: "Let a deputy take it.",
      outcomeTable: threeTierTable(
        "Surrogate shines",
        "Neutral",
        "Absence noted",
        [{ type: "favorability", delta: 1 }],
        [],
        [{ type: "politicalInfluence", delta: -1 }]
      ),
    },
    {
      id: "decline",
      label: "Decline",
      description: "Pass on the invite.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "No one minds",
        "Mildly cautious",
        "Looks afraid",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});
