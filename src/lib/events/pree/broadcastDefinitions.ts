import type { EventDefinition } from "@/lib/db/types/events";

/**
 * Broadcast PREE seed definitions — shared historic moments offered to EVERY
 * eligible character at once (see broadcast.ts). `broadcast: "global"` events
 * reach every country; `broadcast: "country"` events respect
 * `requiresCountryIds`. Each fires at most once per world, on the first turn
 * its minYear/maxYear window contains the in-game year.
 *
 * `baseWeight` is unused (broadcasts never enter the weighted pool) but must
 * stay positive for the catalog test. Option ids, labels, descriptions, and
 * `defaultOptionId` MUST stay in lockstep with `handlers/broadcastEvents.ts`.
 */
type BroadcastDef = Omit<EventDefinition, "_id" | "createdAt" | "updatedAt">;

const draft = <T extends Partial<BroadcastDef>>(d: T) =>
  ({
    status: "draft",
    version: 1,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    eligibility: ["all"],
    baseWeight: 1, // unused — broadcasts are not weighted-picked
    ...d,
  }) as BroadcastDef;

export const BROADCAST_SEED_DEFINITIONS: BroadcastDef[] = [
  draft({
    kind: "pree.broadcast.moonLanding",
    image:
      "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=1200&q=70",
    title: "One Small Step",
    headline: "Human beings are walking on the Moon, live on television.",
    body: "The whole street is awake at an ungodly hour. Through every window the same ghostly grey picture flickers. A man in a white suit bounces down a ladder, and for one night the entire world is watching the same thing.",
    broadcast: "global",
    minYear: 1969,
    maxYear: 1969,
    defaultOptionId: "watchQuietly",
    options: [
      {
        id: "hostViewing",
        label: "Host a viewing party",
        description: "Cram the neighbors around your set with drinks and snacks.",
      },
      {
        id: "watchQuietly",
        label: "Watch quietly with family",
        description: "Take the moment in behind your own door.",
        isDefault: true,
      },
      {
        id: "speechless",
        label: "Call everyone you know",
        description: "You have to hear another human voice about this.",
      },
      {
        id: "skeptical",
        label: "Grumble about the cost",
        description: "Think what they could have spent it on down here.",
      },
    ],
  }),
  draft({
    kind: "pree.broadcast.kennedyShot",
    image:
      "https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=1200&q=70",
    title: "The Day the Nation Stopped",
    headline: "The President has been shot in Dallas.",
    body: "The bulletin breaks into the afternoon like a crack in the world. Strangers gather around car radios and shop-window televisions. Shops close. Churches fill. Nobody will ever forget where they were standing.",
    broadcast: "country",
    requiresCountryIds: ["US"],
    minYear: 1963,
    maxYear: 1963,
    defaultOptionId: "grievePrivately",
    options: [
      {
        id: "publicMourning",
        label: "Join the public mourning",
        description: "Stand with the crowds outside the church.",
      },
      {
        id: "grievePrivately",
        label: "Grieve privately",
        description: "Close the curtains and sit with it.",
        isDefault: true,
      },
      {
        id: "comfortOthers",
        label: "Comfort your neighbors",
        description: "Somebody has to hold the street together.",
      },
      {
        id: "mutterTheories",
        label: "Mutter about what really happened",
        description: "Something about this does not add up.",
      },
    ],
  }),
  draft({
    kind: "pree.broadcast.berlinWallFalls",
    image:
      "https://images.unsplash.com/photo-1560969184-10fe8719e047?auto=format&fit=crop&w=1200&q=70",
    title: "The Wall Is Open",
    headline: "Crowds are dancing on the Berlin Wall.",
    body: "The border is open. Trabants are honking through the checkpoints, strangers are embracing on the Kudamm, and people are attacking the Wall itself with hammers. Nobody knows what comes next, and for tonight nobody cares.",
    broadcast: "global",
    minYear: 1989,
    maxYear: 1989,
    defaultOptionId: "watchDisbelief",
    options: [
      {
        id: "celebrate",
        label: "Celebrate like everyone else",
        description: "Open something good. History is happening.",
      },
      {
        id: "watchDisbelief",
        label: "Watch in disbelief",
        description: "Keep waiting for someone to announce it was a mistake.",
        isDefault: true,
      },
      {
        id: "worryNext",
        label: "Worry about what comes next",
        description: "Empires do not usually end this quietly.",
      },
      {
        id: "callFriends",
        label: "Call everyone you know there",
        description: "Lines will be jammed for days. Try anyway.",
      },
    ],
  }),
  draft({
    kind: "pree.broadcast.chernobylCloud",
    image:
      "https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?auto=format&fit=crop&w=1200&q=70",
    title: "An Accident at the Reactor",
    headline:
      "Something has happened at a nuclear power station, and nobody official will say what.",
    body: "Foreign radio says there has been an accident at Chernobyl. The news here says nothing, then says it is minor, then says there is nothing to worry about. The weather report mentions wind direction, which it never does.",
    broadcast: "country",
    requiresCountryIds: ["RU", "DD"],
    minYear: 1986,
    maxYear: 1986,
    defaultOptionId: "foreignRadio",
    options: [
      {
        id: "officialLine",
        label: "Trust the official announcements",
        description: "Panic helps no one. The state is handling it.",
      },
      {
        id: "foreignRadio",
        label: "Tune the foreign broadcasts quietly",
        description: "Find out what the Swedes are measuring, low volume.",
        isDefault: true,
      },
      {
        id: "stockpileLeave",
        label: "Stockpile iodine and visit relatives far away",
        description: "A long-planned trip. Nothing to do with anything.",
      },
      {
        id: "askQuestions",
        label: "Ask questions at work",
        description: "Someone must know something. Ask loudly.",
      },
    ],
  }),
  draft({
    kind: "pree.broadcast.millenniumNight",
    image:
      "https://images.unsplash.com/photo-1467810563316-b5476525c0f9?auto=format&fit=crop&w=1200&q=70",
    title: "Millennium Night",
    headline: "The year 2000 arrives tonight, if the computers allow it.",
    body: "Fireworks are stacked by the river, champagne is sold out, and half the world is quietly wondering whether the power grid, the banks, and the elevators will still work at midnight. Party and apocalypse, same evening.",
    broadcast: "global",
    minYear: 1999,
    maxYear: 1999,
    defaultOptionId: "quietReflection",
    options: [
      {
        id: "partyHard",
        label: "Party like it's 1999",
        description: "Because it is. Find the biggest fireworks in town.",
      },
      {
        id: "y2kBunker",
        label: "Stock candles and cash, just in case",
        description: "If the machines fail, you will be smug and well-lit.",
      },
      {
        id: "quietReflection",
        label: "A quiet night of reflection",
        description: "Watch the century turn over from your own window.",
        isDefault: true,
      },
      {
        id: "workGlitch",
        label: "Volunteer for Y2K duty",
        description: "Someone has to babysit the servers at midnight.",
      },
    ],
  }),
];
