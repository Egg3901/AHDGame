/**
 * Random development events. Each presents a decision with real tradeoffs;
 * an unanswered event applies its default choice at the deadline.
 * chargeFraction is a share of the product's investment target.
 */
import type { VentureEventChoice, VentureEventDef } from "./types";

function c(
  id: string,
  label: string,
  detail: string,
  qualityDelta: number,
  chargeFraction: number,
  delayTurns: number
): VentureEventChoice {
  return { id, label, detail, qualityDelta, chargeFraction, delayTurns };
}

const SCREEN_LINES = ["film", "television_series", "streaming_original", "cable_program"] as const;
const NEWS_LINES = ["newspaper_edition", "radio_program"] as const;
const VEHICLE_LINES = ["passenger_car", "truck", "commercial_vehicle"] as const;
const ELECTRONIC_LINES = [
  "consumer_electronics",
  "industrial_electronics",
  "electronic_components",
  "home_appliance",
] as const;

export const MEDIA_VENTURE_EVENTS: readonly VentureEventDef[] = [
  {
    id: "media_lead_walks",
    domain: "media",
    title: "Your lead talent walks",
    body: "The lead has left over a pay dispute. Production can recast, renegotiate, or continue without them.",
    lineIds: [...SCREEN_LINES, "music_release"],
    choices: [
      c(
        "recast",
        "Recast the role",
        "Costs 10% of the budget and adds 6 turns. No quality loss.",
        0,
        0.1,
        6
      ),
      c("renegotiate", "Meet their price", "Costs 15% of the budget. Quality holds.", 1, 0.15, 0),
      c("proceed", "Go on without them", "Free and on schedule. Quality drops 6 points.", -6, 0, 0),
    ],
    defaultChoiceId: "proceed",
  },
  {
    id: "media_early_buzz",
    domain: "media",
    title: "Critics are talking early",
    body: "A preview has people talking. You can feed it or let it run on its own.",
    choices: [
      c(
        "amplify",
        "Fund a preview push",
        "Costs 6% of the budget. Quality up 4 points.",
        4,
        0.06,
        0
      ),
      c("organic", "Let it grow", "Free. Quality up 2 points.", 2, 0, 0),
    ],
    defaultChoiceId: "organic",
  },
  {
    id: "media_rival_slot",
    domain: "media",
    title: "A rival title takes your slot",
    body: "A competitor has booked the same release window with a similar title.",
    lineIds: [...SCREEN_LINES, "music_release", "book"],
    choices: [
      c("move", "Move the date", "Adds 12 turns. No other cost.", 0, 0, 12),
      c(
        "hold",
        "Hold the date",
        "On schedule, but quality drops 4 points from the head-to-head.",
        -4,
        0,
        0
      ),
      c("counter", "Counter-program", "Costs 8% of the budget. Quality up 1 point.", 1, 0.08, 0),
    ],
    defaultChoiceId: "hold",
  },
  {
    id: "media_censorship_review",
    domain: "media",
    title: "A censorship review is opened",
    body: "Regulators have asked to review the content before release.",
    choices: [
      c("accept", "Accept the cuts", "Free and quick. Quality drops 3 points.", -3, 0, 0),
      c(
        "appeal",
        "Appeal the review",
        "Costs 7% of the budget and adds 10 turns. Content stays intact.",
        0,
        0.07,
        10
      ),
      c(
        "preedit",
        "Self-edit now",
        "Costs 3% of the budget and adds 3 turns. Quality drops 1 point.",
        -1,
        0.03,
        3
      ),
    ],
    defaultChoiceId: "accept",
  },
  {
    id: "media_leaked_script",
    domain: "media",
    title: "The script leaks",
    body: "Key plot points are public before you have shown anything.",
    lineIds: [...SCREEN_LINES, "book"],
    choices: [
      c(
        "rewrite",
        "Rewrite the ending",
        "Costs 6% of the budget and adds 8 turns. Quality up 2 points.",
        2,
        0.06,
        8
      ),
      c("shrug", "Ride it out", "Free. Quality drops 2 points.", -2, 0, 0),
      c("legal", "Pursue the leaker", "Costs 8% of the budget. Quality unchanged.", 0, 0.08, 0),
    ],
    defaultChoiceId: "shrug",
  },
  {
    id: "media_star_endorsement",
    domain: "media",
    title: "A public figure backs the title",
    body: "A well-known name has offered a public endorsement.",
    choices: [
      c(
        "accept_paid",
        "Make it an official partnership",
        "Costs 5% of the budget. Quality up 5 points.",
        5,
        0.05,
        0
      ),
      c("accept_free", "Take the mention", "Free. Quality up 2 points.", 2, 0, 0),
    ],
    defaultChoiceId: "accept_free",
  },
  {
    id: "media_equipment_failure",
    domain: "media",
    title: "Production equipment fails",
    body: "Key equipment has broken down mid-production.",
    lineIds: [...SCREEN_LINES, "music_release", "radio_program"],
    choices: [
      c("rush_replace", "Rush a replacement", "Costs 9% of the budget. No delay.", 0, 0.09, 0),
      c("wait_repair", "Wait for repair", "Adds 9 turns. No extra cost.", 0, 0, 9),
      c("work_around", "Work around it", "Free and on time. Quality drops 4 points.", -4, 0, 0),
    ],
    defaultChoiceId: "wait_repair",
  },
  {
    id: "media_big_scoop",
    domain: "media",
    title: "A major tip arrives",
    body: "A source has given you a story that could define the edition. It is not fully confirmed.",
    lineIds: [...NEWS_LINES],
    choices: [
      c(
        "publish",
        "Run it now",
        "Free and fast. Quality up 4 points, but a miss would hurt the title.",
        4,
        0,
        -4
      ),
      c("verify", "Verify first", "Adds 6 turns. Quality up 3 points.", 3, 0, 6),
      c("pass", "Pass on it", "Free. No change.", 0, 0, 0),
    ],
    defaultChoiceId: "verify",
  },
  {
    id: "media_test_screening",
    domain: "media",
    title: "Test audiences are mixed",
    body: "Early test audiences liked parts of it and disliked others.",
    lineIds: [...SCREEN_LINES, "book"],
    choices: [
      c(
        "rework",
        "Rework big sections",
        "Costs 12% of the budget and adds 12 turns. Quality up 6 points.",
        6,
        0.12,
        12
      ),
      c(
        "polish",
        "Polish at the edges",
        "Costs 3% of the budget. Quality up 2 points.",
        2,
        0.03,
        0
      ),
      c("release_asis", "Release as it stands", "Free. Quality drops 2 points.", -2, 0, 0),
    ],
    defaultChoiceId: "polish",
  },
  {
    id: "media_talent_dispute",
    domain: "media",
    title: "A creative dispute stalls work",
    body: "Your creative leads disagree on direction and work has slowed.",
    lineIds: [...SCREEN_LINES, "music_release", "book"],
    choices: [
      c(
        "mediate",
        "Bring in a mediator",
        "Costs 4% of the budget and adds 4 turns. Quality up 1 point.",
        1,
        0.04,
        4
      ),
      c("decide", "Make the call yourself", "Free. Quality drops 2 points.", -2, 0, 0),
      c("split", "Split the difference", "Adds 6 turns. Quality unchanged.", 0, 0, 6),
    ],
    defaultChoiceId: "decide",
  },
  {
    id: "media_sample_clearance",
    domain: "media",
    title: "A licensing claim arrives",
    body: "A rights holder says part of the work needs a license.",
    lineIds: ["music_release", "film", "streaming_original"],
    choices: [
      c("license", "Buy the license", "Costs 9% of the budget. Quality unchanged.", 0, 0.09, 0),
      c("replace", "Replace the material", "Adds 8 turns. Quality drops 2 points.", -2, 0, 8),
      c("drop", "Cut it", "Free and quick. Quality drops 4 points.", -4, 0, 0),
    ],
    defaultChoiceId: "replace",
  },
  {
    id: "media_festival_invite",
    domain: "media",
    title: "An invitation to a festival",
    body: "A festival wants to premiere the title.",
    lineIds: ["film", "music_release", "book", "streaming_original"],
    choices: [
      c(
        "attend",
        "Accept and prepare",
        "Costs 4% of the budget and adds 6 turns. Quality up 4 points.",
        4,
        0.04,
        6
      ),
      c("decline", "Decline", "Free. No change.", 0, 0, 0),
    ],
    defaultChoiceId: "decline",
  },
  {
    id: "media_advertiser_pressure",
    domain: "media",
    title: "A big advertiser objects",
    body: "A large advertiser wants changes to the content or it will pull spend.",
    lineIds: [...NEWS_LINES, "television_series", "cable_program"],
    choices: [
      c(
        "hold",
        "Hold the line",
        "Costs 5% of the budget in lost deals. Quality up 2 points.",
        2,
        0.05,
        0
      ),
      c("soften", "Soften the content", "Free. Quality drops 3 points.", -3, 0, 0),
    ],
    defaultChoiceId: "soften",
  },
  {
    id: "media_distribution_offer",
    domain: "media",
    title: "A distributor makes an offer",
    body: "A distributor wants exclusive terms, or you can pay for wider reach.",
    choices: [
      c(
        "exclusive",
        "Take the exclusive",
        "Free. Quality drops 1 point from narrower reach.",
        -1,
        0,
        0
      ),
      c("wide", "Pay for wide release", "Costs 10% of the budget. Quality up 3 points.", 3, 0.1, 0),
    ],
    defaultChoiceId: "exclusive",
  },
  {
    id: "media_crew_overtime",
    domain: "media",
    title: "The team is running out of hours",
    body: "The schedule is tight and the team is tired.",
    choices: [
      c(
        "pay_overtime",
        "Pay overtime",
        "Costs 5% of the budget and saves 6 turns. Quality up 1 point.",
        1,
        0.05,
        -6
      ),
      c("ease", "Ease the schedule", "Adds 8 turns. Quality up 1 point.", 1, 0, 8),
      c("push", "Push through", "Saves 6 turns. Quality drops 3 points.", -3, 0, -6),
    ],
    defaultChoiceId: "ease",
  },
];

export const MANUFACTURING_VENTURE_EVENTS: readonly VentureEventDef[] = [
  {
    id: "mfg_supplier_defect",
    domain: "manufacturing",
    title: "A supplier ships defective parts",
    body: "A batch of inputs failed inspection.",
    choices: [
      c(
        "reject",
        "Reject and reorder",
        "Costs 8% of the budget and adds 6 turns. Quality holds.",
        0,
        0.08,
        6
      ),
      c(
        "rework",
        "Rework in house",
        "Costs 4% of the budget. Quality drops 2 points.",
        -2,
        0.04,
        0
      ),
      c("accept", "Use them anyway", "Free and on time. Quality drops 6 points.", -6, 0, 0),
    ],
    defaultChoiceId: "rework",
  },
  {
    id: "mfg_safety_failure",
    domain: "manufacturing",
    title: "A test unit fails a safety check",
    body: "A prototype failed an internal safety test.",
    lineIds: [...VEHICLE_LINES, "home_appliance", "consumer_electronics", "industrial_electronics"],
    choices: [
      c(
        "redesign",
        "Redesign the part",
        "Costs 12% of the budget and adds 12 turns. Quality up 5 points.",
        5,
        0.12,
        12
      ),
      c(
        "shield",
        "Add protective features",
        "Costs 6% of the budget and adds 4 turns. Quality up 1 point.",
        1,
        0.06,
        4
      ),
      c("document", "Document and ship", "Free. Quality drops 5 points.", -5, 0, 0),
    ],
    defaultChoiceId: "shield",
  },
  {
    id: "mfg_patent_dispute",
    domain: "manufacturing",
    title: "A patent claim is filed",
    body: "A competitor says part of your design infringes its patent.",
    lineIds: [...ELECTRONIC_LINES, ...VEHICLE_LINES, "specialty_steel"],
    choices: [
      c("license", "Pay for a license", "Costs 11% of the budget. Quality unchanged.", 0, 0.11, 0),
      c("design_around", "Design around it", "Adds 10 turns. Quality drops 1 point.", -1, 0, 10),
      c(
        "fight",
        "Contest the claim",
        "Costs 5% of the budget. Quality drops 3 points from distraction.",
        -3,
        0.05,
        0
      ),
    ],
    defaultChoiceId: "design_around",
  },
  {
    id: "mfg_breakthrough",
    domain: "manufacturing",
    title: "Engineers find a better process",
    body: "The team has found a way to improve the design.",
    choices: [
      c(
        "adopt",
        "Adopt it now",
        "Costs 5% of the budget and adds 4 turns. Quality up 6 points.",
        6,
        0.05,
        4
      ),
      c("partial", "Adopt part of it", "Free. Quality up 3 points.", 3, 0, 0),
    ],
    defaultChoiceId: "partial",
  },
  {
    id: "mfg_input_spike",
    domain: "manufacturing",
    title: "Input prices spike",
    body: "A key input has jumped in price.",
    choices: [
      c("absorb", "Absorb the cost", "Costs 9% of the budget. Quality holds.", 0, 0.09, 0),
      c("substitute", "Substitute cheaper inputs", "Free. Quality drops 4 points.", -4, 0, 0),
      c("wait", "Wait for prices to ease", "Adds 8 turns. No extra cost.", 0, 0, 8),
    ],
    defaultChoiceId: "wait",
  },
  {
    id: "mfg_regulator_inspection",
    domain: "manufacturing",
    title: "A regulator inspects the plant",
    body: "An inspection has been called on the line behind this product.",
    choices: [
      c(
        "cooperate",
        "Open the books",
        "Costs 3% of the budget and adds 4 turns. Quality up 1 point.",
        1,
        0.03,
        4
      ),
      c("minimal", "Provide the minimum", "Free. Quality drops 3 points from findings.", -3, 0, 0),
      c(
        "prepare",
        "Run a pre-inspection",
        "Costs 6% of the budget and adds 2 turns. Quality up 2 points.",
        2,
        0.06,
        2
      ),
    ],
    defaultChoiceId: "minimal",
  },
  {
    id: "mfg_labor_dispute",
    domain: "manufacturing",
    title: "A labor dispute on the line",
    body: "Workers on the product line are asking for better terms.",
    choices: [
      c("raise", "Meet the demand", "Costs 8% of the budget. Quality up 1 point.", 1, 0.08, 0),
      c("negotiate", "Negotiate", "Adds 8 turns. Quality unchanged.", 0, 0, 8),
      c("refuse", "Refuse", "Free. Quality drops 4 points from slower work.", -4, 0, 0),
    ],
    defaultChoiceId: "negotiate",
  },
  {
    id: "mfg_tooling_failure",
    domain: "manufacturing",
    title: "Tooling wears out early",
    body: "Production tooling needs replacing sooner than planned.",
    choices: [
      c("replace", "Replace the tooling", "Costs 10% of the budget. No delay.", 0, 0.1, 0),
      c("repair", "Repair it", "Costs 3% of the budget and adds 6 turns.", 0, 0.03, 6),
      c("continue", "Run it worn", "Free. Quality drops 4 points.", -4, 0, 0),
    ],
    defaultChoiceId: "repair",
  },
  {
    id: "mfg_competitor_teardown",
    domain: "manufacturing",
    title: "A rival ships something similar",
    body: "A competitor has released a close match to your design.",
    choices: [
      c(
        "differentiate",
        "Differentiate the design",
        "Costs 7% of the budget and adds 6 turns. Quality up 3 points.",
        3,
        0.07,
        6
      ),
      c("price", "Plan to undercut", "Free. Quality drops 2 points.", -2, 0, 0),
      c("ignore", "Stay the course", "Free. No change.", 0, 0, 0),
    ],
    defaultChoiceId: "ignore",
  },
  {
    id: "mfg_certification_delay",
    domain: "manufacturing",
    title: "Certification is delayed",
    body: "The body that certifies this product has a backlog.",
    choices: [
      c("expedite", "Pay to expedite", "Costs 6% of the budget. No delay.", 0, 0.06, 0),
      c("wait", "Wait your turn", "Adds 10 turns. No extra cost.", 0, 0, 10),
    ],
    defaultChoiceId: "wait",
  },
  {
    id: "mfg_pilot_yield",
    domain: "manufacturing",
    title: "Pilot run yields are low",
    body: "The pilot run produced fewer good units than planned.",
    choices: [
      c(
        "tune",
        "Tune the process",
        "Costs 6% of the budget and adds 6 turns. Quality up 3 points.",
        3,
        0.06,
        6
      ),
      c("accept", "Accept the yield", "Free. Quality drops 3 points.", -3, 0, 0),
    ],
    defaultChoiceId: "tune",
  },
  {
    id: "mfg_design_flaw",
    domain: "manufacturing",
    title: "Testing finds a design flaw",
    body: "A flaw in the design shows up under load.",
    choices: [
      c(
        "fix_now",
        "Fix it properly",
        "Costs 9% of the budget and adds 10 turns. Quality up 4 points.",
        4,
        0.09,
        10
      ),
      c("patch", "Patch around it", "Costs 2% of the budget. Quality drops 1 point.", -1, 0.02, 0),
      c("ship", "Leave it", "Free. Quality drops 6 points.", -6, 0, 0),
    ],
    defaultChoiceId: "patch",
  },
  {
    id: "mfg_customer_pilot",
    domain: "manufacturing",
    title: "A large buyer offers to pilot it",
    body: "A big customer wants an early pilot of the product.",
    choices: [
      c(
        "pilot",
        "Run the pilot",
        "Costs 4% of the budget and adds 4 turns. Quality up 4 points.",
        4,
        0.04,
        4
      ),
      c("decline", "Decline", "Free. No change.", 0, 0, 0),
    ],
    defaultChoiceId: "decline",
  },
  {
    id: "mfg_material_substitution",
    domain: "manufacturing",
    title: "A material becomes scarce",
    body: "A specified material is hard to get this month.",
    lineIds: [
      "structural_steel",
      "sheet_steel",
      "specialty_steel",
      "cement",
      "prefabricated_components",
      "construction_materials",
      "cookware_hardware",
    ],
    choices: [
      c(
        "secure",
        "Secure supply at a premium",
        "Costs 7% of the budget. Quality holds.",
        0,
        0.07,
        0
      ),
      c("substitute", "Change the specification", "Free. Quality drops 3 points.", -3, 0, 0),
      c("stockpile_wait", "Wait for supply", "Adds 8 turns. No extra cost.", 0, 0, 8),
    ],
    defaultChoiceId: "stockpile_wait",
  },
  {
    id: "mfg_warranty_review",
    domain: "manufacturing",
    title: "Warranty cost estimates come back high",
    body: "Finance expects higher returns than planned.",
    lineIds: [...VEHICLE_LINES, ...ELECTRONIC_LINES],
    choices: [
      c(
        "strengthen",
        "Strengthen the design",
        "Costs 8% of the budget and adds 6 turns. Quality up 3 points.",
        3,
        0.08,
        6
      ),
      c("reserve", "Set aside a reserve", "Costs 4% of the budget. Quality unchanged.", 0, 0.04, 0),
    ],
    defaultChoiceId: "reserve",
  },
];

export const VENTURE_EVENTS: readonly VentureEventDef[] = [
  ...MEDIA_VENTURE_EVENTS,
  ...MANUFACTURING_VENTURE_EVENTS,
];
