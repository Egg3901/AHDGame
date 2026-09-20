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

// Historical anchors constrain the pressure window, not the result:
// UNGA 68/262: https://docs.un.org/A/RES/68/262
// Minsk package, endorsed by UNSC 2202: https://docs.un.org/S/RES/2202(2015)
// OSCE monitoring mandate: https://www.osce.org/special-monitoring-mission-to-ukraine/117729

function role(ctx: RoleContext): ConflictRole {
  if (ctx.countryId === "UKR") return "belligerent";
  if (ctx.countryId === ctx.backerA) return "backer_a";
  if (ctx.countryId === ctx.backerB) return "backer_b";
  if (ctx.neighbors.includes(ctx.countryId)) return "neighbor";
  if (ctx.blocMembers.includes(ctx.countryId)) return "bloc";
  return "bystander";
}

function trees(key: string): RoleDecisionTrees {
  return {
    belligerent: choiceNode(
      `${key}_ukraine`,
      "Ukraine chooses its security course",
      "Domestic legitimacy, territorial control, and external alignment pull in different directions.",
      [
        responseOpt(
          "uk_reform",
          "Reform and seek guarantees",
          "Strengthen institutions while seeking binding external guarantees.",
          { legitimacy: 4, diplomacy: 3, deterrence: 2 },
          [],
          0.004
        ),
        responseOpt(
          "uk_neutral",
          "Offer armed neutrality",
          "Trade formal non-alignment for monitored sovereignty guarantees.",
          { diplomacy: 4, neutrality: 4 }
        ),
        responseOpt(
          "uk_mobilize",
          "Mobilize national defense",
          "Raise readiness and accept the fiscal and escalation cost.",
          { deterrence: 4, militaryAid: 2, escalation: 2 },
          [],
          0.012
        ),
      ]
    ),
    backer_a: choiceNode(
      `${key}_russia`,
      "Russia tests the post-Soviet order",
      "Moscow can bargain over security, sustain proxies, or escalate direct coercion.",
      [
        responseOpt(
          "ru_bargain",
          "Negotiate reciprocal limits",
          "Offer de-escalation tied to neutrality and monitored force limits.",
          { diplomacy: 4, neutrality: 3, restraint: 2 }
        ),
        responseOpt(
          "ru_proxy",
          "Support separatist proxies",
          "Apply deniable military and political pressure.",
          { proxy: 4, coercion: 3, escalation: 2 }
        ),
        responseOpt(
          "ru_invade",
          "Prepare direct intervention",
          "Use overt force to impose a new territorial settlement.",
          { coercion: 5, escalation: 5 }
        ),
      ]
    ),
    backer_b: choiceNode(
      `${key}_us`,
      "The United States weighs deterrence",
      "Washington can combine aid, sanctions, alliance reassurance, and diplomacy.",
      [
        responseOpt(
          "us_aid",
          "Coordinate military aid",
          "Supply training, equipment, and intelligence without entering the war directly.",
          { militaryAid: 4, deterrence: 4 },
          [],
          0.006
        ),
        responseOpt(
          "us_sanctions",
          "Prepare coordinated sanctions",
          "Threaten finance, technology, and trade restrictions.",
          { sanctions: 4, cohesion: 3 }
        ),
        responseOpt(
          "us_talks",
          "Open strategic talks",
          "Pursue force limits and security guarantees.",
          { diplomacy: 4, restraint: 2 }
        ),
      ]
    ),
    neighbor: choiceNode(
      `${key}_neighbor`,
      "War risk reaches the frontier",
      "Neighbors face refugees, arms transfers, energy exposure, and spillover.",
      [
        responseOpt(
          "receive_refugees",
          "Receive refugees",
          "Fund shelter, services, and legal protection.",
          { aid: 4, cohesion: 2 },
          [cfx("tick", "metric", "economy", "gdpGrowth", -0.002, "Refugee support")],
          0.003
        ),
        responseOpt(
          "transit_aid",
          "Become an aid corridor",
          "Move defensive assistance and relief across the frontier.",
          { militaryAid: 3, aid: 2, deterrence: 2 },
          [],
          0.003
        ),
        responseOpt(
          "mediate",
          "Host negotiations",
          "Use regional access to sustain ceasefire diplomacy.",
          { diplomacy: 4, restraint: 2 }
        ),
      ]
    ),
    bloc: choiceNode(
      `${key}_europe`,
      "Europe seeks a common policy",
      "Governments balance sanctions, energy exposure, defense, and settlement diplomacy.",
      [
        responseOpt(
          "eu_sanctions",
          "Coordinate economic sanctions",
          "Share the cost of finance, trade, and energy restrictions.",
          { sanctions: 4, cohesion: 4 },
          [cfx("tick", "metric", "economy", "gdpGrowth", -0.002, "Sanctions spillover")]
        ),
        responseOpt(
          "eu_guarantees",
          "Offer security guarantees",
          "Back a monitored settlement with material guarantees.",
          { diplomacy: 3, deterrence: 3, cohesion: 2 }
        ),
        responseOpt(
          "eu_divide",
          "Protect national interests",
          "Limit common commitments and preserve bilateral options.",
          { restraint: 2, cohesion: -3 }
        ),
      ]
    ),
    bystander: choiceNode(
      `${key}_world`,
      "The conflict reshapes global diplomacy",
      "Other governments can uphold sovereignty, mediate, provide relief, or remain neutral.",
      [
        responseOpt(
          "un_mediation",
          "Back UN mediation",
          "Support sovereignty, monitoring, and negotiated settlement.",
          { diplomacy: 3, restraint: 2 }
        ),
        responseOpt(
          "relief",
          "Fund humanitarian relief",
          "Support displaced civilians and damaged communities.",
          { aid: 4 },
          [],
          0.001
        ),
        responseOpt(
          "nonaligned",
          "Remain non-aligned",
          "Avoid sanctions and military commitments.",
          { neutrality: 3 }
        ),
      ]
    ),
  };
}

const outcomes: GlobalResponseOutcome[] = [
  {
    outcomeId: "negotiated_neutrality",
    label: "Guaranteed accommodation",
    description: "Reciprocal limits and guarantees produce an armed-neutrality settlement.",
    priority: 80,
    conditions: [
      { axis: "diplomacy", min: 9 },
      { axis: "neutrality", min: 5 },
    ],
    intensityDelta: -12,
    trackDeltas: {
      settlementMomentum: 20,
      escalationRisk: -18,
      coercivePressure: -10,
      territorialControl: 4,
    },
    nextConflictStatus: "negotiating",
    campaignDelta: { settlementMomentum: 18, civilianStrain: -6 },
    tensionDelta: -7,
    wireMessage:
      "Negotiators outline reciprocal security limits and monitored guarantees for Ukraine.",
  },
  {
    outcomeId: "deterrence_holds",
    label: "Deterrence holds",
    description: "Cohesive aid and readiness raise the cost of overt attack.",
    priority: 70,
    conditions: [
      { axis: "deterrence", min: 8 },
      { axis: "cohesion", min: 4 },
    ],
    intensityDelta: -6,
    trackDeltas: { deterrence: 16, allianceCohesion: 10, coercivePressure: -5, escalationRisk: -7 },
    campaignDelta: { regionalSpillover: -3 },
    tensionDelta: -3,
    wireMessage: "Coordinated readiness and assistance deter immediate escalation.",
  },
  {
    outcomeId: "sanctions_and_aid",
    label: "Sanctions and military aid",
    description:
      "Economic pressure and defensive aid constrain aggression but deepen confrontation.",
    priority: 60,
    conditions: [
      { axis: "sanctions", min: 6 },
      { axis: "militaryAid", min: 5 },
    ],
    intensityDelta: 2,
    trackDeltas: {
      sanctionsPressure: 15,
      westernAid: 14,
      deterrence: 8,
      escalationRisk: 4,
      warWeariness: 3,
    },
    campaignDelta: { regionalSpillover: 3 },
    tensionDelta: 5,
    wireMessage: "A coalition coordinates sanctions and defensive aid for Ukraine.",
  },
  {
    outcomeId: "proxy_conflict",
    label: "Proxy conflict",
    description:
      "Deniable support produces a durable territorial confrontation below full invasion.",
    priority: 50,
    conditions: [{ axis: "proxy", min: 7 }],
    intensityDelta: 8,
    trackDeltas: {
      separatistCapacity: 16,
      territorialControl: -10,
      displacement: 7,
      escalationRisk: 8,
      settlementMomentum: -5,
    },
    nextConflictStatus: "active",
    campaignDelta: { casualties: 4, refugees: 6, civilianStrain: 6 },
    tensionDelta: 5,
    wireMessage: "Proxy forces open a sustained territorial conflict in Ukraine.",
  },
  {
    outcomeId: "broad_invasion",
    label: "Broad invasion",
    description: "Direct intervention turns coercive pressure into interstate war.",
    priority: 40,
    conditions: [
      { axis: "coercion", min: 8 },
      { axis: "escalation", min: 8 },
    ],
    intensityDelta: 18,
    trackDeltas: {
      territorialControl: -18,
      displacement: 18,
      infrastructureDamage: 16,
      escalationRisk: 15,
      warWeariness: 8,
    },
    nextConflictStatus: "active",
    campaignDelta: {
      casualties: 12,
      refugees: 18,
      civilianStrain: 16,
      infrastructureDamage: 15,
      regionalSpillover: 10,
    },
    tensionDelta: 12,
    wireMessage: "Russian forces open a broad invasion of Ukraine.",
  },
  {
    outcomeId: "fragmented_response",
    label: "Fragmented response",
    description: "Mixed signals leave coercion, insecurity, and domestic pressure unresolved.",
    priority: 0,
    conditions: [],
    intensityDelta: 4,
    trackDeltas: {
      coercivePressure: 5,
      escalationRisk: 4,
      ukrainianLegitimacy: -3,
      settlementMomentum: -2,
    },
    campaignDelta: { civilianStrain: 2 },
    tensionDelta: 2,
    wireMessage: "International divisions leave the Russia-Ukraine crisis unresolved.",
  },
];

function event(phase: string): ConflictEvent {
  const response: EventResponseDefinition = {
    windowTurns: 24,
    decisionTrees: trees(phase),
    defaultOptionIdByRole: {
      belligerent: "uk_reform",
      backer_a: "ru_bargain",
      backer_b: "us_talks",
      neighbor: "mediate",
      bloc: "eu_guarantees",
      bystander: "nonaligned",
    },
    outcomes,
    defaultOutcomeId: "fragmented_response",
  };
  return {
    key: `${phase}_response`,
    kind: "authored",
    severity: phase === "broad_war" ? "critical" : "major",
    affects: "all",
    trigger: { onPhaseEnter: true, everyTurns: 24 },
    headline: "European security hangs on the Russia-Ukraine crisis",
    body: "Coercion, deterrence, domestic legitimacy, and diplomacy shape whether confrontation freezes, settles, or widens.",
    response,
  };
}

export const RUSSIA_UKRAINE_DEF: LivingConflictDef = {
  key: "russia_ukraine_security",
  type: "geopolitical",
  name: "Russia-Ukraine Security Crisis",
  fromYear: 2013,
  untilYear: 2027,
  autoOpen: true,
  hostCountry: "UKR",
  participants: {
    belligerents: ["UKR"],
    backerA: "RU",
    backerB: "US",
    neighbors: ["PL", "RO", "HU", "TR"],
    blocMembers: ["UK", "DE", "FR", "IT"],
    bystanders: ["CN", "IN", "BR", "NG", "JP", "IE", "SE", "FI"],
  },
  participantFallbacks: { UKR: ["RU", "PL", "RO"], RU: ["CN"], US: ["UK", "FR"], PL: ["DE", "RO"] },
  roleResolver: role,
  tracks: {
    ukrainianLegitimacy: { initial: 48 },
    territorialControl: { initial: 100 },
    coercivePressure: { initial: 35 },
    separatistCapacity: { initial: 8 },
    deterrence: { initial: 30 },
    allianceCohesion: { initial: 45 },
    sanctionsPressure: { initial: 0 },
    westernAid: { initial: 0 },
    displacement: { initial: 0 },
    infrastructureDamage: { initial: 0 },
    escalationRisk: { initial: 25 },
    warWeariness: { initial: 0 },
    settlementMomentum: { initial: 12 },
    reconstruction: { initial: 0 },
  },
  scheduledPressures: [
    {
      key: "alignment_pressure",
      fromYear: 2013,
      untilYear: 2015,
      everyTurns: 12,
      phaseKeys: ["alignment_crisis", "territorial_confrontation"],
      trackDeltas: { coercivePressure: 4, ukrainianLegitimacy: -2, escalationRisk: 3 },
    },
    {
      key: "contact_line_pressure",
      fromYear: 2015,
      everyTurns: 12,
      phaseKeys: ["proxy_conflict", "mobilization"],
      trackDeltas: { warWeariness: 2, displacement: 2, settlementMomentum: -1 },
    },
    {
      key: "war_damage",
      everyTurns: 12,
      phaseKeys: ["broad_war"],
      trackDeltas: { displacement: 5, infrastructureDamage: 4, warWeariness: 4, escalationRisk: 2 },
    },
    {
      key: "recovery",
      everyTurns: 12,
      phaseKeys: ["armistice_reconstruction"],
      trackDeltas: {
        reconstruction: 4,
        displacement: -2,
        infrastructureDamage: -2,
        warWeariness: -2,
      },
    },
  ],
  transitions: [
    {
      key: "territorial_crisis",
      fromPhase: "alignment_crisis",
      toPhase: "territorial_confrontation",
      conditions: [
        { track: "coercivePressure", min: 48 },
        { track: "ukrainianLegitimacy", max: 48 },
      ],
    },
    {
      key: "early_accommodation",
      fromPhase: "alignment_crisis",
      toPhase: "armistice_reconstruction",
      toStatus: "settled",
      priority: 90,
      conditions: [
        { track: "settlementMomentum", min: 60 },
        { track: "escalationRisk", max: 30 },
      ],
    },
    {
      key: "proxy_war",
      fromPhase: "territorial_confrontation",
      toPhase: "proxy_conflict",
      conditions: [{ track: "separatistCapacity", min: 35 }],
    },
    {
      key: "negotiated_accommodation",
      fromPhase: "territorial_confrontation",
      toPhase: "armistice_reconstruction",
      toStatus: "settled",
      priority: 90,
      conditions: [
        { track: "settlementMomentum", min: 65 },
        { track: "coercivePressure", max: 40 },
      ],
    },
    {
      key: "mobilize",
      fromPhase: "proxy_conflict",
      toPhase: "mobilization",
      conditions: [
        { track: "escalationRisk", min: 58 },
        { track: "coercivePressure", min: 55 },
      ],
    },
    {
      key: "frozen_conflict",
      fromPhase: "proxy_conflict",
      toPhase: "armistice_reconstruction",
      toStatus: "ceasefire",
      priority: 80,
      conditions: [
        { track: "settlementMomentum", min: 58 },
        { track: "escalationRisk", max: 42 },
      ],
    },
    {
      key: "invasion",
      fromPhase: "mobilization",
      toPhase: "broad_war",
      conditions: [
        { track: "escalationRisk", min: 78 },
        { track: "deterrence", max: 55 },
      ],
    },
    {
      key: "deterrence_success",
      fromPhase: "mobilization",
      toPhase: "proxy_conflict",
      toStatus: "ceasefire",
      priority: 90,
      conditions: [
        { track: "deterrence", min: 70 },
        { track: "allianceCohesion", min: 60 },
      ],
    },
    {
      key: "armistice",
      fromPhase: "broad_war",
      toPhase: "armistice_reconstruction",
      toStatus: "settled",
      conditions: [
        { track: "settlementMomentum", min: 72 },
        { track: "warWeariness", min: 55 },
      ],
    },
    {
      key: "renewed_war",
      fromPhase: "armistice_reconstruction",
      toPhase: "broad_war",
      toStatus: "active",
      priority: 100,
      conditions: [{ track: "escalationRisk", min: 82 }],
    },
  ],
  phases: [
    {
      level: 1,
      key: "alignment_crisis",
      label: "Alignment and legitimacy crisis",
      summary:
        "Ukraine's domestic legitimacy and external alignment become a regional security contest.",
      advancePressure: 999,
      decisionTrees: {},
      events: [event("alignment_crisis")],
    },
    {
      level: 2,
      key: "territorial_confrontation",
      label: "Territorial confrontation",
      summary:
        "Sovereignty, borders, protest, and coercion collide without predetermining annexation.",
      advancePressure: 999,
      decisionTrees: {},
      events: [event("territorial_confrontation")],
    },
    {
      level: 3,
      key: "proxy_conflict",
      label: "Proxy or frozen conflict",
      summary:
        "Armed proxies and an unstable contact line sustain displacement and escalation risk.",
      advancePressure: 999,
      decisionTrees: {},
      events: [event("proxy_conflict")],
    },
    {
      level: 4,
      key: "mobilization",
      label: "Mobilization and deterrence",
      summary:
        "Force concentrations and alliance choices create a final opportunity for deterrence or settlement.",
      advancePressure: 999,
      decisionTrees: {},
      events: [event("mobilization")],
    },
    {
      level: 5,
      key: "broad_war",
      label: "Broad interstate war",
      summary:
        "Direct war drives casualties, infrastructure damage, displacement, and escalation danger.",
      advancePressure: 999,
      decisionTrees: {},
      events: [event("broad_war")],
    },
    {
      level: 6,
      key: "armistice_reconstruction",
      label: "Armistice and reconstruction",
      summary:
        "A settlement, frozen ceasefire, or negotiated neutrality must survive recovery and relapse risk.",
      advancePressure: 999,
      decisionTrees: {},
      events: [event("armistice_reconstruction")],
    },
  ],
};
