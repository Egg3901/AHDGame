/** Decade-scoped player random events for the 1980s. See decadeEvents.ts for the conventions. */
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { threeTierTable } from "./tiers";
import { apply } from "./decadeEventsApply";

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
