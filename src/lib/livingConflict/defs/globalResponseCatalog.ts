import type {
  CrisisDecisionOption,
  CrisisEffect,
  GlobalResponseOutcome,
} from "@/lib/db/types/crisis";
import type {
  ConflictPhase,
  EventResponseDefinition,
  LivingConflictDef,
  RoleDecisionTrees,
} from "../types";
import { choiceNode, responseOpt as authoredResponseOpt } from "../authoring";
import { cfx } from "../effects";
import { defaultRoleResolver } from "../roles";

interface ScenarioCopy {
  key: string;
  name: string;
  type: LivingConflictDef["type"];
  fromYear: number;
  untilYear: number;
  hostCountry?: string;
  participants: LivingConflictDef["participants"];
  phases: Array<{
    key: string;
    label: string;
    year: number;
    summary: string;
    headline: string;
    body: string;
    defcon: number;
  }>;
  settlement: string;
  escalation: string;
  relief: string;
  stalemate: string;
}

type ResponseDepth = Pick<
  CrisisDecisionOption,
  "campaignRequirement" | "campaignCommitment" | "responseVisibility"
>;

function depthFor(optionId: string): ResponseDepth {
  const military = (side?: "a" | "b", scale = 14): ResponseDepth => ({
    campaignRequirement: {
      allowedStages: ["posture", "mobilization", "operations"],
      minTreasuryPctGdp: 0.0002,
      minMilitaryReadiness: 42,
      minLogistics: 38,
      minDomesticSupport: 40,
    },
    campaignCommitment: {
      kind: "military",
      side,
      scale,
      credibilityDelta: 3,
      warWearinessDelta: 3,
      consequences: { armsProliferation: 5, regionalSpillover: 3, casualties: 1 },
    },
  });
  if (["mobilize", "fortify", "allied_support"].includes(optionId)) return military(undefined, 16);
  if (optionId === "commit_a") return military("a");
  if (optionId === "commit_b") return military("b");
  if (optionId === "covert_a" || optionId === "covert_b") {
    return {
      campaignRequirement: {
        allowedStages: ["posture", "mobilization", "operations"],
        minTreasuryPctGdp: 0.0001,
        minIntelligence: 52,
        minLogistics: 28,
      },
      campaignCommitment: {
        kind: "covert",
        side: optionId === "covert_a" ? "a" : "b",
        scale: 9,
        credibilityDelta: 1,
        covertExposureRisk: 35,
        consequences: { armsProliferation: 3, regionalSpillover: 1 },
      },
      responseVisibility: "covert",
    };
  }
  if (["sanctions", "allied_sanctions"].includes(optionId)) {
    return {
      campaignRequirement: { minDomesticSupport: 38, minIntelligence: 38 },
      campaignCommitment: {
        kind: "sanctions",
        scale: 10,
        credibilityDelta: 1,
        consequences: { civilianStrain: 2, settlementMomentum: 4 },
      },
    };
  }
  if (optionId === "civilian_relief") {
    return {
      campaignRequirement: { minTreasuryPctGdp: 0.00005, minLogistics: 20 },
      campaignCommitment: {
        kind: "humanitarian",
        scale: 12,
        credibilityDelta: 2,
        consequences: { civilianStrain: -6, refugees: -5, settlementMomentum: 2 },
      },
    };
  }
  if (
    [
      "negotiate",
      "mediate_a",
      "mediate_b",
      "regional_talks",
      "allied_mediation",
      "un_mediation",
    ].includes(optionId)
  ) {
    return {
      campaignRequirement: {
        allowedStages: ["posture", "mobilization", "operations", "settlement"],
        minDomesticSupport: 25,
      },
      campaignCommitment: {
        kind: "diplomatic",
        scale: 10,
        credibilityDelta: 2,
        consequences: { settlementMomentum: 7, civilianStrain: -1 },
      },
    };
  }
  if (optionId === "concede") {
    return {
      campaignCommitment: {
        kind: "diplomatic",
        scale: 8,
        credibilityDelta: -2,
        consequences: { settlementMomentum: 6, civilianStrain: -2 },
      },
    };
  }
  return {
    campaignCommitment: {
      kind: "neutral",
      scale: 2,
      credibilityDelta: -1,
      consequences: { settlementMomentum: 1 },
    },
  };
}

function responseOpt(
  optionId: string,
  label: string,
  description: string,
  responseScores: Record<string, number>,
  effects: CrisisEffect[] = [],
  treasuryCostPctGdp?: number
): CrisisDecisionOption {
  return authoredResponseOpt(
    optionId,
    label,
    description,
    responseScores,
    effects,
    treasuryCostPctGdp,
    depthFor(optionId)
  );
}

function decisionTrees(scenario: ScenarioCopy, phaseKey: string): RoleDecisionTrees {
  const subject = scenario.name;
  return {
    belligerent: choiceNode(
      `${phaseKey}_principal`,
      `${subject}: a principal decides`,
      "Your government is directly exposed. The next move may define the crisis.",
      [
        responseOpt(
          "mobilize",
          "Mobilize and stand firm",
          "Put forces and public credibility behind your position.",
          { escalation: 3, solidarity: 1 },
          [cfx("tick", "approval", "government", "overall", -0.015, "Crisis mobilization")],
          0.0005
        ),
        responseOpt(
          "negotiate",
          "Enter negotiations",
          "Trade immediate leverage for a diplomatic exit.",
          {
            mediation: 3,
            restraint: 2,
          }
        ),
        responseOpt(
          "concede",
          "Make a limited concession",
          "Reduce immediate danger at a domestic political cost.",
          { restraint: 3 },
          [cfx("flat", "approval", "government", "overall", -0.02, "Concession backlash")]
        ),
      ]
    ),
    backer_a: choiceNode(
      `${phaseKey}_backer_a`,
      `${subject}: support or restraint`,
      "An aligned government expects material support and a public guarantee.",
      [
        responseOpt(
          "commit_a",
          "Commit to your partner",
          "Send aid and make the guarantee explicit.",
          { escalation: 3, solidarity: 2 },
          [],
          0.0004
        ),
        responseOpt(
          "covert_a",
          "Authorize covert support",
          "Move money, intelligence, and equipment through deniable channels.",
          { escalation: 2, solidarity: 1 },
          [],
          0.0002
        ),
        responseOpt(
          "mediate_a",
          "Press for a settlement",
          "Use influence over your partner to open talks.",
          { mediation: 3, restraint: 2 }
        ),
        responseOpt(
          "distance_a",
          "Keep your distance",
          "Avoid a commitment while the situation develops.",
          { restraint: 1 }
        ),
      ]
    ),
    backer_b: choiceNode(
      `${phaseKey}_backer_b`,
      `${subject}: answer the rival bloc`,
      "The opposing camp has moved. Your clients and allies expect an answer.",
      [
        responseOpt(
          "commit_b",
          "Counter the rival move",
          "Provide money, equipment, and a political guarantee.",
          { escalation: 3, solidarity: 2 },
          [],
          0.0004
        ),
        responseOpt(
          "covert_b",
          "Authorize covert support",
          "Use intelligence channels and deniable shipments to strengthen your partner.",
          { escalation: 2, solidarity: 1 },
          [],
          0.0002
        ),
        responseOpt(
          "mediate_b",
          "Propose reciprocal restraint",
          "Offer a settlement in which both blocs step back.",
          { mediation: 3, restraint: 2 }
        ),
        responseOpt(
          "distance_b",
          "Avoid escalation",
          "Issue no new guarantee and commit no forces.",
          { restraint: 1 }
        ),
      ]
    ),
    neighbor: choiceNode(
      `${phaseKey}_neighbor`,
      `${subject}: pressure reaches the region`,
      "Trade, refugees, and military risk are already crossing borders.",
      [
        responseOpt(
          "sanctions",
          "Impose targeted sanctions",
          "Use trade and finance to force a change in course.",
          { sanctions: 3, restraint: 1 },
          [cfx("tick", "metric", "economy", "gdpGrowth", -0.002, "Sanctions blowback")]
        ),
        responseOpt(
          "regional_talks",
          "Convene regional talks",
          "Offer a neutral table before the blocs take over.",
          { mediation: 3, restraint: 2 }
        ),
        responseOpt(
          "fortify",
          "Fortify the frontier",
          "Prepare for spillover without choosing a camp.",
          { escalation: 1 }
        ),
      ]
    ),
    bloc: choiceNode(
      `${phaseKey}_bloc`,
      `${subject}: the alliance consults`,
      "The alliance wants a common position, but members will bear different costs.",
      [
        responseOpt(
          "allied_support",
          "Support the alliance line",
          "Contribute money, logistics, and diplomatic backing.",
          { escalation: 2, solidarity: 3 },
          [],
          0.00025
        ),
        responseOpt(
          "allied_sanctions",
          "Back economic pressure",
          "Join a coordinated sanctions package.",
          { sanctions: 3, restraint: 1 },
          [cfx("tick", "metric", "economy", "gdpGrowth", -0.0015, "Trade restrictions")]
        ),
        responseOpt(
          "allied_mediation",
          "Demand negotiations",
          "Refuse automatic escalation and press the alliance toward talks.",
          { mediation: 2, restraint: 2 }
        ),
      ]
    ),
    bystander: choiceNode(
      `${phaseKey}_bystander`,
      `${subject}: a global response forms`,
      "Neutral and non-aligned governments can still shape legitimacy, relief, and diplomacy.",
      [
        responseOpt(
          "un_mediation",
          "Back international mediation",
          "Build a voting bloc for supervised negotiations.",
          { mediation: 3, restraint: 2 }
        ),
        responseOpt(
          "civilian_relief",
          "Fund civilian relief",
          "Send aid through neutral international channels.",
          { aid: 3 },
          [],
          0.0001
        ),
        responseOpt("abstain", "Abstain", "Avoid taking a position in a distant confrontation.", {
          restraint: 1,
        }),
      ]
    ),
  };
}

function outcomes(copy: ScenarioCopy): GlobalResponseOutcome[] {
  return [
    {
      outcomeId: "settlement",
      label: "Negotiated settlement",
      description: copy.settlement,
      priority: 40,
      conditions: [
        { axis: "mediation", min: 6 },
        { axis: "restraint", min: 4 },
      ],
      intensityDelta: -12,
      pressureDelta: { a: -8, b: -8 },
      campaignDelta: {
        civilianStrain: -8,
        refugees: -4,
        regionalSpillover: -5,
        settlementMomentum: 35,
      },
      nextCampaignStage: "settlement",
      tensionDelta: -8,
      effectsByRole: {
        belligerent: [cfx("flat", "approval", "government", "overall", 0.015, "Crisis settlement")],
        bystander: [
          cfx("flat", "approval", "government", "overall", 0.008, "Diplomatic leadership"),
        ],
      },
      wireMessage: copy.settlement,
    },
    {
      outcomeId: "escalation",
      label: "International escalation",
      description: copy.escalation,
      priority: 30,
      conditions: [{ axis: "escalation", min: 6 }],
      intensityDelta: 14,
      pressureDelta: { a: 12, b: 12 },
      campaignDelta: {
        civilianStrain: 12,
        refugees: 8,
        infrastructureDamage: 7,
        armsProliferation: 15,
        regionalSpillover: 10,
        casualties: 8,
        settlementMomentum: -8,
      },
      nextCampaignStage: "operations",
      tensionDelta: 10,
      effectsByRole: {
        belligerent: [cfx("tick", "approval", "government", "overall", -0.02, "Escalating crisis")],
        backer_a: [cfx("tick", "metric", "economy", "gdpGrowth", -0.0025, "Foreign commitment")],
        backer_b: [cfx("tick", "metric", "economy", "gdpGrowth", -0.0025, "Foreign commitment")],
      },
      wireMessage: copy.escalation,
    },
    {
      outcomeId: "coordinated_pressure",
      label: "Coordinated pressure",
      description: "A broad sanctions coalition raises the price of continued confrontation.",
      priority: 20,
      conditions: [{ axis: "sanctions", min: 6 }],
      intensityDelta: -4,
      pressureDelta: { a: -4, b: -4 },
      campaignDelta: { civilianStrain: 3, armsProliferation: -3, settlementMomentum: 10 },
      tensionDelta: -3,
      effectsByRole: {
        neighbor: [
          cfx("tick", "metric", "economy", "gdpGrowth", -0.002, "Regional trade disruption"),
        ],
        bloc: [cfx("tick", "metric", "economy", "gdpGrowth", -0.001, "Sanctions enforcement")],
      },
      wireMessage: "A coordinated sanctions coalition has formed around the crisis.",
    },
    {
      outcomeId: "relief",
      label: "International relief effort",
      description: copy.relief,
      priority: 10,
      conditions: [{ axis: "aid", min: 6 }],
      intensityDelta: -3,
      campaignDelta: { civilianStrain: -12, refugees: -10, settlementMomentum: 8 },
      tensionDelta: -1,
      effectsByRole: {
        bystander: [cfx("flat", "approval", "government", "overall", 0.008, "Relief leadership")],
      },
      wireMessage: copy.relief,
    },
    {
      outcomeId: "stalemate",
      label: "Fractured response",
      description: copy.stalemate,
      priority: 0,
      conditions: [],
      intensityDelta: 2,
      campaignDelta: {
        civilianStrain: 4,
        refugees: 2,
        armsProliferation: 3,
        settlementMomentum: -2,
      },
      tensionDelta: 2,
      wireMessage: copy.stalemate,
    },
  ];
}

function response(copy: ScenarioCopy, phaseKey: string): EventResponseDefinition {
  return {
    windowTurns: 24,
    decisionTrees: decisionTrees(copy, phaseKey),
    defaultOptionIdByRole: {
      belligerent: "concede",
      backer_a: "distance_a",
      backer_b: "distance_b",
      neighbor: "fortify",
      bloc: "allied_mediation",
      bystander: "abstain",
    },
    outcomes: outcomes(copy),
    defaultOutcomeId: "stalemate",
  };
}

function buildDef(copy: ScenarioCopy): LivingConflictDef {
  const phases: ConflictPhase[] = copy.phases.map((phase, index) => {
    const trees = decisionTrees(copy, phase.key);
    return {
      level: index + 1,
      key: phase.key,
      label: phase.label,
      summary: phase.summary,
      earliestYear: index === 0 ? undefined : phase.year,
      advancePressure: 20,
      defcon: phase.defcon,
      decisionTrees: trees,
      events: [
        {
          key: `${phase.key}_entry`,
          kind: "authored",
          severity: phase.defcon <= 2 ? "critical" : "major",
          affects: "all",
          trigger: { onPhaseEnter: true },
          headline: phase.headline,
          body: phase.body,
          response: response(copy, phase.key),
        },
        {
          key: `${phase.key}_consultation`,
          kind: "procedural",
          severity: "major",
          affects: "all",
          trigger: {
            everyTurns: 36,
            campaignStages: ["posture", "mobilization", "operations", "settlement"],
          },
          headline: `${copy.name}: governments are called to respond`,
          body: `${phase.summary} The international balance now depends on what governments do next.`,
          response: response(copy, `${phase.key}_recurring`),
        },
      ],
    };
  });
  return {
    key: copy.key,
    type: copy.type,
    name: copy.name,
    fromYear: copy.fromYear,
    untilYear: copy.untilYear,
    hostCountry: copy.hostCountry,
    participants: copy.participants,
    roleResolver: defaultRoleResolver,
    phases,
  };
}

export const BERLIN_DEF = buildDef({
  key: "berlin",
  name: "Berlin Crisis",
  type: "geopolitical",
  fromYear: 1958,
  untilYear: 1963,
  hostCountry: "DD",
  participants: {
    belligerents: ["DE", "DD"],
    backerA: "US",
    backerB: "RU",
    neighbors: ["PL", "CS"],
    blocMembers: ["UK", "FR", "IT", "TR", "HU", "BG", "RO"],
    bystanders: ["IE", "BR", "NG", "CN", "YU", "JP", "SE", "AT", "FI", "GR", "ES"],
  },
  phases: [
    {
      key: "ultimatum",
      label: "Berlin ultimatum",
      year: 1958,
      summary: "Access rights and the city's status are openly contested.",
      headline: "Ultimatum issued over Berlin",
      body: "The powers are ordered to settle Berlin's status or face unilateral action.",
      defcon: 3,
    },
    {
      key: "checkpoint",
      label: "Checkpoint confrontation",
      year: 1961,
      summary: "Armor and armed patrols face each other across the sector line.",
      headline: "Tanks face off at the Berlin checkpoints",
      body: "A local access dispute has become a direct armed confrontation between the blocs.",
      defcon: 2,
    },
  ],
  settlement:
    "The powers have accepted supervised access guarantees and reopened negotiations over Berlin.",
  escalation:
    "New military guarantees and deployments have turned Berlin into a direct superpower confrontation.",
  relief:
    "International agencies have secured civilian access and emergency supply guarantees for Berlin.",
  stalemate:
    "The international response has split, leaving Berlin divided and the ultimatum unresolved.",
});

export const CONGO_DEF = buildDef({
  key: "congo",
  name: "Congo Crisis",
  type: "proxy_war",
  fromYear: 1960,
  untilYear: 1965,
  hostCountry: "CD",
  participants: {
    belligerents: ["CD"],
    backerA: "US",
    backerB: "RU",
    neighbors: ["NG"],
    blocMembers: ["UK", "FR", "DE", "IT", "DD", "PL", "CS", "HU"],
    bystanders: ["IE", "BR", "CN", "YU", "JP", "SE", "AT", "FI", "TR", "GR"],
  },
  phases: [
    {
      key: "independence_breakdown",
      label: "Independence breakdown",
      year: 1960,
      summary: "Mutiny, secession, and foreign intervention threaten the new state.",
      headline: "Congo's independence descends into crisis",
      body: "The army has mutinied, provinces are breaking away, and foreign governments are choosing clients.",
      defcon: 3,
    },
    {
      key: "proxy_intervention",
      label: "Proxy intervention",
      year: 1961,
      summary: "Competing foreign missions and mercenaries turn collapse into a proxy war.",
      headline: "Foreign intervention deepens in Congo",
      body: "Weapons, advisers, and covert money now sustain rival centers of power.",
      defcon: 3,
    },
  ],
  settlement:
    "International mediation has produced a supervised political settlement and a timetable for foreign withdrawal in Congo.",
  escalation:
    "Competing foreign commitments have transformed the Congo crisis into an open proxy struggle.",
  relief:
    "A multinational relief mission has secured food, medical access, and refugee corridors in Congo.",
  stalemate:
    "Foreign governments have divided over Congo, leaving secession and intervention unchecked.",
});

export const SUEZ_AFTERMATH_DEF = buildDef({
  key: "suez_aftermath",
  name: "Suez and Decolonization Crisis",
  type: "geopolitical",
  fromYear: 1956,
  untilYear: 1962,
  hostCountry: "EG",
  participants: {
    belligerents: ["EG"],
    backerA: "UK",
    backerB: "RU",
    neighbors: ["FR", "TR", "GR"],
    blocMembers: ["US", "DE", "IT", "DD", "PL", "CS"],
    bystanders: ["IE", "BR", "NG", "CN", "YU", "JP", "SE", "AT", "FI"],
  },
  phases: [
    {
      key: "canal_settlement",
      label: "Canal settlement",
      year: 1956,
      summary:
        "Canal control, shipping access, and the legitimacy of intervention remain unsettled.",
      headline: "The Suez settlement divides the powers",
      body: "Withdrawal has not settled who controls the canal or whether old imperial guarantees still carry force.",
      defcon: 3,
    },
    {
      key: "decolonization_wave",
      label: "Decolonization wave",
      year: 1958,
      summary:
        "The canal crisis accelerates demands for sovereignty across Africa and the Middle East.",
      headline: "Suez aftershocks spread through the colonial world",
      body: "National movements cite Suez as proof that imperial control can be broken.",
      defcon: 4,
    },
  ],
  settlement:
    "A supervised canal convention has guaranteed navigation and recognized Egyptian control.",
  escalation:
    "Fresh military guarantees and covert intervention have reopened the Suez confrontation.",
  relief:
    "International shipping and civilian supply corridors have reopened through the canal zone.",
  stalemate: "The powers remain divided over Suez, deepening the crisis of the old colonial order.",
});

export const OIL_DISRUPTION_DEF = buildDef({
  key: "oil_disruption",
  name: "Global Oil Disruption",
  type: "geopolitical",
  fromYear: 1956,
  untilYear: 1975,
  hostCountry: "EG",
  participants: {
    belligerents: ["EG", "SY"],
    backerA: "RU",
    backerB: "US",
    neighbors: ["TR", "GR"],
    blocMembers: ["UK", "FR", "DE", "IT", "JP", "DD", "PL", "CS"],
    bystanders: ["IE", "BR", "NG", "CN", "YU", "SE", "AT", "FI"],
  },
  phases: [
    {
      key: "shipping_shock",
      label: "Shipping shock",
      year: 1956,
      summary:
        "Canal closures and tanker diversions tighten fuel supplies across industrial economies.",
      headline: "Oil shipments disrupted across the world",
      body: "Tankers are rerouting, stocks are falling, and governments must choose between rationing and confrontation.",
      defcon: 4,
    },
    {
      key: "coordinated_embargo",
      label: "Coordinated embargo",
      year: 1967,
      summary: "Producer governments coordinate supply as an instrument of foreign policy.",
      headline: "Oil producers coordinate an embargo",
      body: "Energy supply has become a collective diplomatic weapon with global economic reach.",
      defcon: 3,
    },
  ],
  settlement:
    "Producer and consumer governments have agreed emergency supply guarantees and a shipping settlement.",
  escalation:
    "Military escorts, counter-sanctions, and rival guarantees have widened the oil confrontation.",
  relief:
    "A coordinated fuel-sharing program has stabilized civilian supply across the hardest-hit economies.",
  stalemate:
    "Governments have failed to coordinate, leaving oil supply fragmented and prices under pressure.",
});

export const NUCLEAR_INCIDENT_DEF = buildDef({
  key: "nuclear_incident",
  name: "Nuclear Alert Crisis",
  type: "geopolitical",
  fromYear: 1957,
  untilYear: 1975,
  participants: {
    belligerents: ["US", "RU"],
    neighbors: ["UK", "DE", "DD", "PL", "TR", "JP", "CN"],
    blocMembers: ["FR", "IT", "CS", "HU", "BG", "RO"],
    bystanders: ["IE", "BR", "NG", "YU", "SE", "AT", "FI", "GR", "ES"],
  },
  phases: [
    {
      key: "false_alarm",
      label: "Strategic false alarm",
      year: 1957,
      summary: "Ambiguous radar and bomber reports force decisions before facts are known.",
      headline: "Strategic forces raised on an ambiguous warning",
      body: "Commanders have minutes to decide whether the warning is attack, accident, or instrumentation failure.",
      defcon: 2,
    },
    {
      key: "missile_standoff",
      label: "Missile standoff",
      year: 1962,
      summary:
        "Forward-deployed weapons create a direct test of blockade, withdrawal, and retaliation.",
      headline: "Missile deployment triggers a superpower standoff",
      body: "Strategic weapons near a rival's frontier have brought the world to the edge of war.",
      defcon: 1,
    },
  ],
  settlement:
    "Reciprocal verification and a quiet withdrawal have ended the immediate nuclear alert.",
  escalation:
    "Military alerts and public guarantees have pushed the nuclear confrontation closer to launch.",
  relief:
    "International inspection teams have secured accident sites and restored emergency communications.",
  stalemate:
    "The powers have exchanged warnings but no guarantees, leaving strategic forces on alert.",
});
