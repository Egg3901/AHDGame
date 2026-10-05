/** Decade-scoped player random events for the 1970s. See decadeEvents.ts for the conventions. */
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { threeTierTable } from "./tiers";
import { apply } from "./decadeEventsApply";

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
