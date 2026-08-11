/**
 * Era-scoped country player random events — USSR (1953–2000 run).
 * Six events: 5 "all", 1 "politician" (partyPlenum). Seeded with
 * requiresCountryIds: ["RU"] and minYear/maxYear in
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
  kind: "pree.ru.era.partyPlenum",
  defaultOptionId: "declinePolitely",
  options: [
    {
      id: "carefulSpeech",
      label: "Give a careful, orthodox speech",
      description: "Praise the line, name no names, sit down.",
      outcomeTable: threeTierTable(
        "Noted as a sound man",
        "Applauded in all the right places",
        "Forgettable, which is its own safety",
        [{ type: "politicalInfluence", delta: 2 }],
        [{ type: "politicalInfluence", delta: 1 }],
        []
      ),
    },
    {
      id: "boldSpeech",
      label: "Give a bold speech",
      description: "Say something that will be talked about.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "The speech of the plenum",
        "Admired quietly, filed carefully",
        "A transcriber's red pencil awaits",
        [
          { type: "politicalInfluence", delta: 4 },
          { type: "favorability", delta: 3 },
        ],
        [{ type: "politicalInfluence", delta: 1 }],
        [
          { type: "politicalInfluence", delta: -3 },
          { type: "infamy", delta: 3 },
        ]
      ),
    },
    {
      id: "declinePolitely",
      label: "Decline politely",
      description: "Regretfully plead other duties.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Absence unremarked",
        "A seat left empty",
        "Your reluctance is noted",
        [],
        [],
        [{ type: "politicalInfluence", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.ru.era.dachaAllocation",
  defaultOptionId: "decline",
  options: [
    {
      id: "acceptGratefully",
      label: "Accept gratefully",
      description: "Take the keys and thank the committee.",
      outcomeTable: threeTierTable(
        "A gem among the birches",
        "A modest dacha, gladly kept",
        "Envied by those without",
        [{ type: "politicalInfluence", delta: 2 }],
        [{ type: "politicalInfluence", delta: 1 }],
        [
          { type: "favorability", delta: -1 },
          { type: "infamy", delta: 1 },
        ]
      ),
    },
    {
      id: "requestBetter",
      label: "Request a better allocation",
      description: "Hint that your service merits more.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Upgraded to the good list",
        "Politely rebuffed, no harm",
        "Marked down as grasping",
        [{ type: "politicalInfluence", delta: 3 }],
        [],
        [
          { type: "politicalInfluence", delta: -2 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
    {
      id: "decline",
      label: "Decline the dacha",
      description: "Say you have no need of it.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Admired austerity",
        "A puzzling refusal",
        "Distrusted for your modesty",
        [{ type: "favorability", delta: 1 }],
        [],
        [{ type: "politicalInfluence", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.ru.era.sausageQueue",
  defaultOptionId: "skipIt",
  options: [
    {
      id: "queueForHours",
      label: "Join the queue for hours",
      description: "Take your place and hold it.",
      outcomeTable: threeTierTable(
        "Two kilos of doktorskaya",
        "A ring of sausage for your patience",
        "Sold out three people ahead of you",
        [{ type: "favorability", delta: 1 }],
        [],
        []
      ),
    },
    {
      id: "askNeighbor",
      label: "Ask a neighbor to grab you some",
      description: "Owe a small favor.",
      outcomeTable: threeTierTable(
        "The neighbor came through",
        "Half a kilo and a debt",
        "The neighbor ate well that week",
        [{ type: "favorability", delta: 1 }],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "skipIt",
      label: "Skip it",
      description: "There will be other rumors.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "There will be other rumors",
        "There will be other rumors",
        "There will be other rumors",
        [],
        [],
        []
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.ru.era.samizdatManuscript",
  defaultOptionId: "handItBack",
  options: [
    {
      id: "readAndReturn",
      label: "Read it and return it quietly",
      description: "Satisfy your conscience, keep your silence.",
      outcomeTable: threeTierTable(
        "Your eyes are opened, your mouth shut",
        "Returned without incident",
        "Someone saw the handoff",
        [{ type: "favorability", delta: 1 }],
        [],
        [
          { type: "infamy", delta: 2 },
          { type: "politicalInfluence", delta: -1 },
        ]
      ),
    },
    {
      id: "passItOn",
      label: "Pass it on to another reader",
      description: "The chain must not break with you.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Trusted in the quiet circles",
        "The chain holds",
        "The chain led back to you",
        [
          { type: "favorability", delta: 3 },
          { type: "infamy", delta: 1 },
        ],
        [{ type: "favorability", delta: 1 }],
        [
          { type: "infamy", delta: 6 },
          { type: "politicalInfluence", delta: -3 },
          { type: "favorability", delta: -3 },
        ]
      ),
    },
    {
      id: "reportIt",
      label: "Report it to the authorities",
      description: "Hand it over and name where it came from.",
      outcomeTable: threeTierTable(
        "Your vigilance is rewarded",
        "A note of thanks, a file of your own",
        "They wonder how you came to hold it",
        [
          { type: "politicalInfluence", delta: 3 },
          { type: "infamy", delta: 2 },
        ],
        [
          { type: "politicalInfluence", delta: 1 },
          { type: "infamy", delta: 3 },
        ],
        [
          { type: "infamy", delta: 5 },
          { type: "politicalInfluence", delta: -1 },
        ]
      ),
    },
    {
      id: "handItBack",
      label: "Hand it back unread",
      description: "You never saw it. It was never here.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Nothing happened at all",
        "A moment of fear, then nothing",
        "The giver will remember your caution",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.ru.era.cosmonautParade",
  defaultOptionId: "sendRegrets",
  options: [
    {
      id: "attendProudly",
      label: "Attend and be seen proudly",
      description: "Stand tall where the cameras can find you.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Your face beside the heroes",
        "Seen, and seen well",
        "Lost in the second row",
        [
          { type: "favorability", delta: 5 },
          { type: "politicalInfluence", delta: 2 },
        ],
        [{ type: "favorability", delta: 3 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "attendBriefly",
      label: "Attend briefly, keep to the edge",
      description: "Be present without being prominent.",
      outcomeTable: threeTierTable(
        "Present, correct, comfortable",
        "A pleasant morning out",
        "Overlooked entirely",
        [{ type: "favorability", delta: 1 }],
        [],
        []
      ),
    },
    {
      id: "sendRegrets",
      label: "Send your regrets",
      description: "Watch it on television like everyone else.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "The parade was splendid on television",
        "The parade was splendid on television",
        "Your empty place was remarked upon",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.ru.era.informerApproach",
  defaultOptionId: "giveHarmlessTrivia",
  options: [
    {
      id: "agreeToReport",
      label: "Agree to inform",
      description: "Sign nothing, say yes, start listening.",
      outcomeTable: threeTierTable(
        "A valued ear in the right places",
        "Useful, protected, compromised",
        "Everyone somehow knows what you are",
        [
          { type: "politicalInfluence", delta: 4 },
          { type: "infamy", delta: 3 },
        ],
        [
          { type: "politicalInfluence", delta: 2 },
          { type: "infamy", delta: 4 },
        ],
        [
          { type: "favorability", delta: -6 },
          { type: "infamy", delta: 8 },
        ]
      ),
    },
    {
      id: "refuseFirmly",
      label: "Refuse firmly",
      description: "Say no, and hope that is the end of it.",
      outcomeTable: threeTierTable(
        "Your refusal is respected",
        "A black mark, quietly filed",
        "Your file grows an addendum",
        [{ type: "favorability", delta: 2 }],
        [{ type: "politicalInfluence", delta: -1 }],
        [
          { type: "politicalInfluence", delta: -2 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
    {
      id: "reportTheApproach",
      label: "Report the approach itself",
      description: "Tell your superiors someone tested you.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Praised for exemplary vigilance",
        "A tick in the correct column",
        "Now two organs watch you",
        [{ type: "politicalInfluence", delta: 3 }],
        [{ type: "politicalInfluence", delta: 1 }],
        [
          { type: "politicalInfluence", delta: -2 },
          { type: "infamy", delta: 1 },
        ]
      ),
    },
    {
      id: "giveHarmlessTrivia",
      label: "Give harmless trivia only",
      description: "Feed him nothing of consequence, slowly.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "He stops asking",
        "The meetings are monthly and dull",
        "He knows exactly what you are doing",
        [],
        [{ type: "infamy", delta: 1 }],
        [
          { type: "politicalInfluence", delta: -2 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
  ],
  applyEffects: apply,
});
