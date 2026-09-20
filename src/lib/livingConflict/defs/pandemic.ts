import type { GlobalResponseOutcome } from "@/lib/db/types/crisis";
import type {
  ConflictEvent,
  ConflictRole,
  EventResponseDefinition,
  LivingConflictDef,
  RoleContext,
  RoleDecisionTrees,
} from "../types";
import { cfx } from "../effects";
import { choiceNode, opt, responseOpt } from "../authoring";

// Primary historical anchors: WHO's dated response timeline covers emergence,
// PHEIC and pandemic declarations, research, variants, COVAX, and vaccine
// distribution, https://www.who.int/emergencies/diseases/novel-coronavirus-2019/interactive-timeline,
// with the archived early chronology at
// https://www.who.int/news/item/27-04-2020-who-timeline---covid-19

/**
 * Pandemic: the proof that the living-conflict engine is not war-specific.
 *
 * A novel pathogen is one persistent, phased event, not a wall of one-off crises.
 * It is paced by contagion pressure and time-in-phase (minDwellTurns), not by a
 * historical calendar, which is the pandemic's answer to Vietnam's earliestYear
 * floor. Every nation acts through its ROLE:
 *
 *  - `belligerent` — a nation in the thick of the outbreak (its epicentres).
 *  - `neighbor`    — a bordering / heavily-exposed nation.
 *  - `bloc`        — a close trade partner, exposed through commerce not contact.
 *  - `bystander`   — everyone else, who can still send aid or shut borders.
 *
 * The responses are not cosmetic: a nation that locks down relieves contagion
 * pressure (slowing the climb) at an economic cost; one that stays open keeps its
 * economy but lets the pressure build. Player choices bend the trajectory.
 */

function pandemicRole(ctx: RoleContext): ConflictRole {
  if (ctx.belligerents.includes(ctx.countryId)) return "belligerent";
  if (ctx.neighbors.includes(ctx.countryId)) return "neighbor";
  if (ctx.blocMembers.includes(ctx.countryId)) return "bloc";
  return "bystander";
}

// Shared response menus, scaled per phase by the caller. Lockdown trades economy
// for health and slows the disease; open trades health for economy.
const lockdown = (gdp: number, health: number) =>
  opt("lockdown", "Impose a lockdown", "Shutter public life to break transmission chains.", [
    cfx("flat", "metric", "economy", "gdpGrowth", gdp, "Lockdown output loss"),
    cfx("tick", "metric", "society", "publicHealth", health, "Transmission slows"),
    cfx("tick", "approval", "government", "overall", -0.02, "Lockdown fatigue"),
  ]);

const vaccinate = (cost: number, health: number) =>
  opt("vaccinate", "Fund mass vaccination", "Pour the budget into a vaccination drive.", [
    cfx("flat", "metric", "economy", "gdpGrowth", cost, "Emergency health spending"),
    cfx("tick", "metric", "society", "publicHealth", health, "Immunity builds"),
    cfx("tick", "approval", "government", "overall", 0.02, "Seen to be acting"),
  ]);

const stayOpen = (health: number) =>
  opt("open", "Keep the economy open", "Refuse restrictions and let the outbreak run.", [
    cfx("tick", "metric", "society", "publicHealth", health, "Unchecked spread"),
    cfx("tick", "approval", "government", "overall", -0.03, "Bodies and blame"),
  ]);

const closeBorders = () =>
  opt("close_borders", "Close the borders", "Seal crossings and ground flights.", [
    cfx("flat", "metric", "economy", "gdpGrowth", -0.01, "Trade and travel collapse"),
    cfx("tick", "metric", "society", "publicHealth", 0.02, "Imported cases fall"),
  ]);

const sendAid = () =>
  opt("send_aid", "Send medical aid", "Ship supplies and specialists to the front line.", [
    cfx("flat", "metric", "economy", "gdpGrowth", -0.004, "Aid outlay"),
    cfx("tick", "approval", "government", "overall", 0.015, "Global goodwill"),
  ]);

function responseTrees(key: string): RoleDecisionTrees {
  return {
    belligerent: choiceNode(
      `${key}_afflicted`,
      "The outbreak tests state capacity",
      "The initially affected government must balance disclosure, containment, health capacity, and trust.",
      [
        responseOpt(
          "test_trace",
          "Build testing and surveillance",
          "Disclose findings, trace contacts, and expand genomic surveillance.",
          { surveillance: 4, cooperation: 2 },
          [],
          0.002
        ),
        responseOpt(
          "restrict",
          "Impose emergency restrictions",
          "Reduce contact sharply while funding household and business support.",
          { containment: 4, support: 2 },
          [cfx("tick", "approval", "government", "overall", -0.015, "Restriction fatigue")],
          0.015
        ),
        responseOpt(
          "downplay",
          "Keep society open",
          "Avoid restrictions and accept faster transmission.",
          { openness: 4 }
        ),
      ]
    ),
    backer_a: choiceNode(
      `${key}_research`,
      "Research powers coordinate",
      "Governments can pool research and manufacturing or reserve capacity for themselves.",
      [
        responseOpt(
          "research_pool",
          "Fund a shared research effort",
          "Pool trials, data, and advance purchases.",
          { research: 4, cooperation: 3 },
          [],
          0.006
        ),
        responseOpt(
          "national_program",
          "Fund a national vaccine program",
          "Prioritize domestic research and supply contracts.",
          { research: 3, nationalism: 3 },
          [],
          0.007
        ),
        responseOpt(
          "wait_for_market",
          "Wait for private development",
          "Limit public commitments and procurement risk.",
          { openness: 2 }
        ),
      ]
    ),
    backer_b: choiceNode(
      `${key}_manufacturing`,
      "Manufacturing capacity becomes strategic",
      "A major producer can expand global supply or reserve doses for geopolitical leverage.",
      [
        responseOpt(
          "expand_manufacturing",
          "Expand licensed manufacturing",
          "Finance plants and technology transfer across producers.",
          { manufacturing: 4, cooperation: 2 },
          [],
          0.005
        ),
        responseOpt(
          "vaccine_diplomacy",
          "Use bilateral vaccine diplomacy",
          "Reserve exports for selected partners.",
          { manufacturing: 2, nationalism: 3 },
          [],
          0.004
        ),
        responseOpt(
          "export_controls",
          "Restrict medical exports",
          "Protect domestic supply at the expense of global capacity.",
          { nationalism: 4 }
        ),
      ]
    ),
    neighbor: choiceNode(
      `${key}_exposed`,
      "Cases cross the border",
      "Exposed governments choose targeted control, broad restrictions, or minimal intervention.",
      [
        responseOpt(
          "targeted_controls",
          "Use targeted controls",
          "Combine testing, ventilation, isolation, and limited closures.",
          { surveillance: 3, containment: 2 },
          [],
          0.004
        ),
        responseOpt(
          "neighbor_lockdown",
          "Order a broad lockdown",
          "Suppress transmission with extensive fiscal support.",
          { containment: 4, support: 3 },
          [cfx("tick", "approval", "government", "overall", -0.012, "Restriction fatigue")],
          0.018
        ),
        responseOpt(
          "neighbor_open",
          "Rely on voluntary precautions",
          "Preserve activity while accepting greater health-system pressure.",
          { openness: 4 }
        ),
      ]
    ),
    bloc: choiceNode(
      `${key}_supply`,
      "Supply chains and health systems strain",
      "Trading partners decide whether to coordinate procurement and production.",
      [
        responseOpt(
          "joint_procurement",
          "Coordinate procurement",
          "Pool medical purchases and distribute scarce supplies by need.",
          { cooperation: 4, equity: 3 },
          [],
          0.004
        ),
        responseOpt(
          "domestic_priority",
          "Prioritize domestic contracts",
          "Secure national supply before sharing output.",
          { nationalism: 4, manufacturing: 1 },
          [],
          0.005
        ),
        responseOpt(
          "support_firms",
          "Support disrupted firms",
          "Use fiscal support to preserve employment and capacity.",
          { support: 4 },
          [],
          0.012
        ),
      ]
    ),
    bystander: choiceNode(
      `${key}_global`,
      "No government is fully insulated",
      "Later-hit governments can prepare, contribute, or free-ride.",
      [
        responseOpt(
          "prepare_capacity",
          "Expand health capacity",
          "Fund staffing, beds, stockpiles, and surveillance before the wave arrives.",
          { surveillance: 2, capacity: 4 },
          [],
          0.006
        ),
        responseOpt(
          "covax",
          "Fund equitable distribution",
          "Contribute doses and financing to the least-covered countries.",
          { equity: 4, cooperation: 3 },
          [],
          0.003
        ),
        responseOpt(
          "free_ride",
          "Limit commitments",
          "Preserve the treasury and rely on others to contain the threat.",
          { openness: 2, nationalism: 2 }
        ),
      ]
    ),
  };
}

const responseOutcomes: GlobalResponseOutcome[] = [
  {
    outcomeId: "contained_cluster",
    label: "Contained cluster",
    description:
      "Surveillance and coordinated containment suppress the first wave without eliminating future pandemic risk.",
    priority: 70,
    conditions: [
      { axis: "surveillance", min: 7 },
      { axis: "containment", min: 5 },
    ],
    intensityDelta: -10,
    trackDeltas: {
      transmission: -18,
      surveillance: 15,
      healthCapacity: 6,
      publicTrust: 6,
      supplyChainStrain: 2,
    },
    nextConflictStatus: "ceasefire",
    campaignDelta: { civilianStrain: -7, settlementMomentum: 10 },
    tensionDelta: -3,
    wireMessage: "Coordinated surveillance and containment suppress the immediate outbreak.",
  },
  {
    outcomeId: "research_acceleration",
    label: "Research acceleration",
    description:
      "Shared research and manufacturing commitments accelerate vaccines and therapeutics.",
    priority: 60,
    conditions: [
      { axis: "research", min: 6 },
      { axis: "manufacturing", min: 4 },
    ],
    intensityDelta: -4,
    trackDeltas: { vaccineResearch: 18, manufacturing: 12, publicTrust: 3, supplyChainStrain: -3 },
    campaignDelta: { settlementMomentum: 12, civilianStrain: -3 },
    tensionDelta: -2,
    wireMessage:
      "An international research and manufacturing effort accelerates medical countermeasures.",
  },
  {
    outcomeId: "equitable_rollout",
    label: "Equitable rollout",
    description:
      "Joint procurement and distribution raise immunity without leaving large reservoirs of transmission.",
    priority: 55,
    conditions: [
      { axis: "equity", min: 6 },
      { axis: "cooperation", min: 6 },
    ],
    intensityDelta: -8,
    trackDeltas: { distributionEquity: 16, immunity: 14, transmission: -10, publicTrust: 5 },
    campaignDelta: { civilianStrain: -6, settlementMomentum: 10 },
    tensionDelta: -3,
    wireMessage: "Coordinated vaccine distribution lifts immunity across exposed regions.",
  },
  {
    outcomeId: "supported_restrictions",
    label: "Supported restrictions",
    description:
      "Restrictions slow transmission while fiscal support limits household and firm damage.",
    priority: 50,
    conditions: [
      { axis: "containment", min: 7 },
      { axis: "support", min: 5 },
    ],
    intensityDelta: -7,
    trackDeltas: {
      transmission: -14,
      restrictionFatigue: 10,
      publicTrust: 2,
      supplyChainStrain: 7,
      healthCapacity: 5,
    },
    campaignDelta: { civilianStrain: 2, settlementMomentum: 5 },
    tensionDelta: -1,
    wireMessage: "Governments pair emergency restrictions with broad economic support.",
  },
  {
    outcomeId: "vaccine_nationalism",
    label: "Unequal medical rollout",
    description:
      "National programs advance supply but leave distribution gaps and persistent transmission reservoirs.",
    priority: 40,
    conditions: [{ axis: "nationalism", min: 7 }],
    intensityDelta: 3,
    trackDeltas: {
      vaccineResearch: 8,
      manufacturing: 7,
      distributionEquity: -10,
      immunity: 5,
      transmission: 4,
      publicTrust: -3,
    },
    campaignDelta: { civilianStrain: 4, regionalSpillover: 5 },
    tensionDelta: 4,
    wireMessage: "Vaccine nationalism creates sharp gaps in access and continuing transmission.",
  },
  {
    outcomeId: "uncontrolled_wave",
    label: "Uncontrolled wave",
    description:
      "Fragmented preparation and minimal intervention allow transmission to outrun health systems.",
    priority: 0,
    conditions: [],
    intensityDelta: 12,
    trackDeltas: {
      transmission: 16,
      healthCapacity: -12,
      publicTrust: -8,
      restrictionFatigue: 5,
      supplyChainStrain: 10,
    },
    campaignDelta: { casualties: 9, civilianStrain: 12, regionalSpillover: 8 },
    tensionDelta: 5,
    wireMessage: "A new pandemic wave outruns fragmented public-health responses.",
  },
];

function responseEvent(phase: string): ConflictEvent {
  const response: EventResponseDefinition = {
    windowTurns: 24,
    decisionTrees: responseTrees(phase),
    defaultOptionIdByRole: {
      belligerent: "test_trace",
      backer_a: "research_pool",
      backer_b: "expand_manufacturing",
      neighbor: "targeted_controls",
      bloc: "joint_procurement",
      bystander: "prepare_capacity",
    },
    outcomes: responseOutcomes,
    defaultOutcomeId: "uncontrolled_wave",
  };
  return {
    key: `${phase}_global_response`,
    kind: "authored",
    severity: phase === "pandemic" ? "critical" : "major",
    affects: "all",
    trigger: { onPhaseEnter: true, everyTurns: 24 },
    headline: "Governments coordinate the pandemic response",
    body: "Containment, fiscal support, research, manufacturing, and distribution choices will shape the next wave.",
    response,
  };
}

export const PANDEMIC_DEF: LivingConflictDef = {
  key: "pandemic",
  type: "pandemic",
  name: "Novel Pandemic",
  fromYear: 2018,
  untilYear: 2027,
  autoOpen: true,
  participants: {
    belligerents: ["CN"],
    neighbors: ["JP", "RU"],
    blocMembers: ["US", "UK", "DE", "FR", "IT"],
    bystanders: ["IE", "BR", "NG", "IN", "SE", "TR", "GR", "AT", "FI"],
  },
  participantFallbacks: {
    CN: ["IN", "JP"],
    US: ["UK", "DE", "FR"],
    RU: ["IN", "TR"],
  },
  roleResolver: pandemicRole,
  tracks: {
    transmission: { initial: 28 },
    surveillance: { initial: 18 },
    healthCapacity: { initial: 68 },
    publicTrust: { initial: 55 },
    restrictionFatigue: { initial: 0 },
    vaccineResearch: { initial: 0 },
    manufacturing: { initial: 8 },
    distributionEquity: { initial: 12 },
    supplyChainStrain: { initial: 5 },
    immunity: { initial: 0 },
  },
  scheduledPressures: [
    {
      key: "zoonotic_uncertainty",
      everyTurns: 12,
      phaseKeys: ["emergence", "outbreak"],
      trackDeltas: { transmission: 5, surveillance: 2 },
    },
    {
      key: "wave_pressure",
      everyTurns: 12,
      phaseKeys: ["pandemic", "containment"],
      trackDeltas: { transmission: 4, restrictionFatigue: 3, supplyChainStrain: 2 },
    },
    {
      key: "research_learning",
      everyTurns: 12,
      phaseKeys: ["outbreak", "pandemic", "containment"],
      trackDeltas: { vaccineResearch: 4, manufacturing: 2 },
    },
    {
      key: "endemic_immunity",
      everyTurns: 12,
      phaseKeys: ["endemic"],
      trackDeltas: { immunity: 2, transmission: -2, restrictionFatigue: -2 },
    },
  ],
  transitions: [
    {
      key: "sustained_outbreak",
      fromPhase: "emergence",
      toPhase: "outbreak",
      conditions: [{ track: "transmission", min: 45 }],
    },
    {
      key: "early_containment",
      fromPhase: "emergence",
      toPhase: "containment",
      toStatus: "ceasefire",
      priority: 80,
      conditions: [
        { track: "transmission", max: 18 },
        { track: "surveillance", min: 60 },
      ],
    },
    {
      key: "global_spread",
      fromPhase: "outbreak",
      toPhase: "pandemic",
      conditions: [
        { track: "transmission", min: 70 },
        { track: "healthCapacity", max: 50 },
      ],
    },
    {
      key: "outbreak_contained",
      fromPhase: "outbreak",
      toPhase: "containment",
      toStatus: "ceasefire",
      priority: 80,
      conditions: [
        { track: "transmission", max: 30 },
        { track: "surveillance", min: 55 },
      ],
    },
    {
      key: "medical_turn",
      fromPhase: "pandemic",
      toPhase: "containment",
      toStatus: "ceasefire",
      conditions: [
        { track: "transmission", max: 45 },
        { track: "immunity", min: 50 },
        { track: "healthCapacity", min: 45 },
      ],
    },
    {
      key: "endemic_transition",
      fromPhase: "containment",
      toPhase: "endemic",
      toStatus: "settled",
      conditions: [
        { track: "transmission", max: 25 },
        { track: "immunity", min: 68 },
      ],
    },
    {
      key: "renewed_wave",
      fromPhase: "containment",
      toPhase: "pandemic",
      toStatus: "active",
      priority: 100,
      conditions: [{ track: "transmission", min: 72 }],
    },
    {
      key: "endemic_escape",
      fromPhase: "endemic",
      toPhase: "pandemic",
      toStatus: "active",
      priority: 100,
      conditions: [
        { track: "transmission", min: 78 },
        { track: "immunity", max: 55 },
      ],
    },
  ],
  phases: [
    {
      level: 1,
      key: "emergence",
      label: "Emergence",
      summary: "An unfamiliar illness in a cluster of cases. Nobody is sure yet what it is.",
      advancePressure: 999,
      defcon: 5,
      decisionTrees: {
        belligerent: choiceNode(
          "emergence_afflicted",
          "An unexplained cluster",
          "Hospitals in the epicentre report a cluster of a severe, unfamiliar illness.",
          [
            opt(
              "investigate",
              "Launch an investigation",
              "Stand up a task force and sequence it.",
              [
                cfx("flat", "metric", "economy", "gdpGrowth", -0.002, "Emergency response cost"),
                cfx("tick", "metric", "society", "publicHealth", 0.01, "Early containment"),
              ]
            ),
            opt("downplay", "Downplay it", "Call it a bad flu season and avoid a panic.", [
              cfx("tick", "metric", "society", "publicHealth", -0.02, "Silent spread"),
            ]),
          ]
        ),
        neighbor: choiceNode(
          "emergence_neighbor",
          "Reports from across the border",
          "Worrying reports arrive from a neighbouring country.",
          [
            opt("monitor", "Monitor and prepare", "Ready hospitals and watch the border.", []),
            closeBorders(),
          ]
        ),
      },
      passiveEffects: {
        belligerent: [cfx("tick", "metric", "society", "publicHealth", -0.01, "Outbreak strain")],
      },
      events: [
        responseEvent("emergence"),
        {
          key: "patient_zero",
          kind: "authored",
          severity: "minor",
          affects: ["belligerent"],
          trigger: { onPhaseEnter: true },
          headline: "Cluster of unexplained illness reported",
          body: "Physicians in the epicentre flag a severe respiratory illness they cannot identify.",
        },
      ],
    },
    {
      level: 2,
      key: "outbreak",
      label: "Outbreak",
      summary: "Sustained local transmission. The illness has a name and a rising curve.",
      minDwellTurns: 3,
      advancePressure: 999,
      defcon: 4,
      decisionTrees: {
        belligerent: choiceNode(
          "outbreak_afflicted",
          "The curve is bending upward",
          "Cases are doubling. Intensive care is filling.",
          [lockdown(-0.02, 0.05), stayOpen(-0.05)]
        ),
        neighbor: choiceNode(
          "outbreak_neighbor",
          "Cases arrive at home",
          "The first imported cases are confirmed inside your borders.",
          [
            closeBorders(),
            opt("screen", "Screen travellers", "Test at the border, stay open.", [
              cfx("tick", "metric", "society", "publicHealth", 0.01, "Screening catches cases"),
            ]),
          ]
        ),
        bystander: choiceNode(
          "outbreak_bystander",
          "A distant outbreak",
          "The outbreak dominates the world's headlines.",
          [sendAid(), opt("wait", "Wait and see", "Take no action yet.", [])]
        ),
      },
      passiveEffects: {
        belligerent: [
          cfx("tick", "metric", "society", "publicHealth", -0.02, "Outbreak strain"),
          cfx("tick", "metric", "economy", "consumerConfidence", -0.015, "Fear dampens demand"),
        ],
        neighbor: [cfx("tick", "metric", "society", "publicHealth", -0.008, "Spillover cases")],
      },
      events: [
        responseEvent("outbreak"),
        {
          key: "who_declaration",
          kind: "authored",
          severity: "major",
          affects: "all",
          trigger: { onPhaseEnter: true },
          headline: "Global health emergency declared",
          body: "International authorities declare the outbreak a public health emergency of global concern.",
        },
        {
          key: "case_surge",
          kind: "procedural",
          severity: "major",
          affects: ["belligerent", "neighbor"],
          trigger: { everyTurns: 4, minIntensity: 30 },
          headline: "Case surge overwhelms hospitals",
          body: "A fresh wave pushes the health system past capacity in the worst-hit regions.",
          effects: {
            belligerent: [
              cfx("tick", "metric", "society", "publicHealth", -0.03, "Surge overload"),
            ],
          },
        },
      ],
    },
    {
      level: 3,
      key: "pandemic",
      label: "Pandemic",
      summary: "Global spread. Every region is counting cases and every economy is bleeding.",
      minDwellTurns: 4,
      advancePressure: 999,
      defcon: 3,
      decisionTrees: {
        belligerent: choiceNode(
          "pandemic_afflicted",
          "A nation under siege",
          "The pandemic is everywhere at once. The choice is how hard to fight it.",
          [lockdown(-0.035, 0.06), vaccinate(-0.02, 0.05), stayOpen(-0.06)]
        ),
        neighbor: choiceNode(
          "pandemic_neighbor",
          "Full spread at home",
          "Your own outbreak now rivals the epicentre's.",
          [lockdown(-0.03, 0.05), stayOpen(-0.05)]
        ),
        bloc: choiceNode(
          "pandemic_bloc",
          "Supply chains buckle",
          "Trade with the afflicted bloc has seized up.",
          [
            opt("subsidise", "Subsidise industry", "Cushion the shock to key sectors.", [
              cfx("flat", "metric", "economy", "gdpGrowth", -0.008, "Support outlay"),
            ]),
            opt("absorb", "Absorb the hit", "Let the market take it.", [
              cfx("tick", "metric", "economy", "gdpGrowth", -0.01, "Trade collapse"),
            ]),
          ]
        ),
        bystander: choiceNode(
          "pandemic_bystander",
          "No one is spared",
          "The pandemic has reached you too, later and lighter.",
          [vaccinate(-0.015, 0.04), stayOpen(-0.03)]
        ),
      },
      passiveEffects: {
        belligerent: [
          cfx("tick", "metric", "society", "publicHealth", -0.03, "Pandemic toll"),
          cfx("tick", "metric", "economy", "gdpGrowth", -0.012, "Economic seizure"),
        ],
        neighbor: [cfx("tick", "metric", "society", "publicHealth", -0.02, "Full outbreak")],
        bloc: [cfx("tick", "metric", "economy", "gdpGrowth", -0.006, "Trade disruption")],
        bystander: [cfx("tick", "metric", "society", "publicHealth", -0.008, "Late arrival")],
      },
      events: [
        responseEvent("pandemic"),
        {
          key: "variant",
          kind: "procedural",
          severity: "critical",
          affects: "all",
          trigger: { everyTurns: 6, minIntensity: 50 },
          headline: "A more transmissible variant emerges",
          body: "Sequencing confirms a variant that spreads faster and dodges some immunity.",
          effects: {
            belligerent: [cfx("flat", "metric", "society", "publicHealth", -0.03, "Variant wave")],
            neighbor: [cfx("flat", "metric", "society", "publicHealth", -0.02, "Variant wave")],
          },
        },
      ],
    },
    {
      level: 4,
      key: "containment",
      label: "Containment",
      summary: "Vaccines and immunity are turning the curve. The worst is passing.",
      minDwellTurns: 4,
      advancePressure: 999,
      defcon: 4,
      decisionTrees: {
        belligerent: choiceNode(
          "containment_afflicted",
          "Turning the corner",
          "Cases are falling. The question is how fast to reopen.",
          [
            opt("reopen", "Reopen carefully", "Lift restrictions in stages.", [
              cfx("flat", "metric", "economy", "gdpGrowth", 0.02, "Recovery begins"),
            ]),
            opt("hold", "Hold the line", "Keep measures until it is truly over.", [
              cfx("tick", "metric", "society", "publicHealth", 0.02, "Fewer relapses"),
            ]),
          ]
        ),
      },
      passiveEffects: {
        belligerent: [cfx("tick", "metric", "economy", "gdpGrowth", 0.008, "Rebound")],
      },
      events: [
        responseEvent("containment"),
        {
          key: "vaccine_rollout",
          kind: "authored",
          severity: "major",
          affects: "all",
          trigger: { onPhaseEnter: true },
          headline: "Mass vaccination turns the tide",
          body: "Immunisation reaches critical mass and case counts fall across the worst-hit regions.",
        },
      ],
    },
    {
      level: 5,
      key: "endemic",
      label: "Endemic",
      summary: "The disease is now a manageable background risk. The emergency is over.",
      minDwellTurns: 3,
      advancePressure: 999, // terminal phase; the ladder does not climb past it
      defcon: 5,
      decisionTrees: {},
      passiveEffects: {},
      events: [
        responseEvent("endemic"),
        {
          key: "endemic_declared",
          kind: "authored",
          severity: "minor",
          affects: "all",
          trigger: { onPhaseEnter: true },
          headline: "Health authorities declare the pandemic over",
          body: "The pathogen is now endemic: still circulating, no longer an emergency.",
        },
      ],
    },
  ],
};
