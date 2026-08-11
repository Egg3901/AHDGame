import type { TransitionPressures, TransitionRule } from "./types";

export const GOLD_COAST_ENTITY_ID = "GC";
export const GHANA_ENTITY_ID = "GH";
export const GOLD_COAST_TO_GHANA_RULE_ID = "gold-coast-to-ghana";

export const SOMALIA_TRUST_ENTITY_ID = "ST";
export const SOMALIA_ENTITY_ID = "SO";
export const SOMALIA_TRUST_TO_SOMALIA_RULE_ID = "somalia-trust-to-somalia";

export const BELGIAN_CONGO_ENTITY_ID = "BC";
export const CONGO_ENTITY_ID = "CD";
export const BELGIAN_CONGO_TO_CONGO_RULE_ID = "belgian-congo-to-congo";

export const FRENCH_ALGERIA_ENTITY_ID = "FA";
export const ALGERIA_ENTITY_ID = "DZ";
export const FRENCH_ALGERIA_TO_ALGERIA_RULE_ID = "french-algeria-to-algeria";

export const BRITISH_GUIANA_ENTITY_ID = "BRG";
export const GUYANA_ENTITY_ID = "GY";
export const BRITISH_GUIANA_TO_GUYANA_RULE_ID = "british-guiana-to-guyana";

/** ADN — not AD (Andorra occupies that code in the Tier-3 Europe registry). */
export const ADEN_PROTECTORATE_ENTITY_ID = "ADN";
export const SOUTH_YEMEN_ENTITY_ID = "YD";
export const ADEN_TO_SOUTH_YEMEN_RULE_ID = "aden-to-south-yemen";

/** POA — not ISO PA (Panama occupies that code in the Tier-2 Americas roster). */
export const PORTUGUESE_ANGOLA_ENTITY_ID = "POA";
export const ANGOLA_ENTITY_ID = "AO";
export const PORTUGUESE_ANGOLA_TO_ANGOLA_RULE_ID = "portuguese-angola-to-angola";

export const PORTUGUESE_MOZAMBIQUE_ENTITY_ID = "PM";
export const MOZAMBIQUE_ENTITY_ID = "MZ";
export const PORTUGUESE_MOZAMBIQUE_TO_MOZAMBIQUE_RULE_ID = "portuguese-mozambique-to-mozambique";

/**
 * Gold Coast → Ghana sovereignty rule (#3726 tracer).
 *
 * Historical defaults (not rails): independence 6 Mar 1957; UN admission 8 Mar 1957.
 * Earliest plausible self-government acceleration ~1954 (CPP electoral mandate);
 * latest resolution window ends 1962 before alternate colonial consolidations dominate.
 */
export const GOLD_COAST_TO_GHANA_RULE: TransitionRule = Object.freeze({
  ruleId: GOLD_COAST_TO_GHANA_RULE_ID,
  presetId: "1953-default",
  sourceEntityId: GOLD_COAST_ENTITY_ID,
  targetEntityId: GHANA_ENTITY_ID,
  displayName: "Gold Coast independence → Ghana",
  window: Object.freeze({
    earliestYear: 1954,
    expectedYear: 1957,
    latestYear: 1962,
  }),
  unAdmissionExpectedYear: 1957,
  targetSimulationTier: "sphere-macro",
});

/**
 * Italian Trust Territory of Somaliland + British Somaliland → Somalia (#3727).
 * Independence / union 1 Jul 1960; UN admission 20 Sep 1960.
 */
export const SOMALIA_TRUST_TO_SOMALIA_RULE: TransitionRule = Object.freeze({
  ruleId: SOMALIA_TRUST_TO_SOMALIA_RULE_ID,
  presetId: "1953-default",
  sourceEntityId: SOMALIA_TRUST_ENTITY_ID,
  targetEntityId: SOMALIA_ENTITY_ID,
  displayName: "Somalia Trust Territories independence → Somalia",
  window: Object.freeze({
    earliestYear: 1958,
    expectedYear: 1960,
    latestYear: 1965,
  }),
  unAdmissionExpectedYear: 1960,
  targetSimulationTier: "sphere-macro",
});

/** Belgian Congo → Congo (Léopoldville / later Zaire). Independence 30 Jun 1960. */
export const BELGIAN_CONGO_TO_CONGO_RULE: TransitionRule = Object.freeze({
  ruleId: BELGIAN_CONGO_TO_CONGO_RULE_ID,
  presetId: "1953-default",
  sourceEntityId: BELGIAN_CONGO_ENTITY_ID,
  targetEntityId: CONGO_ENTITY_ID,
  displayName: "Belgian Congo independence → Congo",
  window: Object.freeze({
    earliestYear: 1958,
    expectedYear: 1960,
    latestYear: 1965,
  }),
  unAdmissionExpectedYear: 1960,
  targetSimulationTier: "sphere-macro",
});

/** French Algeria → Algeria. Évian Accords / independence 5 Jul 1962. */
export const FRENCH_ALGERIA_TO_ALGERIA_RULE: TransitionRule = Object.freeze({
  ruleId: FRENCH_ALGERIA_TO_ALGERIA_RULE_ID,
  presetId: "1953-default",
  sourceEntityId: FRENCH_ALGERIA_ENTITY_ID,
  targetEntityId: ALGERIA_ENTITY_ID,
  displayName: "French Algeria independence → Algeria",
  window: Object.freeze({
    earliestYear: 1959,
    expectedYear: 1962,
    latestYear: 1967,
  }),
  unAdmissionExpectedYear: 1962,
  targetSimulationTier: "sphere-macro",
});

/** British Guiana → Guyana. Independence 26 May 1966. */
export const BRITISH_GUIANA_TO_GUYANA_RULE: TransitionRule = Object.freeze({
  ruleId: BRITISH_GUIANA_TO_GUYANA_RULE_ID,
  presetId: "1953-default",
  sourceEntityId: BRITISH_GUIANA_ENTITY_ID,
  targetEntityId: GUYANA_ENTITY_ID,
  displayName: "British Guiana independence → Guyana",
  window: Object.freeze({
    earliestYear: 1961,
    expectedYear: 1966,
    latestYear: 1971,
  }),
  unAdmissionExpectedYear: 1966,
  targetSimulationTier: "sphere-macro",
});

/** Aden Protectorate / South Arabia → South Yemen (PDRY). Independence 30 Nov 1967. */
export const ADEN_TO_SOUTH_YEMEN_RULE: TransitionRule = Object.freeze({
  ruleId: ADEN_TO_SOUTH_YEMEN_RULE_ID,
  presetId: "1953-default",
  sourceEntityId: ADEN_PROTECTORATE_ENTITY_ID,
  targetEntityId: SOUTH_YEMEN_ENTITY_ID,
  displayName: "Aden Protectorate independence → South Yemen",
  window: Object.freeze({
    earliestYear: 1963,
    expectedYear: 1967,
    latestYear: 1972,
  }),
  unAdmissionExpectedYear: 1967,
  targetSimulationTier: "sphere-macro",
});

/** Portuguese Angola → Angola. Independence 11 Nov 1975; UN admission 1976. */
export const PORTUGUESE_ANGOLA_TO_ANGOLA_RULE: TransitionRule = Object.freeze({
  ruleId: PORTUGUESE_ANGOLA_TO_ANGOLA_RULE_ID,
  presetId: "1953-default",
  sourceEntityId: PORTUGUESE_ANGOLA_ENTITY_ID,
  targetEntityId: ANGOLA_ENTITY_ID,
  displayName: "Portuguese Angola independence → Angola",
  window: Object.freeze({
    earliestYear: 1970,
    expectedYear: 1975,
    latestYear: 1980,
  }),
  unAdmissionExpectedYear: 1976,
  targetSimulationTier: "sphere-macro",
});

/** Portuguese Mozambique → Mozambique. Independence 25 Jun 1975. */
export const PORTUGUESE_MOZAMBIQUE_TO_MOZAMBIQUE_RULE: TransitionRule = Object.freeze({
  ruleId: PORTUGUESE_MOZAMBIQUE_TO_MOZAMBIQUE_RULE_ID,
  presetId: "1953-default",
  sourceEntityId: PORTUGUESE_MOZAMBIQUE_ENTITY_ID,
  targetEntityId: MOZAMBIQUE_ENTITY_ID,
  displayName: "Portuguese Mozambique independence → Mozambique",
  window: Object.freeze({
    earliestYear: 1970,
    expectedYear: 1975,
    latestYear: 1980,
  }),
  unAdmissionExpectedYear: 1975,
  targetSimulationTier: "sphere-macro",
});

/** Neutral baseline: rising legitimacy, mild unrest, parent still capable. */
export const DEFAULT_TRANSITION_PRESSURES: Readonly<TransitionPressures> = Object.freeze({
  legitimacy: 0.55,
  unrest: 0.35,
  conflict: 0.05,
  parentCapacity: 0.55,
  spherePressure: 0.45,
});

const RULES: Readonly<Record<string, TransitionRule>> = Object.freeze({
  [GOLD_COAST_TO_GHANA_RULE_ID]: GOLD_COAST_TO_GHANA_RULE,
  [SOMALIA_TRUST_TO_SOMALIA_RULE_ID]: SOMALIA_TRUST_TO_SOMALIA_RULE,
  [BELGIAN_CONGO_TO_CONGO_RULE_ID]: BELGIAN_CONGO_TO_CONGO_RULE,
  [FRENCH_ALGERIA_TO_ALGERIA_RULE_ID]: FRENCH_ALGERIA_TO_ALGERIA_RULE,
  [BRITISH_GUIANA_TO_GUYANA_RULE_ID]: BRITISH_GUIANA_TO_GUYANA_RULE,
  [ADEN_TO_SOUTH_YEMEN_RULE_ID]: ADEN_TO_SOUTH_YEMEN_RULE,
  [PORTUGUESE_ANGOLA_TO_ANGOLA_RULE_ID]: PORTUGUESE_ANGOLA_TO_ANGOLA_RULE,
  [PORTUGUESE_MOZAMBIQUE_TO_MOZAMBIQUE_RULE_ID]: PORTUGUESE_MOZAMBIQUE_TO_MOZAMBIQUE_RULE,
});

/** Approved decolonization roster rule ids (#3727), excluding the #3726 Ghana tracer. */
export const DECOLONIZATION_ROSTER_RULE_IDS = Object.freeze([
  SOMALIA_TRUST_TO_SOMALIA_RULE_ID,
  BELGIAN_CONGO_TO_CONGO_RULE_ID,
  FRENCH_ALGERIA_TO_ALGERIA_RULE_ID,
  BRITISH_GUIANA_TO_GUYANA_RULE_ID,
  ADEN_TO_SOUTH_YEMEN_RULE_ID,
  PORTUGUESE_ANGOLA_TO_ANGOLA_RULE_ID,
  PORTUGUESE_MOZAMBIQUE_TO_MOZAMBIQUE_RULE_ID,
] as const);

export function getTransitionRule(ruleId: string): TransitionRule {
  const rule = RULES[ruleId];
  if (!rule) {
    throw new Error(`Unknown historical transition rule ${ruleId}; refusing fallback.`);
  }
  return rule;
}

export function listTransitionRules(presetId?: string): readonly TransitionRule[] {
  const rules = Object.values(RULES);
  return presetId ? rules.filter((rule) => rule.presetId === presetId) : rules;
}
