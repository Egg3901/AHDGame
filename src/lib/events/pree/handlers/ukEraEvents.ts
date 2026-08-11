/**
 * Era-scoped country player random events — United Kingdom (1953–2000 run).
 * Six events, all "all" eligibility. Seeded with requiresCountryIds: ["UK"]
 * and minYear/maxYear in eraCountryDefinitions.ts. Option ids, labels,
 * descriptions, and the default here MUST match the seed definition exactly
 * (the approve route rejects drift).
 */
import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { threeTierTable } from "./tiers";

const apply: EventHandler["applyEffects"] = async (ctx) => {
  await applyDeclarativeEffects(ctx, ctx.tier.effects);
};

registerEventHandler({
  kind: "pree.uk.era.coronationStreetParty",
  defaultOptionId: "watchOnTelly",
  options: [
    {
      id: "organizeIt",
      label: "Organize the street party",
      description: "Clipboards, bunting, and a mountain of sandwiches.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "The best party the street ever had",
        "A grand day out for all",
        "Rain on the sandwiches",
        [
          { type: "favorability", delta: 6 },
          { type: "personalWealth", deltaAnchor: -2_000 },
        ],
        [
          { type: "favorability", delta: 3 },
          { type: "personalWealth", deltaAnchor: -2_000 },
        ],
        [
          { type: "favorability", delta: 1 },
          { type: "personalWealth", deltaAnchor: -2_000 },
        ]
      ),
    },
    {
      id: "chipIn",
      label: "Chip in and lend a hand",
      description: "Bring a table and a trifle.",
      outcomeTable: threeTierTable(
        "The trifle was legendary",
        "A good neighbor",
        "The trifle collapsed",
        [
          { type: "favorability", delta: 2 },
          { type: "personalWealth", deltaAnchor: -500 },
        ],
        [
          { type: "favorability", delta: 1 },
          { type: "personalWealth", deltaAnchor: -500 },
        ],
        [{ type: "personalWealth", deltaAnchor: -500 }]
      ),
    },
    {
      id: "watchOnTelly",
      label: "Watch it quietly on the telly",
      description: "Enjoy the day from your own chair.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "A lovely day in",
        "A lovely day in",
        "A lovely day in",
        [],
        [],
        []
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.uk.era.rationingEnds",
  defaultOptionId: "shrugItOff",
  options: [
    {
      id: "celebrateProperly",
      label: "Celebrate properly",
      description: "A joint of meat and sweets for the children.",
      outcomeTable: threeTierTable(
        "A feast to remember",
        "A proper Sunday dinner",
        "Overdid the sugar",
        [
          { type: "favorability", delta: 2 },
          { type: "personalWealth", deltaAnchor: -1_000 },
        ],
        [
          { type: "favorability", delta: 1 },
          { type: "personalWealth", deltaAnchor: -1_000 },
        ],
        [{ type: "personalWealth", deltaAnchor: -1_000 }]
      ),
    },
    {
      id: "stockUp",
      label: "Stock up while you can",
      description: "Fill the pantry before it all runs out.",
      outcomeTable: threeTierTable(
        "A well-filled pantry",
        "Sensible provisioning",
        "Half of it went off",
        [{ type: "personalWealth", deltaAnchor: -800 }],
        [{ type: "personalWealth", deltaAnchor: -1_200 }],
        [{ type: "personalWealth", deltaAnchor: -2_000 }]
      ),
    },
    {
      id: "shrugItOff",
      label: "Shrug it off",
      description: "You've managed this long without.",
      isDefault: true,
      outcomeTable: threeTierTable("Carried on", "Carried on", "Carried on", [], [], []),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.uk.era.beatlesTickets",
  defaultOptionId: "listenOnWireless",
  options: [
    {
      id: "queueOvernight",
      label: "Queue overnight for tickets",
      description: "Sleep on the pavement like the rest of them.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Front row, and hoarse for a week",
        "A night of screaming joy",
        "Sold out before you reached the window",
        [
          { type: "favorability", delta: 4 },
          { type: "personalWealth", deltaAnchor: -500 },
        ],
        [
          { type: "favorability", delta: 2 },
          { type: "personalWealth", deltaAnchor: -500 },
        ],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "payATout",
      label: "Pay a tout over the odds",
      description: "Money talks, even at a Beatlemania markup.",
      outcomeTable: threeTierTable(
        "Worth every penny",
        "Good seats, bad price",
        "The tickets were forgeries",
        [
          { type: "favorability", delta: 3 },
          { type: "personalWealth", deltaAnchor: -3_000 },
        ],
        [
          { type: "favorability", delta: 1 },
          { type: "personalWealth", deltaAnchor: -3_000 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -3_000 },
          { type: "infamy", delta: 1 },
        ]
      ),
    },
    {
      id: "listenOnWireless",
      label: "Listen on the wireless instead",
      description: "Perfectly good from the comfort of home.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Sounded marvellous",
        "Sounded marvellous",
        "Sounded marvellous",
        [],
        [],
        []
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.uk.era.minersPicket",
  defaultOptionId: "stayHome",
  options: [
    {
      id: "joinPicket",
      label: "Join the picket line",
      description: "Stand with the men at the gate.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "A hero of the line",
        "Solidarity, remembered",
        "Arrested at the gate",
        [
          { type: "favorability", delta: 5 },
          { type: "politicalInfluence", delta: 1 },
        ],
        [{ type: "favorability", delta: 3 }],
        [
          { type: "favorability", delta: -2 },
          { type: "infamy", delta: 3 },
        ]
      ),
    },
    {
      id: "crossQuietly",
      label: "Cross the line quietly",
      description: "Keep your head down and go to work.",
      outcomeTable: threeTierTable(
        "In and out unremarked",
        "A few hard stares",
        "Named as a scab",
        [{ type: "favorability", delta: -1 }],
        [
          { type: "favorability", delta: -2 },
          { type: "infamy", delta: 1 },
        ],
        [
          { type: "favorability", delta: -5 },
          { type: "infamy", delta: 4 },
        ]
      ),
    },
    {
      id: "supportFromAfar",
      label: "Support the strike fund from afar",
      description: "Send money, keep your distance.",
      outcomeTable: threeTierTable(
        "Quietly thanked by the union",
        "A modest kindness",
        "Noticed by the wrong people",
        [
          { type: "favorability", delta: 2 },
          { type: "personalWealth", deltaAnchor: -1_000 },
        ],
        [
          { type: "favorability", delta: 1 },
          { type: "personalWealth", deltaAnchor: -1_000 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -1_000 },
          { type: "infamy", delta: 1 },
        ]
      ),
    },
    {
      id: "stayHome",
      label: "Stay home until it blows over",
      description: "Cross no lines, take no sides.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Unscathed by either side",
        "A quiet few weeks",
        "Resented by both sides",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.uk.era.winterOfDiscontent",
  defaultOptionId: "grumbleQuietly",
  options: [
    {
      id: "muckIn",
      label: "Muck in and help the neighbors",
      description: "Clear the street, check on the old folks.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "The street's guardian angel",
        "Much appreciated",
        "A cold and thankless slog",
        [{ type: "favorability", delta: 5 }],
        [{ type: "favorability", delta: 3 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "grumbleQuietly",
      label: "Grumble quietly and carry on",
      description: "Light a candle and wait for spring.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Kept calm, carried on",
        "A miserable winter, endured",
        "Frostbite and fury",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "makeHay",
      label: "Make political hay of the chaos",
      description: "Point loudly at who's to blame.",
      primaryStat: "debate",
      outcomeTable: threeTierTable(
        "Your diagnosis catches fire",
        "A few heads nod along",
        "Seen as exploiting misery",
        [
          { type: "politicalInfluence", delta: 3 },
          { type: "favorability", delta: 2 },
        ],
        [{ type: "politicalInfluence", delta: 1 }],
        [
          { type: "favorability", delta: -3 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.uk.era.pollTaxProtest",
  defaultOptionId: "payAndGrumble",
  options: [
    {
      id: "payAndGrumble",
      label: "Pay up and grumble",
      description: "Write the cheque, complain at the pub.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Paid, like it or not",
        "Paid, loudly resented",
        "Paid, and it stung",
        [{ type: "personalWealth", deltaAnchor: -2_000 }],
        [{ type: "personalWealth", deltaAnchor: -2_000 }],
        [{ type: "personalWealth", deltaAnchor: -3_000 }]
      ),
    },
    {
      id: "joinMarch",
      label: "Join the protest march",
      description: "Take to the streets against the charge.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "On the right side of a historic march",
        "One face in a furious crowd",
        "Caught up in the riot",
        [
          { type: "favorability", delta: 4 },
          { type: "politicalInfluence", delta: 1 },
        ],
        [{ type: "favorability", delta: 2 }],
        [
          { type: "favorability", delta: -2 },
          { type: "infamy", delta: 3 },
        ]
      ),
    },
    {
      id: "refuseToPay",
      label: "Refuse to pay",
      description: "Can't pay, won't pay.",
      outcomeTable: threeTierTable(
        "A folk hero of the non-payers",
        "Bailiff letters pile up",
        "Summonsed and surcharged",
        [
          { type: "favorability", delta: 3 },
          { type: "infamy", delta: 1 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -1_000 },
          { type: "infamy", delta: 2 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -5_000 },
          { type: "infamy", delta: 4 },
        ]
      ),
    },
  ],
  applyEffects: apply,
});
