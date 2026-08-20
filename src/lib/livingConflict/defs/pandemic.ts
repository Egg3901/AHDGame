import type { LivingConflictDef, RoleContext, ConflictRole } from "../types";
import { cfx } from "../effects";
import { choiceNode, opt } from "../authoring";

/**
 * Pandemic: the proof that the living-conflict engine is not war-specific.
 *
 * A novel pathogen is one persistent, phased event, not a wall of one-off crises.
 * It is paced by contagion pressure and time-in-phase (minDwellTurns), not by a
 * historical calendar, which is the pandemic's answer to Vietnam's earliestYear
 * floor. Every nation acts through its ROLE:
 *
 *  - `belligerent` — a nation in the thick of the outbreak (its epicentres).
 *  - `neighbor`    — a bordering / heavily-exposed nation.
 *  - `bloc`        — a close trade partner, exposed through commerce not contact.
 *  - `bystander`   — everyone else, who can still send aid or shut borders.
 *
 * The responses are not cosmetic: a nation that locks down relieves contagion
 * pressure (slowing the climb) at an economic cost; one that stays open keeps its
 * economy but lets the pressure build. Player choices bend the trajectory.
 */

function pandemicRole(ctx: RoleContext): ConflictRole {
  if (ctx.belligerents.includes(ctx.countryId)) return "belligerent";
  if (ctx.neighbors.includes(ctx.countryId)) return "neighbor";
  if (ctx.blocMembers.includes(ctx.countryId)) return "bloc";
  return "bystander";
}

// Shared response menus, scaled per phase by the caller. Lockdown trades economy
// for health and slows the disease; open trades health for economy.
const lockdown = (gdp: number, health: number) =>
  opt("lockdown", "Impose a lockdown", "Shutter public life to break transmission chains.", [
    cfx("flat", "metric", "economy", "gdpGrowth", gdp, "Lockdown output loss"),
    cfx("tick", "metric", "society", "publicHealth", health, "Transmission slows"),
    cfx("tick", "approval", "government", "overall", -0.02, "Lockdown fatigue"),
  ]);

const vaccinate = (cost: number, health: number) =>
  opt("vaccinate", "Fund mass vaccination", "Pour the budget into a vaccination drive.", [
    cfx("flat", "metric", "economy", "gdpGrowth", cost, "Emergency health spending"),
    cfx("tick", "metric", "society", "publicHealth", health, "Immunity builds"),
    cfx("tick", "approval", "government", "overall", 0.02, "Seen to be acting"),
  ]);

const stayOpen = (health: number) =>
  opt("open", "Keep the economy open", "Refuse restrictions and let the outbreak run.", [
    cfx("tick", "metric", "society", "publicHealth", health, "Unchecked spread"),
    cfx("tick", "approval", "government", "overall", -0.03, "Bodies and blame"),
  ]);

const closeBorders = () =>
  opt("close_borders", "Close the borders", "Seal crossings and ground flights.", [
    cfx("flat", "metric", "economy", "gdpGrowth", -0.01, "Trade and travel collapse"),
    cfx("tick", "metric", "society", "publicHealth", 0.02, "Imported cases fall"),
  ]);

const sendAid = () =>
  opt("send_aid", "Send medical aid", "Ship supplies and specialists to the front line.", [
    cfx("flat", "metric", "economy", "gdpGrowth", -0.004, "Aid outlay"),
    cfx("tick", "approval", "government", "overall", 0.015, "Global goodwill"),
  ]);

export const PANDEMIC_DEF: LivingConflictDef = {
  key: "pandemic",
  type: "pandemic",
  name: "Novel Pandemic",
  roleResolver: pandemicRole,
  phases: [
    {
      level: 1,
      key: "emergence",
      label: "Emergence",
      summary: "An unfamiliar illness in a cluster of cases. Nobody is sure yet what it is.",
      advancePressure: 20,
      naturalPressure: 8,
      defcon: 5,
      decisionTrees: {
        belligerent: choiceNode(
          "emergence_afflicted",
          "An unexplained cluster",
          "Hospitals in the epicentre report a cluster of a severe, unfamiliar illness.",
          [
            opt(
              "investigate",
              "Launch an investigation",
              "Stand up a task force and sequence it.",
              [
                cfx("flat", "metric", "economy", "gdpGrowth", -0.002, "Emergency response cost"),
                cfx("tick", "metric", "society", "publicHealth", 0.01, "Early containment"),
              ]
            ),
            opt("downplay", "Downplay it", "Call it a bad flu season and avoid a panic.", [
              cfx("tick", "metric", "society", "publicHealth", -0.02, "Silent spread"),
            ]),
          ]
        ),
        neighbor: choiceNode(
          "emergence_neighbor",
          "Reports from across the border",
          "Worrying reports arrive from a neighbouring country.",
          [
            opt("monitor", "Monitor and prepare", "Ready hospitals and watch the border.", []),
            closeBorders(),
          ]
        ),
      },
      passiveEffects: {
        belligerent: [cfx("tick", "metric", "society", "publicHealth", -0.01, "Outbreak strain")],
      },
      events: [
        {
          key: "patient_zero",
          kind: "authored",
          severity: "minor",
          affects: ["belligerent"],
          trigger: { onPhaseEnter: true },
          headline: "Cluster of unexplained illness reported",
          body: "Physicians in the epicentre flag a severe respiratory illness they cannot identify.",
        },
      ],
    },
    {
      level: 2,
      key: "outbreak",
      label: "Outbreak",
      summary: "Sustained local transmission. The illness has a name and a rising curve.",
      minDwellTurns: 3,
      advancePressure: 28,
      naturalPressure: 12,
      defcon: 4,
      decisionTrees: {
        belligerent: choiceNode(
          "outbreak_afflicted",
          "The curve is bending upward",
          "Cases are doubling. Intensive care is filling.",
          [lockdown(-0.02, 0.05), stayOpen(-0.05)]
        ),
        neighbor: choiceNode(
          "outbreak_neighbor",
          "Cases arrive at home",
          "The first imported cases are confirmed inside your borders.",
          [
            closeBorders(),
            opt("screen", "Screen travellers", "Test at the border, stay open.", [
              cfx("tick", "metric", "society", "publicHealth", 0.01, "Screening catches cases"),
            ]),
          ]
        ),
        bystander: choiceNode(
          "outbreak_bystander",
          "A distant outbreak",
          "The outbreak dominates the world's headlines.",
          [sendAid(), opt("wait", "Wait and see", "Take no action yet.", [])]
        ),
      },
      passiveEffects: {
        belligerent: [
          cfx("tick", "metric", "society", "publicHealth", -0.02, "Outbreak strain"),
          cfx("tick", "metric", "economy", "consumerConfidence", -0.015, "Fear dampens demand"),
        ],
        neighbor: [cfx("tick", "metric", "society", "publicHealth", -0.008, "Spillover cases")],
      },
      events: [
        {
          key: "who_declaration",
          kind: "authored",
          severity: "major",
          affects: "all",
          trigger: { onPhaseEnter: true },
          headline: "Global health emergency declared",
          body: "International authorities declare the outbreak a public health emergency of global concern.",
        },
        {
          key: "case_surge",
          kind: "procedural",
          severity: "major",
          affects: ["belligerent", "neighbor"],
          trigger: { everyTurns: 4, minIntensity: 30 },
          headline: "Case surge overwhelms hospitals",
          body: "A fresh wave pushes the health system past capacity in the worst-hit regions.",
          effects: {
            belligerent: [
              cfx("tick", "metric", "society", "publicHealth", -0.03, "Surge overload"),
            ],
          },
        },
      ],
    },
    {
      level: 3,
      key: "pandemic",
      label: "Pandemic",
      summary: "Global spread. Every region is counting cases and every economy is bleeding.",
      minDwellTurns: 4,
      advancePressure: 34,
      naturalPressure: 14,
      defcon: 3,
      decisionTrees: {
        belligerent: choiceNode(
          "pandemic_afflicted",
          "A nation under siege",
          "The pandemic is everywhere at once. The choice is how hard to fight it.",
          [lockdown(-0.035, 0.06), vaccinate(-0.02, 0.05), stayOpen(-0.06)]
        ),
        neighbor: choiceNode(
          "pandemic_neighbor",
          "Full spread at home",
          "Your own outbreak now rivals the epicentre's.",
          [lockdown(-0.03, 0.05), stayOpen(-0.05)]
        ),
        bloc: choiceNode(
          "pandemic_bloc",
          "Supply chains buckle",
          "Trade with the afflicted bloc has seized up.",
          [
            opt("subsidise", "Subsidise industry", "Cushion the shock to key sectors.", [
              cfx("flat", "metric", "economy", "gdpGrowth", -0.008, "Support outlay"),
            ]),
            opt("absorb", "Absorb the hit", "Let the market take it.", [
              cfx("tick", "metric", "economy", "gdpGrowth", -0.01, "Trade collapse"),
            ]),
          ]
        ),
        bystander: choiceNode(
          "pandemic_bystander",
          "No one is spared",
          "The pandemic has reached you too, later and lighter.",
          [vaccinate(-0.015, 0.04), stayOpen(-0.03)]
        ),
      },
      passiveEffects: {
        belligerent: [
          cfx("tick", "metric", "society", "publicHealth", -0.03, "Pandemic toll"),
          cfx("tick", "metric", "economy", "gdpGrowth", -0.012, "Economic seizure"),
        ],
        neighbor: [cfx("tick", "metric", "society", "publicHealth", -0.02, "Full outbreak")],
        bloc: [cfx("tick", "metric", "economy", "gdpGrowth", -0.006, "Trade disruption")],
        bystander: [cfx("tick", "metric", "society", "publicHealth", -0.008, "Late arrival")],
      },
      events: [
        {
          key: "variant",
          kind: "procedural",
          severity: "critical",
          affects: "all",
          trigger: { everyTurns: 6, minIntensity: 50 },
          headline: "A more transmissible variant emerges",
          body: "Sequencing confirms a variant that spreads faster and dodges some immunity.",
          effects: {
            belligerent: [cfx("flat", "metric", "society", "publicHealth", -0.03, "Variant wave")],
            neighbor: [cfx("flat", "metric", "society", "publicHealth", -0.02, "Variant wave")],
          },
        },
      ],
    },
    {
      level: 4,
      key: "containment",
      label: "Containment",
      summary: "Vaccines and immunity are turning the curve. The worst is passing.",
      minDwellTurns: 4,
      advancePressure: 40,
      naturalPressure: 12,
      defcon: 4,
      decisionTrees: {
        belligerent: choiceNode(
          "containment_afflicted",
          "Turning the corner",
          "Cases are falling. The question is how fast to reopen.",
          [
            opt("reopen", "Reopen carefully", "Lift restrictions in stages.", [
              cfx("flat", "metric", "economy", "gdpGrowth", 0.02, "Recovery begins"),
            ]),
            opt("hold", "Hold the line", "Keep measures until it is truly over.", [
              cfx("tick", "metric", "society", "publicHealth", 0.02, "Fewer relapses"),
            ]),
          ]
        ),
      },
      passiveEffects: {
        belligerent: [cfx("tick", "metric", "economy", "gdpGrowth", 0.008, "Rebound")],
      },
      events: [
        {
          key: "vaccine_rollout",
          kind: "authored",
          severity: "major",
          affects: "all",
          trigger: { onPhaseEnter: true },
          headline: "Mass vaccination turns the tide",
          body: "Immunisation reaches critical mass and case counts fall across the worst-hit regions.",
        },
      ],
    },
    {
      level: 5,
      key: "endemic",
      label: "Endemic",
      summary: "The disease is now a manageable background risk. The emergency is over.",
      minDwellTurns: 3,
      advancePressure: 999, // terminal phase; the ladder does not climb past it
      defcon: 5,
      decisionTrees: {},
      passiveEffects: {},
      events: [
        {
          key: "endemic_declared",
          kind: "authored",
          severity: "minor",
          affects: "all",
          trigger: { onPhaseEnter: true },
          headline: "Health authorities declare the pandemic over",
          body: "The pathogen is now endemic: still circulating, no longer an emergency.",
        },
      ],
    },
  ],
};
