/**
 * 20 decade-scoped player random events (1950s-1990s, four per decade).
 *
 * Each handler registers via the substrate. Option ids and `defaultOptionId`
 * MUST stay in lockstep with the matching seed definition in
 * `decadeDefinitions.ts` (the approve route and the seed-catalog test reject
 * drift). No em-dashes, no dramatic language. Outcomes are modest three-tier
 * tables built with `threeTierTable`.
 *
 * Era gating (minYear/maxYear on the definitions) keeps each event inside its
 * own decade; the handlers here are era-agnostic and just own the outcomes.
 */
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { threeTierTable } from "./tiers";
import { apply } from "./decadeEventsApply";
import "./decadeEvents1970s";
import "./decadeEvents1980s";
import "./decadeEvents1990s";

export { apply };

// ──────────────────────────────── 1950s ────────────────────────────────────

registerEventHandler({
  kind: "pree.decade.1950s.duckAndCover",
  defaultOptionId: "followDrill",
  options: [
    {
      id: "takeCharge",
      label: "Take charge of the room",
      description: "Get everyone under cover and keep order.",
      primaryStat: "energy",
      outcomeTable: threeTierTable(
        "Steady voice in a tense room",
        "People follow your lead",
        "A few rolled eyes",
        [{ type: "favorability", delta: 3 }],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "followDrill",
      label: "Follow the drill quietly",
      description: "Duck, cover, and wait for the all-clear.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "No consequence",
        "No consequence",
        "No consequence",
        [],
        [],
        []
      ),
    },
    {
      id: "makeJokes",
      label: "Crack jokes from under the desk",
      description: "Somebody has to lighten the mood.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "The room laughs with you",
        "A few chuckles",
        "The warden glares",
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "stepOut",
      label: "Step out for a smoke",
      description: "Drills are for the nervous.",
      outcomeTable: threeTierTable(
        "Nobody notices",
        "A raised eyebrow",
        "Reported to the warden",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.decade.1950s.firstTvStation",
  defaultOptionId: "waitOnIt",
  options: [
    {
      id: "buyConsole",
      label: "Buy the big console set",
      description: "Top of the line, walnut cabinet, rabbit ears included.",
      outcomeTable: threeTierTable(
        "Finest picture on the block",
        "A handsome piece of furniture",
        "The reception is snowy",
        [
          { type: "personalWealth", deltaAnchor: -1_500 },
          { type: "favorability", delta: 2 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -1_500 },
          { type: "favorability", delta: 1 },
        ],
        [{ type: "personalWealth", deltaAnchor: -1_500 }]
      ),
    },
    {
      id: "buyUsed",
      label: "Pick up a secondhand set",
      description: "A smaller table model at half the price.",
      outcomeTable: threeTierTable(
        "A bargain that works",
        "Good enough for the news",
        "The vertical hold drifts",
        [
          { type: "personalWealth", deltaAnchor: -700 },
          { type: "favorability", delta: 1 },
        ],
        [{ type: "personalWealth", deltaAnchor: -700 }],
        [{ type: "personalWealth", deltaAnchor: -700 }]
      ),
    },
    {
      id: "hostNeighbors",
      label: "Buy a set and host the street",
      description: "Your living room becomes the neighborhood theater.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "The whole street loves your house",
        "A regular Tuesday crowd",
        "The crowd eats all your snacks",
        [
          { type: "personalWealth", deltaAnchor: -1_500 },
          { type: "favorability", delta: 4 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -1_500 },
          { type: "favorability", delta: 2 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -1_500 },
          { type: "favorability", delta: 1 },
        ]
      ),
    },
    {
      id: "waitOnIt",
      label: "Wait for the fad to pass",
      description: "Radio was good enough for the war.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "No consequence",
        "No consequence",
        "You feel left out of conversations",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.decade.1950s.polioVaccineLine",
  defaultOptionId: "takeFamily",
  options: [
    {
      id: "lineUpEarly",
      label: "Line up before dawn",
      description: "Be first through the door when the nurses arrive.",
      primaryStat: "energy",
      outcomeTable: threeTierTable(
        "First in line, home by breakfast",
        "Done before the crowds",
        "A long cold morning",
        [{ type: "favorability", delta: 1 }],
        [],
        []
      ),
    },
    {
      id: "volunteerHelp",
      label: "Volunteer at the clinic",
      description: "Direct traffic, pass out forms, keep the line moving.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "The nurses could not have done it without you",
        "A day well spent",
        "Sore feet and a paper hat",
        [{ type: "favorability", delta: 4 }],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "takeFamily",
      label: "Take the whole family in line",
      description: "Everyone gets the shot, no fuss.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Everyone immunized",
        "Everyone immunized",
        "Tears, but everyone immunized",
        [{ type: "favorability", delta: 1 }],
        [],
        []
      ),
    },
    {
      id: "skipIt",
      label: "Skip the line",
      description: "You will get to it eventually. Probably.",
      outcomeTable: threeTierTable(
        "No consequence",
        "A neighbor mentions it",
        "The school sends a note home",
        [],
        [{ type: "favorability", delta: -1 }],
        [{ type: "favorability", delta: -2 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.decade.1950s.loyaltyHearing",
  defaultOptionId: "complyNarrowly",
  options: [
    {
      id: "complyNarrowly",
      label: "Comply, but answer narrowly",
      description: "Give them the minimum and protect your friends.",
      isDefault: true,
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "The committee loses interest",
        "You survive the session",
        "They note your reluctance",
        [{ type: "politicalInfluence", delta: 1 }],
        [],
        [{ type: "infamy", delta: 1 }]
      ),
    },
    {
      id: "defyCommittee",
      label: "Defy the committee publicly",
      description: "Denounce the whole proceeding as un-American.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "A stand people remember",
        "Admired by some, marked by others",
        "Blacklisted by Friday",
        [
          { type: "favorability", delta: 4 },
          { type: "politicalInfluence", delta: 2 },
        ],
        [
          { type: "favorability", delta: 2 },
          { type: "infamy", delta: 2 },
        ],
        [
          { type: "infamy", delta: 4 },
          { type: "politicalInfluence", delta: -2 },
        ]
      ),
    },
    {
      id: "nameNames",
      label: "Cooperate fully and name names",
      description: "Survive by pointing at others.",
      outcomeTable: threeTierTable(
        "The committee rewards you",
        "You are cleared",
        "Word gets around about who talked",
        [
          { type: "politicalInfluence", delta: 2 },
          { type: "favorability", delta: -2 },
        ],
        [{ type: "favorability", delta: -2 }],
        [
          { type: "favorability", delta: -4 },
          { type: "infamy", delta: 3 },
        ]
      ),
    },
    {
      id: "pleadFifth",
      label: "Invoke your right to silence",
      description: "Take the Fifth and let them make of it what they will.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "A principled silence",
        "The papers shrug",
        "Headlines hint at guilt",
        [{ type: "favorability", delta: 1 }],
        [{ type: "infamy", delta: 1 }],
        [{ type: "infamy", delta: 3 }]
      ),
    },
  ],
  applyEffects: apply,
});

// ──────────────────────────────── 1960s ────────────────────────────────────

registerEventHandler({
  kind: "pree.decade.1960s.moonshotWatch",
  defaultOptionId: "watchQuietly",
  options: [
    {
      id: "hostParty",
      label: "Host the watch party",
      description: "Lemonade, folding chairs, the best seat on the block.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "A night the street talks about for years",
        "Good company and a good show",
        "The picture tubes pick a bad moment",
        [
          { type: "favorability", delta: 4 },
          { type: "personalWealth", deltaAnchor: -300 },
        ],
        [
          { type: "favorability", delta: 2 },
          { type: "personalWealth", deltaAnchor: -300 },
        ],
        [
          { type: "favorability", delta: 1 },
          { type: "personalWealth", deltaAnchor: -300 },
        ]
      ),
    },
    {
      id: "watchQuietly",
      label: "Watch quietly with everyone",
      description: "Just be there when the engines light.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "You will remember where you were",
        "A shared cheer goes up",
        "No consequence",
        [{ type: "favorability", delta: 1 }],
        [],
        []
      ),
    },
    {
      id: "grumbleCost",
      label: "Grumble about the cost of it all",
      description: "All that money, and for what?",
      outcomeTable: threeTierTable(
        "A few neighbors nod along",
        "Mostly ignored",
        "You dampen the whole evening",
        [],
        [{ type: "favorability", delta: -1 }],
        [{ type: "favorability", delta: -2 }]
      ),
    },
    {
      id: "stayInside",
      label: "Stay inside",
      description: "It will be on the news tonight anyway.",
      outcomeTable: threeTierTable(
        "No consequence",
        "No consequence",
        "You missed the moment everyone shares",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.decade.1960s.beatlessTickets",
  defaultOptionId: "listenRadio",
  options: [
    {
      id: "queueOvernight",
      label: "Queue overnight for returns",
      description: "Sleeping bag, thermos, and hope.",
      primaryStat: "energy",
      outcomeTable: threeTierTable(
        "Two seats, third row",
        "Two seats, upper deck",
        "The returns run out two people ahead",
        [
          { type: "favorability", delta: 3 },
          { type: "personalWealth", deltaAnchor: -200 },
        ],
        [
          { type: "favorability", delta: 2 },
          { type: "personalWealth", deltaAnchor: -200 },
        ],
        [{ type: "personalWealth", deltaAnchor: -100 }]
      ),
    },
    {
      id: "payScalper",
      label: "Pay the scalper",
      description: "Absurd money for a seat in the rafters.",
      outcomeTable: threeTierTable(
        "Worth every penny",
        "A decent view and a story",
        "The tickets turn out to be fakes",
        [
          { type: "personalWealth", deltaAnchor: -2_000 },
          { type: "favorability", delta: 3 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -2_000 },
          { type: "favorability", delta: 1 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -2_000 },
          { type: "favorability", delta: -1 },
        ]
      ),
    },
    {
      id: "listenRadio",
      label: "Listen to it on the radio",
      description: "The broadcast is free and the kitchen is warm.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "You can hear the screaming fine from here",
        "A pleasant evening in",
        "No consequence",
        [],
        [],
        []
      ),
    },
    {
      id: "mockTheFuss",
      label: "Mock the whole fuss",
      description: "Give it a year, nobody will remember them.",
      outcomeTable: threeTierTable(
        "Nobody holds it against you",
        "Your friends disagree loudly",
        "You will be wrong about this for decades",
        [],
        [{ type: "favorability", delta: -1 }],
        [{ type: "favorability", delta: -2 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.decade.1960s.civilRightsMarch",
  defaultOptionId: "watchFromPorch",
  options: [
    {
      id: "joinMarch",
      label: "Join the march",
      description: "Step off the curb and walk with them.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "You walk where history walks",
        "A long walk in good company",
        "Some neighbors will not forget it",
        [
          { type: "favorability", delta: 4 },
          { type: "infamy", delta: 1 },
        ],
        [{ type: "favorability", delta: 2 }],
        [
          { type: "favorability", delta: 1 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
    {
      id: "watchFromPorch",
      label: "Watch from the porch",
      description: "Bear witness without choosing a side.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "No consequence",
        "No consequence",
        "No consequence",
        [],
        [],
        []
      ),
    },
    {
      id: "offerWater",
      label: "Offer the marchers water",
      description: "Set out a table with a pitcher and paper cups.",
      outcomeTable: threeTierTable(
        "A small kindness, warmly received",
        "Many quiet thank-yous",
        "A neighbor complains about your lawn",
        [{ type: "favorability", delta: 3 }],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "complainNoise",
      label: "Complain about the disruption",
      description: "Call the precinct about the noise and the traffic.",
      outcomeTable: threeTierTable(
        "The desk sergeant takes a message",
        "Your name goes in a log",
        "The march remembers who called",
        [{ type: "favorability", delta: -1 }],
        [
          { type: "favorability", delta: -2 },
          { type: "infamy", delta: 1 },
        ],
        [
          { type: "favorability", delta: -4 },
          { type: "infamy", delta: 3 },
        ]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.decade.1960s.falloutShelter",
  defaultOptionId: "politeNo",
  options: [
    {
      id: "buyDeluxe",
      label: "Buy the deluxe model",
      description: "Bunks for six, air filtration, a hand-crank radio.",
      outcomeTable: threeTierTable(
        "The envy of the civil-defense crowd",
        "Peace of mind, poured in concrete",
        "The backyard is a crater for months",
        [
          { type: "personalWealth", deltaAnchor: -3_000 },
          { type: "favorability", delta: 1 },
        ],
        [{ type: "personalWealth", deltaAnchor: -3_000 }],
        [
          { type: "personalWealth", deltaAnchor: -3_000 },
          { type: "favorability", delta: -1 },
        ]
      ),
    },
    {
      id: "buyBasic",
      label: "Buy the basic unit",
      description: "Concrete, a door, and two weeks of canned goods.",
      outcomeTable: threeTierTable(
        "A sensible precaution",
        "You sleep a little easier",
        "The cans expire before the crisis does",
        [{ type: "personalWealth", deltaAnchor: -1_500 }],
        [{ type: "personalWealth", deltaAnchor: -1_500 }],
        [{ type: "personalWealth", deltaAnchor: -1_500 }]
      ),
    },
    {
      id: "takeBrochure",
      label: "Take the brochure and think it over",
      description: "Let him leave the paperwork.",
      outcomeTable: threeTierTable(
        "He never follows up",
        "A few polite phone calls",
        "He calls every week for a year",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "politeNo",
      label: "Politely decline",
      description: "You will take your chances with the sky.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "No consequence",
        "No consequence",
        "The neighbor with a shelter mentions it often",
        [],
        [],
        []
      ),
    },
  ],
  applyEffects: apply,
});
