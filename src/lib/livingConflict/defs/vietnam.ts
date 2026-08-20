import type { LivingConflictDef, ConflictPhase, RoleDecisionTrees } from "../types";
import { defaultRoleResolver } from "../roles";
import { cfx } from "../effects";
import { choiceNode, opt } from "../authoring";

/**
 * Vietnam re-expressed as a living-conflict definition: the same six rungs the
 * bespoke escalation ladder carries (advisors → materiel → naval incident → air
 * campaign → ground → full war), with the same earliestYear floors shipped in
 * 1.2.43, but now as data the generic engine drives.
 *
 * This is the migration target for the Vietnam ladder, not yet its replacement:
 * the live game still runs `vietnamEscalation.ts`. It exists so the engine has a
 * real proxy-war alongside the pandemic pilot, and so the ladder's semantics are
 * captured as a def ready to switch over behind the feature flag.
 *
 * The two superpowers are the backers: US = backer_a (South), RU = backer_b
 * (North). Their decision each phase is the ladder's move — support or pull back.
 */

const backerTrees = (phaseKey: string, supportPctSwing: number): RoleDecisionTrees => {
  const support = () =>
    opt(
      "support",
      "Deepen the commitment",
      "Pour more men, materiel and money into your client. Pushes the war up a rung.",
      [
        cfx("flat", "metric", "economy", "gdpGrowth", supportPctSwing, "War commitment outlay"),
        cfx("tick", "approval", "government", "overall", -0.015, "A war with no end in sight"),
      ]
    );
  const deescalate = opt(
    "deescalate",
    "Pull back",
    "Signal restraint and draw down. Drains your own commitment before the war winds down.",
    [cfx("tick", "approval", "government", "overall", -0.02, "Hawks cry betrayal")]
  );
  return {
    backer_a: choiceNode(
      `${phaseKey}_west`,
      "Washington weighs its commitment",
      "The President must decide how deep the United States goes.",
      [support(), deescalate]
    ),
    backer_b: choiceNode(
      `${phaseKey}_east`,
      "The Politburo weighs its commitment",
      "The General Secretary must decide how far to back the North.",
      [support(), deescalate]
    ),
  };
};

const phase = (
  level: number,
  key: string,
  label: string,
  summary: string,
  earliestYear: number,
  defcon: number,
  procurementDrag: number,
  headline: string,
  body: string
): ConflictPhase => ({
  level,
  key,
  label,
  summary,
  earliestYear: level === 1 ? undefined : earliestYear,
  advancePressure: 24,
  defcon,
  decisionTrees: backerTrees(key, -0.002 * level),
  passiveEffects: {
    backer_a: [cfx("tick", "metric", "economy", "gdpGrowth", procurementDrag, "War economy drag")],
    backer_b: [cfx("tick", "metric", "economy", "gdpGrowth", procurementDrag, "War economy drag")],
  },
  events: [
    {
      key: `${key}_beat`,
      kind: "authored",
      severity: level >= 4 ? "critical" : "major",
      affects: "all",
      trigger: { onPhaseEnter: true },
      headline,
      body,
    },
  ],
});

export const VIETNAM_DEF: LivingConflictDef = {
  key: "vietnam",
  type: "proxy_war",
  name: "Vietnam War",
  fromYear: 1955,
  untilYear: 1975,
  hostCountry: "SVN",
  roleResolver: defaultRoleResolver,
  phases: [
    phase(
      1,
      "advisors",
      "Military advisors",
      "A few hundred officers and training missions.",
      1955,
      4,
      -0.001,
      "Advisors deploy to Vietnam",
      "The first military advisors arrive to train a client army."
    ),
    phase(
      2,
      "materiel",
      "Materiel and money",
      "Rifles, trucks, aircraft and hard currency.",
      1959,
      4,
      -0.002,
      "Arms shipments to Vietnam step up",
      "Materiel and money now flow to Vietnam in quantity."
    ),
    phase(
      3,
      "tonkin_incident",
      "Naval incident",
      "Shots reported in the gulf; the legal footing shifts.",
      1964,
      3,
      -0.004,
      "Naval incident in the gulf",
      "A reported clash at sea hands the executive a free hand."
    ),
    phase(
      4,
      "air_campaign",
      "Air campaign",
      "Sustained bombing, measured in sorties and lost pilots.",
      1965,
      3,
      -0.006,
      "Sustained bombing campaign opens",
      "A continuous air campaign begins over the North."
    ),
    phase(
      5,
      "ground_commitment",
      "Ground commitment",
      "Combat divisions ashore; the draft bites at home.",
      1966,
      2,
      -0.011,
      "Ground troops committed",
      "Combat divisions land. The draft stops being an abstraction."
    ),
    phase(
      6,
      "full_war",
      "Full war",
      "A land war in Asia with no ceiling and no exit date.",
      1968,
      2,
      -0.018,
      "The war has no exit",
      "A full land war grinds on with a body count on the evening news."
    ),
  ],
};
