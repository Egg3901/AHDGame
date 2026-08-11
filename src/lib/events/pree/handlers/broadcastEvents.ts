/**
 * Broadcast event handlers — shared historic moments offered to every
 * eligible character at once (see ../broadcast.ts). Light, mostly
 * favorability-flavored outcomes: these are communal experiences, not
 * gambles. Option ids, labels, descriptions, and the default here MUST match
 * broadcastDefinitions.ts exactly (the approve route rejects drift).
 */
import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { threeTierTable } from "./tiers";

const apply: EventHandler["applyEffects"] = async (ctx) => {
  await applyDeclarativeEffects(ctx, ctx.tier.effects);
};

registerEventHandler({
  kind: "pree.broadcast.moonLanding",
  defaultOptionId: "watchQuietly",
  options: [
    {
      id: "hostViewing",
      label: "Host a viewing party",
      description: "Cram the neighbors around your set with drinks and snacks.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "The street's favorite host",
        "A night nobody forgets",
        "The set chose the worst moment to die",
        [{ type: "favorability", delta: 3 }],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "watchQuietly",
      label: "Watch quietly with family",
      description: "Take the moment in behind your own door.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "A memory for the grandchildren",
        "A memory for the grandchildren",
        "A memory for the grandchildren",
        [],
        [],
        []
      ),
    },
    {
      id: "speechless",
      label: "Call everyone you know",
      description: "You have to hear another human voice about this.",
      outcomeTable: threeTierTable(
        "Voices shaking on every line",
        "A long night of long-distance calls",
        "Lines jammed half the night",
        [{ type: "favorability", delta: 1 }],
        [],
        []
      ),
    },
    {
      id: "skeptical",
      label: "Grumble about the cost",
      description: "Think what they could have spent it on down here.",
      outcomeTable: threeTierTable(
        "A few quietly agree with you",
        "Mostly indulgent shrugs",
        "Read the room, it is the MOON",
        [{ type: "politicalInfluence", delta: 1 }],
        [],
        [{ type: "favorability", delta: -2 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.broadcast.kennedyShot",
  defaultOptionId: "grievePrivately",
  options: [
    {
      id: "publicMourning",
      label: "Join the public mourning",
      description: "Stand with the crowds outside the church.",
      outcomeTable: threeTierTable(
        "Grief shared is grief halved",
        "A silent crowd, together",
        "The crush and the cold get to you",
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }],
        []
      ),
    },
    {
      id: "grievePrivately",
      label: "Grieve privately",
      description: "Close the curtains and sit with it.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "A long, quiet weekend",
        "A long, quiet weekend",
        "A long, quiet weekend",
        [],
        [],
        []
      ),
    },
    {
      id: "comfortOthers",
      label: "Comfort your neighbors",
      description: "Somebody has to hold the street together.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "The rock of the neighborhood",
        "Casseroles and kindness",
        "You run out of words by Sunday",
        [{ type: "favorability", delta: 3 }],
        [{ type: "favorability", delta: 1 }],
        []
      ),
    },
    {
      id: "mutterTheories",
      label: "Mutter about what really happened",
      description: "Something about this does not add up.",
      outcomeTable: threeTierTable(
        "A few lean in to listen",
        "Mostly nervous looks",
        "Too soon. Far too soon",
        [{ type: "infamy", delta: 1 }],
        [{ type: "infamy", delta: 2 }],
        [
          { type: "infamy", delta: 4 },
          { type: "favorability", delta: -3 },
        ]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.broadcast.berlinWallFalls",
  defaultOptionId: "watchDisbelief",
  options: [
    {
      id: "celebrate",
      label: "Celebrate like everyone else",
      description: "Open something good. History is happening.",
      outcomeTable: threeTierTable(
        "A night you will tell forever",
        "Champagne on a weeknight",
        "The hangover of the century",
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }],
        []
      ),
    },
    {
      id: "watchDisbelief",
      label: "Watch in disbelief",
      description: "Keep waiting for someone to announce it was a mistake.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "It really happened",
        "It really happened",
        "It really happened",
        [],
        [],
        []
      ),
    },
    {
      id: "worryNext",
      label: "Worry about what comes next",
      description: "Empires do not usually end this quietly.",
      outcomeTable: threeTierTable(
        "Your caution sounds prophetic",
        "Time will tell",
        "Nobody wants to hear it tonight",
        [{ type: "politicalInfluence", delta: 1 }],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "callFriends",
      label: "Call everyone you know there",
      description: "Lines will be jammed for days. Try anyway.",
      outcomeTable: threeTierTable(
        "You get through. Tears both ends",
        "Busy signals, then a voice",
        "Busy signals all night",
        [{ type: "favorability", delta: 1 }],
        [],
        []
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.broadcast.chernobylCloud",
  defaultOptionId: "foreignRadio",
  options: [
    {
      id: "officialLine",
      label: "Trust the official announcements",
      description: "Panic helps no one. The state is handling it.",
      outcomeTable: threeTierTable(
        "Reassured, mostly",
        "You repeat the line to others",
        "The reassurance rings hollow",
        [{ type: "favorability", delta: 1 }],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "foreignRadio",
      label: "Tune the foreign broadcasts quietly",
      description: "Find out what the Swedes are measuring, low volume.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Informed, if uneasy",
        "Fragments through the static",
        "Someone noticed the antenna",
        [{ type: "politicalInfluence", delta: 1 }],
        [],
        [{ type: "infamy", delta: 1 }]
      ),
    },
    {
      id: "stockpileLeave",
      label: "Stockpile iodine and visit relatives far away",
      description: "A long-planned trip. Nothing to do with anything.",
      outcomeTable: threeTierTable(
        "A prudent, well-timed visit",
        "Better safe",
        "Your absence is remarked upon",
        [],
        [],
        [{ type: "infamy", delta: 2 }]
      ),
    },
    {
      id: "askQuestions",
      label: "Ask questions at work",
      description: "Someone must know something. Ask loudly.",
      outcomeTable: threeTierTable(
        "Others admit they wondered too",
        "Polite silence answers you",
        "Your questions are written down",
        [{ type: "favorability", delta: 1 }],
        [{ type: "infamy", delta: 1 }],
        [{ type: "infamy", delta: 4 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.broadcast.millenniumNight",
  defaultOptionId: "quietReflection",
  options: [
    {
      id: "partyHard",
      label: "Party like it's 1999",
      description: "Because it is. Find the biggest fireworks in town.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "The night of the century",
        "Fireworks, strangers, champagne",
        "You lose your voice and your coat",
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }],
        []
      ),
    },
    {
      id: "y2kBunker",
      label: "Stock candles and cash, just in case",
      description: "If the machines fail, you will be smug and well-lit.",
      outcomeTable: threeTierTable(
        "Nothing fails, but the candles are nice",
        "Prepared for nothing, content anyway",
        "Everyone learns about your bunker",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "quietReflection",
      label: "A quiet night of reflection",
      description: "Watch the century turn over from your own window.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "The century turns, quietly",
        "The century turns, quietly",
        "The century turns, quietly",
        [],
        [],
        []
      ),
    },
    {
      id: "workGlitch",
      label: "Volunteer for Y2K duty",
      description: "Someone has to babysit the servers at midnight.",
      outcomeTable: threeTierTable(
        "Midnight passes without a blip. Hero anyway",
        "A quiet control room and good overtime",
        "One printer dies. You are blamed forever",
        [
          { type: "personalWealth", deltaAnchor: 2_000 },
          { type: "favorability", delta: 1 },
        ],
        [{ type: "personalWealth", deltaAnchor: 1_000 }],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});
