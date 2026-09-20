import type { GlobalResponseOutcome } from "@/lib/db/types/crisis";
import type {
  ConflictEvent,
  ConflictRole,
  EventResponseDefinition,
  LivingConflictDef,
  RoleContext,
  RoleDecisionTrees,
} from "../types";
import { choiceNode, responseOpt } from "../authoring";
import { cfx } from "../effects";

function role(ctx: RoleContext): ConflictRole {
  if (ctx.belligerents.includes(ctx.countryId)) return "belligerent";
  if (ctx.countryId === ctx.backerA) return "backer_a";
  if (ctx.countryId === ctx.backerB) return "backer_b";
  if (ctx.neighbors.includes(ctx.countryId)) return "neighbor";
  if (ctx.blocMembers.includes(ctx.countryId)) return "bloc";
  return "bystander";
}

function trees(key: string): RoleDecisionTrees {
  return {
    belligerent: choiceNode(
      key + "_yu",
      "The federation at a crossroads",
      "The federal government must choose between coercion, constitutional reform, and negotiated separation.",
      [
        responseOpt(
          "coerce",
          "Enforce federal authority",
          "Use security forces to prevent unilateral secession.",
          { escalation: 4 },
          [cfx("tick", "approval", "government", "overall", -0.02, "Federal coercion")]
        ),
        responseOpt(
          "reform",
          "Offer constitutional reform",
          "Trade central authority for a looser negotiated federation.",
          { mediation: 4, restraint: 2 }
        ),
        responseOpt(
          "separate",
          "Accept negotiated separation",
          "Open talks on borders, assets, minorities, and succession.",
          { mediation: 3, restraint: 4 }
        ),
      ]
    ),
    backer_a: choiceNode(
      key + "_west",
      "Western governments respond",
      "Recognition, sanctions, mediation, and intervention may each reshape the dissolution.",
      [
        responseOpt(
          "recognize",
          "Offer conditional recognition",
          "Condition recognition on minority protections and negotiated borders.",
          { mediation: 2, recognition: 4 }
        ),
        responseOpt(
          "intervene",
          "Prepare an intervention coalition",
          "Commit logistics and force to deter widening violence.",
          { escalation: 3, intervention: 4 },
          [],
          0.0005
        ),
        responseOpt(
          "west_mediate",
          "Back international mediation",
          "Press every side toward supervised negotiations.",
          { mediation: 4, restraint: 2 }
        ),
      ]
    ),
    backer_b: choiceNode(
      key + "_east",
      "Moscow chooses its posture",
      "Russia can obstruct, mediate, or support clients as the regional order changes.",
      [
        responseOpt(
          "east_support",
          "Back a client militarily",
          "Provide diplomatic cover and material support.",
          { escalation: 4 }
        ),
        responseOpt(
          "east_mediate",
          "Join a contact group",
          "Pursue a negotiated settlement with the other powers.",
          { mediation: 4, restraint: 2 }
        ),
        responseOpt(
          "east_abstain",
          "Keep a distance",
          "Avoid a new commitment while the federation fractures.",
          { restraint: 2 }
        ),
      ]
    ),
    neighbor: choiceNode(
      key + "_neighbor",
      "War approaches the frontier",
      "Neighboring governments face refugees, sanctions enforcement, and military spillover.",
      [
        responseOpt(
          "seal_border",
          "Fortify the frontier",
          "Restrict crossings and prepare forces for spillover.",
          { escalation: 1, containment: 3 }
        ),
        responseOpt(
          "receive_refugees",
          "Open a humanitarian corridor",
          "Receive displaced civilians and fund emergency relief.",
          { aid: 4, restraint: 1 },
          [cfx("tick", "metric", "economy", "gdpGrowth", -0.002, "Refugee reception")],
          0.0003
        ),
        responseOpt(
          "neighbor_mediate",
          "Host regional talks",
          "Offer a nearby venue for negotiations and monitoring.",
          { mediation: 3, restraint: 2 }
        ),
      ]
    ),
    bloc: choiceNode(
      key + "_europe",
      "Europe seeks a common line",
      "European governments must align recognition, sanctions, peacekeeping, and relief.",
      [
        responseOpt(
          "sanctions",
          "Coordinate targeted sanctions",
          "Raise the cost of continued attacks while preserving relief channels.",
          { sanctions: 4, restraint: 1 }
        ),
        responseOpt(
          "peacekeeping",
          "Offer peacekeepers",
          "Support a monitored ceasefire with a multinational force.",
          { intervention: 3, mediation: 2 },
          [],
          0.0003
        ),
        responseOpt(
          "europe_relief",
          "Fund refugee relief",
          "Support camps, host communities, and civilian evacuation.",
          { aid: 4 },
          [],
          0.0002
        ),
      ]
    ),
    bystander: choiceNode(
      key + "_world",
      "The international response widens",
      "Other governments can support diplomacy, relief, or noninvolvement.",
      [
        responseOpt(
          "un_mediation",
          "Support UN mediation",
          "Back supervised talks and monitoring.",
          { mediation: 3, restraint: 2 }
        ),
        responseOpt(
          "civilian_relief",
          "Fund humanitarian relief",
          "Contribute to refugee, food, and medical operations.",
          { aid: 3 },
          [],
          0.0001
        ),
        responseOpt(
          "abstain",
          "Remain outside the crisis",
          "Avoid commitments while events develop.",
          { restraint: 1 }
        ),
      ]
    ),
  };
}

const outcomes: GlobalResponseOutcome[] = [
  {
    outcomeId: "negotiated_restructuring",
    label: "Negotiated restructuring",
    description: "Constitutional and succession talks reduce the pressure for a violent break.",
    priority: 50,
    conditions: [
      { axis: "mediation", min: 8 },
      { axis: "restraint", min: 4 },
    ],
    intensityDelta: -10,
    trackDeltas: {
      constitutionalCohesion: 8,
      nationalistMobilization: -8,
      violence: -10,
      settlementMomentum: 18,
    },
    nextConflictStatus: "negotiating",
    campaignDelta: { settlementMomentum: 20, civilianStrain: -5, refugees: -4 },
    tensionDelta: -5,
    wireMessage:
      "Internationally supported negotiations open over Yugoslavia's constitutional future.",
  },
  {
    outcomeId: "international_intervention",
    label: "International intervention",
    description:
      "A multinational force combines protection, coercive leverage, and supervised diplomacy.",
    priority: 45,
    conditions: [
      { axis: "intervention", min: 6 },
      { axis: "mediation", min: 2 },
    ],
    intensityDelta: -4,
    trackDeltas: {
      violence: -8,
      displacement: -5,
      intervention: 18,
      settlementMomentum: 12,
    },
    campaignDelta: {
      civilianStrain: -5,
      refugees: -5,
      settlementMomentum: 12,
      regionalSpillover: -3,
    },
    tensionDelta: 2,
    wireMessage: "A multinational force enters the Yugoslav crisis under a negotiated mandate.",
  },
  {
    outcomeId: "military_escalation",
    label: "Military escalation",
    description: "Arming, coercion, and external commitments widen organized violence.",
    priority: 40,
    conditions: [{ axis: "escalation", min: 7 }],
    intensityDelta: 15,
    trackDeltas: {
      constitutionalCohesion: -10,
      nationalistMobilization: 10,
      violence: 18,
      displacement: 12,
      infrastructureDamage: 8,
    },
    nextConflictStatus: "active",
    campaignDelta: {
      civilianStrain: 12,
      refugees: 12,
      casualties: 10,
      infrastructureDamage: 8,
      regionalSpillover: 8,
    },
    tensionDelta: 8,
    wireMessage: "Military mobilization accelerates the Yugoslav crisis.",
  },
  {
    outcomeId: "protected_relief",
    label: "Protected relief effort",
    description: "Humanitarian corridors slow displacement and improve outside legitimacy.",
    priority: 30,
    conditions: [{ axis: "aid", min: 7 }],
    intensityDelta: -3,
    trackDeltas: { displacement: -10, legitimacy: 8, settlementMomentum: 4 },
    campaignDelta: { civilianStrain: -10, refugees: -10, settlementMomentum: 5 },
    tensionDelta: -1,
    wireMessage: "A coordinated humanitarian corridor opens around the Yugoslav crisis.",
  },
  {
    outcomeId: "international_pressure",
    label: "Coordinated international pressure",
    description: "Sanctions and conditional recognition alter the incentives of the factions.",
    priority: 20,
    conditions: [{ axis: "sanctions", min: 5 }],
    intensityDelta: -4,
    trackDeltas: { settlementMomentum: 8, legitimacy: 4, violence: -3 },
    campaignDelta: { civilianStrain: 3, settlementMomentum: 9 },
    tensionDelta: -2,
    wireMessage: "A coordinated sanctions and recognition policy takes shape.",
  },
  {
    outcomeId: "fractured_response",
    label: "Fractured response",
    description:
      "Recognition, restraint, and military policy remain divided while local pressures rise.",
    priority: 0,
    conditions: [],
    intensityDelta: 3,
    trackDeltas: {
      constitutionalCohesion: -3,
      nationalistMobilization: 4,
      violence: 3,
      displacement: 2,
    },
    campaignDelta: { civilianStrain: 3, refugees: 2, settlementMomentum: -2 },
    tensionDelta: 2,
    wireMessage: "The international response to Yugoslavia remains divided.",
  },
];

function event(phase: string, headline: string, body: string): ConflictEvent {
  const decisionTrees = trees(phase);
  const response: EventResponseDefinition = {
    windowTurns: 24,
    decisionTrees,
    defaultOptionIdByRole: {
      belligerent: "reform",
      backer_a: "west_mediate",
      backer_b: "east_abstain",
      neighbor: "neighbor_mediate",
      bloc: "europe_relief",
      bystander: "abstain",
    },
    outcomes,
    defaultOutcomeId: "fractured_response",
  };
  return {
    key: phase + "_response",
    kind: "authored",
    severity: phase === "armed_conflict" ? "critical" : "major",
    affects: "all",
    trigger: { onPhaseEnter: true, everyTurns: 24 },
    headline,
    body,
    response,
  };
}

export const YUGOSLAVIA_DEF: LivingConflictDef = {
  key: "yugoslav_dissolution",
  type: "geopolitical",
  name: "Yugoslav Dissolution",
  fromYear: 1991,
  untilYear: 2010,
  autoOpen: true,
  hostCountry: "YU",
  participants: {
    belligerents: ["YU"],
    backerA: "US",
    backerB: "RU",
    neighbors: ["AT", "IT", "GR"],
    blocMembers: ["UK", "DE", "FR", "TR"],
    bystanders: ["IE", "SE", "FI", "BR", "NG", "IN", "CN", "JP"],
  },
  participantFallbacks: { YU: ["CS", "HU", "RO"], RU: ["CN"], US: ["UK", "FR"] },
  roleResolver: role,
  tracks: {
    constitutionalCohesion: { initial: 34 },
    nationalistMobilization: { initial: 58 },
    violence: { initial: 12 },
    displacement: { initial: 0 },
    infrastructureDamage: { initial: 0 },
    legitimacy: { initial: 38 },
    intervention: { initial: 0 },
    settlementMomentum: { initial: 12 },
    reconstruction: { initial: 0 },
  },
  scheduledPressures: [
    {
      key: "constitutional_deadlock",
      fromYear: 1991,
      untilYear: 1995,
      everyTurns: 12,
      phaseKeys: ["federal_crisis", "declarations"],
      trackDeltas: { constitutionalCohesion: -3, nationalistMobilization: 3 },
    },
    {
      key: "war_displacement",
      everyTurns: 12,
      phaseKeys: ["armed_conflict", "international_intervention"],
      trackDeltas: { displacement: 4, infrastructureDamage: 3, legitimacy: -2 },
    },
    {
      key: "postwar_recovery",
      fromYear: 1995,
      everyTurns: 12,
      phaseKeys: ["settlement", "reconstruction"],
      trackDeltas: { reconstruction: 4, displacement: -2, settlementMomentum: 2 },
    },
  ],
  transitions: [
    {
      key: "declarations_begin",
      fromPhase: "federal_crisis",
      toPhase: "declarations",
      conditions: [
        { track: "constitutionalCohesion", max: 25 },
        { track: "nationalistMobilization", min: 60 },
      ],
    },
    {
      key: "reform_holds_federation",
      fromPhase: "declarations",
      toPhase: "federal_crisis",
      toStatus: "negotiating",
      priority: 80,
      conditions: [
        { track: "constitutionalCohesion", min: 48 },
        { track: "settlementMomentum", min: 45 },
      ],
    },
    {
      key: "war_begins",
      fromPhase: "declarations",
      toPhase: "armed_conflict",
      toStatus: "active",
      conditions: [{ track: "violence", min: 45 }],
    },
    {
      key: "intervention",
      fromPhase: "armed_conflict",
      toPhase: "international_intervention",
      conditions: [
        { track: "violence", min: 72 },
        { track: "displacement", min: 35 },
      ],
    },
    {
      key: "negotiated_settlement",
      fromPhase: "armed_conflict",
      toPhase: "settlement",
      toStatus: "settled",
      priority: 90,
      conditions: [
        { track: "settlementMomentum", min: 70 },
        { track: "violence", max: 45 },
      ],
    },
    {
      key: "intervention_settlement",
      fromPhase: "international_intervention",
      toPhase: "settlement",
      toStatus: "settled",
      conditions: [
        { track: "settlementMomentum", min: 72 },
        { track: "violence", max: 50 },
      ],
    },
    {
      key: "reconstruction_begins",
      fromPhase: "settlement",
      toPhase: "reconstruction",
      toStatus: "settled",
      conditions: [
        { track: "reconstruction", min: 35 },
        { track: "violence", max: 25 },
      ],
    },
    {
      key: "settlement_relapse",
      fromPhase: "settlement",
      toPhase: "armed_conflict",
      toStatus: "active",
      priority: 100,
      conditions: [{ track: "violence", min: 65 }],
    },
  ],
  phases: [
    {
      level: 1,
      key: "federal_crisis",
      label: "Federal constitutional crisis",
      summary: "Economic strain and competing national projects erode the federal bargain.",
      advancePressure: 100,
      decisionTrees: {},
      events: [
        event(
          "federal_crisis",
          "Yugoslavia's federal bargain is breaking down",
          "Republican governments and federal institutions contest sovereignty, fiscal authority, and the future of the federation."
        ),
      ],
    },
    {
      level: 2,
      key: "declarations",
      label: "Declarations and contested borders",
      summary:
        "Competing claims to sovereignty force choices over recognition, minorities, and borders.",
      advancePressure: 100,
      decisionTrees: {},
      events: [
        event(
          "declarations",
          "Declarations test Yugoslavia's borders",
          "Recognition and coercion may turn political dissolution into interstate and communal war."
        ),
      ],
    },
    {
      level: 3,
      key: "armed_conflict",
      label: "Armed conflict",
      summary: "Organized violence, sieges, displacement, and atrocities threaten the region.",
      advancePressure: 100,
      decisionTrees: {},
      events: [
        event(
          "armed_conflict",
          "War spreads through Yugoslavia",
          "Governments face sanctions, relief, peacekeeping, intervention, and negotiated partition choices."
        ),
      ],
    },
    {
      level: 4,
      key: "international_intervention",
      label: "International intervention",
      summary: "External powers and peacekeepers directly shape escalation and settlement.",
      advancePressure: 100,
      decisionTrees: {},
      events: [
        event(
          "international_intervention",
          "Outside powers enter the Yugoslav war",
          "Intervention may contain violence, widen it, or impose a settlement that later unravels."
        ),
      ],
    },
    {
      level: 5,
      key: "settlement",
      label: "Settlement and return",
      summary:
        "Ceasefires, territorial arrangements, refugee return, and political legitimacy remain contested.",
      advancePressure: 100,
      decisionTrees: {},
      events: [
        event(
          "settlement",
          "A Balkan settlement faces implementation",
          "Return, policing, elections, reconstruction, and minority guarantees determine whether peace holds."
        ),
      ],
    },
    {
      level: 6,
      key: "reconstruction",
      label: "Reconstruction",
      summary:
        "Recovery and institutional legitimacy compete with unresolved displacement and grievance.",
      advancePressure: 100,
      decisionTrees: {},
      events: [
        event(
          "reconstruction",
          "The Balkans rebuild after war",
          "Aid, refugee return, institution-building, and accountability shape the postwar order."
        ),
      ],
    },
  ],
};
