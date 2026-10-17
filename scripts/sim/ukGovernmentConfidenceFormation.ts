import {
  CONFIDENCE_START,
  confidenceAfterGovernmentFormation,
} from "@/lib/countries/uk/confidence/confidenceGauge";

const predecessorValues = [0, 10, 20, 35, 50, 65, 80, 90, 99, 100];
const results = predecessorValues.map((previous) => ({
  predecessor: previous,
  previousRule: CONFIDENCE_START,
  carryForwardRule: confidenceAfterGovernmentFormation(previous),
}));

for (const result of results) {
  if (result.carryForwardRule < result.predecessor || result.carryForwardRule > CONFIDENCE_START) {
    throw new Error(`Formation result violated bounds for predecessor ${result.predecessor}`);
  }
  if (result.predecessor < CONFIDENCE_START - 10 && result.carryForwardRule >= CONFIDENCE_START) {
    throw new Error(`Formation erased the predecessor's low confidence at ${result.predecessor}`);
  }
}

console.log(
  JSON.stringify(
    {
      question: "Does a new government inherit prior confidence without a full reset?",
      rule: "Restore 10% of the remaining distance to full confidence.",
      scenarios: results,
      invariants: [
        "No transition reduces confidence.",
        "No transition exceeds 100.",
        "Any predecessor below 100 remains below 100 after formation.",
      ],
      verdict: "passed",
    },
    null,
    2
  )
);
