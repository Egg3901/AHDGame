/**
 * Era-scoped country player random events — United States (1953–2000 run).
 * Six events, all "all" eligibility. Seeded with requiresCountryIds: ["US"]
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
  kind: "pree.us.era.suburbiaMortgage",
  defaultOptionId: "keepRenting",
  options: [
    {
      id: "buyNew",
      label: "Take the mortgage and buy",
      description: "Sign for the new house on the new street.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "The house gains value fast",
        "A solid family investment",
        "Stretched thin by the payments",
        [
          { type: "personalWealth", deltaAnchor: 40_000 },
          { type: "favorability", delta: 2 },
        ],
        [{ type: "personalWealth", deltaAnchor: 15_000 }],
        [
          { type: "personalWealth", deltaAnchor: -25_000 },
          { type: "favorability", delta: -1 },
        ]
      ),
    },
    {
      id: "buySmaller",
      label: "Buy a smaller place further out",
      description: "Get on the ladder without stretching.",
      outcomeTable: threeTierTable(
        "A canny modest buy",
        "Settled in comfortably",
        "Long commute, small gain",
        [{ type: "personalWealth", deltaAnchor: 15_000 }],
        [{ type: "personalWealth", deltaAnchor: 5_000 }],
        [{ type: "personalWealth", deltaAnchor: -5_000 }]
      ),
    },
    {
      id: "keepRenting",
      label: "Keep renting for now",
      description: "Stay put and watch the market.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "No harm done",
        "Life goes on",
        "Prices climbed past you",
        [],
        [],
        [{ type: "personalWealth", deltaAnchor: -5_000 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.us.era.loyaltyOath",
  defaultOptionId: "signQuietly",
  options: [
    {
      id: "signQuietly",
      label: "Sign it quietly",
      description: "Sign, file it, and get back to work.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Signed and forgotten",
        "A shrug at the water cooler",
        "Resented by a few",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "signPublicly",
      label: "Sign and affirm it publicly",
      description: "Make a show of your loyalty.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Praised as a patriot",
        "Noted approvingly upstairs",
        "Seen as a showboat",
        [
          { type: "favorability", delta: 3 },
          { type: "politicalInfluence", delta: 1 },
        ],
        [{ type: "favorability", delta: 1 }],
        [
          { type: "favorability", delta: -1 },
          { type: "infamy", delta: 1 },
        ]
      ),
    },
    {
      id: "refuse",
      label: "Refuse on principle",
      description: "Decline to sign and take the consequences.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Quietly admired for your spine",
        "Respected, if sidelined",
        "Blacklisted and whispered about",
        [{ type: "favorability", delta: 4 }],
        [
          { type: "favorability", delta: 2 },
          { type: "infamy", delta: 1 },
        ],
        [
          { type: "favorability", delta: -3 },
          { type: "infamy", delta: 4 },
          { type: "politicalInfluence", delta: -2 },
        ]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.us.era.tailfinCaddy",
  defaultOptionId: "keepOldCar",
  options: [
    {
      id: "splurge",
      label: "Splurge on the Cadillac",
      description: "Buy the fins, buy the chrome, buy the stares.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "The toast of the block",
        "Turned a few heads",
        "Read as nouveau-riche flash",
        [
          { type: "personalWealth", deltaAnchor: -40_000 },
          { type: "favorability", delta: 4 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -40_000 },
          { type: "favorability", delta: 2 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -40_000 },
          { type: "favorability", delta: -2 },
          { type: "infamy", delta: 1 },
        ]
      ),
    },
    {
      id: "buyPractical",
      label: "Buy something practical",
      description: "A sensible sedan at a sensible price.",
      outcomeTable: threeTierTable(
        "Sensible and respected",
        "A fine sensible car",
        "Utterly unremarkable",
        [
          { type: "personalWealth", deltaAnchor: -15_000 },
          { type: "favorability", delta: 1 },
        ],
        [{ type: "personalWealth", deltaAnchor: -15_000 }],
        [{ type: "personalWealth", deltaAnchor: -15_000 }]
      ),
    },
    {
      id: "keepOldCar",
      label: "Keep the old car",
      description: "It still runs fine.",
      isDefault: true,
      outcomeTable: threeTierTable("Frugality pays", "No change", "No change", [], [], []),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.us.era.sitInCounter",
  defaultOptionId: "closeEarly",
  options: [
    {
      id: "serveThem",
      label: "Serve them like anyone else",
      description: "Take their order and their money.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Remembered for simple decency",
        "Respected by many, boycotted by a few",
        "Targeted by the angry crowd",
        [{ type: "favorability", delta: 5 }],
        [
          { type: "favorability", delta: 3 },
          { type: "infamy", delta: 1 },
        ],
        [
          { type: "favorability", delta: -2 },
          { type: "infamy", delta: 3 },
        ]
      ),
    },
    {
      id: "joinSitIn",
      label: "Join the sit-in",
      description: "Take a seat beside them.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "A photograph in the papers",
        "Arrested but unbowed",
        "Beaten and charged",
        [
          { type: "favorability", delta: 6 },
          { type: "politicalInfluence", delta: 2 },
        ],
        [
          { type: "favorability", delta: 3 },
          { type: "infamy", delta: 2 },
        ],
        [
          { type: "favorability", delta: -2 },
          { type: "infamy", delta: 4 },
        ]
      ),
    },
    {
      id: "refuseService",
      label: "Refuse service and call for order",
      description: "Stand on the old rules.",
      outcomeTable: threeTierTable(
        "Cheered by the regulars",
        "A hard line, quietly kept",
        "On the wrong side of history",
        [
          { type: "favorability", delta: 1 },
          { type: "infamy", delta: 1 },
        ],
        [{ type: "infamy", delta: 2 }],
        [
          { type: "favorability", delta: -5 },
          { type: "infamy", delta: 5 },
        ]
      ),
    },
    {
      id: "closeEarly",
      label: "Close early and stay out of it",
      description: "Flip the sign and wait for it to pass.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "No one remembers who closed",
        "A day of lost takings",
        "Noticed for your absence",
        [],
        [{ type: "personalWealth", deltaAnchor: -2_000 }],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.us.era.moonWatchParty",
  defaultOptionId: "watchAlone",
  options: [
    {
      id: "hostTheBlock",
      label: "Host a watch party for the whole block",
      description: "Roll the set into the yard and feed everyone.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "The night the whole street held its breath",
        "Warmly remembered",
        "The set conked out at the worst moment",
        [
          { type: "favorability", delta: 5 },
          { type: "personalWealth", deltaAnchor: -3_000 },
        ],
        [
          { type: "favorability", delta: 3 },
          { type: "personalWealth", deltaAnchor: -3_000 },
        ],
        [
          { type: "favorability", delta: -1 },
          { type: "personalWealth", deltaAnchor: -3_000 },
        ]
      ),
    },
    {
      id: "hostFamily",
      label: "Host a small family gathering",
      description: "Just your own, around the television.",
      outcomeTable: threeTierTable(
        "A family memory for life",
        "A quiet, good night",
        "Static and squabbles",
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }],
        []
      ),
    },
    {
      id: "watchAlone",
      label: "Watch quietly at home",
      description: "Take it in by yourself.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "One small step, witnessed in peace",
        "A night to remember",
        "A night to remember",
        [],
        [],
        []
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.us.era.draftLetter",
  defaultOptionId: "seekDeferment",
  options: [
    {
      id: "reportForService",
      label: "Report for service",
      description: "Answer the call and go.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Served with honor, welcomed home",
        "Did your duty",
        "Came back changed",
        [
          { type: "favorability", delta: 5 },
          { type: "politicalInfluence", delta: 1 },
        ],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: -2 }]
      ),
    },
    {
      id: "seekDeferment",
      label: "Seek a deferment",
      description: "Use every lawful channel to delay.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Deferment granted, no questions",
        "Deferment granted, eyebrows raised",
        "Noticed on the wrong lists",
        [],
        [{ type: "favorability", delta: -1 }],
        [
          { type: "favorability", delta: -2 },
          { type: "infamy", delta: 1 },
        ]
      ),
    },
    {
      id: "speakAgainst",
      label: "Speak out against the war",
      description: "Make your opposition public.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "A voice the movement needed",
        "Respected by some, damned by others",
        "Branded un-American",
        [
          { type: "favorability", delta: 4 },
          { type: "politicalInfluence", delta: 2 },
        ],
        [
          { type: "favorability", delta: 1 },
          { type: "infamy", delta: 2 },
        ],
        [
          { type: "favorability", delta: -4 },
          { type: "infamy", delta: 4 },
        ]
      ),
    },
    {
      id: "burnTheLetter",
      label: "Burn the letter",
      description: "Destroy it and dare them to come.",
      outcomeTable: threeTierTable(
        "An icon of the resistance",
        "Fined and famous in certain circles",
        "Federal charges",
        [
          { type: "favorability", delta: 3 },
          { type: "infamy", delta: 3 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -10_000 },
          { type: "infamy", delta: 4 },
        ],
        [
          { type: "favorability", delta: -6 },
          { type: "infamy", delta: 8 },
        ]
      ),
    },
  ],
  applyEffects: apply,
});
