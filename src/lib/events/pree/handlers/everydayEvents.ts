/**
 * 20 new global player random events (everyday, grounded flavor).
 *
 * Each handler registers via the substrate. Option ids and `defaultOptionId`
 * MUST stay in lockstep with the matching seed definition in
 * `seedDefinitions.ts` (the approve route and the seed-catalog test reject
 * drift). No em-dashes, no dramatic language. Outcomes are modest three-tier
 * tables built with `threeTierTable`.
 *
 * Eligibility spread: 12 `all`, 4 `politician`, 1 `inElection`, 5 `ceo`-ish.
 * The POLITICIAN / IN ELECTION / CEO handlers continue in everydayEvents2.ts.
 */
import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { threeTierTable } from "./tiers";

export const apply: EventHandler["applyEffects"] = async (ctx) => {
  await applyDeclarativeEffects(ctx, ctx.tier.effects);
};

// ── ALL (private citizens, politicians, CEOs alike) ─────────────────────────

registerEventHandler({
  kind: "pree.lostWallet",
  defaultOptionId: "leaveIt",
  options: [
    {
      id: "turnIn",
      label: "Track down the owner and return it",
      description: "Find the name on the cards and hand it back.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Local news loves it",
        "Owner is grateful",
        "Quiet thank you",
        [{ type: "favorability", delta: 4 }],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "takeCash",
      label: "Keep the cash, ditch the wallet",
      description: "Pocket the bills and drop the rest in a bin.",
      outcomeTable: threeTierTable(
        "Nobody notices",
        "Small windfall",
        "Caught on a door cam",
        [{ type: "personalWealth", deltaAnchor: 5_000 }],
        [{ type: "personalWealth", deltaAnchor: 2_000 }],
        [
          { type: "personalWealth", deltaAnchor: 2_000 },
          { type: "infamy", delta: 3 },
        ]
      ),
    },
    {
      id: "dropAtStation",
      label: "Drop it at the police station",
      description: "Hand it in and let them sort it out.",
      outcomeTable: threeTierTable(
        "Civic-minded nod",
        "Logged and forgotten",
        "Clerk shrugs",
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }],
        []
      ),
    },
    {
      id: "leaveIt",
      label: "Leave it where it is",
      description: "Not your problem.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "No consequence",
        "No consequence",
        "Bad luck rubs off",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.highSchoolReunion",
  defaultOptionId: "ignore",
  options: [
    {
      id: "rsvpYes",
      label: "RSVP and go",
      description: "Book the trip and show your face.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Warm nostalgia",
        "Pleasant enough evening",
        "Awkward small talk",
        [
          { type: "favorability", delta: 2 },
          { type: "personalWealth", deltaAnchor: -1_000 },
        ],
        [
          { type: "favorability", delta: 1 },
          { type: "personalWealth", deltaAnchor: -1_000 },
        ],
        [{ type: "personalWealth", deltaAnchor: -1_000 }]
      ),
    },
    {
      id: "sendRegrets",
      label: "Send polite regrets",
      description: "A warm note saying you can't make it.",
      outcomeTable: threeTierTable(
        "Gracious reply",
        "Polite decline",
        "Form letter",
        [{ type: "favorability", delta: 1 }],
        [],
        []
      ),
    },
    {
      id: "sendProxy",
      label: "Send a video message",
      description: "Record a greeting for the organizers to play.",
      outcomeTable: threeTierTable(
        "Crowd enjoys it",
        "Mild applause",
        "Comes off distant",
        [{ type: "favorability", delta: 1 }],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "ignore",
      label: "Toss the invite",
      description: "Don't reply at all.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Nobody keeps score",
        "Mild guilt",
        "Classmates notice",
        [],
        [{ type: "favorability", delta: -1 }],
        [{ type: "favorability", delta: -2 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.fenceDispute",
  defaultOptionId: "ignore",
  options: [
    {
      id: "surveyIt",
      label: "Hire a surveyor",
      description: "Settle the property line with a real map.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "Line is clearly yours",
        "Survey settles it",
        "Survey is inconclusive",
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
      id: "negotiate",
      label: "Talk it out over the fence",
      description: "Work it out neighbor to neighbor.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Handshake deal",
        "Reasonable compromise",
        "Talks go nowhere",
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "tearDown",
      label: "Just pull your fence down",
      description: "Cave and remove the section in dispute.",
      outcomeTable: threeTierTable(
        "Tension defused",
        "Quiet relief",
        "Neighbor gloats",
        [{ type: "favorability", delta: 1 }],
        [],
        [{ type: "favorability", delta: -2 }]
      ),
    },
    {
      id: "ignore",
      label: "Ignore the complaint",
      description: "Leave the fence and hope it drops.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "It blows over",
        "Grumbling continues",
        "You get served",
        [],
        [{ type: "favorability", delta: -1 }],
        [{ type: "infamy", delta: 1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.volunteerFirefighter",
  defaultOptionId: "ignore",
  options: [
    {
      id: "join",
      label: "Sign up to volunteer",
      description: "Put in for the next training cohort.",
      primaryStat: "energy",
      outcomeTable: threeTierTable(
        "Local hero material",
        "Solid civic move",
        "Earnest effort",
        [{ type: "favorability", delta: 4 }],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "donate",
      label: "Donate to the department instead",
      description: "Send money rather than time.",
      outcomeTable: threeTierTable(
        "Generous supporter",
        "Helpful contribution",
        "Token gift",
        [
          { type: "favorability", delta: 2 },
          { type: "personalWealth", deltaAnchor: -2_000 },
        ],
        [
          { type: "favorability", delta: 1 },
          { type: "personalWealth", deltaAnchor: -2_000 },
        ],
        [
          { type: "favorability", delta: 1 },
          { type: "personalWealth", deltaAnchor: -2_000 },
        ]
      ),
    },
    {
      id: "spreadWord",
      label: "Share their flyer",
      description: "Pass the recruitment notice along.",
      outcomeTable: threeTierTable(
        "A few sign up",
        "Mild reach",
        "Lost in the feed",
        [{ type: "favorability", delta: 1 }],
        [],
        []
      ),
    },
    {
      id: "ignore",
      label: "Recycle the flyer",
      description: "Not your calling.",
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
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.podcastInvite",
  defaultOptionId: "pass",
  options: [
    {
      id: "longForm",
      label: "Sit for the long interview",
      description: "A real conversation, an hour plus.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Covers your points well",
        "Decent listen",
        "You ramble on tape",
        [{ type: "favorability", delta: 3 }],
        [{ type: "favorability", delta: 1 }],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "shortSegment",
      label: "Do a short clip",
      description: "Ten minutes, highlights only.",
      outcomeTable: threeTierTable(
        "Tight and quotable",
        "Fine segment",
        "Forgettable",
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }],
        []
      ),
    },
    {
      id: "referFriend",
      label: "Send a friend instead",
      description: "Recommend someone better suited.",
      outcomeTable: threeTierTable(
        "Friend shines, you look generous",
        "Polite handoff",
        "Host wanted you",
        [{ type: "favorability", delta: 1 }],
        [],
        []
      ),
    },
    {
      id: "pass",
      label: "Pass on it",
      description: "Too small to bother.",
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
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.annualCheckup",
  defaultOptionId: "skip",
  options: [
    {
      id: "goIn",
      label: "Book the physical",
      description: "Go in person and get it done.",
      primaryStat: "energy",
      outcomeTable: threeTierTable(
        "Clean bill of health",
        "Routine visit",
        "A few flags to watch",
        [{ type: "favorability", delta: 1 }],
        [],
        []
      ),
    },
    {
      id: "telehealth",
      label: "Do a telehealth visit",
      description: "A video appointment from your desk.",
      outcomeTable: threeTierTable(
        "Convenient and sufficient",
        "Quick check-in",
        "Doctor wants you in person",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "reschedule",
      label: "Push it to next month",
      description: "Reschedule for a less busy week.",
      outcomeTable: threeTierTable(
        "Harmless delay",
        "Another postponement",
        "Clinic drops you",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "skip",
      label: "Skip it this year",
      description: "You feel fine.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "No consequence",
        "No consequence",
        "Bad habits noted",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.almaMaterCall",
  defaultOptionId: "hangUp",
  options: [
    {
      id: "majorGift",
      label: "Make a major gift",
      description: "A naming-level donation.",
      primaryStat: "fundraising",
      outcomeTable: threeTierTable(
        "Building gets your name",
        "Dean is delighted",
        "Polite acknowledgment",
        [
          { type: "favorability", delta: 5 },
          { type: "personalWealth", deltaAnchor: -50_000 },
        ],
        [
          { type: "favorability", delta: 3 },
          { type: "personalWealth", deltaAnchor: -50_000 },
        ],
        [
          { type: "favorability", delta: 2 },
          { type: "personalWealth", deltaAnchor: -50_000 },
        ]
      ),
    },
    {
      id: "modestGift",
      label: "Give a modest amount",
      description: "A reasonable annual gift.",
      outcomeTable: threeTierTable(
        "Listed among supporters",
        "Appreciated",
        "Barely registers",
        [
          { type: "favorability", delta: 2 },
          { type: "personalWealth", deltaAnchor: -5_000 },
        ],
        [
          { type: "favorability", delta: 1 },
          { type: "personalWealth", deltaAnchor: -5_000 },
        ],
        [
          { type: "favorability", delta: 1 },
          { type: "personalWealth", deltaAnchor: -5_000 },
        ]
      ),
    },
    {
      id: "pledgeLater",
      label: "Say you'll think about it",
      description: "Pledge to decide later.",
      outcomeTable: threeTierTable(
        "They'll follow up",
        "Soft maybe",
        "You dodge the calls",
        [{ type: "favorability", delta: 1 }],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "hangUp",
      label: "Politely decline",
      description: "End the call quickly.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "No hard feelings",
        "Caller moves on",
        "Development office marks you cold",
        [],
        [{ type: "favorability", delta: -1 }],
        [{ type: "favorability", delta: -2 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.repairMixup",
  defaultOptionId: "ignore",
  options: [
    {
      id: "returnIt",
      label: "Return it to the shop",
      description: "Hand back the item that isn't yours.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "Shop owner is appreciative",
        "Straightened out",
        "Minor hassle",
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }],
        []
      ),
    },
    {
      id: "keepIt",
      label: "Keep the nicer item",
      description: "It's better than what you brought in.",
      outcomeTable: threeTierTable(
        "Nobody catches it",
        "Small upgrade",
        "Shop calls you out",
        [{ type: "personalWealth", deltaAnchor: 2_000 }],
        [{ type: "personalWealth", deltaAnchor: 1_000 }],
        [{ type: "infamy", delta: 1 }]
      ),
    },
    {
      id: "swapBack",
      label: "Swap it back",
      description: "Exchange it for your own item.",
      outcomeTable: threeTierTable(
        "Quietly resolved",
        "Sorted without fuss",
        "Owner already sold yours",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "ignore",
      label: "Keep it and say nothing",
      description: "Let the mistake stand.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Slips by",
        "Shop sends a note",
        "Reviewed on camera",
        [],
        [],
        [{ type: "infamy", delta: 1 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.communityGarden",
  defaultOptionId: "pass",
  options: [
    {
      id: "takePlot",
      label: "Claim the plot",
      description: "Sign up for the last open bed.",
      primaryStat: "energy",
      outcomeTable: threeTierTable(
        "Thriving patch",
        "Decent season",
        "Tomatoes struggle",
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "sharePlot",
      label: "Split it with a neighbor",
      description: "Co-tend the plot together.",
      outcomeTable: threeTierTable(
        "Shared harvest",
        "Friendly arrangement",
        "Chore friction",
        [{ type: "favorability", delta: 3 }],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "donateFee",
      label: "Pay the fee and give the plot away",
      description: "Cover the cost for someone else to take it.",
      outcomeTable: threeTierTable(
        "Generous move",
        "Quiet help",
        "Nice enough",
        [
          { type: "favorability", delta: 2 },
          { type: "personalWealth", deltaAnchor: -500 },
        ],
        [
          { type: "favorability", delta: 1 },
          { type: "personalWealth", deltaAnchor: -500 },
        ],
        [
          { type: "favorability", delta: 1 },
          { type: "personalWealth", deltaAnchor: -500 },
        ]
      ),
    },
    {
      id: "pass",
      label: "Pass on it",
      description: "Let someone else take the bed.",
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
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.propertyReassessment",
  defaultOptionId: "ignore",
  options: [
    {
      id: "appeal",
      label: "Appeal the assessment",
      description: "Challenge the new valuation.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "Valuation rolled back",
        "Small reduction",
        "Appeal denied",
        [{ type: "personalWealth", deltaAnchor: 5_000 }],
        [],
        [{ type: "personalWealth", deltaAnchor: -2_000 }]
      ),
    },
    {
      id: "payUp",
      label: "Pay the new tax bill",
      description: "Accept the reassessment.",
      outcomeTable: threeTierTable(
        "Bill settled",
        "Bill settled",
        "Bill settled",
        [{ type: "personalWealth", deltaAnchor: -4_000 }],
        [{ type: "personalWealth", deltaAnchor: -4_000 }],
        [{ type: "personalWealth", deltaAnchor: -4_000 }]
      ),
    },
    {
      id: "negotiate",
      label: "Ask to phase it in",
      description: "Request a staged increase.",
      outcomeTable: threeTierTable(
        "Phase-in granted",
        "Partial relief",
        "No give",
        [{ type: "personalWealth", deltaAnchor: -2_000 }],
        [{ type: "personalWealth", deltaAnchor: -3_000 }],
        [{ type: "personalWealth", deltaAnchor: -4_000 }]
      ),
    },
    {
      id: "ignore",
      label: "Set it aside",
      description: "Deal with it later.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "No penalties yet",
        "Reminder arrives",
        "Late penalties stack",
        [{ type: "personalWealth", deltaAnchor: -4_000 }],
        [{ type: "personalWealth", deltaAnchor: -4_000 }],
        [{ type: "personalWealth", deltaAnchor: -5_000 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.parkingTicket",
  defaultOptionId: "ignore",
  options: [
    {
      id: "contestIt",
      label: "Contest the ticket",
      description: "Fight it at the hearing.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "Ticket thrown out",
        "Reduced fine",
        "Upheld, plus your time",
        [{ type: "personalWealth", deltaAnchor: 150 }],
        [],
        [{ type: "personalWealth", deltaAnchor: -50 }]
      ),
    },
    {
      id: "payIt",
      label: "Just pay it",
      description: "Write the check and move on.",
      outcomeTable: threeTierTable(
        "Handled",
        "Handled",
        "Handled",
        [{ type: "personalWealth", deltaAnchor: -75 }],
        [{ type: "personalWealth", deltaAnchor: -75 }],
        [{ type: "personalWealth", deltaAnchor: -75 }]
      ),
    },
    {
      id: "volunteerTime",
      label: "Do community service to clear it",
      description: "Work it off instead of paying.",
      outcomeTable: threeTierTable(
        "Fine waived",
        "Counts toward the fine",
        "Goodwill earned",
        [{ type: "favorability", delta: 1 }],
        [{ type: "favorability", delta: 1 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "ignore",
      label: "Stuff it in the glovebox",
      description: "Ignore it and hope.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Slips through",
        "Late fee added",
        "Towed and booted",
        [{ type: "personalWealth", deltaAnchor: -75 }],
        [{ type: "personalWealth", deltaAnchor: -150 }],
        [{ type: "personalWealth", deltaAnchor: -300 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.lostDogReward",
  defaultOptionId: "leaveIt",
  options: [
    {
      id: "searchAndReturn",
      label: "Find the owner and return it",
      description: "Call the number on the tag.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Owner overjoyed",
        "Reunited",
        "Owner relieved",
        [
          { type: "favorability", delta: 4 },
          { type: "personalWealth", deltaAnchor: 500 },
        ],
        [
          { type: "favorability", delta: 2 },
          { type: "personalWealth", deltaAnchor: 500 },
        ],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "returnToShelter",
      label: "Drop it at the shelter",
      description: "Let the shelter handle the reunion.",
      outcomeTable: threeTierTable(
        "Shelter praises you",
        "Sensible move",
        "Quiet handoff",
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }],
        []
      ),
    },
    {
      id: "keepIt",
      label: "Keep the dog",
      description: "Take it home instead.",
      outcomeTable: threeTierTable(
        "Nobody comes looking",
        "You have a dog now",
        "Owner tracks you down",
        [{ type: "favorability", delta: 1 }],
        [],
        [{ type: "infamy", delta: 2 }]
      ),
    },
    {
      id: "leaveIt",
      label: "Leave it wandering",
      description: "Not your problem.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "It wanders off",
        "Neighbor frowns",
        "Kids see you walk past",
        [],
        [{ type: "favorability", delta: -1 }],
        [{ type: "favorability", delta: -2 }]
      ),
    },
  ],
  applyEffects: apply,
});
