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
import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { threeTierTable } from "./tiers";

export const apply: EventHandler["applyEffects"] = async (ctx) => {
  await applyDeclarativeEffects(ctx, ctx.tier.effects);
};

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

// ──────────────────────────────── 1970s ────────────────────────────────────

registerEventHandler({
  kind: "pree.decade.1970s.petrolQueue",
  defaultOptionId: "waitItOut",
  options: [
    {
      id: "queueAtDawn",
      label: "Queue before dawn",
      description: "Beat the rush with a thermos and the morning paper.",
      primaryStat: "energy",
      outcomeTable: threeTierTable(
        "Fifth in line, full tank by seven",
        "A cold morning, a full tank",
        "The station runs dry anyway",
        [{ type: "favorability", delta: 1 }],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "carpoolNeighbor",
      label: "Organize a neighborhood carpool",
      description: "One trip, four passengers, one tank.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "The block's new institution",
        "It works well enough",
        "Scheduling turns into a part-time job",
        [{ type: "favorability", delta: 3 }],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "payPremium",
      label: "Pay a premium at a private pump",
      description: "There is always someone with fuel to sell.",
      outcomeTable: threeTierTable(
        "Full tank, no questions",
        "Full tank, light wallet",
        "The fuel is watered down",
        [{ type: "personalWealth", deltaAnchor: -500 }],
        [{ type: "personalWealth", deltaAnchor: -500 }],
        [
          { type: "personalWealth", deltaAnchor: -800 },
          { type: "favorability", delta: -1 },
        ]
      ),
    },
    {
      id: "waitItOut",
      label: "Wait out the line like everyone else",
      description: "Suffer in good company.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Eventually the nozzle reaches your car",
        "Three hours gone",
        "Three hours gone and only half a tank allowed",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.decade.1970s.stagflationShopFloor",
  defaultOptionId: "tightenBelt",
  options: [
    {
      id: "askRaise",
      label: "Ask for a raise anyway",
      description: "Make the case that your pay buys less every month.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "A modest bump, grudgingly given",
        "A promise to revisit in the spring",
        "The foreman stops saying good morning",
        [
          { type: "personalWealth", deltaAnchor: 1_000 },
          { type: "favorability", delta: 1 },
        ],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "tightenBelt",
      label: "Tighten the household belt",
      description: "Meatless Tuesdays and a colder thermostat.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "The budget holds",
        "The budget mostly holds",
        "The budget holds and everyone is cold",
        [{ type: "personalWealth", deltaAnchor: 500 }],
        [],
        []
      ),
    },
    {
      id: "sideGig",
      label: "Pick up weekend work",
      description: "A second income to stay ahead of the prices.",
      primaryStat: "energy",
      outcomeTable: threeTierTable(
        "The extra shifts add up",
        "Tired but solvent",
        "Tired, and barely ahead of the prices",
        [
          { type: "personalWealth", deltaAnchor: 1_500 },
          { type: "favorability", delta: 1 },
        ],
        [{ type: "personalWealth", deltaAnchor: 1_000 }],
        [{ type: "personalWealth", deltaAnchor: 500 }]
      ),
    },
    {
      id: "grumbleLoudly",
      label: "Grumble loudly about the whole mess",
      description: "Everyone is thinking it; say it out loud.",
      outcomeTable: threeTierTable(
        "The break room crowns you its spokesman",
        "Sympathetic nods",
        "The wrong people overhear",
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.decade.1970s.scandalAcquaintance",
  defaultOptionId: "cooperateInvestigators",
  options: [
    {
      id: "standByThem",
      label: "Stand by them publicly",
      description: "A friend does not run when the subpoenas arrive.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Loyalty that people remember kindly",
        "Admired and pitied in equal measure",
        "The taint splashes onto you",
        [
          { type: "favorability", delta: 3 },
          { type: "infamy", delta: 1 },
        ],
        [{ type: "favorability", delta: 1 }],
        [
          { type: "favorability", delta: -2 },
          { type: "infamy", delta: 3 },
        ]
      ),
    },
    {
      id: "distanceYourself",
      label: "Distance yourself carefully",
      description: "A statement about limited contact and full confidence in the process.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "The statement lands cleanly",
        "You slip out of the story",
        "Old photos of you two surface",
        [{ type: "politicalInfluence", delta: 1 }],
        [],
        [
          { type: "favorability", delta: -2 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
    {
      id: "cooperateInvestigators",
      label: "Cooperate with the investigators",
      description: "Answer their questions and turn over what you have.",
      isDefault: true,
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Cleared, and thanked on the record",
        "Cleared, quietly",
        "Your name still spends a week in the papers",
        [
          { type: "favorability", delta: 2 },
          { type: "politicalInfluence", delta: 1 },
        ],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "leakToPress",
      label: "Leak what you know to a reporter",
      description: "Get ahead of the story on your own terms.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "The scoop makes you look clean",
        "The story moves on without you",
        "The leak is traced back to you",
        [
          { type: "favorability", delta: 2 },
          { type: "politicalInfluence", delta: 1 },
        ],
        [],
        [
          { type: "infamy", delta: 4 },
          { type: "politicalInfluence", delta: -2 },
        ]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.decade.1970s.discoNight",
  defaultOptionId: "leaveEarly",
  options: [
    {
      id: "danceAllNight",
      label: "Dance until the lights come up",
      description: "Commit fully to the floor.",
      primaryStat: "energy",
      outcomeTable: threeTierTable(
        "The floor clears a circle around you",
        "A glorious, sweaty evening",
        "You pull something on the hustle",
        [{ type: "favorability", delta: 3 }],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "buyRound",
      label: "Buy a round for the table",
      description: "Champagne cocktails on you.",
      outcomeTable: threeTierTable(
        "The toast of the table",
        "A warm round of thanks",
        "The bill stings more than the thanks",
        [
          { type: "personalWealth", deltaAnchor: -400 },
          { type: "favorability", delta: 3 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -400 },
          { type: "favorability", delta: 1 },
        ],
        [{ type: "personalWealth", deltaAnchor: -400 }]
      ),
    },
    {
      id: "peopleWatch",
      label: "Hold the table and people-watch",
      description: "Guard the coats and enjoy the show.",
      outcomeTable: threeTierTable(
        "The best seat in the house",
        "An entertaining evening",
        "You are mistaken for staff twice",
        [{ type: "favorability", delta: 1 }],
        [],
        []
      ),
    },
    {
      id: "leaveEarly",
      label: "Slip out before midnight",
      description: "You have an early morning and quiet tastes.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Home by eleven, unbothered",
        "No consequence",
        "Your friends do not let it go",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

// ──────────────────────────────── 1980s ────────────────────────────────────

registerEventHandler({
  kind: "pree.decade.1980s.homeComputer",
  defaultOptionId: "skipIt",
  options: [
    {
      id: "buyTopLine",
      label: "Buy the top-of-the-line model",
      description: "The full kit: monitor, disk drive, dot-matrix printer.",
      outcomeTable: threeTierTable(
        "You are suddenly very organized",
        "The spreadsheet alone was worth it",
        "It mostly prints test pages",
        [
          { type: "personalWealth", deltaAnchor: -2_500 },
          { type: "favorability", delta: 2 },
          { type: "politicalInfluence", delta: 1 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -2_500 },
          { type: "favorability", delta: 1 },
        ],
        [{ type: "personalWealth", deltaAnchor: -2_500 }]
      ),
    },
    {
      id: "buyBudget",
      label: "Buy the budget model",
      description: "It hooks up to the television and loads from a tape.",
      outcomeTable: threeTierTable(
        "A humble machine that delivers",
        "Good enough for letters and games",
        "The tape chews your only program",
        [
          { type: "personalWealth", deltaAnchor: -1_000 },
          { type: "favorability", delta: 1 },
        ],
        [{ type: "personalWealth", deltaAnchor: -1_000 }],
        [{ type: "personalWealth", deltaAnchor: -1_000 }]
      ),
    },
    {
      id: "takeCourse",
      label: "Take an evening computing course first",
      description: "Learn before you spend.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "Top of the evening class",
        "You can now say you know BASIC",
        "The class is full of twelve-year-olds",
        [
          { type: "personalWealth", deltaAnchor: -300 },
          { type: "favorability", delta: 1 },
        ],
        [{ type: "personalWealth", deltaAnchor: -300 }],
        [{ type: "personalWealth", deltaAnchor: -300 }]
      ),
    },
    {
      id: "skipIt",
      label: "Walk past the demo table",
      description: "A typewriter never needed a disk drive.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "No consequence",
        "No consequence",
        "The salesman remembers your face",
        [],
        [],
        []
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.decade.1980s.yuppieStockTip",
  defaultOptionId: "passOnIt",
  options: [
    {
      id: "goAllIn",
      label: "Go all in on the tip",
      description: "Certainty like this does not come twice.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "The takeover lands and the tip was golden",
        "A decent return on nerve",
        "The regulators ask how you knew",
        [
          { type: "personalWealth", deltaAnchor: 10_000 },
          { type: "favorability", delta: 1 },
        ],
        [{ type: "personalWealth", deltaAnchor: 3_000 }],
        [
          { type: "personalWealth", deltaAnchor: -2_000 },
          { type: "infamy", delta: 5 },
        ]
      ),
    },
    {
      id: "smallPosition",
      label: "Take a small position",
      description: "Enough to enjoy it if he is right.",
      outcomeTable: threeTierTable(
        "A tidy little gain",
        "A modest gain",
        "A modest loss and a lesson",
        [{ type: "personalWealth", deltaAnchor: 3_000 }],
        [{ type: "personalWealth", deltaAnchor: 1_000 }],
        [{ type: "personalWealth", deltaAnchor: -1_000 }]
      ),
    },
    {
      id: "reportIt",
      label: "Report the tip to compliance",
      description: "This smells like someone else's information.",
      outcomeTable: threeTierTable(
        "Compliance commends your instincts",
        "A note goes in your file, favorably",
        "The wine bar crowd hears you talked",
        [
          { type: "favorability", delta: 2 },
          { type: "politicalInfluence", delta: 1 },
        ],
        [{ type: "favorability", delta: 1 }],
        [{ type: "infamy", delta: 1 }]
      ),
    },
    {
      id: "passOnIt",
      label: "Pass on it",
      description: "Buy your own wine and keep your own counsel.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "No consequence",
        "No consequence",
        "You hear later that it paid off",
        [],
        [],
        []
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.decade.1980s.benefitConcert",
  defaultOptionId: "justWatch",
  options: [
    {
      id: "donateCampaign",
      label: "Pledge from the campaign account",
      description: "Put the organization's name on a generous pledge.",
      outcomeTable: threeTierTable(
        "The pledge makes the telethon scroll",
        "A well-received gesture",
        "Someone questions the accounting later",
        [
          { type: "campaignFunds", deltaLocal: -2_000 },
          { type: "favorability", delta: 4 },
        ],
        [
          { type: "campaignFunds", deltaLocal: -2_000 },
          { type: "favorability", delta: 2 },
        ],
        [
          { type: "campaignFunds", deltaLocal: -2_000 },
          { type: "favorability", delta: 1 },
          { type: "infamy", delta: 1 },
        ]
      ),
    },
    {
      id: "donatePersonal",
      label: "Donate from your own pocket",
      description: "A personal check, no cameras involved.",
      outcomeTable: threeTierTable(
        "A quiet generosity that still gets noticed",
        "Money well sent",
        "The check is the news, briefly",
        [
          { type: "personalWealth", deltaAnchor: -1_000 },
          { type: "favorability", delta: 3 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -1_000 },
          { type: "favorability", delta: 1 },
        ],
        [{ type: "personalWealth", deltaAnchor: -1_000 }]
      ),
    },
    {
      id: "phoneInSmall",
      label: "Phone in a small pledge",
      description: "Join the millions giving what they can.",
      outcomeTable: threeTierTable(
        "Part of something enormous",
        "A good feeling all weekend",
        "The line is busy; you give up",
        [
          { type: "personalWealth", deltaAnchor: -200 },
          { type: "favorability", delta: 1 },
        ],
        [{ type: "personalWealth", deltaAnchor: -200 }],
        []
      ),
    },
    {
      id: "justWatch",
      label: "Just watch the show",
      description: "Enjoy the music; the phones are busy anyway.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "A great concert, free of guilt",
        "No consequence",
        "Monday's small talk finds you wanting",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.decade.1980s.moralCrusade",
  defaultOptionId: "studyIssue",
  options: [
    {
      id: "joinCrusade",
      label: "Join the crusade",
      description: "Sign the petition and headline their hearing.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "The movement adopts you as its champion",
        "Their voters notice, approvingly",
        "The crusade curdles and you are in the photos",
        [
          { type: "favorability", delta: 3 },
          { type: "campaignSupport", delta: 2 },
        ],
        [
          { type: "favorability", delta: 2 },
          { type: "infamy", delta: 1 },
        ],
        [
          { type: "favorability", delta: -2 },
          { type: "infamy", delta: 3 },
        ]
      ),
    },
    {
      id: "opposeCrusade",
      label: "Oppose it on principle",
      description: "Defend free expression and call it a panic.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "A stand the editorial pages praise",
        "Respect from some quarters",
        "The crusade makes you its villain",
        [
          { type: "favorability", delta: 3 },
          { type: "politicalInfluence", delta: 1 },
        ],
        [{ type: "favorability", delta: 1 }],
        [
          { type: "favorability", delta: -2 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
    {
      id: "studyIssue",
      label: "Promise to study the issue",
      description: "Take the exhibits and schedule no hearings.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "The folder gathers dust peacefully",
        "The crusade moves on to louder targets",
        "They return, louder, with more exhibits",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "quietDonation",
      label: "Make a quiet donation instead",
      description: "Support the cause without the cameras.",
      outcomeTable: threeTierTable(
        "Their gratitude stays private",
        "Money accepted, questions unasked",
        "The donation list leaks",
        [
          { type: "personalWealth", deltaAnchor: -500 },
          { type: "campaignSupport", delta: 1 },
        ],
        [{ type: "personalWealth", deltaAnchor: -500 }],
        [
          { type: "personalWealth", deltaAnchor: -500 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
  ],
  applyEffects: apply,
});

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
