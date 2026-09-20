import type { CrisisDecisionNode, CrisisDecisionOption } from "@/lib/db/types/crisis";
import type {
  ConflictEvent,
  ConflictRole,
  LivingConflictDef,
  RoleContext,
  RoleEffects,
} from "../types";
import { cfx } from "../effects";

const KEY = "northern_ireland";

function role(ctx: RoleContext): ConflictRole {
  return ctx.belligerents.includes(ctx.countryId) ? "belligerent" : "bystander";
}

function trajectory(
  optionId: string,
  label: string,
  description: string,
  trackDeltas: Record<string, number>,
  nextNodeId: string | null,
  effects: CrisisDecisionOption["effects"] = []
): CrisisDecisionOption {
  return {
    optionId,
    label,
    description,
    effects,
    nextNodeId,
    action: { kind: "livingConflictTrajectory", conflictKey: KEY, trackDeltas },
  };
}

function negotiationTree(): CrisisDecisionNode[] {
  return [
    {
      nodeId: "uk_position",
      type: "choice",
      title: "London chooses its opening",
      description:
        "The Prime Minister and Northern Ireland Secretary must decide whether security policy serves a political process or replaces it.",
      requiredRoles: ["headOfState", "cabinet"],
      requiredCountryIds: ["UK"],
      timeLimitMinutes: 24 * 60,
      options: [
        trajectory(
          "uk_security_first",
          "Keep security policy dominant",
          "Refuse political commitments until armed groups yield.",
          { violence: 7, settlementMomentum: -5, legitimacy: -3 },
          "irish_position",
          [cfx("tick", "approval", "government", "overall", -0.01, "A conflict without an exit")]
        ),
        trajectory(
          "uk_backchannel",
          "Authorize a political backchannel",
          "Give officials room to test principles, sequencing, and an eventual ceasefire.",
          { violence: -4, settlementMomentum: 12, legitimacy: 6, domesticConsent: 3 },
          "irish_position",
          [cfx("tick", "approval", "government", "overall", 0.01, "A credible peace initiative")]
        ),
      ],
    },
    {
      nodeId: "irish_position",
      type: "choice",
      title: "Dublin answers",
      description:
        "The Irish government can coordinate principles and guarantees with London or turn constitutional disagreement into a veto.",
      requiredRoles: ["headOfState", "cabinet"],
      requiredCountryIds: ["IE"],
      timeLimitMinutes: 24 * 60,
      options: [
        trajectory(
          "ie_distance",
          "Withhold coordination",
          "Keep constitutional distance and refuse a shared framework.",
          { settlementMomentum: -6, legitimacy: -4, nationalistConsent: -3 },
          "unionist_position"
        ),
        trajectory(
          "ie_coordinate",
          "Build an Anglo-Irish framework",
          "Coordinate consent principles, guarantees, and channels to the parties.",
          { settlementMomentum: 10, legitimacy: 7, nationalistConsent: 5 },
          "unionist_position",
          [cfx("tick", "approval", "government", "overall", 0.01, "Constructive diplomacy")]
        ),
      ],
    },
    {
      nodeId: "unionist_position",
      type: "choice",
      title: "Unionist participation",
      description:
        "Unionist leaders must decide whether consent is safer inside negotiations or outside them.",
      requiredRoles: ["partyLeader"],
      requiredCountryIds: ["UK"],
      requiredPartyAbbreviations: ["DUP", "UUP"],
      timeLimitMinutes: 24 * 60,
      options: [
        trajectory(
          "unionist_withhold",
          "Withhold participation",
          "Reject the process until its constitutional and security terms change.",
          { unionistConsent: -6, settlementMomentum: -4, violence: 3 },
          "nationalist_position"
        ),
        trajectory(
          "unionist_join",
          "Enter talks with safeguards",
          "Seek consent, decommissioning, and institutional guarantees from inside the process.",
          { unionistConsent: 12, settlementMomentum: 8, legitimacy: 4 },
          "nationalist_position"
        ),
      ],
    },
    {
      nodeId: "nationalist_position",
      type: "choice",
      title: "Nationalist participation",
      description:
        "Nationalist leaders must judge whether constitutional politics can deliver representation and a credible route away from violence.",
      requiredRoles: ["partyLeader"],
      requiredCountryIds: ["UK"],
      requiredPartyAbbreviations: ["SF", "SDLP"],
      timeLimitMinutes: 24 * 60,
      options: [
        trajectory(
          "nationalist_withhold",
          "Withhold participation",
          "Reject the terms and retain pressure outside the talks.",
          { nationalistConsent: -6, settlementMomentum: -4, violence: 4 },
          null
        ),
        trajectory(
          "nationalist_join",
          "Commit to constitutional talks",
          "Pursue equality, cross-border institutions, and consent through negotiation.",
          { nationalistConsent: 12, settlementMomentum: 8, violence: -5, legitimacy: 4 },
          null
        ),
      ],
    },
  ];
}

const negotiationEvent: ConflictEvent = {
  key: "peace_initiative",
  kind: "authored" as const,
  severity: "major" as const,
  affects: ["belligerent"] as ConflictRole[],
  trigger: { onPhaseEnter: true, everyTurns: 24 },
  headline: "A Northern Ireland peace initiative opens",
  body: "London, Dublin, and Northern Ireland's political traditions face linked choices over security, consent, and negotiation.",
  negotiation: { windowTurns: 8, decisionTree: negotiationTree() },
};

const passive: RoleEffects = {
  belligerent: [
    cfx("tick", "approval", "government", "overall", -0.002, "The unresolved Troubles"),
    cfx("tick", "metric", "society", "democraticHealth", -0.001, "Political violence"),
  ],
};

export const NORTHERN_IRELAND_DEF: LivingConflictDef = {
  key: KEY,
  type: "geopolitical",
  name: "The Troubles and Northern Ireland Peace Process",
  fromYear: 1991,
  untilYear: 2027,
  autoOpen: true,
  hostCountry: "UK",
  participants: {
    belligerents: ["UK", "IE"],
    neighbors: [],
    blocMembers: [],
    bystanders: ["US"],
  },
  participantFallbacks: { IE: ["UK", "FR"] },
  roleResolver: role,
  tracks: {
    violence: { initial: 70 },
    settlementMomentum: { initial: 18 },
    legitimacy: { initial: 35 },
    unionistConsent: { initial: 28 },
    nationalistConsent: { initial: 28 },
    decommissioning: { initial: 5 },
    institutionalStability: { initial: 10 },
    domesticConsent: { initial: 30 },
  },
  scheduledPressures: [
    {
      key: "political_exhaustion",
      fromYear: 1991,
      untilYear: 2005,
      everyTurns: 12,
      trackDeltas: { settlementMomentum: 2, legitimacy: 1 },
    },
    {
      key: "spoiler_pressure",
      everyTurns: 18,
      phaseKeys: ["backchannels", "ceasefire", "multiparty_talks", "power_sharing"],
      trackDeltas: { violence: 3, domesticConsent: -1 },
    },
  ],
  transitions: [
    {
      key: "open_backchannels",
      fromPhase: "armed_stalemate",
      toPhase: "backchannels",
      toStatus: "negotiating",
      conditions: [
        { track: "settlementMomentum", min: 35 },
        { track: "legitimacy", min: 40 },
      ],
    },
    {
      key: "reach_ceasefire",
      fromPhase: "backchannels",
      toPhase: "ceasefire",
      toStatus: "ceasefire",
      conditions: [
        { track: "violence", max: 55 },
        { track: "unionistConsent", min: 35 },
        { track: "nationalistConsent", min: 35 },
      ],
    },
    {
      key: "begin_multiparty_talks",
      fromPhase: "ceasefire",
      toPhase: "multiparty_talks",
      toStatus: "negotiating",
      conditions: [
        { track: "settlementMomentum", min: 55 },
        { track: "legitimacy", min: 50 },
      ],
    },
    {
      key: "ratify_agreement",
      fromPhase: "multiparty_talks",
      toPhase: "agreement",
      toStatus: "settled",
      conditions: [
        { track: "settlementMomentum", min: 78 },
        { track: "unionistConsent", min: 60 },
        { track: "nationalistConsent", min: 60 },
        { track: "domesticConsent", min: 55 },
      ],
    },
    {
      key: "form_power_sharing",
      fromPhase: "agreement",
      toPhase: "power_sharing",
      toStatus: "settled",
      conditions: [
        { track: "decommissioning", min: 45 },
        { track: "institutionalStability", min: 45 },
      ],
    },
    {
      key: "talks_break_down",
      fromPhase: "multiparty_talks",
      toPhase: "armed_stalemate",
      toStatus: "active",
      priority: 100,
      conditions: [{ track: "violence", min: 82 }],
    },
    {
      key: "ceasefire_breaks",
      fromPhase: "ceasefire",
      toPhase: "armed_stalemate",
      toStatus: "active",
      priority: 100,
      conditions: [{ track: "violence", min: 82 }],
    },
    {
      key: "institutions_collapse",
      fromPhase: "power_sharing",
      toPhase: "fragile_settlement",
      toStatus: "negotiating",
      priority: 100,
      conditions: [{ track: "institutionalStability", max: 25 }],
    },
    {
      key: "restore_institutions",
      fromPhase: "fragile_settlement",
      toPhase: "power_sharing",
      toStatus: "settled",
      conditions: [
        { track: "institutionalStability", min: 50 },
        { track: "domesticConsent", min: 55 },
      ],
    },
  ],
  phases: [
    {
      level: 1,
      key: "armed_stalemate",
      label: "Armed stalemate",
      summary:
        "Violence persists while governments and parties test whether a political route exists.",
      advancePressure: 100,
      decisionTrees: {},
      passiveEffects: passive,
      events: [negotiationEvent],
    },
    {
      level: 2,
      key: "backchannels",
      label: "Backchannels",
      summary: "Governments and intermediaries test principles, sequencing, and participation.",
      advancePressure: 100,
      decisionTrees: {},
      passiveEffects: passive,
      events: [negotiationEvent],
    },
    {
      level: 3,
      key: "ceasefire",
      label: "Ceasefire",
      summary:
        "A ceasefire creates political space but remains vulnerable to spoilers and exclusion.",
      advancePressure: 100,
      decisionTrees: {},
      passiveEffects: passive,
      events: [negotiationEvent],
    },
    {
      level: 4,
      key: "multiparty_talks",
      label: "Multiparty talks",
      summary: "Parties contest consent, institutions, prisoners, policing, and decommissioning.",
      advancePressure: 100,
      decisionTrees: {},
      passiveEffects: passive,
      events: [negotiationEvent],
    },
    {
      level: 5,
      key: "agreement",
      label: "Agreement and ratification",
      summary: "A settlement exists on paper and must survive ratification and implementation.",
      advancePressure: 100,
      decisionTrees: {},
      passiveEffects: passive,
      events: [negotiationEvent],
    },
    {
      level: 6,
      key: "power_sharing",
      label: "Power sharing",
      summary:
        "Devolved institutions operate, but consent and implementation still determine durability.",
      advancePressure: 100,
      decisionTrees: {},
      passiveEffects: passive,
      events: [negotiationEvent],
    },
    {
      level: 7,
      key: "fragile_settlement",
      label: "Suspended institutions",
      summary:
        "The settlement survives while power sharing is suspended and confidence is rebuilt.",
      advancePressure: 100,
      decisionTrees: {},
      passiveEffects: passive,
      events: [negotiationEvent],
    },
  ],
};
