/** Decade-scoped player random events for the 1990s. See decadeEvents.ts for the conventions. */
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { threeTierTable } from "./tiers";
import { apply } from "./decadeEventsApply";

// ──────────────────────────────── 1990s ────────────────────────────────────

registerEventHandler({
  kind: "pree.decade.1990s.dialUpArrives",
  defaultOptionId: "freeTrial",
  options: [
    {
      id: "signUpNow",
      label: "Sign up for the unlimited plan",
      description: "Go all in on the information superhighway.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "You are suddenly very well informed",
        "Email changes how you work",
        "The phone bill sparks a household inquiry",
        [
          { type: "personalWealth", deltaAnchor: -500 },
          { type: "politicalInfluence", delta: 2 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -500 },
          { type: "favorability", delta: 1 },
        ],
        [{ type: "personalWealth", deltaAnchor: -500 }]
      ),
    },
    {
      id: "freeTrial",
      label: "Start with the free trial disc",
      description: "A hundred free hours from the disc in the mail.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "A hundred hours well spent",
        "You get the hang of it",
        "You burn the hours on hold music",
        [],
        [],
        []
      ),
    },
    {
      id: "setUpForKids",
      label: "Set it up mostly for the kids",
      description: "Homework, encyclopedias, and chat rooms you will worry about later.",
      outcomeTable: threeTierTable(
        "The kids teach you, eventually",
        "Homework improves measurably",
        "Nobody under sixteen sleeps before midnight now",
        [
          { type: "personalWealth", deltaAnchor: -300 },
          { type: "favorability", delta: 2 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -300 },
          { type: "favorability", delta: 1 },
        ],
        [{ type: "personalWealth", deltaAnchor: -300 }]
      ),
    },
    {
      id: "skipIt",
      label: "Leave the disc in the drawer",
      description: "The library has computers if it ever matters.",
      outcomeTable: threeTierTable(
        "No consequence",
        "No consequence",
        "The discs keep arriving in the mail",
        [],
        [],
        []
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.decade.1990s.superMallOpens",
  defaultOptionId: "splitDifference",
  options: [
    {
      id: "shopOpeningDay",
      label: "Shop there on opening day",
      description: "Be part of the crowd under the skylights.",
      outcomeTable: threeTierTable(
        "Free samples and a great parking spot",
        "An impressive piece of retail",
        "You lose the car in lot G for an hour",
        [
          { type: "personalWealth", deltaAnchor: -400 },
          { type: "favorability", delta: 1 },
        ],
        [{ type: "personalWealth", deltaAnchor: -400 }],
        [
          { type: "personalWealth", deltaAnchor: -400 },
          { type: "favorability", delta: -1 },
        ]
      ),
    },
    {
      id: "defendMainStreet",
      label: "Keep shopping on Main Street",
      description: "Spend where the owners know your name.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "The shopkeepers treat you like family",
        "Your loyalty is noticed downtown",
        "Higher prices and a faint martyrdom",
        [
          { type: "personalWealth", deltaAnchor: -300 },
          { type: "favorability", delta: 3 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -300 },
          { type: "favorability", delta: 2 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -300 },
          { type: "favorability", delta: 1 },
        ]
      ),
    },
    {
      id: "splitDifference",
      label: "Split the difference",
      description: "Mall for the big trips, downtown for the rest.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "A reasonable arrangement",
        "Everyone is mildly satisfied",
        "No consequence",
        [],
        [],
        []
      ),
    },
    {
      id: "lamentIt",
      label: "Lament the whole thing loudly",
      description: "Tell anyone who will listen what the town is losing.",
      outcomeTable: threeTierTable(
        "You become the voice of the old downtown",
        "A few people nod in agreement",
        "People cross the street to avoid the speech",
        [{ type: "favorability", delta: 2 }],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.decade.1990s.grungeKid",
  defaultOptionId: "letItRide",
  options: [
    {
      id: "buyGuitar",
      label: "Buy the kid a guitar",
      description: "If there is going to be noise, let it be practiced noise.",
      outcomeTable: threeTierTable(
        "Actual songs emerge within a year",
        "Enthusiastic, shapeless noise",
        "The guitar gathers dust by summer",
        [
          { type: "personalWealth", deltaAnchor: -600 },
          { type: "favorability", delta: 3 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -600 },
          { type: "favorability", delta: 1 },
        ],
        [{ type: "personalWealth", deltaAnchor: -600 }]
      ),
    },
    {
      id: "setCurfew",
      label: "Tighten the rules",
      description: "Earlier curfew, and no more concerts on school nights.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "The rules hold, grudgingly",
        "A cold war settles over the dinner table",
        "Open rebellion by Friday",
        [{ type: "favorability", delta: -1 }],
        [{ type: "favorability", delta: -2 }],
        [{ type: "favorability", delta: -3 }]
      ),
    },
    {
      id: "listenAlong",
      label: "Ask to hear the albums",
      description: "Sit down and actually listen to the racket.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "The kid is floored; you almost like track four",
        "A bridge built over very loud water",
        "You understand none of it, and it shows",
        [{ type: "favorability", delta: 3 }],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "letItRide",
      label: "Let the phase run its course",
      description: "You survived your own haircut at that age.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "The phase passes, as phases do",
        "No consequence",
        "The flannel is now permanent",
        [],
        [],
        []
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.decade.1990s.dotComPitch",
  defaultOptionId: "passPolitely",
  options: [
    {
      id: "investSeed",
      label: "Write the seed check",
      description: "Stake them and take a board seat.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "The little startup is suddenly everywhere",
        "Growth is slow but real",
        "The servers and the money both burn out",
        [
          { type: "personalWealth", deltaAnchor: -5_000 },
          { type: "politicalInfluence", delta: 2 },
          { type: "favorability", delta: 2 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -5_000 },
          { type: "favorability", delta: 1 },
        ],
        [{ type: "personalWealth", deltaAnchor: -5_000 }]
      ),
    },
    {
      id: "acquihire",
      label: "Buy the company for the talent",
      description: "Fold the kids and their servers into your firm.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Your firm is suddenly the innovative one",
        "They ship things your departments never could",
        "They quit the day the lockup expires",
        [
          { type: "personalWealth", deltaAnchor: -3_000 },
          { type: "politicalInfluence", delta: 2 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -3_000 },
          { type: "politicalInfluence", delta: 1 },
        ],
        [{ type: "personalWealth", deltaAnchor: -3_000 }]
      ),
    },
    {
      id: "passPolitely",
      label: "Pass, but wish them well",
      description: "Thank them for the pitch and keep your wallet closed.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "They remember you kindly",
        "No consequence",
        "No consequence",
        [{ type: "favorability", delta: 1 }],
        [],
        []
      ),
    },
    {
      id: "dismissIt",
      label: "Dismiss the whole internet thing",
      description: "Tell the room it is a fad for hobbyists.",
      outcomeTable: threeTierTable(
        "The room mostly agrees with you",
        "A few people quietly disagree",
        "The quote will follow you for years",
        [],
        [{ type: "favorability", delta: -1 }],
        [
          { type: "favorability", delta: -2 },
          { type: "infamy", delta: 1 },
        ]
      ),
    },
  ],
  applyEffects: apply,
});
