/**
 * Era-scoped country player random events — East Germany / DDR (1953–2000
 * run). Six events, all "all" eligibility. Seeded with
 * requiresCountryIds: ["DD"] and minYear/maxYear in
 * eraCountryDefinitions.ts. Option ids, labels, descriptions, and the
 * default here MUST match the seed definition exactly (the approve route
 * rejects drift).
 */
import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { threeTierTable } from "./tiers";

const apply: EventHandler["applyEffects"] = async (ctx) => {
  await applyDeclarativeEffects(ctx, ctx.tier.effects);
};

registerEventHandler({
  kind: "pree.dd.era.trabantDelivered",
  defaultOptionId: "justDriveIt",
  options: [
    {
      id: "celebrateWithStreet",
      label: "Celebrate with the whole street",
      description: "Give everyone a ride around the block.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "The street's favorite motorist",
        "A queue of delighted passengers",
        "The two-stroke died mid-victory-lap",
        [{ type: "favorability", delta: 4 }],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "justDriveIt",
      label: "Just drive it, no fuss",
      description: "It is a car. Cars are for driving.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Years of waiting, quietly redeemed",
        "It rattles, it goes",
        "It rattles more than it goes",
        [],
        [],
        []
      ),
    },
    {
      id: "sellItQuietly",
      label: "Sell it quietly at a markup",
      description: "Someone will pay well to skip the queue.",
      outcomeTable: threeTierTable(
        "A handsome profit, no questions",
        "Sold on for a tidy sum",
        "Word of your dealing gets around",
        [{ type: "personalWealth", deltaAnchor: 15_000 }],
        [{ type: "personalWealth", deltaAnchor: 8_000 }],
        [
          { type: "personalWealth", deltaAnchor: 8_000 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.dd.era.westpaket",
  defaultOptionId: "keepItQuiet",
  options: [
    {
      id: "shareItRound",
      label: "Share it around the building",
      description: "Coffee for everyone, goodwill for you.",
      outcomeTable: threeTierTable(
        "The best-smelling landing in the building",
        "Generosity remembered",
        "Some mutter about western show",
        [{ type: "favorability", delta: 3 }],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "keepItQuiet",
      label: "Keep it quietly for the family",
      description: "A small taste of the West, behind your own door.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Real coffee on a Sunday morning",
        "Real coffee on a Sunday morning",
        "Real coffee on a Sunday morning",
        [],
        [],
        []
      ),
    },
    {
      id: "sellTheCoffee",
      label: "Sell the coffee and chocolate on",
      description: "West goods fetch good money.",
      outcomeTable: threeTierTable(
        "A neat little profit",
        "Sold to a grateful buyer",
        "Reported for petty speculation",
        [{ type: "personalWealth", deltaAnchor: 3_000 }],
        [{ type: "personalWealth", deltaAnchor: 1_500 }],
        [
          { type: "personalWealth", deltaAnchor: 1_500 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.dd.era.fdjRally",
  defaultOptionId: "attendQuietly",
  options: [
    {
      id: "attendEnthusiastically",
      label: "Attend enthusiastically",
      description: "Sing loudly, clap first, be noticed.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Noticed by the right functionaries",
        "A model attendee",
        "Overdid it; colleagues smirk",
        [
          { type: "politicalInfluence", delta: 2 },
          { type: "favorability", delta: 1 },
        ],
        [{ type: "politicalInfluence", delta: 1 }],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "attendQuietly",
      label: "Attend quietly",
      description: "Be present, be counted, be unremarkable.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Counted, content, forgotten",
        "Counted, content, forgotten",
        "Counted, content, forgotten",
        [],
        [],
        []
      ),
    },
    {
      id: "makeExcuses",
      label: "Make excuses and stay away",
      description: "A sudden headache, a family matter.",
      outcomeTable: threeTierTable(
        "Your absence goes unnoticed",
        "A raised eyebrow at the next meeting",
        "Your name on the absentee list",
        [],
        [{ type: "politicalInfluence", delta: -1 }],
        [
          { type: "politicalInfluence", delta: -2 },
          { type: "favorability", delta: -1 },
        ]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.dd.era.borderPermit",
  defaultOptionId: "decideAgainst",
  options: [
    {
      id: "applyProperly",
      label: "Apply through proper channels",
      description: "File the paperwork and wait.",
      outcomeTable: threeTierTable(
        "Granted, a genuine miracle",
        "Denied, without explanation",
        "Denied, and your file grew",
        [{ type: "favorability", delta: 3 }],
        [],
        [
          { type: "infamy", delta: 2 },
          { type: "politicalInfluence", delta: -1 },
        ]
      ),
    },
    {
      id: "applyWithConnections",
      label: "Apply using your connections",
      description: "A word in the right ear may help, or be remembered.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "The right ear worked",
        "Considered, then shelved",
        "Your string-pulling is on file now",
        [
          { type: "favorability", delta: 3 },
          { type: "personalWealth", deltaAnchor: -2_000 },
        ],
        [
          { type: "politicalInfluence", delta: -1 },
          { type: "personalWealth", deltaAnchor: -1_000 },
        ],
        [
          { type: "infamy", delta: 3 },
          { type: "politicalInfluence", delta: -2 },
        ]
      ),
    },
    {
      id: "decideAgainst",
      label: "Decide against applying",
      description: "Some doors are safer left unknocked.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "A quiet, sensible decision",
        "A quiet, sensible decision",
        "A quiet, sensible decision",
        [],
        [],
        []
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.dd.era.stasiQuestion",
  defaultOptionId: "deflect",
  options: [
    {
      id: "cooperate",
      label: "Cooperate fully",
      description: "Tell him what he wants to know.",
      outcomeTable: threeTierTable(
        "A friend of the organs",
        "Helpful, and quietly disliked",
        "The colleague is taken in the night",
        [
          { type: "politicalInfluence", delta: 3 },
          { type: "infamy", delta: 2 },
        ],
        [
          { type: "politicalInfluence", delta: 1 },
          { type: "infamy", delta: 3 },
        ],
        [
          { type: "favorability", delta: -4 },
          { type: "infamy", delta: 6 },
        ]
      ),
    },
    {
      id: "deflect",
      label: "Deflect politely",
      description: "Know nothing, remember less.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "He writes down nothing, twice",
        "An unproductive interview",
        "Your vagueness gets its own page",
        [],
        [],
        [{ type: "infamy", delta: 1 }]
      ),
    },
    {
      id: "warnColleague",
      label: "Warn the colleague",
      description: "Let them know a file is being opened.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "A loyalty that will not be forgotten",
        "The colleague lies low and thanks you",
        "The warning itself was reported",
        [{ type: "favorability", delta: 4 }],
        [{ type: "favorability", delta: 2 }],
        [
          { type: "infamy", delta: 5 },
          { type: "politicalInfluence", delta: -2 },
          { type: "favorability", delta: -2 },
        ]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.dd.era.fkkBeach",
  defaultOptionId: "declinePolitely",
  options: [
    {
      id: "goAuNaturel",
      label: "Go, and go au naturel",
      description: "When on the FKK beach, do as the FKK beach does.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "A convert to the cause",
        "An oddly liberating afternoon",
        "Sunburn in unfortunate places",
        [{ type: "favorability", delta: 3 }],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "keepKitOn",
      label: "Go, but keep your kit on",
      description: "Sit on the sand fully clothed and own it.",
      outcomeTable: threeTierTable(
        "Eccentric but beloved",
        "Tolerated, if gently mocked",
        "Mocked without the 'gently'",
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "declinePolitely",
      label: "Decline politely",
      description: "Perhaps another weekend.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Perhaps another weekend",
        "Perhaps another weekend",
        "Perhaps another weekend",
        [],
        [],
        []
      ),
    },
  ],
  applyEffects: apply,
});
