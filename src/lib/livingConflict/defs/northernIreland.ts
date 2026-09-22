import type { CrisisDecisionNode, CrisisDecisionOption } from "@/lib/db/types/crisis";
import type {
  ConflictEvent,
  ConflictRole,
  LivingConflictDef,
  RoleContext,
  RoleEffects,
} from "../types";

// Primary historical anchor: the UK government's published Belfast Agreement,
// including consent, institutions, decommissioning, policing, prisoners, and
// British-Irish machinery: https://www.gov.uk/government/publications/the-belfast-agreement
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
  const constructive = (trackDeltas.settlementMomentum ?? 0) > 0;
  return {
    optionId,
    label,
    description,
    effects,
    nextNodeId,
    action: {
      kind: "livingConflictTrajectory",
      conflictKey: KEY,
      trackDeltas,
      regionalEffects: {
        regionId: "NIR",
        independenceDesireDelta: constructive ? -1 : 2,
        devolutionSatisfactionDelta: constructive ? 2 : -2,
      },
    },
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
          {
            unionistConsent: 12,
            settlementMomentum: 8,
            legitimacy: 4,
            institutionalStability: 6,
          },
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
          "regional_executive_position"
        ),
        trajectory(
          "nationalist_join",
          "Commit to constitutional talks",
          "Pursue equality, cross-border institutions, and consent through negotiation.",
          {
            nationalistConsent: 12,
            settlementMomentum: 8,
            violence: -5,
            legitimacy: 4,
            decommissioning: 12,
          },
          "regional_executive_position"
        ),
      ],
    },
    {
      nodeId: "regional_executive_position",
      type: "choice",
      title: "Northern Ireland executive implementation",
      description:
        "Where a regional executive exists, its First Minister must decide whether devolved institutions will carry the settlement into practice.",
      requiredRoles: ["stateGovernor"],
      requiredCountryIds: ["UK"],
      requiredRegionIds: ["NIR"],
      timeLimitMinutes: 24 * 60,
      options: [
        trajectory(
          "executive_unavailable",
          "No functioning executive commits",
          "The process continues without a functioning regional executive behind implementation.",
          { institutionalStability: -2 },
          null
        ),
        trajectory(
          "executive_implement",
          "Commit the executive to implementation",
          "Use devolved institutions to build policing, administrative, and cross-community confidence.",
          { institutionalStability: 14, domesticConsent: 6, legitimacy: 4 },
          null
        ),
      ],
    },
  ];
}

function ratificationTree(): CrisisDecisionNode[] {
  return [
    {
      nodeId: "uk_ratification",
      type: "choice",
      title: "Westminster ratification",
      description:
        "The UK government must decide whether to place the negotiated settlement before Parliament.",
      requiredRoles: ["headOfState", "cabinet"],
      requiredCountryIds: ["UK"],
      timeLimitMinutes: 24 * 60,
      options: [
        trajectory(
          "uk_withhold_ratification",
          "Withhold the settlement bill",
          "Keep the agreement out of Parliament and return the process to uncertainty.",
          { settlementMomentum: -10, legitimacy: -8, domesticConsent: -5 },
          "irish_ratification"
        ),
        {
          optionId: "uk_introduce_ratification",
          label: "Introduce the settlement bill",
          description: "Put the agreement to a real, contestable vote in Westminster.",
          effects: [cfx("tick", "approval", "government", "overall", 0.01, "Peace legislation")],
          nextNodeId: "irish_ratification",
          action: {
            kind: "livingConflictRatificationBill",
            conflictKey: KEY,
            title: "Northern Ireland Settlement and Institutions Bill",
            summary:
              "A bill to ratify the negotiated Northern Ireland settlement and authorize its devolved and cross-border institutions.",
            category: "northern_ireland_peace",
            trackDeltas: { settlementMomentum: 8, domesticConsent: 5, legitimacy: 4 },
          },
        },
      ],
    },
    {
      nodeId: "irish_ratification",
      type: "choice",
      title: "Dáil ratification",
      description:
        "The Irish government must decide whether to place its constitutional and institutional commitments before the Dáil.",
      requiredRoles: ["headOfState", "cabinet"],
      requiredCountryIds: ["IE"],
      timeLimitMinutes: 24 * 60,
      options: [
        trajectory(
          "ie_withhold_ratification",
          "Withhold the ratification bill",
          "Decline to bind Ireland to the negotiated institutions and guarantees.",
          { settlementMomentum: -10, legitimacy: -8, nationalistConsent: -5 },
          null
        ),
        {
          optionId: "ie_introduce_ratification",
          label: "Introduce the ratification bill",
          description: "Put Ireland's commitments to a real, contestable vote in the Dáil.",
          effects: [cfx("tick", "approval", "government", "overall", 0.01, "Peace legislation")],
          nextNodeId: null,
          action: {
            kind: "livingConflictRatificationBill",
            conflictKey: KEY,
            title: "British-Irish Agreement Ratification Bill",
            summary:
              "A bill to ratify Ireland's commitments under the negotiated Northern Ireland settlement and its cross-border institutions.",
            category: "northern_ireland_peace",
            trackDeltas: { settlementMomentum: 8, domesticConsent: 5, legitimacy: 4 },
          },
        },
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

const ratificationEvent: ConflictEvent = {
  key: "agreement_ratification",
  kind: "authored",
  severity: "major",
  affects: ["belligerent"],
  trigger: { onPhaseEnter: true, everyTurns: 24 },
  headline: "The Northern Ireland settlement faces ratification",
  body: "The negotiated text now requires separate, contestable authorization in Westminster and the Dáil.",
  negotiation: { windowTurns: 8, decisionTree: ratificationTree() },
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
    ratificationAuthorization: { initial: 0, min: 0, max: 2 },
    ratificationFailureCount: { initial: 0, min: 0, max: 2 },
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
        { track: "ratificationAuthorization", min: 2 },
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
      events: [ratificationEvent],
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
