import type { Crisis, CrisisEffect, CrisisTemplate } from "@/lib/db/types/crisis";
import { toNativeEffectValue } from "@/lib/crises/effectScale";
import { WARSAW_PACT_BLOC_COUNTRY_IDS } from "@/lib/crises/warsawPactSatellites";
import { getVietnamEscalationLevel } from "@/lib/crises/vietnamEscalationInterface";

/** Resolve a template's default duration for a given scope.
 *  Prefers `durationByScope[scope]`, then falls back to `durationTurns`,
 *  then returns `null` (indefinite). */
export function getTemplateDuration(
  template: CrisisTemplate,
  scope: Crisis["scope"]
): number | null {
  if (template.durationByScope?.[scope] !== undefined) {
    return template.durationByScope[scope] ?? null;
  }
  return template.durationTurns ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// REALISTIC CRISIS TEMPLATES
// Grounded in real-world economics and politics. No fantasy values.
// Effects are modest (1-5% swings) and duration-bound.
// ─────────────────────────────────────────────────────────────────────────────

// Designer vocabulary → canonical stateMetrics schema (see src/lib/db/types/stateMetrics.ts).
// Crisis effects are applied with $inc on `${category}.${field}.value`, so a name that
// doesn't exist in the schema would silently create a dead, unread field. This table binds
// the human-readable concepts used in the templates below to real metric paths. Consumer and
// investor confidence are real per-state metrics (economic.consumerConfidence /
// economic.investorConfidence, engine-computed in registry/economic.ts), so crisis shocks
// land on the same fields the margin/valuation systems read. Inflation is national, not a
// stateMetric, and is handled separately in fx() (see below).
const METRIC_ALIASES: Record<string, { category: string; field: string }> = {
  "economy.gdp": { category: "economic", field: "gdpGrowth" },
  "economy.unemployment": { category: "economic", field: "unemploymentRate" },
  "economy.consumerConfidence": { category: "economic", field: "consumerConfidence" },
  "economy.investorConfidence": { category: "economic", field: "investorConfidence" },
  "economy.exports": { category: "economic", field: "tradeBalance" },
  "economy.realWages": { category: "economic", field: "medianIncome" },
  "economy.renewableShare": { category: "environment", field: "renewableEnergy" },
  "economy.foodPrices": { category: "economic", field: "costOfLiving" },
  "economy.housing": { category: "economic", field: "propertyValueIndex" },
  "infrastructure.damage": { category: "infrastructure", field: "infrastructureInvestmentGap" },
  "infrastructure.power": { category: "infrastructure", field: "powerGridReliability" },
  "publicsafety.confidence": { category: "publicSafety", field: "publicSafetyConfidence" },
};

function fx(
  effectType: "flat" | "tick",
  targetType: "metric" | "approval" | "profitMargin" | "stat",
  metricCategory: string,
  metricField: string,
  // Authored as a FRACTIONAL swing (e.g. -0.02 = "a 2% swing"). The turn engine
  // applies effects as a raw $inc in native metric units (gdpGrowth ~1.5,
  // approvalRating 0-100, inflationRate ~2.5), so we convert here via
  // toNativeEffectValue (×100 flat, ×30 tick). See effectScale.ts.
  swing: number,
  label: string
): CrisisEffect {
  const value = toNativeEffectValue(effectType, swing);
  // Inflation is national (federalBudget.economicFactors.inflationRate), not a per-state metric,
  // so route "economy.inflation" to the dedicated inflation target. The per-turn inflation
  // recalc blends the shock through ~35% inertia, so it decays naturally over following turns.
  if (targetType === "metric" && metricCategory === "economy" && metricField === "inflation") {
    return {
      effectType,
      targetType: "inflation",
      metricCategory: null,
      metricField: null,
      value,
      sectorType: null,
      strategyId: null,
      label,
    };
  }
  // Stat effects bypass metric aliases, they target character stats directly.
  if (targetType === "stat") {
    return {
      effectType,
      targetType: "stat",
      statKey: metricCategory, // e.g. "charisma", "statecraft"
      metricCategory: null,
      metricField: null,
      value,
      sectorType: null,
      strategyId: null,
      label,
    };
  }
  // Only metric effects are written by path; approval/profitMargin ignore category/field.
  const resolved =
    targetType === "metric" ? METRIC_ALIASES[`${metricCategory}.${metricField}`] : undefined;
  return {
    effectType,
    targetType,
    metricCategory: resolved?.category ?? metricCategory,
    metricField: resolved?.field ?? metricField,
    value,
    sectorType: null,
    strategyId: null,
    label,
  };
}

/**
 * One-time, real GDP output loss for physical-destruction disasters. `fraction`
 * is the share of the affected region's GDP destroyed at onset (0.005-0.03 →
 * 0.5%-3%), applied once as a multiplicative cut to `state.gdp`. Surfaced in the
 * UI as "X% of GDP lost · $Ybn". Prefer this over a `economy.gdp` growth-rate
 * shock for earthquakes/hurricanes/etc., the growth-rate path is for persistent
 * economic crises, not one-off destruction.
 */
function gdpLoss(fraction: number, label: string): CrisisEffect {
  return {
    effectType: "flat",
    targetType: "gdpLoss",
    metricCategory: null,
    metricField: null,
    value: fraction,
    sectorType: null,
    strategyId: null,
    label,
  };
}

/**
 * A single, steady profit-margin shock for economic crises. Authored in
 * percentage points (NOT scaled, bypasses fx()), it lands at full `value` on the
 * onset turn and ramps linearly to 0 at expiry, exactly like the infrastructure-
 * disaster margin penalty. Applied as a read-time blend on every corp in the
 * crisis's scope (see disasterMarginPenalty.ts / buildLookups resolveCrisisStateIds),
 * so unlike the per-turn `tick` metric effects it is one sustained, decaying hit
 * rather than a repeated nibble. `value` should be negative (a margin loss).
 *
 * `physicality` (P3.5) decides how the shock bites under the plants tier:
 * "physical" converts the percentage points into a production haircut (less
 * tonnage), "financial" keeps it a margin hit at unchanged tonnage. Default is
 * "financial", the conservative choice, and the only one that is safe for
 * already-spawned crises, which carry no flag. Classify a template "physical"
 * only when the event plainly STOPS output (power cut, plant halt, port shut,
 * inputs unavailable); anything that is a price, credit, demand or sentiment
 * shock stays financial.
 */
function marginShock(
  value: number,
  label: string,
  physicality: "physical" | "financial" = "financial",
  /** Restrict the shock to one corporation sector type (e.g. "manufacturing").
   *  The per-turn margin/production application (crisisTurn.ts) already filters
   *  on `sectorType`, so this concentrates the hit on the struck industry
   *  instead of every corp in scope. Absent = economy-wide (legacy). */
  sectorType: string | null = null
): CrisisEffect {
  return {
    effectType: "decay",
    targetType: "profitMargin",
    metricCategory: null,
    metricField: null,
    value,
    sectorType,
    strategyId: null,
    label,
    physicality,
  };
}

// ── FINANCIAL / ECONOMIC ───────────────────────────────────────────────────

export const BANKING_CRISIS_TEMPLATE: CrisisTemplate = {
  name: "Banking Crisis",
  heroImage:
    "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1600&q=70",
  description:
    "A major financial institution faces insolvency. Credit markets freeze, lending dries up, and consumer confidence plummets.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 8,
  durationByScope: { country: 8, global: 10 },
  effects: [
    marginShock(-7, "Credit freeze squeezes corporate margins"),
    fx("tick", "metric", "economy", "gdp", -0.025, "GDP contraction from credit freeze"),
    fx("tick", "metric", "economy", "unemployment", 0.02, "Unemployment from bank failures"),
    fx(
      "tick",
      "metric",
      "economy",
      "inflation",
      -0.008,
      "Deflationary pressure from credit crunch"
    ),
    fx("tick", "metric", "economy", "investorConfidence", -0.03, "Investor confidence collapse"),
    fx("tick", "approval", "government", "overall", -0.04, "Government approval erosion"),
  ],
  wireMessageOnStart: "A banking crisis has erupted. Credit markets freeze and lending dries up.",
  wireMessageOnEnd: "The banking crisis subsides. Credit markets begin to thaw.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "bailout",
        type: "choice",
        title: "Banking crisis response",
        description: "A major bank is insolvent. What is your government's response?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "bailout_yes",
            label: "Bailout",
            description:
              "Inject public funds to stabilize the bank. Costs 2% of GDP from treasury, reduces crisis duration by 3 turns.",
            nextNodeId: "oversight",
            effects: [fx("flat", "metric", "economy", "gdp", -0.02, "Bailout fiscal cost")],
          },
          {
            optionId: "bailout_no",
            label: "Let it fail",
            description:
              "Allow the bank to collapse. No immediate cost, but crisis duration extends by 2 turns and unemployment spikes.",
            nextNodeId: "contagion",
            effects: [
              fx(
                "flat",
                "metric",
                "economy",
                "unemployment",
                0.03,
                "Bank failure unemployment spike"
              ),
            ],
          },
          {
            optionId: "bailout_nationalize",
            label: "Nationalize",
            description:
              "Take the bank into public ownership. No treasury cost, but approval drops sharply among business voters.",
            nextNodeId: "oversight",
            effects: [
              fx(
                "flat",
                "approval",
                "business",
                "overall",
                -0.08,
                "Nationalization business backlash"
              ),
            ],
          },
        ],
      },
      {
        nodeId: "oversight",
        type: "choice",
        title: "Post-crisis regulation",
        description: "Post-crisis, what regulatory response do you pursue?",
        requiredRoles: ["cabinet"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "oversight_strict",
            label: "Strict Regulation",
            description:
              "Impose capital requirements and break up too-big-to-fail institutions. Reduces future crisis probability.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "approval", "business", "overall", -0.05, "Regulation business cost"),
              fx("flat", "approval", "government", "overall", 0.03, "Regulation public support"),
            ],
          },
          {
            optionId: "oversight_light",
            label: "Light Touch",
            description:
              "Minimal new regulation. Business approval recovers, but future crisis risk remains elevated.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "approval", "business", "overall", 0.03, "Light touch business relief"),
            ],
          },
        ],
      },
      {
        nodeId: "contagion",
        type: "choice",
        title: "Contagion spread",
        description:
          "Contagion spreads to other institutions. Other national leaders may contribute to a stabilization fund.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "contagion_contribute",
            label: "Contribute to Stabilization Fund",
            description:
              "Donate 0.5% of GDP to a joint stabilization fund. Reduces crisis duration by 1 turn per contributor.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "gdp", -0.005, "Stabilization fund contribution"),
            ],
          },
          {
            optionId: "contagion_wait",
            label: "Wait and See",
            description: "No action. The crisis runs its full course.",
            nextNodeId: "terminal",
            effects: [],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Crisis resolved",
        description: "The banking crisis resolution is complete.",
        outcomeMessage:
          "Credit markets have begun to thaw and lending is slowly resuming. The worst of the financial panic has passed, though unemployment and economic confidence will take additional time to recover.",
        outcomeEffects: [
          fx("flat", "metric", "economy", "unemployment", -0.01, "Jobs recovery as credit thaws"),
          fx(
            "flat",
            "metric",
            "economy",
            "investorConfidence",
            0.015,
            "Investor confidence partial restoration"
          ),
        ],
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const RECESSION_TEMPLATE: CrisisTemplate = {
  name: "Recession",
  autoTrigger: {
    kind: "condition",
    cooldownTurns: 144,
    condition: { all: [{ metric: "gdpGrowth", op: "lt", threshold: 0, consecutiveTurns: 3 }] },
  },
  heroImage:
    "https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&w=1600&q=70",
  description:
    "Two consecutive quarters of negative GDP growth. Consumer spending falls, business investment stalls, and unemployment rises.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 12,
  durationByScope: { country: 12, global: 14, region: 8 },
  effects: [
    marginShock(-6, "Demand slump compresses margins"),
    fx("tick", "metric", "economy", "gdp", -0.022, "GDP contraction from recession"),
    fx(
      "tick",
      "metric",
      "economy",
      "unemployment",
      0.015,
      "Unemployment from business contraction"
    ),
    fx("tick", "metric", "economy", "consumerConfidence", -0.03, "Consumer confidence collapse"),
    fx("tick", "metric", "economy", "investorConfidence", -0.025, "Investor confidence collapse"),
    fx("tick", "approval", "government", "overall", -0.03, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "The economy has entered recession. GDP contracts for two consecutive quarters.",
  wireMessageOnEnd: "The recession ends. GDP returns to growth.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "stimulus",
        type: "choice",
        title: "Recession response",
        description: "The economy is in recession. What is your fiscal response?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "stimulus_austerity",
            label: "Austerity",
            description:
              "Cut government spending to balance the budget. Reduces debt but deepens the recession.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "gdp", -0.02, "Austerity GDP deepening"),
              fx("flat", "metric", "economy", "unemployment", 0.015, "Austerity unemployment rise"),
              fx("flat", "approval", "government", "overall", -0.05, "Austerity public backlash"),
            ],
          },
          {
            optionId: "stimulus_moderate",
            label: "Moderate Stimulus",
            description:
              "Increase spending on infrastructure and unemployment benefits. Costs 1.5% of GDP, reduces duration by 2 turns.",
            nextNodeId: "terminal",
            effects: [fx("flat", "metric", "economy", "gdp", -0.015, "Stimulus fiscal cost")],
          },
          {
            optionId: "stimulus_large",
            label: "Large Stimulus",
            description:
              "Massive public works and direct cash transfers. Costs 3% of GDP, reduces duration by 4 turns, but risks inflation.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "gdp", -0.03, "Large stimulus fiscal cost"),
              fx("flat", "metric", "economy", "inflation", 0.02, "Stimulus inflation pressure"),
            ],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Response complete",
        description: "The recession response is complete.",
        outcomeMessage:
          "The fiscal response has been deployed and economic conditions are stabilizing. Consumer spending is cautiously returning, and layoffs are beginning to slow as businesses regain confidence.",
        outcomeEffects: [
          fx("flat", "metric", "economy", "unemployment", -0.008, "Hiring cautiously resumes"),
          fx(
            "flat",
            "metric",
            "economy",
            "consumerConfidence",
            0.015,
            "Consumer confidence partial recovery"
          ),
        ],
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

// ── P3.5: COST-SIDE MARGIN SHOCKS AND THE PLANTS DOUBLE-COUNT ────────────────
// Four templates below author their margin shock as a rise in the cost of
// INPUTS: Inflation Spike, Energy Crisis, Currency Crisis (imported inputs) and
// Trade War (tariffed inputs). Under the plants tier a sector pays for its
// inputs physically, an explicit inputs-cost line valued at live commodity
// prices, so any input-price movement the market itself produces is already in
// the P&L and must not be charged a second time as margin points.
//
// These four are nonetheless kept at FULL magnitude and classified "financial",
// because the market does NOT reproduce them: crisis effects never write
// commodity prices, so nothing in the physical inputs-cost line moves when an
// Inflation Spike or an Energy Crisis fires. Their margin points ARE the
// residual financial shock, not a duplicate of it. Zeroing them under plants
// would delete the effect outright rather than de-duplicate it.
//
// The one template that IS a real quantity shock, Supply Chain Disruption,
// where inputs are unavailable rather than expensive, is instead reclassified
// "physical", so it cuts tonnage through the production factor and stops being
// an unpriced margin hit. That is the double-count guard: reclassification, not
// magnitude zeroing. If a future template literally raises modelled commodity
// prices, its plants-mode magnitude must go to 0 here.
export const INFLATION_SPIKE_TEMPLATE: CrisisTemplate = {
  name: "Inflation Spike",
  autoTrigger: {
    kind: "condition",
    cooldownTurns: 144,
    condition: { all: [{ metric: "inflationRate", op: "gt", threshold: 7 }] },
  },
  heroImage:
    "https://images.unsplash.com/photo-1604719312566-8912e9227c6a?auto=format&fit=crop&w=1600&q=70",
  description:
    "Rapid price increases erode purchasing power. Wage-price spirals threaten, and central banks face pressure to act.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 6,
  durationByScope: { country: 6, global: 8, region: 4 },
  effects: [
    marginShock(-4, "Input-cost inflation erodes margins") /* see P3.5 cost-side note above */,
    fx("tick", "metric", "economy", "inflation", 0.03, "Inflation acceleration"),
    fx("tick", "metric", "economy", "consumerConfidence", -0.02, "Consumer confidence erosion"),
    fx("tick", "metric", "economy", "realWages", -0.025, "Real wage decline"),
    fx("tick", "approval", "government", "overall", -0.03, "Government approval erosion"),
  ],
  wireMessageOnStart: "Inflation is spiking rapidly. Prices rise and purchasing power erodes.",
  wireMessageOnEnd: "Inflation moderates. Price stability returns.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Inflation response",
        description: "Inflation is spiking. What is your government's response?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_rates",
            label: "Raise Interest Rates",
            description:
              "The central bank hikes rates aggressively. Cools inflation but risks recession. Duration reduced by 2 turns.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "gdp", -0.01, "Rate hike GDP cooling"),
              fx("flat", "metric", "economy", "unemployment", 0.005, "Rate hike unemployment"),
            ],
          },
          {
            optionId: "response_wage",
            label: "Wage Controls",
            description:
              "Cap wage increases to break the spiral. Unpopular with workers but effective. Duration reduced by 3 turns.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "approval", "workers", "overall", -0.06, "Wage control worker backlash"),
            ],
          },
          {
            optionId: "response_wait",
            label: "Wait It Out",
            description: "No intervention. Inflation runs its course. Full duration applies.",
            nextNodeId: "terminal",
            effects: [],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Response complete",
        description: "The inflation spike response is complete.",
        outcomeMessage:
          "The anti-inflation measures are taking effect and price growth is moderating. Purchasing power is beginning to recover, though wage-price pressures will ease only gradually.",
        outcomeEffects: [
          fx("flat", "metric", "economy", "inflation", -0.015, "Disinflation from policy response"),
          fx("flat", "metric", "economy", "realWages", 0.01, "Real wage partial recovery"),
        ],
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

// ── NATURAL DISASTERS ────────────────────────────────────────────────────────

export const HURRICANE_TEMPLATE: CrisisTemplate = {
  naturalDisaster: true,
  geo: { countries: ["US"], requiresRegionTags: ["coastal"] },
  name: "Hurricane",
  heroImage:
    "https://images.unsplash.com/photo-1457327289196-f38b88d97147?auto=format&fit=crop&w=1600&q=70",
  description:
    "A Category 4 hurricane has made landfall in {location}, shredding power lines and flooding entire neighborhoods as storm surge pushes miles inland. Tens of thousands have fled to shelters, ports and refineries are shut down, and emergency crews are wading through debris to reach those stranded on rooftops. Officials warn it could take weeks to restore power and clear the worst-hit coastal communities.",
  scope: "region",
  countryIds: [],
  regionIds: [],
  durationTurns: 4,
  durationByScope: { region: 4, country: 6 },
  effects: [
    gdpLoss(0.02, "Hurricane GDP shock"),
    fx("tick", "metric", "economy", "unemployment", 0.025, "Unemployment from displacement"),
    fx("tick", "metric", "infrastructure", "damage", 0.08, "Infrastructure damage accumulation"),
    fx("tick", "approval", "government", "overall", -0.03, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "A major hurricane has struck {location}, leaving coastal regions facing severe flooding, damage, and mass displacement.",
  wireMessageOnEnd: "Hurricane recovery is underway. Infrastructure repairs begin.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Hurricane response",
        description: "A hurricane has devastated coastal regions. What is the immediate response?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_federal",
            label: "Federal Emergency Declaration",
            description:
              "Mobilize federal disaster relief. Costs 0.5% of GDP, reduces duration by 1 turn.",
            nextNodeId: "rebuild",
            effects: [fx("flat", "metric", "economy", "gdp", -0.005, "Federal relief cost")],
          },
          {
            optionId: "response_state",
            label: "State-Led Response",
            description:
              "Let state governors handle relief. No federal cost, but slower recovery. Full duration.",
            nextNodeId: "rebuild",
            effects: [],
          },
        ],
      },
      {
        nodeId: "rebuild",
        type: "choice",
        title: "Reconstruction fund",
        description: "Other national leaders may contribute to the reconstruction fund.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "rebuild_contribute",
            label: "Contribute to Reconstruction",
            description: "Donate 0.25% of GDP to the reconstruction fund.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "gdp", -0.0025, "Reconstruction contribution"),
            ],
          },
          {
            optionId: "rebuild_skip",
            label: "Decline",
            description: "No contribution. Reconstruction proceeds at base pace.",
            nextNodeId: "terminal",
            effects: [],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Recovery complete",
        description: "Hurricane recovery is complete.",
        outcomeMessage:
          "Relief crews have cleared the worst debris and power has been restored to most affected areas. Reconstruction is underway, and displaced residents are beginning to return to their communities.",
        outcomeEffects: [
          fx("flat", "metric", "infrastructure", "damage", -0.04, "Reconstruction progress"),
          fx("flat", "metric", "economy", "unemployment", -0.012, "Rebuilding jobs"),
        ],
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const EARTHQUAKE_TEMPLATE: CrisisTemplate = {
  naturalDisaster: true,
  geo: { requiresRegionTags: ["seismic"] },
  name: "Earthquake",
  heroImage:
    "https://images.unsplash.com/photo-1677233860259-ce1a8e0f8498?auto=format&fit=crop&w=1600&q=70",
  description:
    "A magnitude 7.2 earthquake has struck {location}, toppling buildings and severing highways and rail lines across the region. Hospitals are overwhelmed, power and water service have failed for hundreds of thousands, and search-and-rescue crews are racing to reach survivors trapped in the rubble. Aftershocks continue to rattle the area as the full scale of the damage comes into focus.",
  scope: "region",
  countryIds: [],
  regionIds: [],
  durationTurns: 6,
  durationByScope: { region: 6, country: 8 },
  effects: [
    gdpLoss(0.03, "Earthquake GDP shock"),
    fx("tick", "metric", "economy", "unemployment", 0.03, "Unemployment from business closures"),
    fx("tick", "metric", "infrastructure", "damage", 0.1, "Infrastructure damage accumulation"),
    fx("tick", "approval", "government", "overall", -0.04, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "A major earthquake has struck {location}, collapsing buildings and triggering urgent search-and-rescue operations across the region.",
  wireMessageOnEnd: "Earthquake recovery continues. Reconstruction efforts are scaling up.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Earthquake response",
        description: "An earthquake has devastated a major city. What is the immediate response?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_martial",
            label: "Declare Martial Law",
            description:
              "Military controls the disaster zone. Looting stops, but civil liberties are suspended. Duration reduced by 1 turn.",
            nextNodeId: "aid",
            effects: [
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                -0.04,
                "Martial law civil liberty cost"
              ),
            ],
          },
          {
            optionId: "response_civilian",
            label: "Civilian-Led Response",
            description:
              "Civilian agencies coordinate relief. Slower but preserves civil liberties. Full duration.",
            nextNodeId: "aid",
            effects: [],
          },
        ],
      },
      {
        nodeId: "aid",
        type: "choice",
        title: "International aid",
        description:
          "International aid is needed for reconstruction. Other national leaders may contribute.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "aid_contribute",
            label: "Send Aid",
            description: "Contribute 0.5% of GDP in reconstruction aid.",
            nextNodeId: "terminal",
            effects: [fx("flat", "metric", "economy", "gdp", -0.005, "Aid contribution cost")],
          },
          {
            optionId: "aid_skip",
            label: "No Aid",
            description: "No contribution. The affected region recovers on its own.",
            nextNodeId: "terminal",
            effects: [],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Recovery underway",
        description: "Earthquake recovery is underway.",
        outcomeMessage:
          "Reconstruction crews have restored the worst-hit districts. The recovery cost the treasury, but stability is returning and infrastructure is being rebuilt.",
        outcomeEffects: [
          fx("flat", "metric", "infrastructure", "damage", -0.05, "Reconstruction progress"),
          fx("flat", "metric", "economy", "unemployment", -0.015, "Rebuilding jobs"),
        ],
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const WILDFIRE_TEMPLATE: CrisisTemplate = {
  naturalDisaster: true,
  geo: { requiresRegionTags: ["wildfire"] },
  name: "Wildfire",
  heroImage:
    "https://images.unsplash.com/photo-1692364221415-654b20e6d1d2?auto=format&fit=crop&w=1600&q=70",
  description:
    "A fast-moving wildfire is tearing through {location}, incinerating homes and forcing entire towns to flee ahead of the flames. Thick smoke has pushed air quality to hazardous levels for miles, grounding aircraft and shuttering schools and businesses. Exhausted crews are cutting fire lines around the clock as shifting winds threaten to drive the blaze into populated areas.",
  scope: "region",
  countryIds: [],
  regionIds: [],
  durationTurns: 3,
  durationByScope: { region: 3, country: 5 },
  effects: [
    gdpLoss(0.01, "Wildfire GDP shock"),
    fx("tick", "metric", "environment", "airQuality", -0.12, "Air quality degradation"),
    fx("tick", "metric", "infrastructure", "damage", 0.04, "Infrastructure damage from fire"),
    fx("tick", "approval", "government", "overall", -0.02, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "A massive wildfire is burning across {location}, where air quality has turned hazardous and evacuations are underway.",
  wireMessageOnEnd: "The wildfire is contained. Air quality begins to improve.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Wildfire response",
        description: "A wildfire is burning out of control. What is the response?",
        requiredRoles: ["stateGovernor"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_evacuate",
            label: "Mandatory Evacuation",
            description:
              "Order full evacuation of threatened areas. Saves lives but displaces thousands and damages the economy.",
            nextNodeId: "fund",
            effects: [fx("flat", "metric", "economy", "gdp", -0.01, "Evacuation economic cost")],
          },
          {
            optionId: "response_defend",
            label: "Defend in Place",
            description:
              "Focus firefighting resources on protecting population centers. Riskier but less economic disruption.",
            nextNodeId: "fund",
            effects: [
              fx("flat", "metric", "economy", "gdp", -0.005, "Defend economic cost"),
              fx("flat", "approval", "government", "overall", -0.03, "Defend risk public concern"),
            ],
          },
        ],
      },
      {
        nodeId: "fund",
        type: "collective",
        title: "Wildfire suppression fund",
        description:
          "National leaders may contribute to a shared suppression fund. The more it raises, the faster the fire is contained. Full funding cuts the remaining duration roughly in half.",
        collectiveTarget: 10_000_000,
        collectiveCurrency: "USD",
        requiredRoles: ["headOfState", "cabinet", "stateGovernor"],
        timeLimitMinutes: 1440, // 24h window for contributions before auto-resolution
        options: [
          {
            optionId: "contribute_5m",
            label: "Contribute $5M",
            description: "Commit $5M from the treasury to suppression efforts.",
            collectiveContribution: 5_000_000,
            nextNodeId: "terminal",
            effects: [],
          },
          {
            optionId: "contribute_2m",
            label: "Contribute $2M",
            description: "Commit $2M from the treasury to suppression efforts.",
            collectiveContribution: 2_000_000,
            nextNodeId: "terminal",
            effects: [],
          },
          {
            optionId: "decline",
            label: "Decline to contribute",
            description: "Make no contribution to the fund.",
            collectiveContribution: 0,
            nextNodeId: "terminal",
            effects: [],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Wildfire contained",
        description: "The wildfire has been contained and recovery begins.",
        outcomeMessage:
          "Smoke has cleared and air quality is improving as containment lines hold and crews begin clearing burned structures.",
        outcomeEffects: [
          fx("flat", "metric", "environment", "airQuality", 0.05, "Air quality recovers"),
          fx("flat", "metric", "infrastructure", "damage", -0.02, "Rebuilding burned structures"),
        ],
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

// ── POLITICAL / SOCIAL ───────────────────────────────────────────────────────

export const MASS_PROTESTS_TEMPLATE: CrisisTemplate = {
  name: "Mass Protests",
  autoTrigger: {
    kind: "condition",
    cooldownTurns: 144,
    condition: {
      all: [
        { metric: "approval", op: "lt", threshold: 35 },
        { metric: "unemploymentRate", op: "gt", threshold: 8 },
      ],
    },
  },
  heroImage:
    "https://images.unsplash.com/photo-1591259622709-bdb033b4be2b?auto=format&fit=crop&w=1600&q=70",
  description:
    "Widespread civil unrest erupts over economic inequality and government corruption. Streets are occupied, transport disrupted, and investor confidence shaken.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 5,
  durationByScope: { country: 5, region: 4, global: 8 },
  effects: [
    marginShock(-3, "Unrest disrupts commerce and margins"),
    fx("tick", "metric", "economy", "gdp", -0.015, "Protest GDP disruption"),
    fx("tick", "metric", "economy", "investorConfidence", -0.04, "Investor confidence erosion"),
    fx("tick", "approval", "government", "overall", -0.05, "Government approval collapse"),
  ],
  wireMessageOnStart:
    "Mass protests have erupted nationwide. Civil unrest disrupts commerce and shakes investor confidence.",
  wireMessageOnEnd: "The protests subside. Normalcy gradually returns.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Protest response",
        description: "Mass protests are sweeping the nation. How do you respond?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_reform",
            label: "Promise Reform",
            description:
              "Announce anti-corruption and economic reforms. Reduces unrest but requires follow-through.",
            nextNodeId: "followthrough",
            effects: [
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                0.03,
                "Reform promise approval boost"
              ),
            ],
          },
          {
            optionId: "response_crackdown",
            label: "Crack Down",
            description:
              "Deploy security forces to clear streets. Ends protests quickly but damages international reputation and approval.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "approval", "government", "overall", -0.08, "Crackdown approval collapse"),
              fx(
                "flat",
                "metric",
                "economy",
                "investorConfidence",
                -0.05,
                "Crackdown investor flight"
              ),
            ],
          },
          {
            optionId: "response_ignore",
            label: "Ignore",
            description: "No official response. Protests continue at full intensity.",
            nextNodeId: "terminal",
            effects: [],
          },
        ],
      },
      {
        nodeId: "followthrough",
        type: "choice",
        title: "Reform follow-through",
        description: "You promised reform. Do you follow through?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "followthrough_yes",
            label: "Enact Reforms",
            description:
              "Pass anti-corruption legislation and economic redistribution. Costs political capital but stabilizes the country.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "approval", "government", "overall", 0.05, "Reform enactment approval"),
              fx("flat", "metric", "economy", "gdp", -0.005, "Reform transition cost"),
            ],
          },
          {
            optionId: "followthrough_no",
            label: "Backtrack",
            description: "Abandon reform promises. Protests reignite with renewed intensity.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "approval", "government", "overall", -0.06, "Backtrack betrayal penalty"),
              fx("flat", "metric", "economy", "gdp", -0.01, "Backtrack renewed unrest cost"),
            ],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Crisis resolved",
        description: "The protest crisis is resolved.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const POLITICAL_SCANDAL_TEMPLATE: CrisisTemplate = {
  name: "Political Scandal",
  heroImage:
    "https://images.unsplash.com/photo-1742413628282-b8b3ff1b7557?auto=format&fit=crop&w=1600&q=70",
  description:
    "A major corruption scandal implicates senior government officials. Media coverage is relentless, opposition demands resignations, and public trust collapses.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 4,
  durationByScope: { country: 4, global: 6 },
  effects: [
    fx("tick", "approval", "government", "overall", -0.06, "Scandal approval collapse"),
    fx("tick", "metric", "economy", "investorConfidence", -0.03, "Investor confidence erosion"),
    fx("flat", "stat", "charisma", "", -0.5, "Scandal damages personal credibility"),
    fx("flat", "stat", "statecraft", "", -0.3, "Scandal undermines political skill"),
  ],
  wireMessageOnStart:
    "A major political scandal has broken. Senior officials are implicated and public trust collapses.",
  wireMessageOnEnd: "The scandal fades from headlines. Political damage lingers.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Scandal response",
        description: "A corruption scandal has engulfed your government. How do you respond?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_resign",
            label: "Resign",
            description:
              "Step down to preserve institutional integrity. Ends the crisis immediately but you leave office.",
            nextNodeId: "terminal",
            effects: [],
          },
          {
            optionId: "response_investigate",
            label: "Independent Investigation",
            description:
              "Appoint an independent prosecutor. Takes time but may clear your name. Duration reduced by 1 turn.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                0.02,
                "Investigation transparency boost"
              ),
            ],
          },
          {
            optionId: "response_deny",
            label: "Deny and Attack",
            description:
              "Dismiss the scandal as fake news and attack the media. Polarizes the country but rallies your base.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "approval", "government", "overall", -0.03, "Denial credibility loss"),
              fx("flat", "approval", "base", "overall", 0.04, "Denial base rally"),
            ],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Scandal complete",
        description: "The scandal has run its course.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

// ── GEOPOLITICAL / SECURITY ──────────────────────────────────────────────────

export const TRADE_WAR_TEMPLATE: CrisisTemplate = {
  name: "Trade War",
  autoTrigger: { kind: "random", cooldownTurns: 216, scope: "global", spawnChance: 0.003 },
  heroImage:
    "https://images.unsplash.com/photo-1613690399151-65ea69478674?auto=format&fit=crop&w=1600&q=70",
  description:
    "A major trading partner imposes punitive tariffs on your exports. Retaliatory measures escalate, supply chains reorient, and export sectors suffer.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 10,
  durationByScope: { country: 10, global: 12 },
  effects: [
    marginShock(-4, "Tariff costs compress margins") /* see P3.5 cost-side note */,
    fx("tick", "metric", "economy", "gdp", -0.018, "Trade war GDP drag"),
    fx("tick", "metric", "economy", "exports", -0.04, "Export sector collapse"),
    fx("tick", "metric", "economy", "inflation", 0.012, "Tariff inflation pass-through"),
    fx("tick", "approval", "government", "overall", -0.02, "Government approval erosion"),
  ],
  wireMessageOnStart: "A trade war has begun. Tariffs disrupt exports and supply chains.",
  wireMessageOnEnd: "The trade war ends. Tariffs are lifted and trade normalizes.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Trade war strategy",
        description: "A trade war has erupted. What is your strategy?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_retaliate",
            label: "Retaliate",
            description:
              "Impose matching tariffs. Escalates the conflict but shows strength. Duration extends by 2 turns.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                0.03,
                "Retaliation nationalist boost"
              ),
              fx(
                "flat",
                "metric",
                "economy",
                "inflation",
                0.01,
                "Retaliation consumer price impact"
              ),
            ],
          },
          {
            optionId: "response_negotiate",
            label: "Negotiate",
            description:
              "Seek a diplomatic solution. Reduces duration by 3 turns but requires concessions.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                -0.02,
                "Negotiation concession backlash"
              ),
            ],
          },
          {
            optionId: "response_diversify",
            label: "Diversify Trade",
            description:
              "Pivot to new trading partners. No immediate tariff relief but builds long-term resilience. Duration reduced by 1 turn.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "exports", 0.01, "Diversification export recovery"),
            ],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Strategy set",
        description: "The trade war strategy is set.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const CYBER_ATTACK_TEMPLATE: CrisisTemplate = {
  name: "Cyber Attack",
  // Commercial internet era. A 1953 or 1979 world that actually reaches 1995
  // can have one; the old preset-keyed gate blocked a 1991 world forever.
  fromYear: 1995,
  autoTrigger: { kind: "random", cooldownTurns: 144, scope: "country", spawnChance: 0.0035 },
  heroImage:
    "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=1600&q=70",
  description:
    "A state-sponsored cyber attack cripples critical infrastructure. Power grids flicker, financial systems stall, and classified data is exfiltrated.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 3,
  effects: [
    marginShock(-4, "Operational disruption hits margins"),
    fx("flat", "metric", "economy", "gdp", -0.03, "Cyber attack GDP shock"),
    fx("tick", "metric", "infrastructure", "damage", 0.08, "Critical infrastructure damage"),
    fx("tick", "metric", "publicsafety", "confidence", -0.06, "Public safety confidence collapse"),
    fx("tick", "approval", "government", "overall", -0.04, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "A major cyber attack has crippled critical infrastructure. Power and financial systems are disrupted.",
  wireMessageOnEnd: "Systems are restored. Cybersecurity posture is under review.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Cyber attack response",
        description: "A cyber attack has crippled infrastructure. What is the response?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_retaliate",
            label: "Retaliate in Kind",
            description:
              "Launch a counter-cyber operation. Escalates the conflict but deters future attacks.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "metric",
                "publicsafety",
                "confidence",
                0.05,
                "Retaliation deterrence boost"
              ),
              fx("flat", "approval", "government", "overall", 0.02, "Retaliation public support"),
            ],
          },
          {
            optionId: "response_defend",
            label: "Defensive Hardening",
            description:
              "Invest in cybersecurity infrastructure. Costs 0.5% of GDP but prevents recurrence.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "metric",
                "infrastructure",
                "damage",
                -0.12,
                "Hardening security improvement"
              ),
            ],
          },
          {
            optionId: "response_diplomatic",
            label: "Diplomatic Protest",
            description:
              "File formal protests and seek sanctions. No immediate effect but builds international pressure.",
            nextNodeId: "terminal",
            effects: [],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Response complete",
        description: "The cyber attack response is complete.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const ENERGY_CRISIS_TEMPLATE: CrisisTemplate = {
  name: "Energy Crisis",
  autoTrigger: { kind: "random", cooldownTurns: 216, scope: "global", spawnChance: 0.004 },
  heroImage:
    "https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?auto=format&fit=crop&w=1600&q=70",
  description:
    "A supply shock disrupts energy markets. Oil and gas prices spike, manufacturing costs soar, and households face heating and transport crises.",
  scope: "global",
  countryIds: [],
  regionIds: [],
  durationTurns: 6,
  durationByScope: { global: 6, country: 8, region: 5 },
  effects: [
    marginShock(-5, "Energy-cost surge compresses margins") /* see P3.5 cost-side note */,
    fx("tick", "metric", "economy", "inflation", 0.025, "Energy inflation spike"),
    fx("tick", "metric", "economy", "gdp", -0.015, "Energy supply shock GDP drag"),
    fx("tick", "metric", "economy", "consumerConfidence", -0.025, "Consumer confidence erosion"),
    fx("tick", "approval", "government", "overall", -0.025, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "An energy crisis has hit global markets. Fuel prices spike and supply chains strain.",
  wireMessageOnEnd: "Energy markets stabilize. Prices moderate and supply normalizes.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Energy crisis response",
        description: "Energy prices are spiking. What is your government's response?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_subsidies",
            label: "Consumer Subsidies",
            description:
              "Cap energy prices and subsidize households. Costs 1% of GDP but shields consumers.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "approval", "government", "overall", 0.03, "Subsidy consumer relief"),
              fx("flat", "metric", "economy", "inflation", -0.005, "Subsidy price dampening"),
            ],
          },
          {
            optionId: "response_strategic",
            label: "Release Strategic Reserves",
            description:
              "Tap strategic petroleum reserves. No treasury cost but depletes reserves.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "metric",
                "infrastructure",
                "power",
                -0.08,
                "Reserve depletion strains grid resilience"
              ),
              fx(
                "flat",
                "metric",
                "economy",
                "inflation",
                -0.01,
                "Reserve release price dampening"
              ),
            ],
          },
          {
            optionId: "response_accelerate",
            label: "Accelerate Renewables",
            description:
              "Fast-track renewable energy projects. Long-term benefit but no immediate price relief.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "renewableShare", 0.03, "Renewable acceleration"),
            ],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Response complete",
        description: "The energy crisis response is complete.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const REFUGEE_CRISIS_TEMPLATE: CrisisTemplate = {
  name: "Refugee Crisis",
  autoTrigger: { kind: "random", cooldownTurns: 216, scope: "country", spawnChance: 0.0025 },
  heroImage:
    "https://images.unsplash.com/photo-1494059980473-813e73ee784b?auto=format&fit=crop&w=1600&q=70",
  description:
    "A neighboring conflict triggers a mass displacement. Refugee flows strain border regions, social services buckle, and political tensions rise.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 8,
  durationByScope: { country: 8, region: 6 },
  effects: [
    fx("tick", "metric", "economy", "gdp", -0.012, "Refugee fiscal burden"),
    fx("tick", "metric", "economy", "unemployment", 0.01, "Labor market displacement"),
    fx("tick", "metric", "economy", "foodPrices", 0.015, "Strain on food prices from displacement"),
    fx("tick", "approval", "government", "overall", -0.03, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "A refugee crisis has begun. Displaced populations strain border regions and social services.",
  wireMessageOnEnd: "The refugee flow slows. Integration efforts continue.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Refugee policy",
        description: "Refugees are arriving at your border. What is your policy?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_open",
            label: "Open Borders",
            description:
              "Accept all refugees and provide integration support. Costs 0.8% of GDP but gains international standing.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "approval",
                "international",
                "overall",
                0.05,
                "Open borders international standing"
              ),
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                -0.03,
                "Open borders domestic backlash"
              ),
            ],
          },
          {
            optionId: "response_camps",
            label: "Border Camps",
            description:
              "House refugees in temporary camps at the border. Minimal cost but humanitarian criticism.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "approval",
                "international",
                "overall",
                -0.03,
                "Camps humanitarian criticism"
              ),
            ],
          },
          {
            optionId: "response_close",
            label: "Close Borders",
            description:
              "Deny entry. No cost but severe international condemnation and potential humanitarian crisis.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "approval",
                "international",
                "overall",
                -0.08,
                "Closed borders condemnation"
              ),
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                0.02,
                "Closed borders nationalist support"
              ),
            ],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Policy set",
        description: "The refugee policy is set.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const PANDEMIC_TEMPLATE: CrisisTemplate = {
  name: "Pandemic",
  autoTrigger: { kind: "random", cooldownTurns: 432, scope: "global", spawnChance: 0.0015 },
  // Deliberately NO year window. Global pandemics are not a modern phenomenon:
  // 1957 Asian flu and 1968 Hong Kong flu each killed over a million people.
  // The old `notForEras` gate was incoherent anyway: it blocked 1979 and 1991
  // while leaving 1953 open. Removing it adds possibility space rather than
  // removing any, which is the direction this program pulls.
  heroImage:
    "https://images.unsplash.com/photo-1585771724684-38269d6639fd?auto=format&fit=crop&w=1600&q=70",
  description:
    "A novel infectious disease spreads globally. Healthcare systems strain, economies lock down, and social life is disrupted.",
  scope: "global",
  countryIds: [],
  regionIds: [],
  durationTurns: 10,
  durationByScope: { global: 10, country: 12, region: 8 },
  effects: [
    marginShock(-8, "Demand collapse and disruption compress margins"),
    fx("tick", "metric", "economy", "gdp", -0.025, "Pandemic GDP contraction"),
    fx("tick", "metric", "economy", "unemployment", 0.02, "Pandemic unemployment"),
    fx("tick", "metric", "economy", "consumerConfidence", -0.04, "Pandemic consumer fear"),
    fx("tick", "metric", "economy", "realWages", -0.015, "Pandemic real wage squeeze"),
    fx("tick", "approval", "government", "overall", -0.025, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "A pandemic has emerged. Healthcare systems strain and economies face disruption.",
  wireMessageOnEnd: "The pandemic subsides. Recovery begins.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Pandemic strategy",
        description: "A pandemic is spreading. What is your public health strategy?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_lockdown",
            label: "Full Lockdown",
            description:
              "Close non-essential businesses and restrict movement. Deep economic cost but saves lives and reduces duration by 3 turns.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "gdp", -0.03, "Lockdown GDP collapse"),
              fx("flat", "metric", "economy", "unemployment", 0.02, "Lockdown unemployment"),
            ],
          },
          {
            optionId: "response_targeted",
            label: "Targeted Restrictions",
            description:
              "Limit large gatherings and mask mandates. Moderate economic impact, reduces duration by 1 turn.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "gdp", -0.01, "Targeted restrictions GDP hit"),
            ],
          },
          {
            optionId: "response_herd",
            label: "Herd Immunity",
            description:
              "No restrictions. Let the virus run its course. Minimal economic disruption but maximum health toll and duration.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                -0.05,
                "Herd immunity public backlash"
              ),
            ],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Strategy set",
        description: "The pandemic strategy is set.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

// ── NEW TEMPLATES ────────────────────────────────────────────────────────────

export const CURRENCY_CRISIS_TEMPLATE: CrisisTemplate = {
  name: "Currency Crisis",
  autoTrigger: {
    kind: "condition",
    cooldownTurns: 144,
    condition: {
      all: [{ metric: "fxDepreciation", op: "gt", threshold: 15, windowTurns: 6 }],
    },
  },
  heroImage:
    "https://images.unsplash.com/photo-1580519542036-c47de6196ba5?auto=format&fit=crop&w=1600&q=70",
  description:
    "A sudden loss of confidence triggers capital flight and a sharp currency devaluation. Import prices surge, debt servicing costs spike, and the central bank faces a dilemma.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 6,
  durationByScope: { country: 6, global: 8, region: 5 },
  effects: [
    marginShock(-5, "Import-cost surge compresses margins") /* see P3.5 cost-side note */,
    fx("tick", "metric", "economy", "gdp", -0.02, "Currency crisis GDP contraction"),
    fx("tick", "metric", "economy", "inflation", 0.025, "Import price surge"),
    fx("tick", "metric", "economy", "investorConfidence", -0.04, "Capital flight panic"),
    fx("tick", "metric", "economy", "realWages", -0.02, "Purchasing power collapse"),
    fx("tick", "approval", "government", "overall", -0.03, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "A currency crisis has erupted. Capital flees, the exchange rate collapses, and import prices soar.",
  wireMessageOnEnd: "Currency markets stabilize. The worst of the devaluation passes.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Currency crisis response",
        description: "Your currency is in free fall. What is your government's response?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_rates",
            label: "Emergency Rate Hike",
            description:
              "The central bank hikes rates sharply to defend the currency. Painful but shortens the crisis by 2 turns.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "gdp", -0.02, "Rate hike recessionary shock"),
              fx("flat", "metric", "economy", "unemployment", 0.01, "Rate hike unemployment"),
            ],
          },
          {
            optionId: "response_controls",
            label: "Capital Controls",
            description:
              "Block capital flight to stabilize the exchange rate. Unpopular with foreign investors but buys time.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "metric",
                "economy",
                "investorConfidence",
                -0.05,
                "Investor confidence collapse"
              ),
              fx("flat", "approval", "government", "overall", 0.02, "Nationalist support"),
            ],
          },
          {
            optionId: "response_bailout",
            label: "Seek IMF Bailout",
            description:
              "Request emergency financing. Stabilizes reserves but imposes austerity conditions.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "gdp", -0.015, "Austerity conditions bite"),
              fx("flat", "approval", "government", "overall", -0.03, "Sovereignty backlash"),
            ],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Response complete",
        description: "The currency crisis response is complete.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const DROUGHT_FAMINE_TEMPLATE: CrisisTemplate = {
  naturalDisaster: true,
  geo: { requiresRegionTags: ["arid"] },
  name: "Drought / Famine",
  heroImage:
    "https://images.unsplash.com/photo-1753542175735-f57082a5ff79?auto=format&fit=crop&w=1600&q=70",
  description:
    "Severe drought devastates agriculture. Crop failures push food prices higher, rural livelihoods collapse, and humanitarian agencies warn of famine.",
  scope: "region",
  countryIds: [],
  regionIds: [],
  durationTurns: 5,
  durationByScope: { region: 5, country: 7, global: 10 },
  effects: [
    fx("flat", "metric", "economy", "gdp", -0.02, "Drought agricultural shock"),
    fx("tick", "metric", "economy", "inflation", 0.03, "Food price spike"),
    fx("tick", "metric", "economy", "realWages", -0.02, "Real income erosion"),
    fx("tick", "metric", "economy", "foodPrices", 0.04, "Cost of living surge"),
    fx("tick", "approval", "government", "overall", -0.03, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "A severe drought is devastating agriculture. Food prices rise and rural livelihoods are at risk.",
  wireMessageOnEnd: "Rain returns and food markets stabilize. Recovery will take time.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Drought response",
        description: "Drought is causing crop failures. What is the response?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_subsidies",
            label: "Food Subsidies",
            description:
              "Subsidize food prices and import grain. Costs 1% of GDP but cushions households.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "gdp", -0.01, "Subsidy fiscal cost"),
              fx("flat", "metric", "economy", "inflation", -0.02, "Subsidy price dampening"),
              fx("flat", "approval", "government", "overall", 0.03, "Subsidy popularity"),
            ],
          },
          {
            optionId: "response_aid",
            label: "Seek International Aid",
            description: "Request food aid and relief funds. Reduces duration by 2 turns.",
            nextNodeId: "terminal",
            effects: [fx("flat", "metric", "economy", "foodPrices", -0.015, "Aid price relief")],
          },
          {
            optionId: "response_ignore",
            label: "Let Markets Adjust",
            description: "No intervention. Prices ration scarce food. Rural populations suffer.",
            nextNodeId: "terminal",
            effects: [fx("flat", "approval", "government", "overall", -0.05, "Inaction backlash")],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Response complete",
        description: "The drought response is complete.",
        outcomeMessage:
          "Relief measures have cushioned the worst of the food crisis and markets are beginning to stabilize. Rural livelihoods remain strained but immediate famine risk has receded.",
        outcomeEffects: [
          fx("flat", "metric", "economy", "inflation", -0.012, "Food supply stabilization"),
          fx("flat", "metric", "economy", "realWages", 0.008, "Purchasing power partial recovery"),
        ],
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const HOUSING_COLLAPSE_TEMPLATE: CrisisTemplate = {
  name: "Housing Market Collapse",
  heroImage:
    "https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=1600&q=70",
  description:
    "A property bubble bursts. Home prices plunge, construction halts, household wealth evaporates, and heavily mortgaged banks face rising defaults.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 8,
  durationByScope: { country: 8, global: 10, region: 6 },
  effects: [
    marginShock(-6, "Credit and demand slump compress margins"),
    fx("flat", "metric", "economy", "housing", -0.15, "Housing price collapse"),
    fx("tick", "metric", "economy", "gdp", -0.015, "Construction and wealth drag"),
    fx("tick", "metric", "economy", "unemployment", 0.015, "Construction unemployment"),
    fx("tick", "metric", "economy", "consumerConfidence", -0.03, "Wealth effect collapse"),
    fx("tick", "approval", "government", "overall", -0.025, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "The housing market has collapsed. Prices plunge, construction stops, and household wealth evaporates.",
  wireMessageOnEnd: "Housing markets bottom out. A slow recovery begins.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Housing crash response",
        description: "Property prices are in free fall. How does the government respond?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_bailout",
            label: "Bailout Homeowners",
            description:
              "Mortgage relief and foreclosure moratoria. Costs 2% of GDP but stops contagion.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "gdp", -0.02, "Mortgage relief fiscal cost"),
              fx("flat", "approval", "government", "overall", 0.04, "Homeowner relief popularity"),
            ],
          },
          {
            optionId: "response_liquidate",
            label: "Let Prices Clear",
            description: "No intervention. Markets correct faster but households absorb losses.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "housing", -0.08, "Accelerated price correction"),
              fx("flat", "approval", "government", "overall", -0.04, "Inaction anger"),
            ],
          },
          {
            optionId: "response_lending",
            label: "Cheap Credit for Buyers",
            description: "Subsidized mortgages to restart demand. Risky but supports prices.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "housing", 0.05, "Credit stimulus price support"),
              fx("flat", "metric", "economy", "inflation", 0.01, "Credit expansion inflation"),
            ],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Response complete",
        description: "The housing collapse response is complete.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const LABOR_STRIKES_TEMPLATE: CrisisTemplate = {
  name: "Labor Strike Wave",
  heroImage:
    "https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=1600&q=70",
  description:
    "Widespread strikes disrupt transport, manufacturing, and public services. Wage demands fuel inflationary pressure and supply chains seize up.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 5,
  durationByScope: { country: 5, region: 4, global: 8 },
  effects: [
    marginShock(-5, "Strike disruption and wage pressure compress margins", "physical"),
    fx("tick", "metric", "economy", "gdp", -0.02, "Strike output loss"),
    fx("tick", "metric", "economy", "inflation", 0.015, "Wage-price pressure"),
    fx("tick", "metric", "economy", "consumerConfidence", -0.02, "Consumer confidence erosion"),
    fx("tick", "approval", "government", "overall", -0.03, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "A wave of labor strikes is disrupting the economy. Wage demands and supply-chain bottlenecks mount.",
  wireMessageOnEnd: "Strikes wind down. New wage settlements reshape labor costs.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Strike response",
        description: "Workers are striking across key sectors. How do you respond?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_negotiate",
            label: "Negotiate Wage Deals",
            description:
              "Bargain with unions. Settles strikes but raises labor costs and inflation.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "inflation", 0.02, "Wage settlement inflation"),
              fx("flat", "approval", "government", "overall", 0.02, "Negotiation approval"),
            ],
          },
          {
            optionId: "response_crackdown",
            label: "Break the Strikes",
            description:
              "Use back-to-work legislation and police. Ends disruption but infuriates workers.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "gdp", 0.01, "Output recovery"),
              fx("flat", "approval", "government", "overall", -0.06, "Union backlash"),
            ],
          },
          {
            optionId: "response_concede",
            label: "Concede Demands",
            description: "Accept most union demands. Stops strikes quickly but embeds inflation.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "inflation", 0.03, "Inflationary settlement"),
              fx("flat", "approval", "government", "overall", 0.04, "Worker approval"),
            ],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Response complete",
        description: "The strike wave response is complete.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

/**
 * Nationwide steel strike, the first crisis to use real-subsystem action hooks
 * (see CrisisOptionAction). Steel has no dedicated sector type; it is produced by
 * the `manufacturing` sector, so the strike concentrates its bite there and the
 * supply shock propagates downstream (autos, defense, construction, energy) via
 * the existing steel input-output demand already modelled in sectorStrategies.
 *
 * Each presidential option routes to its own terminal so the crisis INTERACTION
 * resolves on the choice, while the real consequences play out over following
 * turns in their own subsystems: the executive taking is reviewed by the Supreme
 * Court (docket turn), the emergency bill runs the bill lifecycle, the wage-floor
 * settlement lands a collective agreement that stops the strike. This is the
 * template to copy when authoring future action-bearing crises.
 */
export const STEEL_STRIKE_TEMPLATE: CrisisTemplate = {
  name: "Nationwide Steel Strike",
  heroImage:
    "https://images.unsplash.com/photo-1533630018502-c1cd6b2b1a1e?auto=format&fit=crop&w=1600&q=70",
  description:
    "The steelworkers have walked out nationwide. Blast furnaces bank down, and the shutdown ripples into autos, defense, construction, and power as steel supply dries up. The President must act.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 6,
  durationByScope: { country: 6 },
  effects: [
    marginShock(-8, "Steel mills idled by the walkout", "physical", "manufacturing"),
    fx("tick", "metric", "economy", "gdp", -0.025, "Lost steel output and downstream stoppages"),
    fx("tick", "metric", "economy", "inflation", 0.02, "Steel scarcity drives input prices"),
    fx("tick", "metric", "economy", "consumerConfidence", -0.02, "Shutdown anxiety"),
    fx(
      "tick",
      "metric",
      "economy",
      "investorConfidence",
      -0.02,
      "Industrial paralysis unnerves markets"
    ),
    fx(
      "tick",
      "approval",
      "government",
      "overall",
      -0.03,
      "A paralysed economy erodes the government"
    ),
  ],
  wireMessageOnStart:
    "Steelworkers have struck nationwide. Furnaces are banking down and steel-dependent industry is grinding to a halt.",
  wireMessageOnEnd:
    "The steel strike is over. The settlement, imposed, negotiated, or won in court, reshapes the industry.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "The steel strike is national",
        description:
          "Steel has stopped and the shutdown is spreading to every industry that depends on it. As President, how do you break the deadlock?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_executive_order",
            label: "Nationalize by Executive Order",
            description:
              "Seize the steel industry by emergency executive order and run the mills as state enterprises. Fast and decisive, but the order will be challenged in the Supreme Court, which can strike it down.",
            nextNodeId: "terminal_executive",
            action: { kind: "executiveNationalize", sectorType: "manufacturing" },
            effects: [
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                0.03,
                "Decisive action rallies support"
              ),
              fx(
                "flat",
                "metric",
                "economy",
                "investorConfidence",
                -0.03,
                "Seizure alarms investors"
              ),
            ],
          },
          {
            optionId: "response_emergency_bill",
            label: "Emergency Nationalization Bill",
            description:
              "Send Congress an emergency bill to nationalize steel at fair value. No court risk if it passes, but you need the votes, and the strike burns on while it is debated.",
            nextNodeId: "terminal_bill",
            action: {
              kind: "emergencyNationalizeBill",
              sectorType: "manufacturing",
              sectorCarveFraction: 1,
            },
            effects: [
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                0.01,
                "A lawful path reassures moderates"
              ),
            ],
          },
          {
            optionId: "response_bargain",
            label: "Bring Both Sides to the Table",
            description:
              "Open government-brokered bargaining between the steelmakers and the union. Keeps the industry private and buys goodwill, but a deal is not guaranteed.",
            nextNodeId: "terminal_bargain",
            action: { kind: "openBargaining", sectorType: "manufacturing" },
            effects: [
              fx("flat", "approval", "government", "overall", 0.02, "Statesmanship plays well"),
            ],
          },
          {
            optionId: "response_settle",
            label: "Concede the Wage Demands",
            description:
              "End the strike now by imposing the union's wage floor across the industry. Furnaces relight immediately, but the settlement embeds higher costs and inflation.",
            nextNodeId: "terminal_settle",
            action: { kind: "settleWageFloor", sectorType: "manufacturing" },
            effects: [
              fx("flat", "metric", "economy", "inflation", 0.03, "Wage settlement feeds inflation"),
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                0.04,
                "Workers reward the concession"
              ),
            ],
          },
          {
            optionId: "response_hold_firm",
            label: "Hold Firm",
            description:
              "Refuse to intervene and let the strike run its course. The economy bleeds, but you concede nothing and set no precedent.",
            nextNodeId: "terminal_hold",
            effects: [
              fx("flat", "approval", "government", "overall", -0.04, "Inaction reads as weakness"),
            ],
          },
        ],
      },
      {
        nodeId: "terminal_executive",
        type: "terminal",
        title: "Order signed, now to the Court",
        description:
          "You have seized the steel mills by executive order. The state is running them, but a constitutional challenge is on its way to the Supreme Court.",
        outcomeMessage:
          "The President has nationalized steel by executive order. The seizure heads to the Supreme Court for review.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
      {
        nodeId: "terminal_bill",
        type: "terminal",
        title: "Bill sent to Congress",
        description:
          "An emergency bill to nationalize the steel industry is before Congress on an expedited vote. Its fate rests with the legislature.",
        outcomeMessage:
          "An emergency bill to nationalize steel has been rushed to the floor of Congress.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
      {
        nodeId: "terminal_bargain",
        type: "terminal",
        title: "Talks convened",
        description:
          "Government mediators have brought the steelmakers and the union to the table. A settlement is not guaranteed, but the guns are silent while they talk.",
        outcomeMessage:
          "The President has convened government-brokered talks between the steelmakers and the union.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
      {
        nodeId: "terminal_settle",
        type: "terminal",
        title: "Strike settled",
        description:
          "You imposed the union's wage floor. The furnaces are relighting, but the industry carries higher costs from here on.",
        outcomeMessage:
          "The steel strike is settled: the President conceded the union's wage demands industry-wide.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
      {
        nodeId: "terminal_hold",
        type: "terminal",
        title: "No intervention",
        description: "You chose not to intervene. The strike will grind on until one side breaks.",
        outcomeMessage: "The President declined to intervene in the steel strike. It runs on.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const DEBT_DEFAULT_CONTAGION_TEMPLATE: CrisisTemplate = {
  name: "Sovereign Debt Default",
  heroImage:
    "https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=1600&q=70",
  description:
    "A major government defaults on its debt. Contagion spreads through credit markets, borrowing costs spike, and austerity looms for debtor nations.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 6,
  durationByScope: { country: 6, global: 8, region: 5 },
  effects: [
    marginShock(-7, "Financing freeze compresses margins"),
    fx("flat", "metric", "economy", "gdp", -0.04, "Default GDP shock"),
    fx("tick", "metric", "economy", "gdp", -0.018, "Austerity and credit freeze drag"),
    fx("tick", "metric", "economy", "unemployment", 0.02, "Austerity unemployment"),
    fx("tick", "metric", "economy", "inflation", 0.015, "Currency collapse inflation"),
    fx("tick", "metric", "economy", "investorConfidence", -0.05, "Investor confidence collapse"),
    fx("tick", "approval", "government", "overall", -0.04, "Government approval collapse"),
  ],
  wireMessageOnStart:
    "A sovereign debt default has roiled credit markets. Contagion and austerity fears spread.",
  wireMessageOnEnd: "Creditors and the defaulting government reach a restructuring deal.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Debt default response",
        description: "A sovereign default is shaking markets. How do you protect your country?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_austerity",
            label: "Austerity Budget",
            description:
              "Slash spending to reassure creditors. Deep recessionary cost but restores access.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "gdp", -0.03, "Austerity deepening"),
              fx("flat", "metric", "economy", "inflation", -0.01, "Demand collapse disinflation"),
              fx("flat", "metric", "economy", "investorConfidence", 0.04, "Creditor reassurance"),
            ],
          },
          {
            optionId: "response_default",
            label: "Restructure Your Own Debt",
            description:
              "Force creditors to take losses. Avoids austerity but locks you out of markets.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "gdp", -0.02, "Restructuring GDP shock"),
              fx("flat", "approval", "government", "overall", 0.03, "Anti-austerity rally"),
            ],
          },
          {
            optionId: "response_bailout",
            label: "Bailout the Defaulting Nation",
            description: "Lead a rescue package. Costs 1.5% of GDP but limits contagion.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "gdp", -0.015, "Bailout fiscal cost"),
              fx("flat", "metric", "economy", "investorConfidence", 0.05, "Contagion containment"),
            ],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Response complete",
        description: "The debt default response is complete.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

// ── ADDITIONAL TEMPLATES ─────────────────────────────────────────────────────

export const SUPPLY_CHAIN_DISRUPTION_TEMPLATE: CrisisTemplate = {
  name: "Supply Chain Disruption",
  autoTrigger: { kind: "random", cooldownTurns: 216, scope: "global", spawnChance: 0.004 },
  heroImage:
    "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=1600&q=70",
  description:
    "A cascade of shipping bottlenecks, factory shutdowns, and port backlogs paralyzes global supply chains. Shelves empty, production stalls, and input costs soar.",
  scope: "global",
  countryIds: [],
  regionIds: [],
  durationTurns: 8,
  durationByScope: { global: 8, country: 10, region: 6 },
  effects: [
    marginShock(-6, "Input shortages compress margins", "physical"),
    fx("tick", "metric", "economy", "gdp", -0.018, "Supply chain output drag"),
    fx("tick", "metric", "economy", "inflation", 0.02, "Input cost pass-through"),
    fx("tick", "metric", "economy", "consumerConfidence", -0.02, "Consumer goods shortage"),
    fx("tick", "approval", "government", "overall", -0.02, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "Global supply chains are seizing up. Shipping bottlenecks and factory shutdowns cascade.",
  wireMessageOnEnd: "Supply chains stabilize. Shipping backlogs clear and production resumes.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Supply chain strategy",
        description: "Supply chains are broken. How does your government respond?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_stockpile",
            label: "Build Strategic Stockpiles",
            description:
              "Pre-purchase critical inputs at high prices. Costs 1% of GDP but insulates domestic industry from the worst shortages.",
            nextNodeId: "terminal",
            effects: [fx("flat", "metric", "economy", "gdp", -0.01, "Stockpile fiscal cost")],
          },
          {
            optionId: "response_reshore",
            label: "Accelerate Reshoring",
            description:
              "Subsidize domestic manufacturing. Slow to take effect but reduces future vulnerability.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "gdp", -0.008, "Reshoring subsidy cost"),
              fx(
                "flat",
                "metric",
                "economy",
                "investorConfidence",
                0.02,
                "Domestic industry boost"
              ),
            ],
          },
          {
            optionId: "response_wait",
            label: "Let Markets Adjust",
            description: "No intervention. Higher prices incentivize firms to find alternatives.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "inflation", 0.01, "Market-driven price surge"),
            ],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Response set",
        description: "The supply chain response is set.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const TECH_BUBBLE_BURST_TEMPLATE: CrisisTemplate = {
  name: "Tech Bubble Burst",
  // Needs a listed tech sector large enough to bubble. Dot-com era onward.
  fromYear: 1995,
  autoTrigger: { kind: "random", cooldownTurns: 216, scope: "country", spawnChance: 0.002 },
  heroImage:
    "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1600&q=70",
  description:
    "Overvalued tech stocks collapse after years of speculative excess. Venture capital evaporates, tech layoffs mount, and startup ecosystems contract sharply.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 8,
  durationByScope: { country: 8, global: 10 },
  effects: [
    marginShock(-5, "Valuation collapse and funding freeze compress margins"),
    fx("flat", "metric", "economy", "gdp", -0.03, "Wealth destruction shock"),
    fx("tick", "metric", "economy", "unemployment", 0.02, "Tech sector layoffs"),
    fx("tick", "metric", "economy", "investorConfidence", -0.05, "Investor confidence collapse"),
    fx("tick", "metric", "economy", "consumerConfidence", -0.02, "Wealth effect erosion"),
    fx("tick", "approval", "government", "overall", -0.02, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "The tech bubble has burst. Valuations collapse and layoffs sweep the sector.",
  wireMessageOnEnd:
    "Tech markets find a floor. Survivors restructure and hiring cautiously resumes.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Tech crash response",
        description: "Tech stocks have crashed. How do you respond?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_bailout",
            label: "Bail Out Startups",
            description:
              "Emergency government investment in tech infrastructure. Costly but preserves jobs and talent.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "gdp", -0.015, "Bailout fiscal cost"),
              fx("flat", "metric", "economy", "unemployment", -0.01, "Saved jobs"),
            ],
          },
          {
            optionId: "response_regulation",
            label: "Tighten Financial Regulation",
            description:
              "Crack down on speculative excesses. Reduces future bubble risk but depresses investor confidence further.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "metric",
                "economy",
                "investorConfidence",
                -0.03,
                "Regulatory chill on investment"
              ),
            ],
          },
          {
            optionId: "response_laissez",
            label: "Let Markets Correct",
            description: "No intervention. Markets clear faster but unemployment peaks higher.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "unemployment", 0.015, "Unchecked layoff wave"),
            ],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Response set",
        description: "The tech crash response is set.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const EXTREME_HEAT_TEMPLATE: CrisisTemplate = {
  naturalDisaster: true,
  name: "Extreme Heat Wave",
  heroImage:
    "https://images.unsplash.com/photo-1504701954957-2010ec3bcec1?auto=format&fit=crop&w=1600&q=70",
  description:
    "Record-breaking temperatures overwhelm cooling infrastructure, spike energy demand, and cause widespread health emergencies. Agricultural yields fall and outdoor workers face deadly conditions.",
  scope: "region",
  countryIds: [],
  regionIds: [],
  durationTurns: 3,
  durationByScope: { region: 3, country: 4, global: 6 },
  effects: [
    fx("tick", "metric", "economy", "gdp", -0.01, "Productivity loss from heat"),
    fx("tick", "metric", "economy", "inflation", 0.015, "Energy demand spike"),
    fx("tick", "metric", "economy", "foodPrices", 0.02, "Agricultural heat damage"),
    fx("tick", "metric", "environment", "airQuality", -0.06, "Ozone and particulate surge"),
    fx("tick", "approval", "government", "overall", -0.025, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "A record heat wave is sweeping the region. Health systems are overwhelmed and energy grids are straining.",
  wireMessageOnEnd: "Temperatures moderate. Recovery from the heat wave begins.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Heat wave response",
        description: "A deadly heat wave is underway. What is the emergency response?",
        requiredRoles: ["headOfState", "stateGovernor"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_cooling",
            label: "Open Cooling Centers",
            description:
              "Deploy public cooling shelters and distribute water. Saves lives and maintains approval.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "approval", "government", "overall", 0.02, "Cooling center approval"),
              fx("flat", "metric", "economy", "gdp", -0.005, "Emergency services cost"),
            ],
          },
          {
            optionId: "response_power",
            label: "Emergency Power Rationing",
            description:
              "Roll blackouts to prevent grid collapse. Prevents catastrophe but disrupts businesses.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "gdp", -0.01, "Blackout productivity loss"),
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                -0.01,
                "Rationing public frustration"
              ),
            ],
          },
          {
            optionId: "response_climate",
            label: "Fast-Track Climate Legislation",
            description:
              "Use the crisis as a mandate for aggressive emissions policy. Politically risky but long-term benefit.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "renewableShare", 0.04, "Renewable push"),
              fx("flat", "approval", "government", "overall", -0.02, "Industry backlash"),
            ],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Response set",
        description: "The heat wave response is set.",
        outcomeMessage:
          "Temperatures have dropped to seasonal norms and emergency health services are standing down. Air quality is recovering as ozone levels recede and cooling centers are winding down operations.",
        outcomeEffects: [
          fx("flat", "metric", "environment", "airQuality", 0.04, "Ozone and particulate recovery"),
          fx("flat", "metric", "economy", "inflation", -0.008, "Energy demand normalization"),
        ],
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const NUCLEAR_ACCIDENT_TEMPLATE: CrisisTemplate = {
  name: "Nuclear Accident",
  heroImage:
    "https://images.unsplash.com/photo-1630142895963-6996ae6b3a5b?auto=format&fit=crop&w=1600&q=70",
  description:
    "A reactor at a major nuclear facility in {location} has suffered a partial meltdown, prompting authorities to order the immediate evacuation of everyone within the surrounding exclusion zone. Radiation readings are climbing, food and water supplies are being seized for testing, and panicked residents are clogging highways as they flee. The disaster has reignited a fierce global debate over the safety of nuclear power.",
  scope: "region",
  countryIds: [],
  regionIds: [],
  durationTurns: 10,
  durationByScope: { region: 10, country: 12 },
  effects: [
    gdpLoss(0.03, "Evacuation and shutdown shock"),
    fx("tick", "metric", "economy", "gdp", -0.02, "Long-term exclusion zone drag"),
    fx("tick", "metric", "environment", "airQuality", -0.15, "Radiation and contamination"),
    fx("tick", "metric", "economy", "investorConfidence", -0.04, "Energy policy uncertainty"),
    fx("tick", "approval", "government", "overall", -0.05, "Government approval collapse"),
  ],
  wireMessageOnStart:
    "A nuclear accident in {location} has triggered mass evacuation as radiation fears spread across the region.",
  wireMessageOnEnd: "The reactor is contained. Decontamination and recovery begin.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Nuclear accident response",
        description: "A reactor has melted down. How do you manage the crisis?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_evacuate",
            label: "Full Evacuation Zone",
            description: "Evacuate a 30km radius. Costly and disruptive but minimizes health toll.",
            nextNodeId: "aid",
            effects: [
              fx("flat", "metric", "economy", "gdp", -0.02, "Evacuation economic disruption"),
              fx("flat", "approval", "government", "overall", 0.02, "Safety-first approval"),
            ],
          },
          {
            optionId: "response_shelter",
            label: "Shelter in Place",
            description: "Advise residents to shelter indoors. Less disruptive but risks exposure.",
            nextNodeId: "aid",
            effects: [
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                -0.04,
                "Public anger at inadequate response"
              ),
            ],
          },
        ],
      },
      {
        nodeId: "aid",
        type: "choice",
        title: "International assistance",
        description: "International nuclear safety expertise and aid may be offered.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "aid_accept",
            label: "Accept International Help",
            description: "Bring in IAEA teams and foreign expertise. Reduces duration by 2 turns.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "approval",
                "international",
                "overall",
                0.03,
                "Cooperation international standing"
              ),
            ],
          },
          {
            optionId: "aid_reject",
            label: "Handle Internally",
            description:
              "Manage containment with domestic teams. Preserves national pride but slower.",
            nextNodeId: "terminal",
            effects: [],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Containment underway",
        description: "The nuclear accident response is set.",
        outcomeMessage:
          "The reactor has been stabilized and the immediate radiation threat is contained. Decontamination will take years, but evacuees are receiving support and air quality is slowly improving outside the exclusion zone.",
        outcomeEffects: [
          fx(
            "flat",
            "metric",
            "environment",
            "airQuality",
            0.06,
            "Radiation dispersal improves air quality"
          ),
          fx("flat", "metric", "economy", "investorConfidence", 0.02, "Energy policy stabilizes"),
        ],
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const COUP_ATTEMPT_TEMPLATE: CrisisTemplate = {
  name: "Coup Attempt",
  autoTrigger: {
    kind: "condition",
    cooldownTurns: 288,
    condition: {
      all: [
        { metric: "approval", op: "lt", threshold: 25 },
        { metric: "gdpGrowth", op: "lt", threshold: -2 },
      ],
    },
  },
  heroImage:
    "https://images.unsplash.com/photo-1608396941316-ea89219bd56e?auto=format&fit=crop&w=1600&q=70",
  description:
    "A faction of military officers or political extremists attempts to seize power. The capital is locked down, constitutional order is suspended, and foreign governments weigh how to respond.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 3,
  durationByScope: { country: 3, global: 5 },
  effects: [
    marginShock(-5, "Instability disrupts operations and margins"),
    fx("flat", "metric", "economy", "gdp", -0.05, "Political instability shock"),
    fx("tick", "metric", "economy", "investorConfidence", -0.08, "Capital flight and freeze"),
    fx("tick", "metric", "publicsafety", "confidence", -0.12, "Civil order breakdown"),
    fx("tick", "approval", "government", "overall", -0.06, "Government approval collapse"),
  ],
  wireMessageOnStart:
    "A coup attempt is underway. Military factions have seized key installations and the capital is in lockdown.",
  wireMessageOnEnd: "The coup attempt is defeated. Constitutional order is restored.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Coup response",
        description: "A coup is underway. How do you respond?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_resist",
            label: "Call for Resistance",
            description:
              "Broadcast a call to loyal forces and the public to resist. Rallies support but risks violence.",
            nextNodeId: "aftermath",
            effects: [
              fx("flat", "approval", "government", "overall", 0.04, "Resistance rally"),
              fx("flat", "metric", "publicsafety", "confidence", -0.05, "Escalating violence fear"),
            ],
          },
          {
            optionId: "response_negotiate",
            label: "Negotiate with Coup Leaders",
            description:
              "Seek a political settlement. Avoids bloodshed but may require concessions.",
            nextNodeId: "aftermath",
            effects: [fx("flat", "approval", "government", "overall", -0.03, "Perceived weakness")],
          },
          {
            optionId: "response_flee",
            label: "Go Into Exile",
            description:
              "Leave the country and build international pressure for restoration. Crisis duration extends.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "approval",
                "international",
                "overall",
                0.04,
                "Exile international sympathy"
              ),
            ],
          },
        ],
      },
      {
        nodeId: "aftermath",
        type: "choice",
        title: "Post-coup accountability",
        description: "The coup has failed. How do you handle the perpetrators?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "trial",
            label: "Civilian Trials",
            description: "Prosecute coup leaders through civilian courts. Strengthens rule of law.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "approval", "government", "overall", 0.04, "Rule of law approval"),
            ],
          },
          {
            optionId: "purge",
            label: "Military Purge",
            description:
              "Purge the military of suspected sympathizers. Neutralizes the threat but risks overreach.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                -0.02,
                "Purge civil liberties concern"
              ),
              fx(
                "flat",
                "metric",
                "publicsafety",
                "confidence",
                0.04,
                "Security apparatus tightened"
              ),
            ],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Crisis resolved",
        description: "The coup attempt is resolved.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const POWER_GRID_FAILURE_TEMPLATE: CrisisTemplate = {
  name: "Power Grid Failure",
  autoTrigger: {
    kind: "condition",
    cooldownTurns: 216,
    condition: { all: [{ metric: "powerGridReliability", op: "lt", threshold: 90 }] },
  },
  heroImage:
    "https://images.unsplash.com/photo-1520116468816-95b69f847357?auto=format&fit=crop&w=1600&q=70",
  description:
    "A cascading failure across the power grid plunges regions into darkness. Hospitals run on generators, factories shut down, and communications infrastructure strains under the outage.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 4,
  durationByScope: { country: 4, region: 3 },
  effects: [
    marginShock(-5, "Blackout halts production and compresses margins", "physical"),
    fx("flat", "metric", "economy", "gdp", -0.025, "Blackout output shock"),
    fx("tick", "metric", "economy", "gdp", -0.012, "Ongoing disruption drag"),
    fx("tick", "metric", "infrastructure", "power", -0.15, "Grid reliability collapse"),
    fx("tick", "metric", "economy", "consumerConfidence", -0.025, "Consumer confidence erosion"),
    fx("tick", "approval", "government", "overall", -0.04, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "A cascading grid failure has caused widespread blackouts. Essential services are running on backup power.",
  wireMessageOnEnd: "Power is restored. Grid engineers assess the systemic failures.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Grid failure response",
        description: "The power grid has failed. How do you respond?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_emergency",
            label: "Emergency Repairs",
            description:
              "Mobilize utility workers on emergency overtime. Costs 0.5% of GDP but cuts duration by 1 turn.",
            nextNodeId: "terminal",
            effects: [fx("flat", "metric", "economy", "gdp", -0.005, "Emergency repair cost")],
          },
          {
            optionId: "response_military",
            label: "Deploy Military Engineers",
            description:
              "Military engineering units restore critical nodes first. Restores partial power quickly.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "metric",
                "infrastructure",
                "power",
                0.06,
                "Military engineering partial restore"
              ),
            ],
          },
          {
            optionId: "response_investigate",
            label: "Prioritize Investigation",
            description:
              "Find the root cause before full restoration to prevent recurrence. Longer outage, safer outcome.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "metric",
                "infrastructure",
                "power",
                0.1,
                "Investigation-led long-term reliability gain"
              ),
              fx("flat", "metric", "economy", "gdp", -0.01, "Extended outage cost"),
            ],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Response set",
        description: "The grid failure response is set.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const WATER_CRISIS_TEMPLATE: CrisisTemplate = {
  name: "Water Crisis",
  heroImage:
    "https://images.unsplash.com/photo-1501854140801-50d01698950b?auto=format&fit=crop&w=1600&q=70",
  description:
    "Aquifer depletion, contamination, or prolonged drought drives a severe water scarcity crisis. Agriculture collapses, cities impose rationing, and public health deteriorates.",
  scope: "region",
  countryIds: [],
  regionIds: [],
  durationTurns: 7,
  durationByScope: { region: 7, country: 9, global: 12 },
  effects: [
    fx("flat", "metric", "economy", "gdp", -0.02, "Agricultural collapse"),
    fx("tick", "metric", "economy", "inflation", 0.02, "Food and water price surge"),
    fx("tick", "metric", "economy", "foodPrices", 0.03, "Cost of living surge"),
    fx("tick", "metric", "economy", "unemployment", 0.015, "Agricultural unemployment"),
    fx("tick", "approval", "government", "overall", -0.03, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "A water crisis has taken hold. Rationing begins and agricultural losses mount.",
  wireMessageOnEnd: "The water crisis eases. Reservoirs begin refilling and supplies stabilize.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Water crisis response",
        description: "Water scarcity is severe. How does the government respond?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_desalination",
            label: "Emergency Desalination",
            description:
              "Fast-track coastal desalination plants. High upfront cost but provides long-term supply security.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "gdp", -0.015, "Desalination capital cost"),
              fx("flat", "metric", "economy", "inflation", -0.01, "Supply security disinflation"),
            ],
          },
          {
            optionId: "response_rationing",
            label: "Mandatory Rationing",
            description:
              "Ration water across sectors by decree. Preserves reserves but disrupts agriculture and industry.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "gdp", -0.01, "Rationing output cost"),
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                -0.02,
                "Rationing public frustration"
              ),
            ],
          },
          {
            optionId: "response_import",
            label: "Import Water and Food",
            description: "Purchase emergency food and water imports. Expensive but fast.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "gdp", -0.012, "Import fiscal cost"),
              fx("flat", "metric", "economy", "inflation", -0.015, "Import supply relief"),
            ],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Response set",
        description: "The water crisis response is set.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const DISINFORMATION_CRISIS_TEMPLATE: CrisisTemplate = {
  name: "Disinformation Crisis",
  // The template's framing is algorithmic social-media spread, which needs the
  // platforms. Propaganda obviously predates this; that is a different crisis.
  fromYear: 2010,
  autoTrigger: { kind: "random", cooldownTurns: 144, scope: "country", spawnChance: 0.0035 },
  heroImage:
    "https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1600&q=70",
  description:
    "A coordinated disinformation campaign, possibly foreign-backed, floods media and social platforms. Public trust drops, election results are questioned, and communities split along partisan lines.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 5,
  durationByScope: { country: 5, global: 7 },
  effects: [
    fx("tick", "metric", "economy", "investorConfidence", -0.025, "Political uncertainty"),
    fx("tick", "metric", "publicsafety", "confidence", -0.06, "Social trust collapse"),
    fx("tick", "approval", "government", "overall", -0.04, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "A disinformation crisis is destabilizing public discourse. Trust in institutions is eroding rapidly.",
  wireMessageOnEnd: "The disinformation wave subsides. Trust in institutions slowly recovers.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Disinformation response",
        description: "Disinformation is spreading rapidly. How does your government respond?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_counter",
            label: "Rapid Response Unit",
            description:
              "Deploy a government fact-checking and communications team. Limits spread but risks accusations of censorship.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "publicsafety", "confidence", 0.04, "Trust restoration effort"),
              fx("flat", "approval", "government", "overall", -0.01, "Censorship concern"),
            ],
          },
          {
            optionId: "response_platform",
            label: "Pressure Social Platforms",
            description:
              "Compel platforms to remove false content. Effective but raises free speech concerns.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "metric",
                "publicsafety",
                "confidence",
                0.03,
                "Platform moderation relief"
              ),
              fx("flat", "approval", "government", "overall", -0.02, "Censorship backlash"),
            ],
          },
          {
            optionId: "response_transparency",
            label: "Radical Transparency",
            description:
              "Declassify intelligence on the disinformation source. Builds credibility but exposes methods.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "approval", "government", "overall", 0.03, "Transparency credibility"),
              fx("flat", "metric", "publicsafety", "confidence", 0.05, "Public reassurance"),
            ],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Response set",
        description: "The disinformation response is set.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const TSUNAMI_TEMPLATE: CrisisTemplate = {
  naturalDisaster: true,
  geo: { requiresRegionTags: ["coastal", "seismic"] },
  name: "Tsunami",
  heroImage:
    "https://images.unsplash.com/photo-1745042006595-572d5a6e9caa?auto=format&fit=crop&w=1600&q=70",
  description:
    "A massive undersea earthquake has sent a tsunami crashing into the coast of {location}, with waves surging far inland and sweeping away homes, vehicles, and entire neighborhoods within minutes. Harbors, fishing fleets, and seaside infrastructure have been obliterated, and the death toll is climbing as rescuers search the wreckage. Survivors are stranded on higher ground without power, clean water, or communications.",
  scope: "region",
  countryIds: [],
  regionIds: [],
  durationTurns: 6,
  durationByScope: { region: 6, country: 8 },
  effects: [
    gdpLoss(0.03, "Tsunami coastal destruction"),
    fx("tick", "metric", "economy", "unemployment", 0.03, "Displacement unemployment"),
    fx("tick", "metric", "infrastructure", "damage", 0.12, "Coastal infrastructure loss"),
    fx("tick", "approval", "government", "overall", -0.04, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "A tsunami has struck the coast of {location}, submerging entire communities as the death toll rises.",
  wireMessageOnEnd: "Tsunami recovery is underway. Temporary infrastructure is restored.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Tsunami response",
        description: "A tsunami has devastated the coastline. What is the emergency response?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_declaration",
            label: "National Disaster Declaration",
            description:
              "Mobilize all federal resources. Costs 1% of GDP but unlocks maximum relief capacity.",
            nextNodeId: "rebuild",
            effects: [fx("flat", "metric", "economy", "gdp", -0.01, "Disaster declaration cost")],
          },
          {
            optionId: "response_local",
            label: "Local Authorities Lead",
            description: "Coordinate through regional governments. Lower cost but slower response.",
            nextNodeId: "rebuild",
            effects: [
              fx("flat", "approval", "government", "overall", -0.02, "Slow response concern"),
            ],
          },
        ],
      },
      {
        nodeId: "rebuild",
        type: "collective",
        title: "International reconstruction fund",
        description:
          "Nations may contribute to a reconstruction fund. Full funding accelerates coastal rebuilding, halving the remaining crisis duration.",
        collectiveTarget: 20_000_000,
        collectiveCurrency: "USD",
        requiredRoles: ["headOfState", "cabinet"],
        timeLimitMinutes: 1440,
        options: [
          {
            optionId: "contribute_10m",
            label: "Contribute $10M",
            description: "Commit $10M to the reconstruction fund.",
            collectiveContribution: 10_000_000,
            nextNodeId: "terminal",
            effects: [],
          },
          {
            optionId: "contribute_5m",
            label: "Contribute $5M",
            description: "Commit $5M to the reconstruction fund.",
            collectiveContribution: 5_000_000,
            nextNodeId: "terminal",
            effects: [],
          },
          {
            optionId: "decline",
            label: "Decline",
            description: "No contribution.",
            collectiveContribution: 0,
            nextNodeId: "terminal",
            effects: [],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Recovery underway",
        description: "The tsunami response is set.",
        outcomeMessage:
          "International rescue teams have cleared the most dangerous debris and temporary shelters are housing displaced residents. Coastal reconstruction is beginning, and harbor access has been partially restored.",
        outcomeEffects: [
          fx(
            "flat",
            "metric",
            "infrastructure",
            "damage",
            -0.06,
            "Coastal reconstruction progress"
          ),
          fx("flat", "metric", "economy", "unemployment", -0.015, "Rebuilding and relief jobs"),
        ],
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const DEBT_CEILING_CRISIS_TEMPLATE: CrisisTemplate = {
  name: "Debt Ceiling Crisis",
  heroImage:
    "https://images.unsplash.com/photo-1468254095679-bbcba94a7066?auto=format&fit=crop&w=1600&q=70",
  description:
    "Political gridlock over raising the debt ceiling brings government to the brink of default. Markets price in rising risk, credit agencies warn of downgrades, and federal workers face uncertain pay.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 4,
  durationByScope: { country: 4, global: 5 },
  effects: [
    marginShock(-4, "Funding uncertainty compresses margins"),
    fx("tick", "metric", "economy", "investorConfidence", -0.04, "Default risk premium"),
    fx("tick", "metric", "economy", "gdp", -0.01, "Uncertainty drag on activity"),
    fx("tick", "approval", "government", "overall", -0.05, "Government dysfunction approval hit"),
  ],
  wireMessageOnStart:
    "A debt ceiling standoff is rattling markets. Default risk climbs as political leaders remain deadlocked.",
  wireMessageOnEnd: "A deal is struck. The debt ceiling is raised and default averted.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Debt ceiling strategy",
        description: "A debt ceiling standoff is threatening default. How do you resolve it?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_deal",
            label: "Strike a Budget Deal",
            description:
              "Negotiate spending cuts in exchange for raising the ceiling. Ends crisis but entrenches austerity.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "metric", "economy", "gdp", -0.015, "Austerity deal growth drag"),
              fx("flat", "approval", "government", "overall", 0.02, "Resolution approval"),
            ],
          },
          {
            optionId: "response_clean",
            label: "Clean Raise",
            description:
              "Push for a clean debt ceiling increase with no conditions. Preserves spending but takes longer.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "metric",
                "economy",
                "investorConfidence",
                0.03,
                "No-default confidence boost"
              ),
            ],
          },
          {
            optionId: "response_executive",
            label: "Executive Action",
            description:
              "Invoke constitutional authority to override the debt ceiling. Constitutionally risky but ends market uncertainty immediately.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "metric",
                "economy",
                "investorConfidence",
                0.04,
                "Certainty market relief"
              ),
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                -0.03,
                "Constitutional overreach concern"
              ),
            ],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Crisis resolved",
        description: "The debt ceiling crisis is resolved.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

// ── NEW NATURAL DISASTERS ────────────────────────────────────────────────────

export const TORNADO_TEMPLATE: CrisisTemplate = {
  naturalDisaster: true,
  geo: { requiresRegionTags: ["tornado"] },
  name: "Tornado Outbreak",
  heroImage:
    "https://images.unsplash.com/photo-1527482797697-8795b05a13fe?auto=format&fit=crop&w=1600&q=70",
  description:
    "A violent tornado outbreak has carved a path of destruction across {location}, flattening homes, schools, and businesses along its track in a matter of minutes. Power is out for thousands, debris has blocked major roads, and emergency crews are combing collapsed structures for the missing. Forecasters warn that more supercells could spawn additional twisters before the system moves on.",
  scope: "region",
  countryIds: [],
  regionIds: [],
  durationTurns: 2,
  durationByScope: { region: 2, country: 3 },
  effects: [
    gdpLoss(0.01, "Tornado damage shock"),
    fx("tick", "metric", "infrastructure", "damage", 0.05, "Structural damage along the track"),
    fx("tick", "approval", "government", "overall", -0.02, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "A tornado outbreak has torn through {location}, leaving homes flattened and power lines down along its path.",
  wireMessageOnEnd: "The tornadoes have passed. Cleanup and rebuilding begin.",
};

export const FLOOD_TEMPLATE: CrisisTemplate = {
  naturalDisaster: true,
  geo: { requiresRegionTags: ["flood"] },
  name: "Major Flood",
  heroImage:
    "https://images.unsplash.com/photo-1547683905-f686c993aae5?auto=format&fit=crop&w=1600&q=70",
  description:
    "Days of relentless rain have overwhelmed rivers and drainage systems across {location}, sending muddy water surging through low-lying districts and downtown streets. Roads and rail links are cut off, thousands have been forced from their homes, and vast stretches of farmland sit underwater with crops ruined. Authorities are racing to reinforce levees as more rain is forecast.",
  scope: "region",
  countryIds: [],
  regionIds: [],
  durationTurns: 4,
  durationByScope: { region: 4, country: 6 },
  effects: [
    gdpLoss(0.015, "Flood damage shock"),
    fx("tick", "metric", "infrastructure", "damage", 0.06, "Submerged roads and utilities"),
    fx("tick", "metric", "economy", "foodPrices", 0.015, "Crop and supply losses"),
    fx("tick", "approval", "government", "overall", -0.025, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "Major flooding has submerged low-lying areas of {location}, cutting off roads and displacing thousands.",
  wireMessageOnEnd: "Floodwaters recede. Damage assessments and repairs get underway.",
};

export const VOLCANIC_ERUPTION_TEMPLATE: CrisisTemplate = {
  naturalDisaster: true,
  geo: { requiresRegionTags: ["volcanic"] },
  name: "Volcanic Eruption",
  heroImage:
    "https://images.unsplash.com/photo-1759503408354-8cfa8a13115e?auto=format&fit=crop&w=1600&q=70",
  description:
    "A volcano in {location} has erupted violently, spewing ash miles into the sky and sending rivers of lava and mud down its slopes toward populated valleys. Authorities have ordered mass evacuations as ashfall buries farmland and chokes towns, while airports across the region shut down with airspace declared unsafe. Scientists warn the eruption could intensify in the days ahead.",
  scope: "region",
  countryIds: [],
  regionIds: [],
  durationTurns: 5,
  durationByScope: { region: 5, country: 7 },
  effects: [
    gdpLoss(0.025, "Eruption and evacuation shock"),
    fx("tick", "metric", "environment", "airQuality", -0.12, "Ashfall air quality collapse"),
    fx("tick", "metric", "infrastructure", "damage", 0.05, "Ash and lahar damage"),
    fx("tick", "approval", "government", "overall", -0.03, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "A volcano in {location} has erupted, blanketing the area in ash and forcing mass evacuations.",
  wireMessageOnEnd: "The eruption subsides. Ash cleanup and recovery begin.",
};

export const WINTER_STORM_TEMPLATE: CrisisTemplate = {
  naturalDisaster: true,
  geo: { requiresRegionTags: ["wintry"] },
  name: "Winter Storm",
  heroImage:
    "https://images.unsplash.com/photo-1616126393469-d32bbeb41511?auto=format&fit=crop&w=1600&q=70",
  description:
    "A crippling winter storm has buried {location} under heavy snow and ice, snapping power lines and plunging hundreds of thousands of homes into cold and darkness. Highways and airports are shut down, stranding travelers, while hospitals strain under a surge of cold-related emergencies and heating demand pushes the grid to its limits. Officials are urging residents to stay off the roads until crews can dig out.",
  scope: "region",
  countryIds: [],
  regionIds: [],
  durationTurns: 2,
  durationByScope: { region: 2, country: 3 },
  effects: [
    gdpLoss(0.008, "Winter storm shutdown"),
    fx("tick", "metric", "infrastructure", "power", -0.08, "Ice-laden grid outages"),
    fx("tick", "approval", "government", "overall", -0.02, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "A severe winter storm has paralyzed {location}, stranding residents amid power outages and impassable roads.",
  wireMessageOnEnd: "The storm clears. Crews restore power and reopen roads.",
};

// ── INFRASTRUCTURE DISASTERS (sector margin shocks) ──────────────────────────
// Region-scoped, man-made failures. Their defining effect is a decaying profit-
// margin hit on sectors in the affected state, which the spawner preserves and
// which feeds the blended sector margin (see buildRegionalDisasterEffects).

export const BRIDGE_COLLAPSE_TEMPLATE: CrisisTemplate = {
  naturalDisaster: true,
  name: "Bridge Collapse",
  heroImage:
    "https://images.unsplash.com/photo-1657682947944-a89ee627d862?auto=format&fit=crop&w=1600&q=70",
  description:
    "A major bridge fails, severing a key transport link. Freight reroutes for miles, commutes seize up, and local businesses lose access to customers and suppliers.",
  scope: "region",
  countryIds: [],
  regionIds: [],
  durationTurns: 3,
  durationByScope: { region: 3, country: 4 },
  effects: [
    fx("flat", "metric", "economy", "gdp", -0.008, "Severed transport link"),
    {
      effectType: "decay",
      targetType: "profitMargin",
      metricCategory: null,
      metricField: null,
      sectorType: null,
      strategyId: null,
      value: -6,
      label: "Bridge collapse logistics disruption",
      physicality: "physical",
    },
    fx("tick", "metric", "infrastructure", "damage", 0.04, "Structural failure and detours"),
    fx("tick", "approval", "government", "overall", -0.02, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "A major bridge has collapsed, severing a key transport link. Freight detours and commutes back up for miles.",
  wireMessageOnEnd: "A temporary span reopens the crossing. Full repairs continue.",
};

export const PORT_CLOSURE_TEMPLATE: CrisisTemplate = {
  naturalDisaster: true,
  geo: { requiresRegionTags: ["coastal"] },
  name: "Port Shutdown",
  heroImage:
    "https://images.unsplash.com/photo-1605745341112-85968b19335b?auto=format&fit=crop&w=1600&q=70",
  description:
    "The region's main port shuts down after a critical failure. Cargo backs up at anchor, importers run short, and exporters miss shipments.",
  scope: "region",
  countryIds: [],
  regionIds: [],
  durationTurns: 4,
  durationByScope: { region: 4, country: 6 },
  effects: [
    fx("flat", "metric", "economy", "gdp", -0.012, "Cargo backlog shock"),
    {
      effectType: "decay",
      targetType: "profitMargin",
      metricCategory: null,
      metricField: null,
      sectorType: null,
      strategyId: null,
      value: -8,
      label: "Port shutdown supply disruption",
      physicality: "physical",
    },
    fx("tick", "metric", "economy", "exports", -0.03, "Export throughput collapse"),
    fx("tick", "approval", "government", "overall", -0.015, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "The region's main port has shut down after a critical failure. Cargo backs up and supply chains seize.",
  wireMessageOnEnd: "The port reopens. Backlogged cargo begins to clear.",
};

export const INDUSTRIAL_ACCIDENT_TEMPLATE: CrisisTemplate = {
  naturalDisaster: true,
  name: "Industrial Accident",
  heroImage:
    "https://images.unsplash.com/photo-1676624775964-10bc144cbeba?auto=format&fit=crop&w=1600&q=70",
  description:
    "A major accident at an industrial site forces a shutdown and area evacuation. Production halts and a cleanup operation begins under regulatory scrutiny.",
  scope: "region",
  countryIds: [],
  regionIds: [],
  durationTurns: 3,
  durationByScope: { region: 3, country: 5 },
  effects: [
    fx("flat", "metric", "economy", "gdp", -0.01, "Plant shutdown shock"),
    {
      effectType: "decay",
      targetType: "profitMargin",
      metricCategory: null,
      metricField: null,
      sectorType: null,
      strategyId: null,
      value: -6,
      label: "Industrial accident production halt",
      physicality: "physical",
    },
    fx("tick", "metric", "environment", "airQuality", -0.06, "Chemical release air quality hit"),
    fx("tick", "approval", "government", "overall", -0.02, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "A major industrial accident has forced a plant shutdown and area evacuation. Investigators are on site.",
  wireMessageOnEnd: "The site is secured. Operations resume under review.",
};

// ── STATE-SPECIFIC NATURAL DISASTERS ─────────────────────────────────────────
// Region-tag-gated disasters tied to specific hazard profiles. Like the simple
// disaster templates above (tornado, flood, volcanic, winter storm), these carry
// effects + wire copy only, no decision tree. The regional spawner gates them by
// `geo.requiresRegionTags` so they only strike states that carry the tag.

export const DUST_STORM_TEMPLATE: CrisisTemplate = {
  naturalDisaster: true,
  geo: { requiresRegionTags: ["arid"] },
  name: "Dust Storm",
  heroImage:
    "https://images.unsplash.com/photo-1567470412546-f7d36d6e1f6a?auto=format&fit=crop&w=1600&q=70",
  description:
    "A towering wall of dust has rolled across {location}, blotting out the sun and reducing visibility to a few meters along major highways. Drivers have pulled onto the shoulder with hazards on, flights are grounded, and residents are sealing doors and windows as fine grit works its way into homes and machinery. Forecasters expect the haze to linger for a day or two before the air clears.",
  scope: "region",
  countryIds: [],
  regionIds: [],
  durationTurns: 3,
  durationByScope: { region: 3, country: 4 },
  effects: [
    gdpLoss(0.008, "Dust storm disruption"),
    fx("tick", "metric", "environment", "airQuality", -0.1, "Particulate haze"),
    fx("tick", "metric", "infrastructure", "damage", 0.03, "Abrasion and grit cleanup"),
    fx("tick", "approval", "government", "overall", -0.02, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "A dust storm has swept across {location}, grounding flights and cutting visibility to near zero on major highways.",
  wireMessageOnEnd: "The dust settles. Air quality slowly improves and roads reopen.",
};

export const HAILSTORM_TEMPLATE: CrisisTemplate = {
  naturalDisaster: true,
  geo: { requiresRegionTags: ["tornado"] },
  name: "Hailstorm",
  heroImage:
    "https://images.unsplash.com/photo-1620503324967-fb6d65e1c5e9?auto=format&fit=crop&w=1600&q=70",
  description:
    "A sudden hailstorm has pelted {location} with stones large enough to dent cars, shatter skylights, and strip fields bare in a matter of minutes. Roofs and vehicles across the area took the worst of it, and growers are surveying shredded crops as adjusters mobilize. Cleanup crews are clearing storm drains clogged with leaves and ice as the system moves on.",
  scope: "region",
  countryIds: [],
  regionIds: [],
  durationTurns: 2,
  durationByScope: { region: 2, country: 3 },
  effects: [
    gdpLoss(0.01, "Hail damage to crops and property"),
    fx("tick", "metric", "economy", "foodPrices", 0.015, "Crop losses push food prices"),
    fx("tick", "metric", "infrastructure", "damage", 0.04, "Roof and vehicle damage"),
    fx("tick", "approval", "government", "overall", -0.015, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "A hailstorm has battered {location}, denting vehicles and shredding crops across the region.",
  wireMessageOnEnd: "The hail clears. Insurance adjusters begin surveying the damage.",
};

export const AVALANCHE_TEMPLATE: CrisisTemplate = {
  naturalDisaster: true,
  geo: { requiresRegionTags: ["wintry"] },
  name: "Avalanche",
  heroImage:
    "https://images.unsplash.com/photo-1483728642387-6c3bdd6c93e5?auto=format&fit=crop&w=1600&q=70",
  description:
    "A large avalanche has swept down a slope above {location}, burying a stretch of mountain road and several outbuildings under tons of snow. Search teams with dogs and probes are working the debris field, and the main route through the area is closed until crews can clear the slide and stabilize the slope. Officials are warning backcountry travelers to stay off steep terrain while the snowpack settles.",
  scope: "region",
  countryIds: [],
  regionIds: [],
  durationTurns: 2,
  durationByScope: { region: 2, country: 3 },
  effects: [
    gdpLoss(0.01, "Avalanche destruction"),
    fx("tick", "metric", "infrastructure", "damage", 0.05, "Buried road and outbuildings"),
    fx("tick", "metric", "economy", "unemployment", 0.01, "Mountain commerce halted"),
    fx("tick", "approval", "government", "overall", -0.02, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "An avalanche has buried a mountain road in {location}, prompting a search of the debris field.",
  wireMessageOnEnd: "The road reopens. Recovery teams stand down as the slope stabilizes.",
};

export const KING_TIDE_FLOODING_TEMPLATE: CrisisTemplate = {
  naturalDisaster: true,
  geo: { requiresRegionTags: ["coastal"] },
  name: "King Tide Flooding",
  heroImage:
    "https://images.unsplash.com/photo-1528465429440-38f8b7512077?auto=format&fit=crop&w=1600&q=70",
  description:
    "Seasonal king tides have pushed seawater up through storm drains and over low seawalls across {location}, flooding coastal streets on dry afternoons. Saltwater is lapping at storefronts and grounding traffic in the lowest neighborhoods, and planners say the nuisance flooding is creeping higher each year. Crews are pumping out intersections and handing out sandbags as another tide cycle builds.",
  scope: "region",
  countryIds: [],
  regionIds: [],
  durationTurns: 3,
  durationByScope: { region: 3, country: 4 },
  effects: [
    gdpLoss(0.006, "Chronic coastal flooding"),
    fx("tick", "metric", "economy", "housing", -0.04, "Coastal property value pressure"),
    fx("tick", "metric", "infrastructure", "damage", 0.03, "Drainage and seawall strain"),
    fx("tick", "approval", "government", "overall", -0.02, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "King tides are flooding coastal streets in {location}, pushing saltwater over low seawalls on dry afternoons.",
  wireMessageOnEnd: "The tides recede. Pumped-out streets reopen until the next cycle.",
};

export const LANDSLIDE_TEMPLATE: CrisisTemplate = {
  naturalDisaster: true,
  geo: { requiresRegionTags: ["seismic"] },
  name: "Landslide",
  heroImage:
    "https://images.unsplash.com/photo-1611279284655-4e0c61e30f6d?auto=format&fit=crop&w=1600&q=70",
  description:
    "A hillside above {location} has given way after sustained ground shaking and wet weather, sending a slide of mud and rock across homes and a key road below. Several structures are buried or pushed off their foundations, utilities are snapped, and geologists are assessing whether the slope is stable enough for rescue crews to work safely. Residents upslope are under evacuation orders as more rain is forecast.",
  scope: "region",
  countryIds: [],
  regionIds: [],
  durationTurns: 3,
  durationByScope: { region: 3, country: 4 },
  effects: [
    gdpLoss(0.012, "Landslide destruction"),
    fx("tick", "metric", "infrastructure", "damage", 0.06, "Buried road and utilities"),
    fx("tick", "metric", "economy", "unemployment", 0.012, "Local commerce cut off"),
    fx("tick", "approval", "government", "overall", -0.02, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "A landslide has buried homes and a key road in {location}, with evacuations ordered as more rain approaches.",
  wireMessageOnEnd:
    "The slope is stabilized. Crews begin clearing the slide and reconnecting utilities.",
};

export const FOREST_PEST_OUTBREAK_TEMPLATE: CrisisTemplate = {
  naturalDisaster: true,
  geo: { requiresRegionTags: ["wildfire"] },
  name: "Forest Pest Outbreak",
  heroImage:
    "https://images.unsplash.com/photo-1542273917363-3b0b3b3b3b3b?auto=format&fit=crop&w=1600&q=70",
  description:
    "A native bark beetle outbreak has flared across the forests of {location}, killing stands of weakened trees faster than crews can cut buffer lines. The dead timber is piling up across a region already prone to fire, air quality is slipping as respiring canopy thins, and foresters are scrambling to salvage log before the killed wood loses value. Officials warn the outbreak will take seasons to run its course.",
  scope: "region",
  countryIds: [],
  regionIds: [],
  durationTurns: 6,
  durationByScope: { region: 6, country: 8 },
  effects: [
    gdpLoss(0.01, "Timber and forest loss"),
    fx("tick", "metric", "environment", "airQuality", -0.05, "Thinned canopy and deadwood"),
    fx("tick", "metric", "economy", "renewableShare", -0.02, "Forest carbon loss"),
    fx("tick", "approval", "government", "overall", -0.015, "Government approval erosion"),
  ],
  wireMessageOnStart:
    "A bark beetle outbreak is killing forests across {location}, leaving standing deadwood that fire crews fear.",
  wireMessageOnEnd: "The outbreak slows. Salvage logging and replanting get underway.",
};

// ── 1960s: USSR LIBERALIZATION AND US PROTEST ────────────────────────────────
// A Prague-Spring-style reform-movement crisis for the USSR and its Warsaw
// Pact satellites, and four distinct American protest crises. All decision
// options apply real effects (approval/metric writes through crisisTurn.ts)
// and, where the choice plausibly provokes further unrest, a real
// `spawnFollowUpCrisis` action that creates another crisis document rather
// than just changing flavor text. See `spawnFollowUpCrisis` in
// optionActions.ts for the handler.

export const PRAGUE_SPRING_TEMPLATE: CrisisTemplate = {
  name: "Reform Movement",
  fromYear: 1960,
  geo: { countries: WARSAW_PACT_BLOC_COUNTRY_IDS },
  autoTrigger: { kind: "random", cooldownTurns: 200, scope: "country", spawnChance: 0.0018 },
  heroImage:
    "https://images.unsplash.com/photo-1591259622709-bdb033b4be2b?auto=format&fit=crop&w=1600&q=70",
  description:
    "A reform faction inside the ruling party is pushing to loosen censorship, ease travel restrictions, and open the economy to limited market pressure. Students and intellectuals are rallying behind it, and the reform's momentum is starting to worry party hardliners and neighboring governments alike.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 6,
  durationByScope: { country: 6 },
  effects: [
    fx(
      "tick",
      "approval",
      "government",
      "overall",
      -0.015,
      "Party authority strained by reform pressure"
    ),
    fx(
      "tick",
      "metric",
      "economy",
      "investorConfidence",
      -0.01,
      "Uncertainty over the country's direction"
    ),
  ],
  wireMessageOnStart:
    "A reform movement inside the ruling party is gathering pace in {location}, pressing for looser censorship and economic liberalization.",
  wireMessageOnEnd: "The reform movement's moment passes, one way or another.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Reform movement response",
        description:
          "A reform movement is gathering pace, pushing for liberalization the party leadership never authorized. How do you respond?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_suppress",
            label: "Suppress Militarily",
            description:
              "Send in security forces to restore party control. Ends the movement fast, but reads as a tank rolling through a capital to the rest of the world.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                0.05,
                "Order restored, control reasserted"
              ),
              fx(
                "flat",
                "approval",
                "westernOpinion",
                "overall",
                -0.12,
                "International outcry over the crackdown"
              ),
              fx(
                "flat",
                "metric",
                "economy",
                "investorConfidence",
                -0.06,
                "Foreign capital spooked by the crackdown"
              ),
            ],
          },
          {
            optionId: "response_tolerate",
            label: "Tolerate",
            description:
              "Let the movement run its course without intervening. Unrest continues to simmer, and the example may embolden reformers elsewhere in the bloc.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                -0.03,
                "Authority visibly unable to act"
              ),
              fx("flat", "approval", "reformers", "overall", 0.04, "Reform movement emboldened"),
            ],
            action: {
              kind: "spawnFollowUpCrisis",
              templateKey: "prague_spring_reform",
              countryPool: "warsawPactSatellites",
              excludeCurrentCountry: true,
              chance: 0.5,
            },
          },
          {
            optionId: "response_reform",
            label: "Genuine Reform",
            description:
              "Get ahead of the movement and enact real liberalization: looser censorship, freer travel, room for the economy to breathe. Popular with reformers, but it is a bet the hardliners in the party will not forgive.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "approval",
                "reformers",
                "overall",
                0.07,
                "Genuine liberalization welcomed"
              ),
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                -0.04,
                "Party stability shaken by the concessions"
              ),
              fx(
                "flat",
                "metric",
                "economy",
                "investorConfidence",
                -0.02,
                "Markets uncertain about the new direction"
              ),
            ],
            action: {
              kind: "spawnFollowUpCrisis",
              templateKey: "hardliner_backlash",
              countryPool: "sameCountry",
              chance: 0.6,
            },
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Crisis resolved",
        description: "The reform movement crisis has run its course.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const HARDLINER_BACKLASH_TEMPLATE: CrisisTemplate = {
  name: "Hardliner Backlash",
  fromYear: 1960,
  geo: { countries: WARSAW_PACT_BLOC_COUNTRY_IDS },
  heroImage:
    "https://images.unsplash.com/photo-1591259622709-bdb033b4be2b?auto=format&fit=crop&w=1600&q=70",
  description:
    "Hardliners inside the party, alarmed by recent liberalization, are maneuvering to reverse it and discipline the reformers who pushed it through.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 4,
  effects: [
    fx("tick", "approval", "reformers", "overall", -0.02, "Hardliner pressure on reformers"),
  ],
  wireMessageOnStart:
    "Party hardliners in {location} are moving to roll back recent liberalization and discipline the reformers behind it.",
  wireMessageOnEnd: "The hardliner backlash subsides, its outcome already felt in the party ranks.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Hardliner backlash response",
        description: "Hardliners want the recent reforms reversed. How do you handle them?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_hold",
            label: "Hold the Line",
            description: "Keep the reforms in place and face down the hardliners directly.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "approval", "reformers", "overall", 0.03, "Reformers reassured"),
              fx("flat", "approval", "government", "overall", -0.03, "Party unity strained"),
            ],
          },
          {
            optionId: "response_concede",
            label: "Concede Ground",
            description: "Walk back part of the reform package to appease the hardliners.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "approval", "reformers", "overall", -0.05, "Reformers feel betrayed"),
              fx("flat", "approval", "government", "overall", 0.02, "Party hardliners placated"),
            ],
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Crisis resolved",
        description: "The hardliner backlash has run its course.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const CIVIL_RIGHTS_MARCHES_TEMPLATE: CrisisTemplate = {
  name: "Civil Rights Marches",
  fromYear: 1960,
  untilYear: 1968,
  geo: { countries: ["US"] },
  autoTrigger: { kind: "random", cooldownTurns: 120, scope: "country", spawnChance: 0.003 },
  heroImage:
    "https://images.unsplash.com/photo-1591259622709-bdb033b4be2b?auto=format&fit=crop&w=1600&q=70",
  description:
    "Mass marches for civil rights and voting rights are drawing hundreds of thousands into the streets. Organizers demand federal action; segregationist state officials dig in.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 5,
  effects: [
    fx(
      "tick",
      "metric",
      "economy",
      "consumerConfidence",
      -0.008,
      "Disruption from mass demonstrations"
    ),
  ],
  wireMessageOnStart:
    "Mass civil rights marches are sweeping {location}, demanding federal action on voting rights and desegregation.",
  wireMessageOnEnd: "The march movement's immediate wave subsides. Its demands remain unresolved.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Civil rights response",
        description: "Civil rights marches are sweeping the country. What is the federal response?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_intervene",
            label: "Federal Intervention",
            description:
              "Send federal marshals to protect marchers and enforce desegregation orders over state objections.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                0.02,
                "Federal action seen as principled"
              ),
              fx("flat", "approval", "civilRightsMovement", "overall", 0.06, "Marchers protected"),
              fx(
                "flat",
                "approval",
                "segregationistVoters",
                "overall",
                -0.08,
                "States'-rights backlash"
              ),
            ],
          },
          {
            optionId: "response_legislate",
            label: "Push Legislation",
            description:
              "Commit to a federal civil rights bill instead of direct intervention. Slower, but builds a durable settlement.",
            nextNodeId: "terminal",
            action: {
              kind: "concessionBill",
              title: "Civil Rights and Voting Protections Act",
              summary:
                "Bars segregation in public accommodations and puts federal protection behind the right to vote.",
              category: "civil rights",
            },
            effects: [
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                0.015,
                "Legislative commitment welcomed"
              ),
              fx(
                "flat",
                "metric",
                "economy",
                "gdp",
                -0.003,
                "Cost of enforcement and compliance programs"
              ),
            ],
          },
          {
            optionId: "response_crackdown",
            label: "Crack Down",
            description:
              "Deploy state police to break up the marches. Ends the immediate disruption, but the images make national headlines.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "approval",
                "segregationistVoters",
                "overall",
                0.05,
                "Order restored, base pleased"
              ),
              fx(
                "flat",
                "approval",
                "civilRightsMovement",
                "overall",
                -0.09,
                "Movement radicalized by the crackdown"
              ),
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                -0.04,
                "National press coverage turns hostile"
              ),
            ],
            action: {
              kind: "spawnFollowUpCrisis",
              templateKey: "urban_riots",
              countryPool: "sameCountry",
              chance: 0.35,
            },
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Crisis resolved",
        description: "The civil rights march crisis has run its course.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const CAMPUS_UNREST_TEMPLATE: CrisisTemplate = {
  name: "Campus Unrest",
  fromYear: 1964,
  untilYear: 1972,
  geo: { countries: ["US"] },
  autoTrigger: { kind: "random", cooldownTurns: 100, scope: "country", spawnChance: 0.0025 },
  heroImage:
    "https://images.unsplash.com/photo-1591259622709-bdb033b4be2b?auto=format&fit=crop&w=1600&q=70",
  description:
    "Students have occupied campus buildings over the war, civil rights, and university governance. Administrators are under pressure to call in police; faculty are split.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 3,
  effects: [
    fx(
      "tick",
      "approval",
      "government",
      "overall",
      -0.008,
      "Generational divide over campus unrest"
    ),
  ],
  wireMessageOnStart:
    "Student occupations and walkouts are spreading across campuses in {location}.",
  wireMessageOnEnd: "The campus occupations wind down as the term year runs out.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Campus unrest response",
        description: "Student occupations are spreading. How does the administration respond?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_negotiate",
            label: "Negotiate with Students",
            description: "Open talks on the students' demands and de-escalate.",
            nextNodeId: "terminal",
            effects: [
              fx("flat", "approval", "youthVoters", "overall", 0.05, "Students feel heard"),
              fx(
                "flat",
                "approval",
                "conservativeVoters",
                "overall",
                -0.02,
                "Seen as caving to protesters"
              ),
            ],
          },
          {
            optionId: "response_crackdown",
            label: "Send in Police",
            description: "Clear the occupied buildings by force. Ends the disruption immediately.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "approval",
                "youthVoters",
                "overall",
                -0.09,
                "Students radicalized by the raid"
              ),
              fx(
                "flat",
                "approval",
                "conservativeVoters",
                "overall",
                0.05,
                "Base approves of restoring order"
              ),
              fx(
                "flat",
                "metric",
                "publicsafety",
                "confidence",
                -0.03,
                "Footage of the raid shakes public confidence"
              ),
            ],
            action: {
              kind: "spawnFollowUpCrisis",
              templateKey: "campus_unrest",
              countryPool: "sameCountry",
              chance: 0.3,
            },
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Crisis resolved",
        description: "The campus unrest crisis has run its course.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const URBAN_RIOTS_TEMPLATE: CrisisTemplate = {
  name: "Urban Unrest",
  fromYear: 1964,
  untilYear: 1968,
  geo: { countries: ["US"] },
  autoTrigger: { kind: "random", cooldownTurns: 100, scope: "country", spawnChance: 0.002 },
  heroImage:
    "https://images.unsplash.com/photo-1591259622709-bdb033b4be2b?auto=format&fit=crop&w=1600&q=70",
  description:
    "Unrest has broken out in urban neighborhoods long neglected by city and federal investment. Fires, looting, and clashes with police have residents and business owners bracing for what comes next.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 4,
  effects: [
    marginShock(-3, "Unrest disrupts local commerce"),
    fx("tick", "metric", "economy", "gdp", -0.01, "Local economic disruption"),
  ],
  wireMessageOnStart: "Urban unrest has broken out in {location} amid long-standing grievances.",
  wireMessageOnEnd: "The unrest subsides. The underlying grievances remain unaddressed.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Urban unrest response",
        description: "Unrest has broken out in city neighborhoods. What is the response?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_guard",
            label: "Deploy the National Guard",
            description: "Restore order with the Guard. Fast, but raises civil-liberties concerns.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                -0.02,
                "Military presence unsettles residents"
              ),
              fx("flat", "metric", "economy", "gdp", -0.005, "Deployment cost"),
            ],
          },
          {
            optionId: "response_invest",
            label: "Announce Investment",
            description: "Commit to housing and jobs programs in the affected neighborhoods.",
            nextNodeId: "terminal",
            action: {
              kind: "concessionBill",
              title: "Urban Investment and Jobs Act",
              summary: "Federal funding for housing and jobs programs in cities hit by unrest.",
              category: "urban policy",
            },
            effects: [
              fx("flat", "approval", "urbanCommunities", "overall", 0.06, "Investment welcomed"),
              fx("flat", "metric", "economy", "gdp", -0.008, "Program cost"),
            ],
          },
          {
            optionId: "response_crackdown",
            label: "Crack Down",
            description:
              "Impose curfews and mass arrests. Ends the unrest fast, but deepens the divide.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "approval",
                "urbanCommunities",
                "overall",
                -0.1,
                "Community trust collapses"
              ),
              fx(
                "flat",
                "approval",
                "lawAndOrderVoters",
                "overall",
                0.07,
                "Order restored, base approves"
              ),
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                -0.03,
                "National coverage turns critical"
              ),
            ],
            action: {
              kind: "spawnFollowUpCrisis",
              templateKey: "urban_riots",
              countryPool: "sameCountry",
              chance: 0.3,
            },
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Crisis resolved",
        description: "The urban unrest crisis has run its course.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

// Vietnam escalation scaling. `getVietnamEscalationLevel()` currently always
// returns 0 (see vietnamEscalationInterface.ts, Track A has not wired the
// real state yet), so today this resolves to the floor values below. Once
// Track A's implementation lands and returns a live 0-1 reading, these will
// scale up with it on the next deploy (module-level, so a running process
// picks up a code change, not a runtime state change, restarting the deploy
// is what makes escalation take effect, same as any other server constant).
const VIETNAM_ESCALATION = getVietnamEscalationLevel();
const ANTIWAR_SPAWN_CHANCE = 0.0015 + 0.0025 * VIETNAM_ESCALATION;
const ANTIWAR_SEVERITY_SCALE = 1 + VIETNAM_ESCALATION;

export const ANTIWAR_PROTEST_TEMPLATE: CrisisTemplate = {
  name: "Anti-War Protests",
  fromYear: 1965,
  untilYear: 1972,
  geo: { countries: ["US"] },
  autoTrigger: {
    kind: "random",
    cooldownTurns: 90,
    scope: "country",
    spawnChance: ANTIWAR_SPAWN_CHANCE,
  },
  heroImage:
    "https://images.unsplash.com/photo-1591259622709-bdb033b4be2b?auto=format&fit=crop&w=1600&q=70",
  description:
    "Anti-war demonstrations are drawing large crowds, draft resistance is spreading, and the war's mounting cost is becoming a domestic political liability.",
  scope: "country",
  countryIds: [],
  regionIds: [],
  durationTurns: 4,
  effects: [
    fx(
      "tick",
      "approval",
      "government",
      "overall",
      -0.012 * ANTIWAR_SEVERITY_SCALE,
      "War-weariness erodes approval"
    ),
  ],
  wireMessageOnStart: "Anti-war demonstrations are spreading across {location}.",
  wireMessageOnEnd: "The wave of anti-war demonstrations recedes, for now.",
  interactionDefinition: {
    decisionTree: [
      {
        nodeId: "response",
        type: "choice",
        title: "Anti-war protest response",
        description: "Anti-war demonstrations are spreading. What is the response?",
        requiredRoles: ["headOfState"],
        timeLimitMinutes: null,
        options: [
          {
            optionId: "response_intervene",
            label: "Federal Intervention",
            description:
              "Deploy federal forces to keep demonstrations from disrupting the capital.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                -0.02 * ANTIWAR_SEVERITY_SCALE,
                "Heavy-handed federal presence resented"
              ),
            ],
          },
          {
            optionId: "response_concede",
            label: "Signal De-escalation",
            description:
              "Announce troop drawdowns or peace talks to take the wind out of the movement.",
            nextNodeId: "terminal",
            action: {
              kind: "concessionBill",
              title: "Selective Service and Troop Commitment Review Act",
              summary: "Reforms the draft system and mandates a review of troop commitment levels.",
              category: "defense policy",
            },
            effects: [
              fx(
                "flat",
                "approval",
                "antiWarVoters",
                "overall",
                0.06 * ANTIWAR_SEVERITY_SCALE,
                "De-escalation welcomed by the movement"
              ),
              fx(
                "flat",
                "approval",
                "hawkishVoters",
                "overall",
                -0.03 * ANTIWAR_SEVERITY_SCALE,
                "Hawks see it as weakness"
              ),
            ],
          },
          {
            optionId: "response_crackdown",
            label: "Crack Down",
            description: "Order police and National Guard to clear demonstrations by force.",
            nextNodeId: "terminal",
            effects: [
              fx(
                "flat",
                "approval",
                "antiWarVoters",
                "overall",
                -0.1 * ANTIWAR_SEVERITY_SCALE,
                "Movement radicalized by the crackdown"
              ),
              fx(
                "flat",
                "approval",
                "hawkishVoters",
                "overall",
                0.05 * ANTIWAR_SEVERITY_SCALE,
                "Order restored, hawks approve"
              ),
              fx(
                "flat",
                "approval",
                "government",
                "overall",
                -0.04 * ANTIWAR_SEVERITY_SCALE,
                "Coverage of the crackdown turns hostile"
              ),
            ],
            action: {
              kind: "spawnFollowUpCrisis",
              templateKey: "campus_unrest",
              countryPool: "sameCountry",
              chance: 0.3 + 0.2 * VIETNAM_ESCALATION,
            },
          },
        ],
      },
      {
        nodeId: "terminal",
        type: "terminal",
        title: "Crisis resolved",
        description: "The anti-war protest crisis has run its course.",
        requiredRoles: ["any"],
        timeLimitMinutes: null,
      },
    ],
    autoResolveOnExpiry: true,
  },
};

export const ALL_CRISIS_TEMPLATES: Record<
  string,
  Omit<
    Crisis,
    "_id" | "createdBy" | "createdAt" | "resolvedAt" | "startTurn" | "endTurn" | "status"
  >
> = {
  banking_crisis: BANKING_CRISIS_TEMPLATE,
  recession: RECESSION_TEMPLATE,
  inflation_spike: INFLATION_SPIKE_TEMPLATE,
  hurricane: HURRICANE_TEMPLATE,
  earthquake: EARTHQUAKE_TEMPLATE,
  wildfire: WILDFIRE_TEMPLATE,
  mass_protests: MASS_PROTESTS_TEMPLATE,
  political_scandal: POLITICAL_SCANDAL_TEMPLATE,
  trade_war: TRADE_WAR_TEMPLATE,
  cyber_attack: CYBER_ATTACK_TEMPLATE,
  energy_crisis: ENERGY_CRISIS_TEMPLATE,
  refugee_crisis: REFUGEE_CRISIS_TEMPLATE,
  pandemic: PANDEMIC_TEMPLATE,
  currency_crisis: CURRENCY_CRISIS_TEMPLATE,
  drought_famine: DROUGHT_FAMINE_TEMPLATE,
  housing_collapse: HOUSING_COLLAPSE_TEMPLATE,
  labor_strikes: LABOR_STRIKES_TEMPLATE,
  steel_strike: STEEL_STRIKE_TEMPLATE,
  debt_default_contagion: DEBT_DEFAULT_CONTAGION_TEMPLATE,
  supply_chain_disruption: SUPPLY_CHAIN_DISRUPTION_TEMPLATE,
  tech_bubble_burst: TECH_BUBBLE_BURST_TEMPLATE,
  extreme_heat: EXTREME_HEAT_TEMPLATE,
  nuclear_accident: NUCLEAR_ACCIDENT_TEMPLATE,
  coup_attempt: COUP_ATTEMPT_TEMPLATE,
  power_grid_failure: POWER_GRID_FAILURE_TEMPLATE,
  water_crisis: WATER_CRISIS_TEMPLATE,
  disinformation_crisis: DISINFORMATION_CRISIS_TEMPLATE,
  tsunami: TSUNAMI_TEMPLATE,
  debt_ceiling_crisis: DEBT_CEILING_CRISIS_TEMPLATE,
  tornado: TORNADO_TEMPLATE,
  flood: FLOOD_TEMPLATE,
  volcanic_eruption: VOLCANIC_ERUPTION_TEMPLATE,
  winter_storm: WINTER_STORM_TEMPLATE,
  bridge_collapse: BRIDGE_COLLAPSE_TEMPLATE,
  port_closure: PORT_CLOSURE_TEMPLATE,
  industrial_accident: INDUSTRIAL_ACCIDENT_TEMPLATE,
  dust_storm: DUST_STORM_TEMPLATE,
  hailstorm: HAILSTORM_TEMPLATE,
  avalanche: AVALANCHE_TEMPLATE,
  king_tide_flooding: KING_TIDE_FLOODING_TEMPLATE,
  landslide: LANDSLIDE_TEMPLATE,
  forest_pest_outbreak: FOREST_PEST_OUTBREAK_TEMPLATE,
  prague_spring_reform: PRAGUE_SPRING_TEMPLATE,
  hardliner_backlash: HARDLINER_BACKLASH_TEMPLATE,
  civil_rights_marches: CIVIL_RIGHTS_MARCHES_TEMPLATE,
  campus_unrest: CAMPUS_UNREST_TEMPLATE,
  urban_riots: URBAN_RIOTS_TEMPLATE,
  antiwar_protest: ANTIWAR_PROTEST_TEMPLATE,
};
