/**
 * Country-scoped player random events — United Kingdom.
 * Seeded with requiresCountryIds: ["UK"] in countryDefinitions.ts.
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
  kind: "pree.uk.ulez",
  defaultOptionId: "ignore",
  options: [
    {
      id: "scrapEv",
      label: "Scrap it and go electric",
      description: "Trade up to a compliant car.",
      outcomeTable: threeTierTable(
        "Green credentials shine",
        "Sensible switch",
        "Pricey changeover",
        [
          { type: "favorability", delta: 4 },
          { type: "personalWealth", deltaAnchor: -25_000 },
        ],
        [
          { type: "favorability", delta: 2 },
          { type: "personalWealth", deltaAnchor: -25_000 },
        ],
        [{ type: "personalWealth", deltaAnchor: -40_000 }]
      ),
    },
    {
      id: "payCharge",
      label: "Pay the daily charge",
      description: "Keep the old car, eat the cost.",
      outcomeTable: threeTierTable(
        "Barely notice it",
        "Steady drain",
        "Charges add up",
        [{ type: "personalWealth", deltaAnchor: -5_000 }],
        [{ type: "personalWealth", deltaAnchor: -10_000 }],
        [{ type: "personalWealth", deltaAnchor: -20_000 }]
      ),
    },
    {
      id: "protest",
      label: "Join the local protest",
      description: "Rally against the zone.",
      outcomeTable: threeTierTable(
        "Champion of motorists",
        "Mixed reception",
        "Branded a crank",
        [{ type: "favorability", delta: 4 }],
        [{ type: "favorability", delta: 1 }],
        [{ type: "infamy", delta: 2 }]
      ),
    },
    {
      id: "ignore",
      label: "Ignore the fines",
      description: "Let the penalty notices pile up.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Slip through",
        "Penalties mount",
        "Bailiffs at the door",
        [{ type: "personalWealth", deltaAnchor: -10_000 }],
        [{ type: "personalWealth", deltaAnchor: -25_000 }],
        [
          { type: "personalWealth", deltaAnchor: -40_000 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.uk.pubBuyout",
  defaultOptionId: "stayOut",
  options: [
    {
      id: "leadBuyout",
      label: "Lead the community buyout",
      description: "Register it and rally the village.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Saviour of the local",
        "Pub saved",
        "Costly crusade",
        [
          { type: "favorability", delta: 8 },
          { type: "personalWealth", deltaAnchor: -50_000 },
        ],
        [
          { type: "favorability", delta: 5 },
          { type: "personalWealth", deltaAnchor: -50_000 },
        ],
        [
          { type: "favorability", delta: 2 },
          { type: "personalWealth", deltaAnchor: -75_000 },
        ]
      ),
    },
    {
      id: "chipIn",
      label: "Chip in quietly",
      description: "Add a modest stake.",
      outcomeTable: threeTierTable(
        "Quiet thanks",
        "Appreciated",
        "Token gesture",
        [
          { type: "favorability", delta: 3 },
          { type: "personalWealth", deltaAnchor: -10_000 },
        ],
        [
          { type: "favorability", delta: 1 },
          { type: "personalWealth", deltaAnchor: -10_000 },
        ],
        [{ type: "personalWealth", deltaAnchor: -10_000 }]
      ),
    },
    {
      id: "letGo",
      label: "Let the developers have it",
      description: "Back the redevelopment.",
      outcomeTable: threeTierTable(
        "Pragmatic, paid off",
        "Locals grumble",
        "Villain of the village",
        [{ type: "personalWealth", deltaAnchor: 10_000 }],
        [{ type: "favorability", delta: -2 }],
        [{ type: "favorability", delta: -4 }]
      ),
    },
    {
      id: "stayOut",
      label: "Stay out of it",
      description: "Not your fight.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "No one notices",
        "Mildly aloof",
        "Seen as indifferent",
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
  kind: "pree.uk.cmaProbe",
  defaultOptionId: "stonewall",
  options: [
    {
      id: "cooperate",
      label: "Cooperate and offer remedies",
      description: "Give the CMA what it wants.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "Certainty rewarded",
        "Matter settled",
        "Concessions sting",
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
      id: "fight",
      label: "Fight it through the courts",
      description: "Challenge the inquiry.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "Cleared on appeal",
        "Drawn-out battle",
        "Record fine",
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
            title: "CMA hits {corp} with record fine",
            template:
              "The Competition and Markets Authority has levied a record penalty against {corp} after CEO {name} lost a protracted court fight over the regulator's market inquiry.",
          },
        }
      ),
    },
    {
      id: "cutPrices",
      label: "Pre-emptively cut prices",
      description: "Disarm the probe with lower prices.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "Public goodwill",
        "Tidy gesture",
        "Margins bleed",
        [
          { type: "favorability", delta: 4 },
          { type: "personalWealth", deltaAnchor: -25_000 },
        ],
        [{ type: "favorability", delta: 2 }],
        [
          { type: "corpSentiment", delta: -2 },
          { type: "personalWealth", deltaAnchor: -50_000 },
        ]
      ),
    },
    {
      id: "stonewall",
      label: "Stonewall the regulator",
      description: "Concede nothing.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "They blink first",
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
  kind: "pree.uk.selectCommittee",
  defaultOptionId: "deputy",
  options: [
    {
      id: "contrition",
      label: "Show contrition, offer a price freeze",
      description: "Take the humble route on camera.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Statesmanlike",
        "Plays well enough",
        "Freeze bites margins",
        [
          { type: "favorability", delta: 5 },
          { type: "personalWealth", deltaAnchor: -25_000 },
        ],
        [{ type: "favorability", delta: 2 }],
        [
          { type: "favorability", delta: 1 },
          { type: "corpSentiment", delta: -2 },
        ]
      ),
    },
    {
      id: "defend",
      label: "Defend profits robustly",
      description: "No apology, all numbers.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Markets admire the spine",
        "Combative but fine",
        "Out-of-touch boss clip",
        [{ type: "corpSentiment", delta: 5 }],
        [{ type: "corpSentiment", delta: 1 }],
        [
          { type: "corpSentiment", delta: -3 },
          { type: "favorability", delta: -8 },
          { type: "infamy", delta: 4 },
        ],
        {
          low: {
            category: "general",
            title: "Backlash as {corp} boss defends profits to MPs",
            template:
              "{name}, chief executive of {corp}, faced public fury after a defiant select-committee appearance defending the company's profits went viral.",
          },
        }
      ),
    },
    {
      id: "blame",
      label: "Blame energy and supply costs",
      description: "Point at the wider market.",
      outcomeTable: threeTierTable(
        "Bought the argument",
        "Half-convinced",
        "Called evasive",
        [{ type: "favorability", delta: 1 }],
        [],
        [{ type: "infamy", delta: 3 }]
      ),
    },
    {
      id: "deputy",
      label: "Send your deputy instead",
      description: "Skip the hearing.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Barely noticed",
        "Looks like dodging",
        "Empty-chair scandal",
        [],
        [{ type: "infamy", delta: 2 }],
        [
          { type: "infamy", delta: 4 },
          { type: "favorability", delta: -3 },
        ]
      ),
    },
  ],
  buildPayload: buildCeoCorpPayload,
  applyEffects: apply,
});

// ── POLITICIAN ───────────────────────────────────────────────────────────────

registerEventHandler({
  kind: "pree.uk.pmqs",
  defaultOptionId: "silent",
  options: [
    {
      id: "soundbite",
      label: "Go for the killer soundbite",
      description: "Swing for the dispatch box.",
      primaryStat: "debate",
      outcomeTable: threeTierTable(
        "Dispatch-box triumph",
        "Lands a hit",
        "Flops in the chamber",
        [
          { type: "politicalInfluence", delta: 5 },
          { type: "favorability", delta: 4 },
        ],
        [{ type: "politicalInfluence", delta: 2 }],
        [
          { type: "favorability", delta: -8 },
          { type: "infamy", delta: 3 },
        ],
        {
          high: {
            category: "executive",
            title: "{name} wins the day at PMQs",
            template:
              "{name} drew cheers across the {country} with a sharp Prime Minister's Questions performance that dominated the political coverage.",
          },
          low: {
            category: "executive",
            title: "{name} fluffs it at PMQs",
            template:
              "{name} misfired at Prime Minister's Questions, with a flat dispatch-box outing replayed gleefully by opponents.",
          },
        }
      ),
    },
    {
      id: "sober",
      label: "Sober, policy-heavy question",
      description: "Gravitas over theatrics.",
      primaryStat: "debate",
      outcomeTable: threeTierTable(
        "Respected for substance",
        "Solid and serious",
        "A bit dry",
        [
          { type: "politicalInfluence", delta: 3 },
          { type: "favorability", delta: 2 },
        ],
        [{ type: "politicalInfluence", delta: 1 }],
        []
      ),
    },
    {
      id: "yield",
      label: "Yield your slot to a colleague",
      description: "Bank some party goodwill.",
      outcomeTable: threeTierTable(
        "Team player credit",
        "Quietly generous",
        "Missed your moment",
        [{ type: "politicalInfluence", delta: 1 }],
        [],
        [{ type: "politicalInfluence", delta: -1 }]
      ),
    },
    {
      id: "silent",
      label: "Stay silent on the benches",
      description: "Sit it out.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Unremarkable",
        "Invisible",
        "Looks like a passenger",
        [],
        [{ type: "politicalInfluence", delta: -1 }],
        [{ type: "politicalInfluence", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.uk.threeLineWhip",
  defaultOptionId: "miss",
  options: [
    {
      id: "rebel",
      label: "Rebel and vote your conscience",
      description: "Defy the whips.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Constituency hero",
        "Principled stand",
        "Whips exact revenge",
        [
          { type: "favorability", delta: 8 },
          { type: "politicalInfluence", delta: -1 },
        ],
        [
          { type: "favorability", delta: 4 },
          { type: "politicalInfluence", delta: -2 },
        ],
        [
          { type: "favorability", delta: 2 },
          { type: "politicalInfluence", delta: -4 },
        ]
      ),
    },
    {
      id: "toeLine",
      label: "Toe the line",
      description: "Vote with the party.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Loyalty noted",
        "Reliable",
        "Constituents fume",
        [{ type: "politicalInfluence", delta: 2 }],
        [
          { type: "politicalInfluence", delta: 1 },
          { type: "favorability", delta: -2 },
        ],
        [{ type: "favorability", delta: -4 }]
      ),
    },
    {
      id: "abstain",
      label: "Abstain and duck the vote",
      description: "Sit on the fence.",
      outcomeTable: threeTierTable(
        "Slips by",
        "Looks gutless",
        "Worst of both worlds",
        [],
        [{ type: "favorability", delta: -1 }],
        [
          { type: "favorability", delta: -2 },
          { type: "politicalInfluence", delta: -1 },
        ]
      ),
    },
    {
      id: "miss",
      label: 'Miss the vote "by accident"',
      description: "Be conveniently absent.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Nobody clocks it",
        "Quietly noted",
        "Caught dodging",
        [],
        [{ type: "politicalInfluence", delta: -1 }],
        [
          { type: "politicalInfluence", delta: -1 },
          { type: "infamy", delta: 1 },
        ]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.uk.nhsWaitingList",
  defaultOptionId: "grumble",
  options: [
    {
      id: "campaign",
      label: "Campaign for the local trust",
      description: "Push for more theatre slots and staff.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Waiting-list champion",
        "Solid local coverage",
        "Looks opportunistic",
        [
          { type: "favorability", delta: 6 },
          { type: "politicalInfluence", delta: 2 },
        ],
        [{ type: "favorability", delta: 3 }],
        [{ type: "infamy", delta: 1 }]
      ),
    },
    {
      id: "goPrivate",
      label: "Go private yourself",
      description: "Skip the queue with a private clinic.",
      outcomeTable: threeTierTable(
        "Quiet and sorted",
        "Wallet takes a hit",
        "Hypocrisy storm",
        [{ type: "personalWealth", deltaAnchor: -15_000 }],
        [
          { type: "personalWealth", deltaAnchor: -25_000 },
          { type: "favorability", delta: -2 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -25_000 },
          { type: "favorability", delta: -6 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
    {
      id: "grumble",
      label: "Grumble and wait",
      description: "Join the queue like everyone else.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Barely noticed",
        "Frustrated but fine",
        "Health scare delay",
        [],
        [{ type: "favorability", delta: -1 }],
        [{ type: "favorability", delta: -2 }]
      ),
    },
    {
      id: "blameGov",
      label: "Blame the government loudly",
      description: "Make it a political story.",
      outcomeTable: threeTierTable(
        "Cuts through",
        "Partisan noise",
        "Tone-deaf rant",
        [{ type: "favorability", delta: 3 }],
        [{ type: "favorability", delta: 1 }],
        [{ type: "infamy", delta: 2 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.uk.councilTaxBill",
  defaultOptionId: "pay",
  options: [
    {
      id: "pay",
      label: "Pay in full",
      description: "Settle the band hike and move on.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Sorted",
        "Stings a bit",
        "Painful hit",
        [{ type: "personalWealth", deltaAnchor: -3_000 }],
        [{ type: "personalWealth", deltaAnchor: -6_000 }],
        [{ type: "personalWealth", deltaAnchor: -10_000 }]
      ),
    },
    {
      id: "challenge",
      label: "Challenge the banding",
      description: "Appeal to the valuation tribunal.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "Band reduced",
        "No change",
        "Costs stack up",
        [{ type: "personalWealth", deltaAnchor: 2_000 }],
        [],
        [{ type: "personalWealth", deltaAnchor: -4_000 }]
      ),
    },
    {
      id: "rally",
      label: "Join the freeze campaign",
      description: "Back a local anti-hike petition.",
      outcomeTable: threeTierTable(
        "Local hero",
        "Mixed reception",
        "NIMBY label",
        [{ type: "favorability", delta: 4 }],
        [{ type: "favorability", delta: 1 }],
        [{ type: "infamy", delta: 1 }]
      ),
    },
    {
      id: "ignore",
      label: "Ignore the reminders",
      description: "Hope it goes away.",
      outcomeTable: threeTierTable(
        "Slip through",
        "Late fees",
        "Bailiffs looming",
        [],
        [{ type: "personalWealth", deltaAnchor: -8_000 }],
        [
          { type: "personalWealth", deltaAnchor: -15_000 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.uk.railStrike",
  defaultOptionId: "endure",
  options: [
    {
      id: "supportStrike",
      label: "Support the strikers",
      description: "Stand with the unions publicly.",
      outcomeTable: threeTierTable(
        "Solidarity praised",
        "Polarising",
        "Commuter fury",
        [{ type: "favorability", delta: 4 }],
        [{ type: "favorability", delta: 1 }],
        [
          { type: "favorability", delta: -4 },
          { type: "infamy", delta: 1 },
        ]
      ),
    },
    {
      id: "condemn",
      label: "Condemn the disruption",
      description: "Side with frustrated passengers.",
      outcomeTable: threeTierTable(
        "Commuter champion",
        "Predictable line",
        "Union backlash",
        [{ type: "favorability", delta: 3 }],
        [],
        [{ type: "favorability", delta: -3 }]
      ),
    },
    {
      id: "workRemote",
      label: "Work around it",
      description: "Remote days and alternative routes.",
      outcomeTable: threeTierTable(
        "Barely affected",
        "Mild hassle",
        "Costly detours",
        [],
        [{ type: "personalWealth", deltaAnchor: -2_000 }],
        [{ type: "personalWealth", deltaAnchor: -5_000 }]
      ),
    },
    {
      id: "endure",
      label: "Grin and bear the chaos",
      description: "Queue for replacement buses.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Stoic",
        "Exhausted",
        "Missed meetings",
        [],
        [{ type: "favorability", delta: -1 }],
        [{ type: "favorability", delta: -2 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.uk.bbcInterview",
  defaultOptionId: "decline",
  options: [
    {
      id: "live",
      label: "Do it live on Today / Newsnight",
      description: "Take the hard questions.",
      primaryStat: "debate",
      outcomeTable: threeTierTable(
        "Commanding performance",
        "Survives the grilling",
        "Car-crash clip",
        [
          { type: "favorability", delta: 6 },
          { type: "politicalInfluence", delta: 3 },
        ],
        [{ type: "favorability", delta: 2 }],
        [
          { type: "favorability", delta: -8 },
          { type: "infamy", delta: 3 },
        ],
        {
          high: {
            category: "executive",
            title: "{name} dominates the BBC interview",
            template:
              "{name} turned in a sharp BBC interview that dominated the next day's political coverage across {country}.",
          },
          low: {
            category: "executive",
            title: "{name}'s BBC interview goes viral for all the wrong reasons",
            template:
              "A bruising BBC grilling left {name} on the defensive, with clips looping across {country} social feeds.",
          },
        }
      ),
    },
    {
      id: "preRecord",
      label: "Insist on a pre-record",
      description: "Control the cut.",
      outcomeTable: threeTierTable(
        "Clean package",
        "Looks cautious",
        "Accused of hiding",
        [{ type: "favorability", delta: 2 }],
        [],
        [{ type: "infamy", delta: 1 }]
      ),
    },
    {
      id: "surrogate",
      label: "Send a surrogate",
      description: "Let a deputy take it.",
      outcomeTable: threeTierTable(
        "Smart delegation",
        "Fine",
        "Looks weak",
        [],
        [],
        [{ type: "politicalInfluence", delta: -1 }]
      ),
    },
    {
      id: "decline",
      label: "Decline the booking",
      description: "Stay off the sofa.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Nobody notices",
        "Empty-chair digs",
        "Running scared narrative",
        [],
        [{ type: "favorability", delta: -1 }],
        [{ type: "favorability", delta: -3 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.uk.partyConference",
  defaultOptionId: "skip",
  options: [
    {
      id: "fringeSpeech",
      label: "Give a barnstorming fringe speech",
      description: "Make your own weather.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Conference darling",
        "Solid fringe turn",
        "Goes down badly",
        [
          { type: "politicalInfluence", delta: 4 },
          { type: "favorability", delta: 4 },
        ],
        [{ type: "politicalInfluence", delta: 2 }],
        [
          { type: "favorability", delta: -4 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
    {
      id: "loyal",
      label: "Clap the leader on cue",
      description: "Be a loyal foot-soldier.",
      outcomeTable: threeTierTable(
        "Whips notice",
        "Reliable",
        "Invisible",
        [{ type: "politicalInfluence", delta: 2 }],
        [{ type: "politicalInfluence", delta: 1 }],
        []
      ),
    },
    {
      id: "rebelFringe",
      label: "Host a rebel fringe",
      description: "Challenge the leadership line.",
      outcomeTable: threeTierTable(
        "Insurgent hero",
        "Mixed buzz",
        "Frozen out",
        [
          { type: "favorability", delta: 5 },
          { type: "politicalInfluence", delta: -2 },
        ],
        [{ type: "favorability", delta: 2 }],
        [
          { type: "politicalInfluence", delta: -4 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
    {
      id: "skip",
      label: "Skip conference",
      description: "Stay in the constituency.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Quiet week",
        "Missed networking",
        "Looked absent",
        [],
        [{ type: "politicalInfluence", delta: -1 }],
        [{ type: "politicalInfluence", delta: -2 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.uk.borderForce",
  defaultOptionId: "quiet",
  options: [
    {
      id: "harden",
      label: "Call for a harder line",
      description: "Push deterrence and returns.",
      outcomeTable: threeTierTable(
        "Cuts through with base",
        "Polarising",
        "Humanitarian backlash",
        [{ type: "favorability", delta: 4 }],
        [{ type: "favorability", delta: 1 }],
        [
          { type: "favorability", delta: -4 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
    {
      id: "humane",
      label: "Call for safer routes",
      description: "Stress legal pathways and rescue.",
      outcomeTable: threeTierTable(
        "Principled stance",
        "Muted reaction",
        "Soft-touch attacks",
        [{ type: "favorability", delta: 3 }],
        [],
        [{ type: "favorability", delta: -3 }]
      ),
    },
    {
      id: "businessVisas",
      label: "Focus on business visas",
      description: "Keep talent flowing for firms.",
      outcomeTable: threeTierTable(
        "Boardrooms nod",
        "Niche story",
        "Out of touch",
        [{ type: "corpSentiment", delta: 3 }],
        [{ type: "corpSentiment", delta: 1 }],
        [{ type: "favorability", delta: -2 }]
      ),
    },
    {
      id: "quiet",
      label: "Stay quiet",
      description: "Let the Home Office take the heat.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Avoids the row",
        "Slightly invisible",
        "Accused of ducking",
        [],
        [],
        [{ type: "politicalInfluence", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.uk.assetOfCommunityValue",
  defaultOptionId: "stayOut",
  options: [
    {
      id: "lead",
      label: "Lead the community bid",
      description: "Save the library or post office.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Local legend",
        "Asset saved",
        "Costly crusade",
        [
          { type: "favorability", delta: 8 },
          { type: "personalWealth", deltaAnchor: -40_000 },
        ],
        [
          { type: "favorability", delta: 4 },
          { type: "personalWealth", deltaAnchor: -40_000 },
        ],
        [
          { type: "favorability", delta: 2 },
          { type: "personalWealth", deltaAnchor: -60_000 },
        ]
      ),
    },
    {
      id: "donate",
      label: "Donate quietly",
      description: "Chip in without the megaphone.",
      outcomeTable: threeTierTable(
        "Quiet thanks",
        "Appreciated",
        "Barely noticed",
        [
          { type: "favorability", delta: 3 },
          { type: "personalWealth", deltaAnchor: -10_000 },
        ],
        [{ type: "personalWealth", deltaAnchor: -10_000 }],
        [{ type: "personalWealth", deltaAnchor: -10_000 }]
      ),
    },
    {
      id: "redevelop",
      label: "Back redevelopment",
      description: "Side with the commercial plan.",
      outcomeTable: threeTierTable(
        "Growth story lands",
        "Muted",
        "Village villain",
        [{ type: "personalWealth", deltaAnchor: 15_000 }],
        [],
        [
          { type: "favorability", delta: -5 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
    {
      id: "stayOut",
      label: "Stay out of it",
      description: "Not your fight.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Uninvolved",
        "Slightly cold",
        "Looked indifferent",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.uk.lordsReception",
  defaultOptionId: "skip",
  options: [
    {
      id: "workRoom",
      label: "Work the room",
      description: "Collect soft patronage and introductions.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Useful connections",
        "Pleasant evening",
        "Looked thirsty",
        [
          { type: "politicalInfluence", delta: 3 },
          { type: "favorability", delta: 2 },
        ],
        [{ type: "politicalInfluence", delta: 1 }],
        [{ type: "infamy", delta: 1 }]
      ),
    },
    {
      id: "policyChat",
      label: "Corner a crossbencher on policy",
      description: "Talk substance, not gossip.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "Respected",
        "Fine chat",
        "Bored them stiff",
        [{ type: "politicalInfluence", delta: 2 }],
        [],
        []
      ),
    },
    {
      id: "photoOp",
      label: "Chase the photo op",
      description: "Be seen with the right ermine.",
      outcomeTable: threeTierTable(
        "Social pages notice",
        "Harmless snap",
        "Looks vain",
        [{ type: "favorability", delta: 2 }],
        [],
        [{ type: "infamy", delta: 1 }]
      ),
    },
    {
      id: "skip",
      label: "Skip the reception",
      description: "Stay in the Commons tearoom.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Fine",
        "Missed a favour",
        "Snub noted",
        [],
        [],
        [{ type: "politicalInfluence", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});
