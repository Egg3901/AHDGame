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

// Primary historical anchors: the independent 9/11 Commission's account of
// warning, attack, preparedness, and response, https://911commission.gov/report/,
// and the enacted 2001 Authorization for Use of Military Force,
// https://www.congress.gov/bill/107th-congress/senate-joint-resolution/23

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
      `${key}_target`,
      "A transnational threat tests the state",
      "The primary target must balance prevention, emergency powers, and the risk of overreaction.",
      [
        responseOpt(
          "integrated_intelligence",
          "Integrate intelligence and policing",
          "Pool warrants, aviation data, financial intelligence, and criminal investigations.",
          { intelligence: 4, policing: 3, restraint: 1 },
          [],
          0.0002
        ),
        responseOpt(
          "emergency_powers",
          "Seek emergency powers",
          "Expand surveillance and detention authority at a durable civil-liberties cost.",
          { intelligence: 3, coercion: 4 },
          [cfx("tick", "metric", "society", "democraticHealth", -0.002, "Emergency powers")]
        ),
        responseOpt(
          "military_response",
          "Prepare military retaliation",
          "Build a coalition for strikes or intervention once attribution is strong enough.",
          { intervention: 4, escalation: 3 },
          [],
          0.0008
        ),
      ]
    ),
    backer_a: choiceNode(
      `${key}_ally`,
      "An ally requests solidarity",
      "Alliance support may mean intelligence, policing, or military commitments.",
      [
        responseOpt(
          "share_intelligence",
          "Share intelligence",
          "Open liaison and financial-intelligence channels.",
          { intelligence: 4, alliance: 2 }
        ),
        responseOpt(
          "join_coalition",
          "Join the coalition",
          "Commit forces and logistics to a military response.",
          { intervention: 4, alliance: 3 },
          [],
          0.0005
        ),
        responseOpt(
          "lawful_support",
          "Offer limited legal support",
          "Cooperate through courts and policing while withholding troops.",
          { policing: 3, restraint: 2 }
        ),
      ]
    ),
    backer_b: choiceNode(
      `${key}_rival`,
      "A rival power weighs cooperation",
      "Counterterrorism cooperation competes with geopolitical advantage and sovereignty concerns.",
      [
        responseOpt(
          "rival_intelligence",
          "Share selected intelligence",
          "Cooperate against common networks without joining the coalition.",
          { intelligence: 3, restraint: 1 }
        ),
        responseOpt(
          "oppose_intervention",
          "Oppose military intervention",
          "Contest attribution and block a broad mandate.",
          { restraint: 4, alliance: -2 }
        ),
        responseOpt(
          "back_client",
          "Arm a regional client",
          "Exploit the crisis through proxy support.",
          { escalation: 4 }
        ),
      ]
    ),
    neighbor: choiceNode(
      `${key}_host`,
      "Networks cross the frontier",
      "Host and neighboring governments face raids, rendition demands, refugees, and insurgent spillover.",
      [
        responseOpt(
          "joint_policing",
          "Authorize joint policing",
          "Use warrants, financial controls, and supervised arrests.",
          { policing: 4, intelligence: 2 }
        ),
        responseOpt(
          "security_sweep",
          "Launch a security sweep",
          "Use mass detention and military force to break suspected cells.",
          { coercion: 4, escalation: 2 }
        ),
        responseOpt(
          "deny_access",
          "Deny foreign access",
          "Reject outside operations while containing the threat domestically.",
          { restraint: 3, alliance: -1 }
        ),
      ]
    ),
    bloc: choiceNode(
      `${key}_bloc`,
      "The alliance debates its response",
      "Members decide independently how far solidarity extends.",
      [
        responseOpt(
          "bloc_intelligence",
          "Expand intelligence cooperation",
          "Build shared watchlists and financial investigations.",
          { intelligence: 3, alliance: 2 }
        ),
        responseOpt(
          "bloc_intervention",
          "Commit to intervention",
          "Provide forces, basing, and reconstruction funds.",
          { intervention: 3, alliance: 3 },
          [],
          0.0005
        ),
        responseOpt(
          "bloc_policing",
          "Keep the response civilian",
          "Limit cooperation to police, courts, and targeted sanctions.",
          { policing: 4, restraint: 2 }
        ),
      ]
    ),
    bystander: choiceNode(
      `${key}_world`,
      "Global counterterrorism pressure grows",
      "Other governments can cooperate, mediate, or remain outside the campaign.",
      [
        responseOpt(
          "financial_controls",
          "Freeze network finance",
          "Join targeted financial and travel controls.",
          { intelligence: 2, policing: 2 }
        ),
        responseOpt(
          "humanitarian_relief",
          "Fund civilian relief",
          "Support civilians displaced by the response.",
          { aid: 4, restraint: 1 },
          [],
          0.0001
        ),
        responseOpt(
          "neutral",
          "Remain neutral",
          "Avoid operational commitments and preserve diplomatic access.",
          { restraint: 2 }
        ),
      ]
    ),
  };
}

const outcomes: GlobalResponseOutcome[] = [
  {
    outcomeId: "plot_disrupted",
    label: "Plot disrupted",
    description:
      "Coordinated intelligence and policing disrupt an advanced plot without eliminating the network.",
    priority: 60,
    conditions: [
      { axis: "intelligence", min: 8 },
      { axis: "policing", min: 5 },
    ],
    intensityDelta: -10,
    trackDeltas: {
      intelligenceCoverage: 14,
      plotReadiness: -18,
      threatCapability: -8,
      attributionConfidence: 6,
      publicFear: -4,
    },
    nextConflictStatus: "active",
    campaignDelta: { civilianStrain: -4, settlementMomentum: 8 },
    tensionDelta: -3,
    wireMessage: "International intelligence cooperation disrupts a major transnational plot.",
  },
  {
    outcomeId: "policing_campaign",
    label: "Policing-led campaign",
    description:
      "Courts, arrests, and financial investigations degrade the network while limiting blowback.",
    priority: 50,
    conditions: [
      { axis: "policing", min: 7 },
      { axis: "restraint", min: 3 },
    ],
    intensityDelta: -6,
    trackDeltas: {
      threatCapability: -10,
      intelligenceCoverage: 8,
      civilLiberties: -3,
      insurgency: -4,
      warWeariness: -2,
    },
    campaignDelta: { civilianStrain: -3, settlementMomentum: 6 },
    tensionDelta: -2,
    wireMessage: "A coordinated civilian counterterrorism campaign targets networks and finance.",
  },
  {
    outcomeId: "military_intervention",
    label: "Military intervention",
    description:
      "A coalition attacks alleged hosts, degrading capability while risking insurgency and blowback.",
    priority: 45,
    conditions: [
      { axis: "intervention", min: 7 },
      { axis: "alliance", min: 4 },
    ],
    intensityDelta: 8,
    trackDeltas: {
      threatCapability: -8,
      interventionCommitment: 18,
      insurgency: 14,
      warWeariness: 8,
      civilLiberties: -4,
    },
    nextConflictStatus: "active",
    campaignDelta: { casualties: 6, refugees: 6, civilianStrain: 8, regionalSpillover: 8 },
    tensionDelta: 7,
    wireMessage:
      "An international coalition opens a military campaign against alleged network hosts.",
  },
  {
    outcomeId: "coercive_backlash",
    label: "Coercive backlash",
    description:
      "Broad emergency powers raise coverage but deepen fear, grievance, and legal strain.",
    priority: 40,
    conditions: [{ axis: "coercion", min: 7 }],
    intensityDelta: 3,
    trackDeltas: {
      intelligenceCoverage: 6,
      civilLiberties: -12,
      publicFear: 8,
      insurgency: 6,
      threatCapability: -3,
    },
    campaignDelta: { civilianStrain: 5, settlementMomentum: -4 },
    tensionDelta: 3,
    wireMessage:
      "Governments adopt sweeping emergency powers in response to the transnational threat.",
  },
  {
    outcomeId: "attack_breakthrough",
    label: "Attack breakthrough",
    description:
      "Fragmented cooperation leaves an advanced plot able to strike an uncertain target.",
    priority: 0,
    conditions: [],
    intensityDelta: 15,
    trackDeltas: {
      plotReadiness: 15,
      publicFear: 18,
      attributionConfidence: 8,
      allianceCohesion: 4,
    },
    campaignDelta: {
      casualties: 10,
      civilianStrain: 10,
      infrastructureDamage: 4,
      regionalSpillover: 5,
    },
    tensionDelta: 8,
    wireMessage: "A major transnational attack breaks through uneven defenses.",
  },
];

function event(phase: string, headline: string, body: string): ConflictEvent {
  const response: EventResponseDefinition = {
    windowTurns: 24,
    decisionTrees: trees(phase),
    defaultOptionIdByRole: {
      belligerent: "integrated_intelligence",
      backer_a: "share_intelligence",
      backer_b: "oppose_intervention",
      neighbor: "joint_policing",
      bloc: "bloc_intelligence",
      bystander: "neutral",
    },
    outcomes,
    defaultOutcomeId: "attack_breakthrough",
  };
  return {
    key: `${phase}_response`,
    kind: "authored",
    severity: phase === "major_attack" ? "critical" : "major",
    affects: "all",
    trigger: { onPhaseEnter: true, everyTurns: 24 },
    headline,
    body,
    response,
  };
}

export const TRANSNATIONAL_TERRORISM_DEF: LivingConflictDef = {
  key: "transnational_terrorism",
  type: "geopolitical",
  name: "Transnational Terrorism and the War on Terror",
  fromYear: 1998,
  untilYear: 2027,
  autoOpen: true,
  hostCountry: "US",
  participants: {
    belligerents: ["US"],
    backerA: "UK",
    backerB: "RU",
    neighbors: ["TR", "IN"],
    blocMembers: ["DE", "FR", "IT", "ES"],
    bystanders: ["IE", "SE", "BR", "NG", "CN", "JP"],
  },
  participantFallbacks: { US: ["UK", "FR"], UK: ["FR", "DE"], RU: ["CN"] },
  roleResolver: role,
  tracks: {
    threatCapability: { initial: 42 },
    intelligenceCoverage: { initial: 24 },
    plotReadiness: { initial: 28 },
    attributionConfidence: { initial: 10 },
    publicFear: { initial: 12 },
    civilLiberties: { initial: 78 },
    allianceCohesion: { initial: 48 },
    interventionCommitment: { initial: 0 },
    insurgency: { initial: 5 },
    warWeariness: { initial: 0 },
  },
  scheduledPressures: [
    {
      key: "network_growth",
      fromYear: 1998,
      untilYear: 2006,
      everyTurns: 12,
      phaseKeys: ["network_formation", "warning"],
      trackDeltas: { threatCapability: 4, plotReadiness: 5 },
    },
    {
      key: "insurgent_adaptation",
      everyTurns: 12,
      phaseKeys: ["military_campaign", "insurgency"],
      trackDeltas: { insurgency: 4, warWeariness: 3, threatCapability: 1 },
    },
    {
      key: "normalization_pressure",
      everyTurns: 12,
      phaseKeys: ["network_degradation", "normalization"],
      trackDeltas: { publicFear: -3, civilLiberties: 2, warWeariness: -2 },
    },
  ],
  transitions: [
    {
      key: "warnings_mount",
      fromPhase: "network_formation",
      toPhase: "warning",
      conditions: [{ track: "plotReadiness", min: 42 }],
    },
    {
      key: "major_attack",
      fromPhase: "warning",
      toPhase: "major_attack",
      conditions: [
        { track: "plotReadiness", min: 70 },
        { track: "intelligenceCoverage", max: 55 },
      ],
    },
    {
      key: "prevent_attack",
      fromPhase: "warning",
      toPhase: "network_degradation",
      priority: 80,
      conditions: [
        { track: "intelligenceCoverage", min: 62 },
        { track: "threatCapability", max: 38 },
      ],
    },
    {
      key: "launch_intervention",
      fromPhase: "major_attack",
      toPhase: "military_campaign",
      conditions: [
        { track: "attributionConfidence", min: 45 },
        { track: "interventionCommitment", min: 30 },
        { track: "allianceCohesion", min: 45 },
      ],
    },
    {
      key: "civilian_response",
      fromPhase: "major_attack",
      toPhase: "network_degradation",
      priority: 70,
      conditions: [
        { track: "intelligenceCoverage", min: 55 },
        { track: "threatCapability", max: 42 },
      ],
    },
    {
      key: "insurgency_blowback",
      fromPhase: "military_campaign",
      toPhase: "insurgency",
      conditions: [{ track: "insurgency", min: 55 }],
    },
    {
      key: "degrade_from_campaign",
      fromPhase: "military_campaign",
      toPhase: "network_degradation",
      priority: 70,
      conditions: [
        { track: "threatCapability", max: 28 },
        { track: "insurgency", max: 35 },
      ],
    },
    {
      key: "degrade_insurgency",
      fromPhase: "insurgency",
      toPhase: "network_degradation",
      conditions: [
        { track: "threatCapability", max: 30 },
        { track: "insurgency", max: 35 },
      ],
    },
    {
      key: "normalize",
      fromPhase: "network_degradation",
      toPhase: "normalization",
      toStatus: "settled",
      conditions: [
        { track: "threatCapability", max: 20 },
        { track: "plotReadiness", max: 25 },
        { track: "publicFear", max: 35 },
      ],
    },
    {
      key: "renewed_threat",
      fromPhase: "normalization",
      toPhase: "warning",
      toStatus: "active",
      priority: 100,
      conditions: [
        { track: "threatCapability", min: 48 },
        { track: "plotReadiness", min: 45 },
      ],
    },
  ],
  phases: [
    {
      level: 1,
      key: "network_formation",
      label: "Network formation",
      summary: "Transnational networks build finance, sanctuary, and operational links.",
      advancePressure: 100,
      decisionTrees: {},
      events: [
        event(
          "network_formation",
          "A transnational extremist network takes shape",
          "Governments see fragments of a threat whose target, method, and timing remain uncertain."
        ),
      ],
    },
    {
      level: 2,
      key: "warning",
      label: "Warnings and plots",
      summary:
        "Intelligence fragments indicate advanced plots without guaranteeing where they will land.",
      advancePressure: 100,
      decisionTrees: {},
      events: [
        event(
          "warning",
          "Warnings point to an advanced transnational plot",
          "Preparedness can disrupt or displace the plot, but cannot guarantee safety."
        ),
      ],
    },
    {
      level: 3,
      key: "major_attack",
      label: "Major attack and attribution",
      summary:
        "A successful attack creates pressure for attribution, emergency law, and retaliation.",
      advancePressure: 100,
      decisionTrees: {},
      events: [
        event(
          "major_attack",
          "A major attack transforms the security debate",
          "Attribution, alliance support, legality, and proportionality constrain the response."
        ),
      ],
    },
    {
      level: 4,
      key: "military_campaign",
      label: "Military campaign",
      summary:
        "A coalition attacks alleged hosts while confronting civilian harm and uncertain objectives.",
      advancePressure: 100,
      decisionTrees: {},
      events: [
        event(
          "military_campaign",
          "The counterterrorism campaign becomes a war",
          "Coalition commitments, reconstruction, and escalation now shape the threat itself."
        ),
      ],
    },
    {
      level: 5,
      key: "insurgency",
      label: "Insurgency and blowback",
      summary: "Occupation, proxy conflict, and grievance regenerate violence across borders.",
      advancePressure: 100,
      decisionTrees: {},
      events: [
        event(
          "insurgency",
          "The intervention feeds a widening insurgency",
          "Governments must choose escalation, drawdown, negotiation, or a return to civilian tools."
        ),
      ],
    },
    {
      level: 6,
      key: "network_degradation",
      label: "Network degradation",
      summary: "The network is weakened but dispersed while emergency institutions remain.",
      advancePressure: 100,
      decisionTrees: {},
      events: [
        event(
          "network_degradation",
          "The network fragments under sustained pressure",
          "Normalization competes with residual plots, legal disputes, and institutional inertia."
        ),
      ],
    },
    {
      level: 7,
      key: "normalization",
      label: "Normalization",
      summary: "Threat management moves back toward ordinary law, with relapse still possible.",
      advancePressure: 100,
      decisionTrees: {},
      events: [
        event(
          "normalization",
          "Governments debate ending the emergency era",
          "Drawdown, legal repair, and vigilance determine whether normalization lasts."
        ),
      ],
    },
  ],
};
