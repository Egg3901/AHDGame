import type {
  ConflictPhase,
  EventResponseDefinition,
  LivingConflictDef,
  RoleDecisionTrees,
} from "../types";
import type { GlobalResponseOutcome } from "@/lib/db/types/crisis";
import { defaultRoleResolver } from "../roles";
import { cfx } from "../effects";
import { choiceNode, responseOpt } from "../authoring";

const VIETNAM_PARTICIPANTS: LivingConflictDef["participants"] = {
  belligerents: ["SVN", "NVN"],
  backerA: "US",
  backerB: "RU",
  neighbors: ["CN"],
  blocMembers: ["UK", "FR", "DE", "JP", "IT", "TR", "DD", "PL", "HU", "CS", "BG", "RO"],
  bystanders: ["IE", "BR", "NG", "YU", "SE", "AT", "FI", "GR", "ES", "BLR", "UKR", "BAL"],
};

function responseTrees(phaseKey: string, level: number): RoleDecisionTrees {
  const supportCost = 0.0005 * level;
  return {
    backer_a: choiceNode(
      `${phaseKey}_west`,
      "Washington weighs the next commitment",
      "The administration must decide how much of its credibility and treasury to put behind Saigon.",
      [
        responseOpt(
          "deepen_west",
          "Deepen the commitment",
          "Send money, materiel, and advisers to the South.",
          { escalation: 3, aid: 1 },
          [cfx("tick", "approval", "government", "overall", -0.012 * level, "War commitment")],
          supportCost
        ),
        responseOpt("hold_west", "Hold the line", "Maintain the present commitment.", {
          restraint: 1,
        }),
        responseOpt(
          "withdraw_west",
          "Press for an exit",
          "Freeze expansion and push both Vietnamese governments toward talks.",
          { restraint: 3, mediation: 2 },
          [cfx("flat", "approval", "government", "overall", -0.015, "Hawkish backlash")]
        ),
      ]
    ),
    backer_b: choiceNode(
      `${phaseKey}_east`,
      "The Politburo weighs the next commitment",
      "Moscow must balance solidarity with Hanoi against the danger of a wider confrontation.",
      [
        responseOpt(
          "deepen_east",
          "Increase military support",
          "Ship weapons, technicians, and hard currency to the North.",
          { escalation: 3, aid: 1 },
          [cfx("tick", "metric", "economy", "gdpGrowth", -0.001 * level, "Foreign war outlay")],
          supportCost
        ),
        responseOpt("hold_east", "Maintain support", "Keep the existing aid pipeline open.", {
          restraint: 1,
        }),
        responseOpt(
          "talks_east",
          "Sponsor negotiations",
          "Use leverage in Hanoi to open an international conference.",
          { restraint: 3, mediation: 2 },
          [cfx("flat", "approval", "government", "overall", -0.01, "Hardliner criticism")]
        ),
      ]
    ),
    neighbor: choiceNode(
      `${phaseKey}_neighbor`,
      "The war approaches China's frontier",
      "Beijing must decide whether Vietnam is a revolutionary obligation, a security buffer, or a trap.",
      [
        responseOpt(
          "arm_north",
          "Arm the North",
          "Open supply corridors and train Vietnamese units.",
          { escalation: 2, aid: 2 },
          [cfx("tick", "metric", "economy", "gdpGrowth", -0.003, "Regional military aid")],
          0.0004
        ),
        responseOpt(
          "guard_border",
          "Guard the frontier",
          "Reinforce the border but avoid entering the war.",
          {
            restraint: 2,
          }
        ),
        responseOpt(
          "host_talks",
          "Offer to host talks",
          "Invite both sides to a regional conference.",
          {
            mediation: 3,
            restraint: 2,
          }
        ),
      ]
    ),
    bloc: choiceNode(
      `${phaseKey}_ally`,
      "An ally asks where you stand",
      "Alliance councils want a public answer and practical support.",
      [
        responseOpt(
          "military_aid",
          "Join the support effort",
          "Provide transport, equipment, or military specialists.",
          { escalation: 2, solidarity: 2 },
          [cfx("tick", "approval", "government", "overall", -0.012, "Foreign entanglement")],
          0.00025
        ),
        responseOpt(
          "humanitarian_aid",
          "Send humanitarian aid",
          "Fund hospitals, food relief, and refugee support without joining combat.",
          { aid: 3, restraint: 1 },
          [cfx("flat", "approval", "government", "overall", 0.01, "Humanitarian leadership")],
          0.00015
        ),
        responseOpt(
          "decline_allied",
          "Decline involvement",
          "Keep the country outside the conflict.",
          {
            restraint: 1,
          }
        ),
      ]
    ),
    bystander: choiceNode(
      `${phaseKey}_bystander`,
      "Vietnam reaches the cabinet table",
      "Even neutral governments face pressure to mediate, assist civilians, or choose a camp.",
      [
        responseOpt(
          "mediate",
          "Back an international conference",
          "Use diplomatic capital to press for talks.",
          {
            mediation: 3,
            restraint: 2,
          }
        ),
        responseOpt(
          "relief",
          "Fund civilian relief",
          "Send food, medicine, and refugee assistance through neutral channels.",
          { aid: 3 },
          [],
          0.0001
        ),
        responseOpt(
          "neutral",
          "Declare strict neutrality",
          "Refuse military alignment with either side.",
          {
            restraint: 1,
          }
        ),
      ]
    ),
  };
}

function outcomes(level: number): GlobalResponseOutcome[] {
  return [
    {
      outcomeId: "conference",
      label: "International conference",
      description:
        "A broad diplomatic coalition forces both camps into talks and slows the military timetable.",
      priority: 40,
      conditions: [
        { axis: "mediation", min: 6 },
        { axis: "restraint", min: 5 },
      ],
      intensityDelta: -12,
      pressureDelta: { a: -8, b: -8 },
      effectsByRole: {
        bystander: [cfx("flat", "approval", "government", "overall", 0.012, "Diplomatic success")],
      },
      wireMessage:
        "A coalition of governments has forced the Vietnam parties into an international conference.",
    },
    {
      outcomeId: "internationalized",
      label: "The war internationalizes",
      description:
        "Military commitments from several capitals widen the war and accelerate the next escalation.",
      priority: 30,
      conditions: [{ axis: "escalation", min: 6 }],
      intensityDelta: 12 + level,
      pressureDelta: { a: 12, b: 12 },
      effectsByRole: {
        backer_a: [cfx("tick", "approval", "government", "overall", -0.015, "Widening war")],
        backer_b: [cfx("tick", "approval", "government", "overall", -0.012, "Widening war")],
        bloc: [cfx("tick", "metric", "economy", "gdpGrowth", -0.002, "Alliance war effort")],
      },
      wireMessage: "Fresh foreign commitments have internationalized the war in Vietnam.",
    },
    {
      outcomeId: "relief_corridor",
      label: "International relief corridor",
      description: "Civilian aid becomes the one field on which rival governments can cooperate.",
      priority: 20,
      conditions: [{ axis: "aid", min: 6 }],
      intensityDelta: -4,
      effectsByRole: {
        bloc: [cfx("flat", "approval", "government", "overall", 0.008, "Relief effort")],
        bystander: [cfx("flat", "approval", "government", "overall", 0.008, "Relief effort")],
      },
      wireMessage: "An international relief corridor has opened across the Vietnamese front.",
    },
    {
      outcomeId: "stalemate",
      label: "Diplomatic stalemate",
      description: "Governments issue statements, but the balance on the ground does not change.",
      priority: 0,
      conditions: [],
      intensityDelta: 2,
      wireMessage:
        "The international response to Vietnam has fractured, leaving the war's course unchanged.",
    },
  ];
}

function response(phaseKey: string, level: number): EventResponseDefinition {
  return {
    windowTurns: 24,
    decisionTrees: responseTrees(phaseKey, level),
    defaultOptionIdByRole: {
      backer_a: "hold_west",
      backer_b: "hold_east",
      neighbor: "guard_border",
      bloc: "decline_allied",
      bystander: "neutral",
    },
    outcomes: outcomes(level),
    defaultOutcomeId: "stalemate",
  };
}

function phase(
  level: number,
  key: string,
  label: string,
  summary: string,
  earliestYear: number,
  defcon: number,
  procurementDrag: number,
  headline: string,
  body: string
): ConflictPhase {
  const decisions = responseTrees(key, level);
  return {
    level,
    key,
    label,
    summary,
    earliestYear: level === 1 ? undefined : earliestYear,
    advancePressure: 24,
    defcon,
    decisionTrees: decisions,
    passiveEffects: {
      backer_a: [
        cfx("tick", "metric", "economy", "gdpGrowth", procurementDrag, "War economy drag"),
      ],
      backer_b: [
        cfx("tick", "metric", "economy", "gdpGrowth", procurementDrag, "War economy drag"),
      ],
    },
    events: [
      {
        key: `${key}_entry`,
        kind: "authored",
        severity: level >= 4 ? "critical" : "major",
        affects: "all",
        trigger: { onPhaseEnter: true },
        headline,
        body,
        response: response(key, level),
      },
      {
        key: `${key}_world_response`,
        kind: "procedural",
        severity: level >= 4 ? "critical" : "major",
        affects: "all",
        trigger: { everyTurns: 24 },
        headline: `${label}: the world is asked to respond`,
        body: `${summary} Governments must decide whether to widen the commitment, contain it, or organize relief.`,
        response: response(`${key}_recurring`, level),
      },
    ],
  };
}

export const VIETNAM_DEF: LivingConflictDef = {
  key: "vietnam",
  type: "proxy_war",
  name: "Vietnam War",
  fromYear: 1955,
  untilYear: 1975,
  hostCountry: "SVN",
  participants: VIETNAM_PARTICIPANTS,
  roleResolver: defaultRoleResolver,
  phases: [
    phase(
      1,
      "advisors",
      "Military advisors",
      "Foreign advisers and training missions multiply on both sides.",
      1955,
      4,
      -0.001,
      "Advisors deploy to Vietnam",
      "Foreign officers are now shaping the war on both sides of the line."
    ),
    phase(
      2,
      "materiel",
      "Materiel and money",
      "Weapons, trucks, aircraft, and hard currency move into Vietnam in quantity.",
      1959,
      4,
      -0.002,
      "Arms shipments to Vietnam step up",
      "The fighting remains Vietnamese, but its supply lines now run through foreign capitals."
    ),
    phase(
      3,
      "tonkin_incident",
      "Naval incident",
      "A clash at sea changes the legal and diplomatic footing of the war.",
      1964,
      3,
      -0.004,
      "Naval incident reported in the gulf",
      "Conflicting reports of a naval clash hand governments a decision they cannot postpone."
    ),
    phase(
      4,
      "air_campaign",
      "Air campaign",
      "Sustained bombing turns commitment into an open military campaign.",
      1965,
      3,
      -0.006,
      "Sustained bombing campaign opens",
      "A continuous air campaign has begun over the North."
    ),
    phase(
      5,
      "ground_commitment",
      "Ground commitment",
      "Combat divisions are ashore and the draft bites at home.",
      1966,
      2,
      -0.011,
      "Ground troops committed",
      "Foreign combat divisions have entered the war in strength."
    ),
    phase(
      6,
      "full_war",
      "Full war",
      "A land war in Asia grinds on with no ceiling and no exit date.",
      1968,
      2,
      -0.018,
      "The war has no exit",
      "The conflict has become a full international war measured in bodies, budgets, and collapsing patience."
    ),
  ],
};
