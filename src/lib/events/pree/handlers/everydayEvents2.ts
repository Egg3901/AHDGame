/**
 * Everyday global player random events — POLITICIAN / IN ELECTION / CEO
 * handlers, continued from everydayEvents.ts (pure code motion to keep that
 * module under the architecture-audit size cap). Same rules apply: option ids
 * and `defaultOptionId` MUST stay in lockstep with the matching seed
 * definition in `seedDefinitions.ts`.
 *
 * Loaded by src/lib/events/pree/index.ts immediately after everydayEvents.ts
 * so registration order is unchanged.
 */
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { buildCeoCorpPayload, buildElectionPayload } from "../payload";
import { apply } from "./everydayEvents";
import { threeTierTable } from "./tiers";

// ── POLITICIAN ───────────────────────────────────────────────────────────────

registerEventHandler({
  kind: "pree.civicAwardNomination",
  defaultOptionId: "ignore",
  options: [
    {
      id: "accept",
      label: "Accept graciously",
      description: "Say yes and give a short speech.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Crowd warms to you",
        "Polite applause",
        "Perfunctory thanks",
        [{ type: "favorability", delta: 5 }],
        [{ type: "favorability", delta: 3 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "attendQuietly",
      label: "Attend without a speech",
      description: "Show up, accept, say little.",
      outcomeTable: threeTierTable(
        "Modest presence noted",
        "Quiet dignity",
        "Barely noticed",
        [{ type: "favorability", delta: 3 }],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "declineHumbly",
      label: "Decline humbly",
      description: "Step aside for someone else.",
      outcomeTable: threeTierTable(
        "Classy move",
        "Polite refusal",
        "No fanfare",
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }],
        []
      ),
    },
    {
      id: "ignore",
      label: "Don't respond",
      description: "Leave the organizers hanging.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Nobody minds",
        "Mild snub",
        "Committee is offended",
        [],
        [{ type: "favorability", delta: -1 }],
        [{ type: "favorability", delta: -2 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.paradeMarshal",
  defaultOptionId: "skip",
  options: [
    {
      id: "lead",
      label: "Be grand marshal",
      description: "Lead the parade in person.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Crowd loves it",
        "Solid turnout",
        "Rain dampens the optics",
        [{ type: "favorability", delta: 4 }],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "rideAlong",
      label: "Ride in a car in the parade",
      description: "Wave from a vehicle instead of walking.",
      outcomeTable: threeTierTable(
        "Friendly wave",
        "Seen by the crowd",
        "Low energy",
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }],
        []
      ),
    },
    {
      id: "sendStaffer",
      label: "Send a staffer",
      description: "Have an aide represent you.",
      outcomeTable: threeTierTable(
        "Capable stand-in",
        "Acceptable proxy",
        "Crowd wanted you",
        [],
        [{ type: "favorability", delta: -1 }],
        [{ type: "favorability", delta: -2 }]
      ),
    },
    {
      id: "skip",
      label: "Skip the parade",
      description: "Stay off the route.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Quiet day",
        "Mild absence noted",
        "Locals notice you're missing",
        [],
        [{ type: "favorability", delta: -1 }],
        [{ type: "favorability", delta: -2 }]
      ),
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.opEdOffer",
  defaultOptionId: "ignore",
  options: [
    {
      id: "writeIt",
      label: "Write it yourself",
      description: "Pen the piece in your own words.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "Sharp and widely shared",
        "Solid argument",
        "Workmanlike",
        [
          { type: "favorability", delta: 4 },
          { type: "politicalInfluence", delta: 2 },
        ],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "ghostwrite",
      label: "Have staff write it",
      description: "Sign your name to a drafted piece.",
      outcomeTable: threeTierTable(
        "Clean draft",
        "Serviceable",
        "Reads as boilerplate",
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "decline",
      label: "Decline the offer",
      description: "Pass on the column.",
      outcomeTable: threeTierTable("No harm done", "Page moves on", "Editor shrugs", [], [], []),
    },
    {
      id: "ignore",
      label: "Don't reply",
      description: "Let the offer lapse.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Quietly dropped",
        "Editor follows up",
        "Offer goes elsewhere",
        [],
        [],
        []
      ),
    },
  ],
  applyEffects: apply,
});

// ── IN ELECTION ──────────────────────────────────────────────────────────────

registerEventHandler({
  kind: "pree.candidateForum",
  defaultOptionId: "skip",
  options: [
    {
      id: "showUp",
      label: "Show up and take questions",
      description: "Attend the forum in person.",
      primaryStat: "debate",
      outcomeTable: threeTierTable(
        "You command the room",
        "Solid showing",
        "A question trips you up",
        [
          { type: "campaignSupport", delta: 4 },
          { type: "favorability", delta: 1 },
        ],
        [{ type: "campaignSupport", delta: 2 }],
        [
          { type: "campaignSupport", delta: 1 },
          { type: "favorability", delta: -1 },
        ]
      ),
    },
    {
      id: "sendStatement",
      label: "Send a written statement",
      description: "Submit your positions instead of attending.",
      outcomeTable: threeTierTable(
        "Statement lands",
        "Reads fine",
        "Crowd wanted you there",
        [{ type: "campaignSupport", delta: 2 }],
        [{ type: "campaignSupport", delta: 1 }],
        []
      ),
    },
    {
      id: "surrogate",
      label: "Send a surrogate",
      description: "Have a supporter speak for you.",
      outcomeTable: threeTierTable(
        "Surrogate does well",
        "Neutral proxy",
        "Opponent outshines them",
        [{ type: "campaignSupport", delta: 1 }],
        [],
        [{ type: "campaignSupport", delta: -1 }]
      ),
    },
    {
      id: "skip",
      label: "Skip the forum",
      description: "Don't participate.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "No one notices",
        "Absence noted",
        "Opponent owns the stage",
        [],
        [{ type: "campaignSupport", delta: -1 }],
        [
          { type: "campaignSupport", delta: -3 },
          { type: "favorability", delta: -1 },
        ]
      ),
    },
  ],
  async buildPayload(ctx) {
    return buildElectionPayload(ctx);
  },
  applyEffects: apply,
});

// ── CEO ──────────────────────────────────────────────────────────────────────

registerEventHandler({
  kind: "pree.minorLeagueSponsor",
  defaultOptionId: "pass",
  options: [
    {
      id: "signDeal",
      label: "Sign the sponsorship",
      description: "Put your name on the stadium wall.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Big local brand lift",
        "Solid community PR",
        "Polite acknowledgment",
        [
          { type: "corpSentiment", delta: 4 },
          { type: "favorability", delta: 2 },
          { type: "personalWealth", deltaAnchor: -50_000 },
        ],
        [
          { type: "corpSentiment", delta: 2 },
          { type: "personalWealth", deltaAnchor: -50_000 },
        ],
        [
          { type: "corpSentiment", delta: 1 },
          { type: "personalWealth", deltaAnchor: -50_000 },
        ]
      ),
    },
    {
      id: "smallAd",
      label: "Buy a small ad package",
      description: "A modest program ad and a banner.",
      outcomeTable: threeTierTable(
        "Reasonable exposure",
        "Decent visibility",
        "Barely seen",
        [
          { type: "corpSentiment", delta: 2 },
          { type: "personalWealth", deltaAnchor: -15_000 },
        ],
        [
          { type: "corpSentiment", delta: 1 },
          { type: "personalWealth", deltaAnchor: -15_000 },
        ],
        [
          { type: "corpSentiment", delta: 1 },
          { type: "personalWealth", deltaAnchor: -15_000 },
        ]
      ),
    },
    {
      id: "inKind",
      label: "Donate goods instead of cash",
      description: "Supply the team in kind.",
      outcomeTable: threeTierTable(
        "Team and fans appreciate it",
        "Helpful contribution",
        "Token support",
        [
          { type: "favorability", delta: 2 },
          { type: "corpSentiment", delta: 1 },
        ],
        [{ type: "favorability", delta: 1 }],
        []
      ),
    },
    {
      id: "pass",
      label: "Pass on the deal",
      description: "Skip the sponsorship.",
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
  buildPayload: buildCeoCorpPayload,
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.tradeAssociationBoard",
  defaultOptionId: "ignore",
  options: [
    {
      id: "acceptSeat",
      label: "Accept the board seat",
      description: "Take the role and attend regularly.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Industry influence grows",
        "Useful connections",
        "Seated quietly",
        [
          { type: "corpSentiment", delta: 3 },
          { type: "politicalInfluence", delta: 1 },
        ],
        [{ type: "corpSentiment", delta: 2 }],
        [{ type: "corpSentiment", delta: 1 }]
      ),
    },
    {
      id: "attendOccasionally",
      label: "Attend occasionally",
      description: "Take the seat but show up rarely.",
      outcomeTable: threeTierTable(
        "Light engagement",
        "Sporadic presence",
        "Name on a list",
        [{ type: "corpSentiment", delta: 2 }],
        [{ type: "corpSentiment", delta: 1 }],
        []
      ),
    },
    {
      id: "decline",
      label: "Decline the seat",
      description: "Pass on the offer.",
      outcomeTable: threeTierTable(
        "No obligation",
        "Polite refusal",
        "Seat goes to a rival",
        [],
        [],
        []
      ),
    },
    {
      id: "ignore",
      label: "Don't respond",
      description: "Let the invitation lapse.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Quietly dropped",
        "Follow-up arrives",
        "Offered to someone else",
        [],
        [],
        []
      ),
    },
  ],
  buildPayload: buildCeoCorpPayload,
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.viralReview",
  defaultOptionId: "ignoreReview",
  options: [
    {
      id: "engagePublicly",
      label: "Respond publicly",
      description: "Reply in the open, fast.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Response wins fans",
        "Reputation steadied",
        "Reply reads tone deaf",
        [{ type: "corpSentiment", delta: 5 }],
        [{ type: "corpSentiment", delta: 2 }],
        [{ type: "corpSentiment", delta: -3 }]
      ),
    },
    {
      id: "refundReplace",
      label: "Quietly make it right",
      description: "Refund and replace without a fuss.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Customer flips to a fan",
        "Problem contained",
        "Cost absorbed",
        [{ type: "corpSentiment", delta: 3 }],
        [{ type: "corpSentiment", delta: 2 }],
        [{ type: "corpSentiment", delta: 1 }]
      ),
    },
    {
      id: "ignoreReview",
      label: "Ignore it",
      description: "Let the review sit.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Fades quickly",
        "Lingers in search",
        "Others pile on",
        [],
        [{ type: "corpSentiment", delta: -1 }],
        [{ type: "corpSentiment", delta: -3 }]
      ),
    },
    {
      id: "lawyerUp",
      label: "Threaten legal action",
      description: "Send a cease and desist to the reviewer.",
      outcomeTable: threeTierTable(
        "Review pulled",
        "Streisand effect brews",
        "Backlash is brutal",
        [{ type: "corpSentiment", delta: -2 }],
        [{ type: "corpSentiment", delta: -4 }],
        [
          { type: "corpSentiment", delta: -6 },
          { type: "infamy", delta: 3 },
        ]
      ),
    },
  ],
  buildPayload: buildCeoCorpPayload,
  applyEffects: apply,
});

registerEventHandler({
  kind: "pree.officeLeaseRenewal",
  defaultOptionId: "monthToMonth",
  options: [
    {
      id: "renew",
      label: "Renew at the asking rent",
      description: "Sign a long lease at the new rate.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Stable home for the firm",
        "Predictable overhead",
        "Pricey but settled",
        [{ type: "personalWealth", deltaAnchor: -40_000 }],
        [{ type: "personalWealth", deltaAnchor: -40_000 }],
        [{ type: "personalWealth", deltaAnchor: -40_000 }]
      ),
    },
    {
      id: "renegotiate",
      label: "Push back on the hike",
      description: "Negotiate the rent down.",
      outcomeTable: threeTierTable(
        "Landlord concedes",
        "Small reduction",
        "Landlord holds firm",
        [{ type: "personalWealth", deltaAnchor: -28_000 }],
        [{ type: "personalWealth", deltaAnchor: -34_000 }],
        [{ type: "personalWealth", deltaAnchor: -40_000 }]
      ),
    },
    {
      id: "relocate",
      label: "Move to cheaper space",
      description: "Relocate the office entirely.",
      outcomeTable: threeTierTable(
        "Better deal found",
        "Comparable space, less rent",
        "Moving costs add up",
        [
          { type: "personalWealth", deltaAnchor: -15_000 },
          { type: "corpSentiment", delta: 1 },
        ],
        [{ type: "personalWealth", deltaAnchor: -20_000 }],
        [
          { type: "personalWealth", deltaAnchor: -30_000 },
          { type: "corpSentiment", delta: -1 },
        ]
      ),
    },
    {
      id: "monthToMonth",
      label: "Go month to month",
      description: "Roll forward without a new lease.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Flexibility kept",
        "Premium for the privilege",
        "Landlord hints at a replacement",
        [{ type: "personalWealth", deltaAnchor: -10_000 }],
        [{ type: "personalWealth", deltaAnchor: -12_000 }],
        [
          { type: "personalWealth", deltaAnchor: -15_000 },
          { type: "corpSentiment", delta: -1 },
        ]
      ),
    },
  ],
  buildPayload: buildCeoCorpPayload,
  applyEffects: apply,
});
