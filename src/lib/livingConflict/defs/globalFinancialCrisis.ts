import type { GlobalResponseOutcome } from "@/lib/db/types/crisis";
import { choiceNode, responseOpt } from "../authoring";
import { cfx } from "../effects";
import { GLOBAL_FINANCIAL_CRISIS_KEY } from "../financialCrisisKey";
import type {
  ConflictEvent,
  ConflictRole,
  EventResponseDefinition,
  LivingConflictDef,
  RoleContext,
  RoleDecisionTrees,
} from "../types";

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
      `${key}_exposed`,
      "The financial system is under stress",
      "The most exposed governments must choose who bears losses and how much public capacity to commit.",
      [
        {
          ...responseOpt(
            "recapitalize",
            "Recapitalize distressed banks",
            "Inject public capital with ownership and oversight conditions.",
            { rescue: 4, coordination: 2 },
            [cfx("tick", "approval", "government", "overall", -0.01, "Bank rescue backlash")],
            0.02
          ),
          action: { kind: "financialCrisisResponse", response: "recapitalize" },
        },
        {
          ...responseOpt(
            "guarantee",
            "Guarantee bank liabilities",
            "Backstop funding markets while leaving institutions in private hands.",
            { rescue: 3, liquidity: 4 },
            [],
            0.012
          ),
          action: { kind: "financialCrisisResponse", response: "guarantee" },
        },
        {
          ...responseOpt(
            "resolve",
            "Resolve failed institutions",
            "Impose losses on shareholders and creditors while protecting insured depositors.",
            { restructuring: 4, restraint: 2 }
          ),
          action: { kind: "financialCrisisResponse", response: "resolve" },
        },
      ]
    ),
    backer_a: choiceNode(
      `${key}_creditor`,
      "Creditor governments debate a rescue",
      "Fiscal transfers, conditional lending, or creditor losses will determine whether sovereign stress spreads.",
      [
        responseOpt(
          "creditor_facility",
          "Fund a joint rescue facility",
          "Pool fiscal capacity for conditional sovereign and bank support.",
          { coordination: 4, rescue: 3 },
          [],
          0.01
        ),
        responseOpt(
          "austerity",
          "Demand austerity conditions",
          "Require rapid fiscal consolidation before assistance.",
          { austerity: 4, rescue: 1 }
        ),
        responseOpt(
          "creditor_haircut",
          "Accept creditor restructuring",
          "Recognize losses and extend maturities to restore solvency.",
          { restructuring: 4, coordination: 2 }
        ),
      ]
    ),
    backer_b: choiceNode(
      `${key}_reserve`,
      "Reserve holders choose their exposure",
      "Large external creditors can sustain demand, withdraw, or support coordinated stabilization.",
      [
        responseOpt(
          "reserve_support",
          "Maintain sovereign purchases",
          "Keep reserve demand in stressed debt markets.",
          { liquidity: 3, coordination: 2 },
          [],
          0.003
        ),
        responseOpt(
          "reserve_withdrawal",
          "Reduce exposure",
          "Protect reserves while amplifying funding pressure.",
          { austerity: 2, contagion: 4 }
        ),
        responseOpt(
          "imf_support",
          "Support multilateral lending",
          "Channel assistance through a monitored international facility.",
          { rescue: 2, coordination: 4 },
          [],
          0.004
        ),
      ]
    ),
    neighbor: choiceNode(
      `${key}_euro`,
      "Bank and sovereign stress cross borders",
      "Closely integrated governments must choose national protection or shared stabilization.",
      [
        responseOpt(
          "national_backstop",
          "Backstop domestic banks",
          "Use the national treasury to secure deposits and funding.",
          { rescue: 3, liquidity: 2 },
          [],
          0.015
        ),
        responseOpt(
          "fiscal_stimulus",
          "Pass fiscal stimulus",
          "Support employment and demand while accepting higher debt.",
          { stimulus: 4, rescue: 1 },
          [],
          0.018
        ),
        responseOpt(
          "fiscal_consolidation",
          "Consolidate the budget",
          "Cut spending to defend market access despite recession risk.",
          { austerity: 4 }
        ),
      ]
    ),
    bloc: choiceNode(
      `${key}_partners`,
      "Trading partners face global recession",
      "Governments can coordinate stimulus, reinforce liquidity, or protect national balance sheets.",
      [
        responseOpt(
          "coordinated_stimulus",
          "Coordinate stimulus",
          "Sustain demand through simultaneous fiscal support.",
          { stimulus: 3, coordination: 3 },
          [],
          0.012
        ),
        responseOpt(
          "swap_lines",
          "Open liquidity swap lines",
          "Provide foreign-currency funding to solvent institutions.",
          { liquidity: 4, coordination: 2 },
          [],
          0.004
        ),
        responseOpt(
          "ring_fence",
          "Ring-fence national finance",
          "Limit cross-border exposure and preserve domestic liquidity.",
          { restraint: 3, contagion: 2 }
        ),
      ]
    ),
    bystander: choiceNode(
      `${key}_world`,
      "The crash reaches the wider economy",
      "Less exposed states still face trade, capital-flow, and policy choices.",
      [
        responseOpt(
          "multilateral_support",
          "Support multilateral stabilization",
          "Contribute reserves and political backing to a shared response.",
          { coordination: 3, liquidity: 2 },
          [],
          0.002
        ),
        responseOpt(
          "countercyclical_budget",
          "Support domestic demand",
          "Use fiscal space to offset the external shock.",
          { stimulus: 3 },
          [],
          0.008
        ),
        responseOpt(
          "capital_controls",
          "Use temporary capital controls",
          "Reduce destabilizing outflows at a confidence cost.",
          { restraint: 3, restructuring: 1 }
        ),
      ]
    ),
  };
}

const outcomes: GlobalResponseOutcome[] = [
  {
    outcomeId: "coordinated_rescue",
    label: "Coordinated rescue",
    description:
      "Treasury support and international liquidity halt the immediate run while transferring risk to public balance sheets.",
    priority: 60,
    conditions: [
      { axis: "rescue", min: 8 },
      { axis: "coordination", min: 6 },
    ],
    intensityDelta: -10,
    trackDeltas: {
      liquidityStress: -18,
      bankSolvency: 14,
      contagion: -12,
      marketConfidence: 15,
      sovereignSpreads: 8,
      householdDistress: 3,
    },
    campaignDelta: { civilianStrain: -6, settlementMomentum: 12 },
    tensionDelta: -4,
    wireMessage: "Governments launch a coordinated bank recapitalization and liquidity rescue.",
  },
  {
    outcomeId: "stimulus_recovery",
    label: "Coordinated stimulus",
    description:
      "Fiscal support contains unemployment and household losses at a persistent sovereign-debt cost.",
    priority: 50,
    conditions: [
      { axis: "stimulus", min: 7 },
      { axis: "coordination", min: 3 },
    ],
    intensityDelta: -6,
    trackDeltas: {
      householdDistress: -12,
      unemployment: -10,
      recovery: 14,
      sovereignSpreads: 7,
      marketConfidence: 6,
    },
    campaignDelta: { civilianStrain: -8, settlementMomentum: 8 },
    tensionDelta: -2,
    wireMessage: "A coordinated fiscal expansion cushions the global recession.",
  },
  {
    outcomeId: "orderly_restructuring",
    label: "Orderly restructuring",
    description: "Creditor losses restore solvency but tighten credit and test market access.",
    priority: 45,
    conditions: [{ axis: "restructuring", min: 7 }],
    intensityDelta: -3,
    trackDeltas: {
      bankSolvency: 10,
      financialFragility: -10,
      liquidityStress: 6,
      sovereignSpreads: 5,
      recovery: 8,
    },
    campaignDelta: { civilianStrain: 3, settlementMomentum: 6 },
    tensionDelta: 1,
    wireMessage: "Creditors accept an orderly restructuring of distressed financial claims.",
  },
  {
    outcomeId: "austerity_spiral",
    label: "Austerity spiral",
    description:
      "Rapid consolidation protects some creditors while deepening unemployment and sovereign-bank stress.",
    priority: 40,
    conditions: [{ axis: "austerity", min: 7 }],
    intensityDelta: 6,
    trackDeltas: {
      unemployment: 12,
      householdDistress: 10,
      recovery: -10,
      sovereignSpreads: 6,
      marketConfidence: -5,
    },
    campaignDelta: { civilianStrain: 10, settlementMomentum: -5 },
    tensionDelta: 3,
    wireMessage: "Austerity conditions deepen the recession across stressed economies.",
  },
  {
    outcomeId: "cascading_failures",
    label: "Cascading failures",
    description:
      "Fragmented national measures fail to restore funding and institutional failures spread.",
    priority: 0,
    conditions: [],
    intensityDelta: 14,
    trackDeltas: {
      financialFragility: 10,
      liquidityStress: 15,
      bankSolvency: -15,
      contagion: 14,
      householdDistress: 10,
      unemployment: 8,
      marketConfidence: -12,
    },
    campaignDelta: { civilianStrain: 12, infrastructureDamage: 2, settlementMomentum: -8 },
    tensionDelta: 6,
    wireMessage: "Bank failures and frozen funding markets cascade across borders.",
  },
];

function event(phase: string, headline: string, body: string): ConflictEvent {
  const response: EventResponseDefinition = {
    windowTurns: 24,
    decisionTrees: trees(phase),
    defaultOptionIdByRole: {
      belligerent: "resolve",
      backer_a: "creditor_haircut",
      backer_b: "imf_support",
      neighbor: "fiscal_consolidation",
      bloc: "ring_fence",
      bystander: "capital_controls",
    },
    outcomes,
    defaultOutcomeId: "cascading_failures",
  };
  return {
    key: `${phase}_response`,
    kind: "authored",
    severity: phase === "banking_panic" ? "critical" : "major",
    affects: "all",
    trigger: { onPhaseEnter: true, everyTurns: 24 },
    headline,
    body,
    response,
  };
}

export const GLOBAL_FINANCIAL_CRISIS_DEF: LivingConflictDef = {
  key: GLOBAL_FINANCIAL_CRISIS_KEY,
  type: "geopolitical",
  name: "Global Financial and Euro Sovereign-Debt Crisis",
  fromYear: 2007,
  untilYear: 2020,
  autoOpen: true,
  minimumOpeningPressure: 60,
  hostCountry: "US",
  participants: {
    belligerents: ["US", "UK"],
    backerA: "DE",
    backerB: "CN",
    neighbors: ["IE", "ES", "IT"],
    blocMembers: ["FR", "JP", "SE"],
    bystanders: ["RU", "BR", "NG", "IN", "TR"],
  },
  participantFallbacks: { US: ["UK", "FR"], UK: ["FR", "DE"], DE: ["FR", "IT"], CN: ["JP", "RU"] },
  roleResolver: role,
  tracks: {
    financialFragility: { initial: 20 },
    liquidityStress: { initial: 10 },
    bankSolvency: { initial: 75 },
    contagion: { initial: 5 },
    householdDistress: { initial: 10 },
    unemployment: { initial: 10 },
    marketConfidence: { initial: 75 },
    sovereignSpreads: { initial: 10 },
    creditorConsent: { initial: 35 },
    recovery: { initial: 5 },
  },
  scheduledPressures: [
    {
      key: "balance_sheet_feedback",
      everyTurns: 12,
      phaseKeys: ["liquidity_stress", "institutional_failure", "banking_panic"],
      trackDeltas: { liquidityStress: 4, bankSolvency: -3, contagion: 3, marketConfidence: -3 },
    },
    {
      key: "recession_feedback",
      everyTurns: 12,
      phaseKeys: ["recession", "sovereign_stress"],
      trackDeltas: { householdDistress: 3, unemployment: 3, recovery: -2 },
    },
    {
      key: "balance_sheet_repair",
      everyTurns: 12,
      phaseKeys: ["stabilization"],
      trackDeltas: {
        financialFragility: -3,
        liquidityStress: -3,
        bankSolvency: 3,
        recovery: 4,
        unemployment: -2,
      },
    },
  ],
  transitions: [
    {
      key: "liquidity_break",
      fromPhase: "credit_boom",
      toPhase: "liquidity_stress",
      conditions: [
        { track: "financialFragility", min: 50 },
        { track: "liquidityStress", min: 35 },
      ],
    },
    {
      key: "early_containment",
      fromPhase: "liquidity_stress",
      toPhase: "stabilization",
      toStatus: "settled",
      priority: 80,
      conditions: [
        { track: "liquidityStress", max: 25 },
        { track: "marketConfidence", min: 65 },
      ],
    },
    {
      key: "institution_fails",
      fromPhase: "liquidity_stress",
      toPhase: "institutional_failure",
      conditions: [
        { track: "bankSolvency", max: 48 },
        { track: "liquidityStress", min: 48 },
      ],
    },
    {
      key: "panic_spreads",
      fromPhase: "institutional_failure",
      toPhase: "banking_panic",
      conditions: [
        { track: "contagion", min: 45 },
        { track: "marketConfidence", max: 45 },
      ],
    },
    {
      key: "recession_begins",
      fromPhase: "banking_panic",
      toPhase: "recession",
      conditions: [
        { track: "householdDistress", min: 40 },
        { track: "unemployment", min: 35 },
      ],
    },
    {
      key: "sovereign_feedback",
      fromPhase: "recession",
      toPhase: "sovereign_stress",
      conditions: [
        { track: "sovereignSpreads", min: 45 },
        { track: "bankSolvency", max: 55 },
      ],
    },
    {
      key: "recovery_from_recession",
      fromPhase: "recession",
      toPhase: "stabilization",
      toStatus: "settled",
      priority: 70,
      conditions: [
        { track: "recovery", min: 55 },
        { track: "unemployment", max: 35 },
      ],
    },
    {
      key: "sovereign_stabilization",
      fromPhase: "sovereign_stress",
      toPhase: "stabilization",
      toStatus: "settled",
      conditions: [
        { track: "recovery", min: 60 },
        { track: "sovereignSpreads", max: 35 },
        { track: "creditorConsent", min: 50 },
      ],
    },
    {
      key: "relapse",
      fromPhase: "stabilization",
      toPhase: "sovereign_stress",
      toStatus: "active",
      priority: 100,
      conditions: [
        { track: "sovereignSpreads", min: 60 },
        { track: "contagion", min: 45 },
      ],
    },
  ],
  phases: [
    {
      level: 1,
      key: "credit_boom",
      label: "Credit boom at the limit",
      summary: "Leverage and weak market absorption leave the financial system vulnerable.",
      advancePressure: 100,
      decisionTrees: {},
      events: [
        event(
          "credit_boom",
          "Credit vulnerabilities reach a breaking point",
          "Live leverage, funding, liquidity, and solvency conditions now threaten a systemic break."
        ),
      ],
    },
    {
      level: 2,
      key: "liquidity_stress",
      label: "Liquidity stress",
      summary: "Funding markets seize while governments and central banks assess solvency.",
      advancePressure: 100,
      decisionTrees: {},
      events: [
        event(
          "liquidity_stress",
          "Wholesale funding markets seize",
          "Liquidity support may contain the run or conceal deeper insolvency."
        ),
      ],
    },
    {
      level: 3,
      key: "institutional_failure",
      label: "Institutional failure or rescue",
      summary: "A major institution must fail, restructure, or receive public support.",
      advancePressure: 100,
      decisionTrees: {},
      events: [
        event(
          "institutional_failure",
          "A systemically important institution is failing",
          "Public rescue, resolution, guarantees, and creditor losses compete under severe time pressure."
        ),
      ],
    },
    {
      level: 4,
      key: "banking_panic",
      label: "Global banking panic",
      summary: "Cross-border exposures transmit bank failures and freeze credit.",
      advancePressure: 100,
      decisionTrees: {},
      events: [
        event(
          "banking_panic",
          "Banking panic spreads across borders",
          "National measures now create spillovers that require coordination or accelerate contagion."
        ),
      ],
    },
    {
      level: 5,
      key: "recession",
      label: "Recession and fiscal response",
      summary: "Credit contraction reaches employment, firms, households, budgets, and elections.",
      advancePressure: 100,
      decisionTrees: {},
      events: [
        event(
          "recession",
          "The financial crash becomes a global recession",
          "Stimulus, austerity, and restructuring distribute losses differently and shape recovery."
        ),
      ],
    },
    {
      level: 6,
      key: "sovereign_stress",
      label: "Sovereign-bank feedback",
      summary:
        "Bank rescues and recession weaken sovereigns whose debt anchors bank balance sheets.",
      advancePressure: 100,
      decisionTrees: {},
      events: [
        event(
          "sovereign_stress",
          "Sovereign and bank balance sheets pull each other down",
          "Creditor governments, stressed members, and reserve holders decide whether the monetary order holds."
        ),
      ],
    },
    {
      level: 7,
      key: "stabilization",
      label: "Stabilization and repair",
      summary:
        "Balance-sheet repair and recovery proceed while debt, unemployment, and backlash persist.",
      advancePressure: 100,
      decisionTrees: {},
      events: [
        event(
          "stabilization",
          "Markets stabilize but the crisis legacy remains",
          "Debt repair, employment recovery, regulation, and creditor consent determine whether stabilization lasts."
        ),
      ],
    },
  ],
};
