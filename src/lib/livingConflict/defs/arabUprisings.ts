import type { GlobalResponseOutcome } from "@/lib/db/types/crisis";
import { choiceNode, responseOpt } from "../authoring";
import { cfx } from "../effects";
import type {
  ConflictEvent,
  ConflictRole,
  EventResponseDefinition,
  LivingConflictDef,
  RoleContext,
  RoleDecisionTrees,
} from "../types";

// Primary anchors: UNSC 1970 (Libya), https://docs.un.org/S/RES/1970(2011),
// UNSC 2254 (Syria), https://docs.un.org/S/RES/2254(2015), and UNHCR Syria data,
// https://data.unhcr.org/en/situations/syria. They bound pressures, not outcomes.
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
      `${key}_government`,
      "A government faces mass mobilization",
      "Reform, repression, or an elite split can redirect the uprising.",
      [
        responseOpt(
          "reform",
          "Offer credible reform",
          "Open institutions, address prices and jobs, and permit organized opposition.",
          { reform: 5, legitimacy: 3 },
          [],
          0.01
        ),
        responseOpt(
          "repress",
          "Order a security crackdown",
          "Use arrests and force to clear demonstrations.",
          { repression: 5, escalation: 3 }
        ),
        responseOpt(
          "transition",
          "Negotiate a transition",
          "Share power under a constitutional timetable.",
          { transition: 5, diplomacy: 3 }
        ),
      ]
    ),
    backer_a: choiceNode(
      `${key}_west`,
      "Outside powers debate their response",
      "Sanctions, mediation, relief, and intervention each carry durable costs.",
      [
        responseOpt(
          "sanction",
          "Coordinate targeted sanctions",
          "Pressure perpetrators while preserving humanitarian trade.",
          { sanctions: 4, diplomacy: 2 }
        ),
        responseOpt(
          "protect",
          "Prepare civilian protection",
          "Commit air, naval, or logistical capacity to protect civilians.",
          { intervention: 4, escalation: 3 },
          [],
          0.008
        ),
        responseOpt(
          "mediate_west",
          "Back a negotiated transition",
          "Tie support to inclusive talks and monitored elections.",
          { transition: 3, diplomacy: 4 }
        ),
      ]
    ),
    backer_b: choiceNode(
      `${key}_rival`,
      "A rival power chooses its client policy",
      "Regime support may preserve the state or intensify proxy war.",
      [
        responseOpt(
          "support_state",
          "Support the incumbent state",
          "Provide diplomatic cover, arms, and advisers.",
          { regimeSupport: 5, escalation: 3 }
        ),
        responseOpt(
          "contact_group",
          "Join a contact group",
          "Trade leverage for a negotiated settlement.",
          { diplomacy: 4, transition: 2 }
        ),
        responseOpt("abstain_rival", "Limit involvement", "Avoid another regional commitment.", {
          restraint: 3,
        }),
      ]
    ),
    neighbor: choiceNode(
      `${key}_neighbor`,
      "Displacement reaches neighboring states",
      "Hosts must choose access, border controls, and support for armed factions.",
      [
        responseOpt(
          "host_refugees",
          "Keep humanitarian borders open",
          "Fund protection and host communities.",
          { aid: 5, legitimacy: 1 },
          [cfx("tick", "metric", "economy", "gdpGrowth", -0.003, "Refugee reception")],
          0.005
        ),
        responseOpt(
          "close_border",
          "Close the border",
          "Restrict entry and reinforce frontier security.",
          { restraint: 2, repression: 1 }
        ),
        responseOpt(
          "arm_opposition",
          "Back an opposition faction",
          "Supply an armed client to shape the conflict.",
          { oppositionSupport: 5, escalation: 3 },
          [],
          0.004
        ),
      ]
    ),
    bloc: choiceNode(
      `${key}_europe`,
      "Europe confronts regional spillover",
      "Governments coordinate refugees, sanctions, diplomacy, and relief.",
      [
        responseOpt(
          "share_refugees",
          "Share refugee protection",
          "Distribute hosting and fiscal support across participating states.",
          { aid: 4, cohesion: 4 },
          [],
          0.003
        ),
        responseOpt(
          "bloc_sanctions",
          "Align sanctions",
          "Coordinate economic pressure and enforcement.",
          { sanctions: 4, cohesion: 3 }
        ),
        responseOpt(
          "bloc_divide",
          "Keep national policies",
          "Avoid common commitments on protection or intervention.",
          { cohesion: -4, restraint: 2 }
        ),
      ]
    ),
    bystander: choiceNode(
      `${key}_world`,
      "The regional crisis demands a response",
      "Other states can fund relief, support talks, or remain outside.",
      [
        responseOpt(
          "un_relief",
          "Fund UN relief",
          "Support food, shelter, education, and medical operations.",
          { aid: 4 },
          [],
          0.001
        ),
        responseOpt(
          "un_talks",
          "Support UN-led talks",
          "Back ceasefire monitoring and inclusive negotiations.",
          { diplomacy: 4, transition: 2 }
        ),
        responseOpt("neutral", "Remain neutral", "Avoid political and military commitments.", {
          restraint: 2,
        }),
      ]
    ),
  };
}

const outcomes: GlobalResponseOutcome[] = [
  {
    outcomeId: "successful_reform",
    label: "Credible reform",
    description:
      "Economic relief and political opening reduce mobilization without regime collapse.",
    priority: 80,
    conditions: [
      { axis: "reform", min: 7 },
      { axis: "legitimacy", min: 3 },
    ],
    intensityDelta: -12,
    trackDeltas: {
      legitimacy: 16,
      protestMobilization: -18,
      repression: -8,
      settlementMomentum: 12,
    },
    nextConflictStatus: "settled",
    campaignDelta: { civilianStrain: -8, settlementMomentum: 12 },
    tensionDelta: -5,
    wireMessage: "Credible reforms defuse an uprising while opening political institutions.",
  },
  {
    outcomeId: "negotiated_transition",
    label: "Negotiated transition",
    description: "Domestic and international mediation produce an inclusive transition timetable.",
    priority: 70,
    conditions: [
      { axis: "transition", min: 7 },
      { axis: "diplomacy", min: 5 },
    ],
    intensityDelta: -10,
    trackDeltas: {
      legitimacy: 10,
      eliteCohesion: -8,
      protestMobilization: -10,
      settlementMomentum: 20,
    },
    nextConflictStatus: "negotiating",
    campaignDelta: { settlementMomentum: 18, civilianStrain: -6 },
    tensionDelta: -5,
    wireMessage: "Government and opposition agree to a monitored political transition.",
  },
  {
    outcomeId: "authoritarian_survival",
    label: "Authoritarian survival",
    description: "Cohesive security forces suppress mobilization but leave durable grievances.",
    priority: 60,
    conditions: [
      { axis: "repression", min: 8 },
      { axis: "regimeSupport", min: 4 },
    ],
    intensityDelta: -3,
    trackDeltas: {
      protestMobilization: -12,
      repression: 16,
      legitimacy: -14,
      extremistSpace: 6,
      settlementMomentum: -10,
    },
    nextConflictStatus: "ceasefire",
    campaignDelta: { casualties: 4, civilianStrain: 8 },
    tensionDelta: 3,
    wireMessage: "Security forces restore authoritarian control after a violent crackdown.",
  },
  {
    outcomeId: "civil_war",
    label: "Civil war",
    description: "Repression, armed opposition, and outside backing fragment the state.",
    priority: 50,
    conditions: [
      { axis: "escalation", min: 7 },
      { axis: "oppositionSupport", min: 4 },
    ],
    intensityDelta: 18,
    trackDeltas: {
      armedOpposition: 18,
      civilianStrain: 16,
      displacement: 15,
      extremistSpace: 10,
      eliteCohesion: -14,
      settlementMomentum: -10,
    },
    nextConflictStatus: "active",
    campaignDelta: {
      casualties: 12,
      refugees: 15,
      civilianStrain: 16,
      infrastructureDamage: 10,
      regionalSpillover: 10,
    },
    tensionDelta: 10,
    wireMessage: "The uprising fragments into an externally backed civil war.",
  },
  {
    outcomeId: "protected_relief",
    label: "Regional protection effort",
    description: "Shared hosting and humanitarian relief reduce displacement pressure.",
    priority: 40,
    conditions: [
      { axis: "aid", min: 8 },
      { axis: "cohesion", min: 3 },
    ],
    intensityDelta: -4,
    trackDeltas: { displacement: -12, civilianStrain: -10, legitimacy: 4, settlementMomentum: 3 },
    campaignDelta: { refugees: -12, civilianStrain: -10 },
    tensionDelta: -2,
    wireMessage: "A coordinated regional protection effort supports refugees and host communities.",
  },
  {
    outcomeId: "fragmented_response",
    label: "Fragmented response",
    description: "Inconsistent outside policies deepen uncertainty and regional diffusion.",
    priority: 0,
    conditions: [],
    intensityDelta: 5,
    trackDeltas: { protestMobilization: 5, civilianStrain: 4, displacement: 3, extremistSpace: 3 },
    campaignDelta: { refugees: 3, regionalSpillover: 4 },
    tensionDelta: 3,
    wireMessage: "A divided international response leaves the regional uprising wave unresolved.",
  },
];

function event(phase: string): ConflictEvent {
  const response: EventResponseDefinition = {
    windowTurns: 24,
    decisionTrees: trees(phase),
    defaultOptionIdByRole: {
      belligerent: "reform",
      backer_a: "mediate_west",
      backer_b: "contact_group",
      neighbor: "host_refugees",
      bloc: "share_refugees",
      bystander: "un_relief",
    },
    outcomes,
    defaultOutcomeId: "fragmented_response",
  };
  return {
    key: `${phase}_response`,
    kind: "authored",
    severity: phase === "civil_war" ? "critical" : "major",
    affects: "all",
    trigger: { onPhaseEnter: true, everyTurns: 24 },
    headline: "An uprising wave tests the regional order",
    body: "Live legitimacy, repression, elite cohesion, foreign backing, and relief determine whether protest produces reform, transition, restoration, or war.",
    response,
  };
}

export const ARAB_UPRISINGS_DEF: LivingConflictDef = {
  key: "arab_uprisings",
  type: "geopolitical",
  name: "Arab Uprisings and Regional Displacement",
  fromYear: 2010,
  untilYear: 2027,
  autoOpen: true,
  participants: {
    belligerents: ["SY"],
    backerA: "US",
    backerB: "RU",
    neighbors: ["TR", "JO", "YE"],
    blocMembers: ["UK", "FR", "DE", "IT"],
    bystanders: ["CN", "IN", "BR", "NG", "IE", "SE", "FI", "GR"],
  },
  participantFallbacks: { SY: ["JO", "YE", "TR"], RU: ["CN"], US: ["UK", "FR"], JO: ["TR", "GR"] },
  roleResolver: role,
  tracks: {
    legitimacy: { initial: 38 },
    protestMobilization: { initial: 25 },
    repression: { initial: 35 },
    eliteCohesion: { initial: 65 },
    armedOpposition: { initial: 0 },
    civilianStrain: { initial: 18 },
    displacement: { initial: 0 },
    extremistSpace: { initial: 5 },
    settlementMomentum: { initial: 8 },
    reconstruction: { initial: 0 },
  },
  scheduledPressures: [
    {
      key: "food_jobs_legitimacy",
      fromYear: 2010,
      untilYear: 2013,
      everyTurns: 12,
      phaseKeys: ["structural_pressure", "protest_diffusion"],
      trackDeltas: { legitimacy: -4, protestMobilization: 5, civilianStrain: 3 },
    },
    {
      key: "regional_diffusion",
      fromYear: 2011,
      untilYear: 2015,
      everyTurns: 12,
      phaseKeys: ["protest_diffusion", "regime_choice"],
      trackDeltas: { protestMobilization: 4, eliteCohesion: -2 },
    },
    {
      key: "war_displacement",
      everyTurns: 12,
      phaseKeys: ["civil_war", "proxy_escalation"],
      trackDeltas: { civilianStrain: 5, displacement: 5, extremistSpace: 3 },
    },
    {
      key: "recovery",
      everyTurns: 12,
      phaseKeys: ["settlement_reconstruction"],
      trackDeltas: { reconstruction: 4, displacement: -2, civilianStrain: -2 },
    },
  ],
  transitions: [
    {
      key: "protests_spread",
      fromPhase: "structural_pressure",
      toPhase: "protest_diffusion",
      conditions: [
        { track: "protestMobilization", min: 42 },
        { track: "legitimacy", max: 38 },
      ],
    },
    {
      key: "reform_success",
      fromPhase: "protest_diffusion",
      toPhase: "settlement_reconstruction",
      toStatus: "settled",
      priority: 90,
      conditions: [
        { track: "legitimacy", min: 52 },
        { track: "protestMobilization", max: 30 },
      ],
    },
    {
      key: "regime_choice",
      fromPhase: "protest_diffusion",
      toPhase: "regime_choice",
      conditions: [{ track: "protestMobilization", min: 55 }],
    },
    {
      key: "negotiated_transition",
      fromPhase: "regime_choice",
      toPhase: "settlement_reconstruction",
      toStatus: "negotiating",
      priority: 90,
      conditions: [
        { track: "settlementMomentum", min: 60 },
        { track: "repression", max: 50 },
      ],
    },
    {
      key: "restored_control",
      fromPhase: "regime_choice",
      toPhase: "authoritarian_restoration",
      toStatus: "ceasefire",
      priority: 80,
      conditions: [
        { track: "repression", min: 68 },
        { track: "eliteCohesion", min: 60 },
        { track: "armedOpposition", max: 30 },
      ],
    },
    {
      key: "war_begins",
      fromPhase: "regime_choice",
      toPhase: "civil_war",
      conditions: [
        { track: "armedOpposition", min: 35 },
        { track: "eliteCohesion", max: 50 },
      ],
    },
    {
      key: "proxy_escalation",
      fromPhase: "civil_war",
      toPhase: "proxy_escalation",
      conditions: [
        { track: "armedOpposition", min: 60 },
        { track: "extremistSpace", min: 35 },
      ],
    },
    {
      key: "frozen_conflict",
      fromPhase: "civil_war",
      toPhase: "settlement_reconstruction",
      toStatus: "ceasefire",
      priority: 85,
      conditions: [
        { track: "settlementMomentum", min: 62 },
        { track: "civilianStrain", max: 65 },
      ],
    },
    {
      key: "proxy_settlement",
      fromPhase: "proxy_escalation",
      toPhase: "settlement_reconstruction",
      toStatus: "settled",
      conditions: [{ track: "settlementMomentum", min: 75 }],
    },
    {
      key: "renewed_uprising",
      fromPhase: "authoritarian_restoration",
      toPhase: "protest_diffusion",
      toStatus: "active",
      priority: 100,
      conditions: [
        { track: "protestMobilization", min: 68 },
        { track: "legitimacy", max: 28 },
      ],
    },
    {
      key: "settlement_relapse",
      fromPhase: "settlement_reconstruction",
      toPhase: "civil_war",
      toStatus: "active",
      priority: 100,
      conditions: [
        { track: "armedOpposition", min: 65 },
        { track: "settlementMomentum", max: 30 },
      ],
    },
  ],
  phases: [
    {
      level: 1,
      key: "structural_pressure",
      label: "Structural pressure",
      summary:
        "Food prices, unemployment, demographics, and weak legitimacy accumulate across the region.",
      advancePressure: 999,
      decisionTrees: {},
      events: [event("structural_pressure")],
    },
    {
      level: 2,
      key: "protest_diffusion",
      label: "Protest diffusion",
      summary:
        "Contentious politics spreads regionally without imposing the same outcome on every state.",
      advancePressure: 999,
      decisionTrees: {},
      events: [event("protest_diffusion")],
    },
    {
      level: 3,
      key: "regime_choice",
      label: "Reform, repression, or transition",
      summary:
        "Government and elite choices determine whether mobilization demobilizes or militarizes.",
      advancePressure: 999,
      decisionTrees: {},
      events: [event("regime_choice")],
    },
    {
      level: 4,
      key: "authoritarian_restoration",
      label: "Authoritarian restoration",
      summary: "Security control returns, but legitimacy and renewed-uprising risks persist.",
      advancePressure: 999,
      decisionTrees: {},
      events: [event("authoritarian_restoration")],
    },
    {
      level: 5,
      key: "civil_war",
      label: "Civil war",
      summary: "State fragmentation drives casualties, displacement, and extremist opportunity.",
      advancePressure: 999,
      decisionTrees: {},
      events: [event("civil_war")],
    },
    {
      level: 6,
      key: "proxy_escalation",
      label: "Regional proxy escalation",
      summary: "External support sustains rival armed coalitions and complicates settlement.",
      advancePressure: 999,
      decisionTrees: {},
      events: [event("proxy_escalation")],
    },
    {
      level: 7,
      key: "settlement_reconstruction",
      label: "Settlement and reconstruction",
      summary: "Transition, frozen conflict, return, and reconstruction compete with relapse.",
      advancePressure: 999,
      decisionTrees: {},
      events: [event("settlement_reconstruction")],
    },
  ],
};
