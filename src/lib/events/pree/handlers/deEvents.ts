/**
 * Country-scoped player random events — Germany.
 * Seeded with requiresCountryIds: ["DE"] in countryDefinitions.ts.
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
  kind: "pree.de.autobahnAccident",
  defaultOptionId: "drive",
  options: [
    {
      id: "renderAid",
      label: "Stop and render aid",
      description: "First on scene — you help.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Hailed for courage",
        "Did the right thing",
        "Shaken but commended",
        [{ type: "favorability", delta: 7 }],
        [{ type: "favorability", delta: 4 }],
        [{ type: "favorability", delta: 2 }]
      ),
    },
    {
      id: "callIn",
      label: "Call it in and drive on",
      description: "Alert the authorities, keep moving.",
      outcomeTable: threeTierTable(
        "Reasonable",
        "Fine",
        "Could have done more",
        [],
        [],
        [{ type: "infamy", delta: 2 }]
      ),
    },
    {
      id: "film",
      label: "Film it and post it",
      description: "Pull out the phone.",
      outcomeTable: threeTierTable(
        "Goes viral, mixed",
        "Tasteless to some",
        "Gawker backlash",
        [{ type: "favorability", delta: -2 }],
        [{ type: "infamy", delta: 2 }],
        [
          { type: "favorability", delta: -6 },
          { type: "infamy", delta: 3 },
        ]
      ),
    },
    {
      id: "drive",
      label: "Keep driving",
      description: "Don't get involved.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Unseen",
        "Quietly judged",
        "Failure-to-aid whispers",
        [],
        [{ type: "infamy", delta: 1 }],
        [{ type: "infamy", delta: 3 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.de.schrebergarten",
  defaultOptionId: "ignore",
  options: [
    {
      id: "comply",
      label: "Comply with the rules",
      description: "Bring the plot into line.",
      outcomeTable: threeTierTable(
        "Model member",
        "Good neighbor",
        "Grudging compliance",
        [{ type: "favorability", delta: 3 }],
        [{ type: "favorability", delta: 1 }],
        []
      ),
    },
    {
      id: "fight",
      label: "Fight it at the members' meeting",
      description: "Make your case to the association.",
      outcomeTable: threeTierTable(
        "Respected stand",
        "A draw",
        "Petty-feud reputation",
        [{ type: "favorability", delta: 2 }],
        [],
        [{ type: "infamy", delta: 2 }]
      ),
    },
    {
      id: "giveUp",
      label: "Give up the plot",
      description: "Walk away from it.",
      outcomeTable: threeTierTable(
        "Clean exit, small return",
        "Move on",
        "Seen as quitting",
        [{ type: "personalWealth", deltaAnchor: 10_000 }],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "ignore",
      label: "Ignore the letters",
      description: "Let the dispute fester.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Blows over",
        "Neighbors irked",
        "Expelled from the club",
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
  kind: "pree.de.kartellamt",
  defaultOptionId: "stonewall",
  options: [
    {
      id: "settle",
      label: "Settle with binding commitments",
      description: "Give the Cartel Office certainty.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Certainty rewarded",
        "Matter closed",
        "Commitments bite",
        [
          { type: "corpSentiment", delta: 4 },
          { type: "personalWealth", deltaAnchor: -25_000 },
        ],
        [{ type: "corpSentiment", delta: 1 }],
        [
          { type: "corpSentiment", delta: -1 },
          { type: "personalWealth", deltaAnchor: -50_000 },
        ]
      ),
    },
    {
      id: "litigate",
      label: "Litigate to the end",
      description: "Fight the dominance case.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "Cleared in court",
        "Long, costly fight",
        "Record cartel fine",
        [{ type: "corpSentiment", delta: 6 }],
        [
          { type: "corpSentiment", delta: -1 },
          { type: "personalWealth", deltaAnchor: -50_000 },
        ],
        [
          { type: "corpSentiment", delta: -12 },
          { type: "personalWealth", deltaAnchor: -150_000 },
          { type: "infamy", delta: 4 },
        ],
        {
          low: {
            category: "general",
            title: "Bundeskartellamt fines {corp} a record sum",
            template:
              "Germany's Federal Cartel Office has imposed a record fine on {corp} after CEO {name} lost a drawn-out fight over abuse of market dominance.",
          },
        }
      ),
    },
    {
      id: "spinOff",
      label: "Spin off the contested unit",
      description: "Divest to defuse the probe.",
      outcomeTable: threeTierTable(
        "Clean resolution",
        "Acceptable",
        "Sold at a discount",
        [
          { type: "corpSentiment", delta: 3 },
          { type: "personalWealth", deltaAnchor: -25_000 },
        ],
        [{ type: "personalWealth", deltaAnchor: -25_000 }],
        [{ type: "personalWealth", deltaAnchor: -50_000 }]
      ),
    },
    {
      id: "stonewall",
      label: "Stonewall",
      description: "Give the regulator nothing.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "They back off",
        "Regulator digs in",
        "Made an example of",
        [{ type: "corpSentiment", delta: -2 }],
        [
          { type: "corpSentiment", delta: -4 },
          { type: "infamy", delta: 2 },
        ],
        [
          { type: "corpSentiment", delta: -8 },
          { type: "infamy", delta: 4 },
        ]
      ),
    },
  ],
  buildPayload: buildCeoCorpPayload,
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.de.factoryRestructure",
  defaultOptionId: "stall",
  options: [
    {
      id: "socialPlan",
      label: "Negotiate a social plan",
      description: "Cut a deal with the works council.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Labor peace, praised",
        "Orderly transition",
        "Severance stings",
        [
          { type: "favorability", delta: 5 },
          { type: "personalWealth", deltaAnchor: -50_000 },
        ],
        [
          { type: "favorability", delta: 2 },
          { type: "personalWealth", deltaAnchor: -50_000 },
        ],
        [{ type: "personalWealth", deltaAnchor: -75_000 }]
      ),
    },
    {
      id: "pushThrough",
      label: "Push restructuring through regardless",
      description: "Override the works council.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Markets cheer the cuts",
        "Efficient but resented",
        "Crippling strike",
        [
          { type: "corpSentiment", delta: 5 },
          { type: "favorability", delta: -4 },
        ],
        [
          { type: "corpSentiment", delta: 2 },
          { type: "favorability", delta: -6 },
        ],
        [
          { type: "corpSentiment", delta: -6 },
          { type: "favorability", delta: -10 },
          { type: "infamy", delta: 4 },
        ],
        {
          low: {
            category: "general",
            title: "Strike paralyzes {corp} after restructuring push",
            template:
              "Workers at {corp} have walked out after CEO {name} forced through a restructuring over the objections of the works council, halting production.",
          },
        }
      ),
    },
    {
      id: "profitShare",
      label: "Offer profit-sharing instead of cuts",
      description: "Trade cuts for a stake in the upside.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Goodwill and buy-in",
        "Reasonable peace",
        "Costly compromise",
        [
          { type: "favorability", delta: 4 },
          { type: "personalWealth", deltaAnchor: -25_000 },
        ],
        [{ type: "favorability", delta: 2 }],
        [{ type: "personalWealth", deltaAnchor: -50_000 }]
      ),
    },
    {
      id: "stall",
      label: "Stall negotiations",
      description: "Play for time.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Buys breathing room",
        "Tension simmers",
        "Trust collapses",
        [],
        [{ type: "corpSentiment", delta: -1 }],
        [
          { type: "corpSentiment", delta: -3 },
          { type: "favorability", delta: -2 },
        ]
      ),
    },
  ],
  buildPayload: buildCeoCorpPayload,
  applyEffects: apply,
});

// ── POLITICIAN ───────────────────────────────────────────────────────────────

registerEventHandler({
  kind: "pree.de.bundestagSpeech",
  defaultOptionId: "yield",
  options: [
    {
      id: "fiery",
      label: "Deliver a fiery, partisan speech",
      description: "Rally your side, hammer theirs.",
      primaryStat: "debate",
      outcomeTable: threeTierTable(
        "Base roars approval",
        "Energizes the faithful",
        "Divisive and shrill",
        [
          { type: "politicalInfluence", delta: 5 },
          { type: "favorability", delta: 2 },
        ],
        [{ type: "politicalInfluence", delta: 2 }],
        [
          { type: "favorability", delta: -6 },
          { type: "infamy", delta: 3 },
        ],
        {
          high: {
            category: "executive",
            title: "{name} fires up the Bundestag",
            template:
              "{name} delivered a barnstorming Bundestag speech that rallied supporters across {country} and dominated the day's debate.",
          },
        }
      ),
    },
    {
      id: "reachAcross",
      label: "Reach across the aisle",
      description: "Strike a consensual, grand-coalition tone.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Praised as a bridge-builder",
        "Constructive",
        "Too soft for some",
        [
          { type: "favorability", delta: 4 },
          { type: "politicalInfluence", delta: 2 },
        ],
        [{ type: "favorability", delta: 2 }],
        []
      ),
    },
    {
      id: "partyLine",
      label: "Read a cautious party-line text",
      description: "Safe, scripted, on-message.",
      outcomeTable: threeTierTable(
        "Reliable",
        "Unremarkable",
        "Wooden delivery",
        [{ type: "politicalInfluence", delta: 1 }],
        [],
        []
      ),
    },
    {
      id: "yield",
      label: "Yield your time",
      description: "Give up the slot.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "No harm",
        "Missed chance",
        "Looks disengaged",
        [],
        [{ type: "politicalInfluence", delta: -1 }],
        [{ type: "politicalInfluence", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.de.talkshow",
  defaultOptionId: "decline",
  options: [
    {
      id: "combative",
      label: "Engage combatively with rivals",
      description: "Take the fight to the panel.",
      primaryStat: "debate",
      outcomeTable: threeTierTable(
        "Wins the exchange",
        "Holds your own",
        "Loses your cool on air",
        [{ type: "politicalInfluence", delta: 4 }],
        [{ type: "politicalInfluence", delta: 1 }],
        [
          { type: "favorability", delta: -6 },
          { type: "infamy", delta: 3 },
        ]
      ),
    },
    {
      id: "reasonable",
      label: "Be the reasonable voice",
      description: "Calm, credible, above the fray.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Voice of reason",
        "Comes off well",
        "A little forgettable",
        [{ type: "favorability", delta: 5 }],
        [{ type: "favorability", delta: 2 }],
        []
      ),
    },
    {
      id: "onMessage",
      label: "Stay narrowly on-message",
      description: "Repeat the lines, take no risks.",
      outcomeTable: threeTierTable(
        "Disciplined",
        "Safe",
        "Evasive-sounding",
        [{ type: "favorability", delta: 1 }],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "decline",
      label: "Decline the invitation",
      description: "Skip the panel.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "No one minds",
        "Quietly cautious",
        "Read as hiding",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});
