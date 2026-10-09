import {
  liveElectorateAgeMarginals,
  applyRegisteredShareToParticipation,
  resolveCompetitiveness,
  resolveIssueSalience,
  resolveParticipation,
} from "../../src/lib/demographics/v2/rules";
import { demographicsV2CalibrationForCountry } from "../../src/lib/demographics/v2/calibration";

interface Scenario {
  name: string;
  baseline: number;
  accessFriction: number;
  contactLift: number;
  saturation: number;
  candidates: Array<{ economic: number; social: number; favorability: number }>;
}

const scenarios: Scenario[] = [
  {
    name: "Quiet safe race",
    baseline: 60,
    accessFriction: 0.1,
    contactLift: 0,
    saturation: 0,
    candidates: [
      { economic: -1, social: 0, favorability: 65 },
      { economic: 1, social: 0, favorability: 35 },
    ],
  },
  {
    name: "Close high-contrast race",
    baseline: 60,
    accessFriction: 0.1,
    contactLift: 4,
    saturation: 0.5,
    candidates: [
      { economic: -4, social: -4, favorability: 52 },
      { economic: 4, social: 4, favorability: 50 },
    ],
  },
  {
    name: "Close low-contrast race",
    baseline: 60,
    accessFriction: 0.25,
    contactLift: 2,
    saturation: 0.25,
    candidates: [
      { economic: -1, social: -1, favorability: 51 },
      { economic: 1, social: 1, favorability: 50 },
    ],
  },
];

console.log("# Demographics v2 Method 4 deterministic sensitivity\n");
console.log(
  "| Scenario | Pack | v1 turnout | v2 turnout | Delta | Contact | Fatigue | Econ weight | Social weight |"
);
console.log("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const scenario of scenarios) {
  const calibration = demographicsV2CalibrationForCountry("US");
  const salience = resolveIssueSalience(scenario.candidates, calibration);
  const competitiveness = resolveCompetitiveness(
    scenario.candidates.map((candidate) => candidate.favorability),
    calibration
  );
  const v1Turnout = scenario.baseline * (1 - scenario.accessFriction);
  const ledger = applyRegisteredShareToParticipation(
    resolveParticipation(
      {
        baselineTurnout: scenario.baseline,
        salience: salience.overall,
        competitiveness,
        accessFriction: 0,
        contactLift: scenario.contactLift,
        saturation: scenario.saturation,
      },
      calibration
    ),
    1 - scenario.accessFriction
  );
  console.log(
    `| ${scenario.name} | ${calibration.id} | ${v1Turnout.toFixed(1)}% | ${ledger.resolvedTurnout.toFixed(1)}% | ${(ledger.resolvedTurnout - v1Turnout).toFixed(1)} pp | ${ledger.contact.toFixed(1)} pp | ${ledger.saturation.toFixed(1)} pp | ${salience.economic.toFixed(3)} | ${salience.social.toFixed(3)} |`
  );
}

const male = Array<number>(101).fill(0);
const female = Array<number>(101).fill(0);
for (const [age, population] of [
  [20, 20],
  [35, 25],
  [50, 25],
  [70, 30],
] as const) {
  male[age] = population / 2;
  female[age] = population / 2;
}
const age = liveElectorateAgeMarginals({ male, female });
console.log("\nLive-vector age shares:", JSON.stringify(age));
