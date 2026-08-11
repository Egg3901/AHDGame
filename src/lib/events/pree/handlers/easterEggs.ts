/**
 * Easter egg player random events: rare, low-weight, a little strange.
 *
 * Seed definitions set a low `baseWeight` so these surface only occasionally.
 * Same registration contract as the everyday events: option ids and the
 * default must match the seed definition exactly. No em-dashes, no dramatic
 * language.
 */
import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { threeTierTable } from "./tiers";

const apply: EventHandler["applyEffects"] = async (ctx) => {
  await applyDeclarativeEffects(ctx, ctx.tier.effects);
};

registerEventHandler({
  kind: "pree.doppelganger",
  defaultOptionId: "ignore",
  options: [
    {
      id: "trackDown",
      label: "Track your lookalike down",
      description: "Find the person borrowing your face.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "You two hit it off",
        "Awkward but funny",
        "A waste of an afternoon",
        [{ type: "favorability", delta: 2 }],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "laughItOff",
      label: "Laugh it off in public",
      description: "Post a joke about your double.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "People enjoy the joke",
        "Mild amusement",
        "A smile from the press",
        [{ type: "favorability", delta: 3 }],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "lawyerUp",
      label: "Send a cease and desist",
      description: "Have a lawyer tell them to knock it off.",
      outcomeTable: threeTierTable(
        "They back down",
        "Petty but effective",
        "Comes off thin skinned",
        [],
        [{ type: "favorability", delta: -1 }],
        [{ type: "infamy", delta: 1 }]
      ),
    },
    {
      id: "ignore",
      label: "Ignore the whole thing",
      description: "Let the rumors run their course.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Story fades",
        "Mild confusion lingers",
        "People keep asking",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.greatAuntBequest",
  defaultOptionId: "ignore",
  options: [
    {
      id: "claimEstate",
      label: "Claim the bequest",
      description: "Sign the papers and take what's there.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "A tidy inheritance",
        "Mostly eaten by fees",
        "A weird antique and a box of photos",
        [{ type: "personalWealth", deltaAnchor: 40_000 }],
        [{ type: "personalWealth", deltaAnchor: 10_000 }],
        [{ type: "personalWealth", deltaAnchor: 2_000 }]
      ),
    },
    {
      id: "donateIt",
      label: "Give it to charity",
      description: "Sign the estate over to a cause.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Generous and noted",
        "Quiet good deed",
        "Polite thanks",
        [{ type: "favorability", delta: 4 }],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "refuse",
      label: "Disclaim the inheritance",
      description: "Decline to take it.",
      outcomeTable: threeTierTable(
        "No strings, no fuss",
        "Clean break",
        "It passes to a cousin",
        [],
        [],
        []
      ),
    },
    {
      id: "ignore",
      label: "Let it sit",
      description: "Do nothing and see what happens.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Probate sorts itself",
        "A small check arrives",
        "Court closes the file",
        [],
        [{ type: "personalWealth", deltaAnchor: 1_000 }],
        []
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.childhoodTimeCapsule",
  defaultOptionId: "ignore",
  options: [
    {
      id: "attend",
      label: "Go to the opening",
      description: "Show up for the dig up in person.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Old neighbors are touched",
        "Nice little reunion",
        "A short nostalgic moment",
        [
          { type: "favorability", delta: 3 },
          { type: "personalWealth", deltaAnchor: -1_000 },
        ],
        [
          { type: "favorability", delta: 2 },
          { type: "personalWealth", deltaAnchor: -1_000 },
        ],
        [
          { type: "favorability", delta: 1 },
          { type: "personalWealth", deltaAnchor: -1_000 },
        ]
      ),
    },
    {
      id: "sendLetter",
      label: "Send a note to include",
      description: "Mail a letter for the next capsule.",
      outcomeTable: threeTierTable(
        "Note becomes a highlight",
        "Read aloud and filed",
        "Tucked in with the rest",
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }],
        []
      ),
    },
    {
      id: "watchOnline",
      label: "Watch the stream",
      description: "Tune in online instead of going.",
      outcomeTable: threeTierTable(
        "A nice moment from home",
        "Watched the highlights",
        "Stream buffered out",
        [{ type: "favorability", delta: 1 }],
        [],
        []
      ),
    },
    {
      id: "ignore",
      label: "Skip it",
      description: "Let the town open it without you.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "No consequence",
        "Mild regret",
        "Old friends notice",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.meteorite",
  defaultOptionId: "keepIt",
  options: [
    {
      id: "sellIt",
      label: "Sell it to a collector",
      description: "Find a buyer for the space rock.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "A genuine collectors' price",
        "A fair offer",
        "Scrap value at best",
        [{ type: "personalWealth", deltaAnchor: 20_000 }],
        [{ type: "personalWealth", deltaAnchor: 8_000 }],
        [{ type: "personalWealth", deltaAnchor: 2_000 }]
      ),
    },
    {
      id: "donateToMuseum",
      label: "Donate it to a museum",
      description: "Give it to the local natural history museum.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Plaque with your name",
        "A nice exhibit piece",
        "Quiet thanks",
        [{ type: "favorability", delta: 5 }],
        [{ type: "favorability", delta: 3 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "keepIt",
      label: "Keep it on the mantel",
      description: "A conversation piece at home.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "A great story at parties",
        "An odd curiosity",
        "It just sits there",
        [{ type: "favorability", delta: 1 }],
        [],
        []
      ),
    },
    {
      id: "insuranceClaim",
      label: "File an insurance claim",
      description: "Claim for the roof and call it a day.",
      outcomeTable: threeTierTable(
        "Roof paid in full",
        "Most of the repair covered",
        "Deductible eats most of it",
        [{ type: "personalWealth", deltaAnchor: 5_000 }],
        [{ type: "personalWealth", deltaAnchor: 3_000 }],
        [{ type: "personalWealth", deltaAnchor: 1_000 }]
      ),
    },
  ],
  applyEffects: apply,
});
