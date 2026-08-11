/**
 * Historical transitions — conditional independence / UN lifecycle.
 *
 * Deep module: callers evaluate / apply / diagnose through this surface.
 * The Gold Coast → Ghana tracer (#3726) and the approved decolonization
 * roster (#3727) share one deterministic pressure-driven engine.
 */
export {
  GOLD_COAST_ENTITY_ID,
  GHANA_ENTITY_ID,
  GOLD_COAST_TO_GHANA_RULE_ID,
  GOLD_COAST_TO_GHANA_RULE,
  SOMALIA_TRUST_ENTITY_ID,
  SOMALIA_ENTITY_ID,
  SOMALIA_TRUST_TO_SOMALIA_RULE_ID,
  SOMALIA_TRUST_TO_SOMALIA_RULE,
  BELGIAN_CONGO_ENTITY_ID,
  CONGO_ENTITY_ID,
  BELGIAN_CONGO_TO_CONGO_RULE_ID,
  BELGIAN_CONGO_TO_CONGO_RULE,
  FRENCH_ALGERIA_ENTITY_ID,
  ALGERIA_ENTITY_ID,
  FRENCH_ALGERIA_TO_ALGERIA_RULE_ID,
  FRENCH_ALGERIA_TO_ALGERIA_RULE,
  BRITISH_GUIANA_ENTITY_ID,
  GUYANA_ENTITY_ID,
  BRITISH_GUIANA_TO_GUYANA_RULE_ID,
  BRITISH_GUIANA_TO_GUYANA_RULE,
  ADEN_PROTECTORATE_ENTITY_ID,
  SOUTH_YEMEN_ENTITY_ID,
  ADEN_TO_SOUTH_YEMEN_RULE_ID,
  ADEN_TO_SOUTH_YEMEN_RULE,
  PORTUGUESE_ANGOLA_ENTITY_ID,
  ANGOLA_ENTITY_ID,
  PORTUGUESE_ANGOLA_TO_ANGOLA_RULE_ID,
  PORTUGUESE_ANGOLA_TO_ANGOLA_RULE,
  PORTUGUESE_MOZAMBIQUE_ENTITY_ID,
  MOZAMBIQUE_ENTITY_ID,
  PORTUGUESE_MOZAMBIQUE_TO_MOZAMBIQUE_RULE_ID,
  PORTUGUESE_MOZAMBIQUE_TO_MOZAMBIQUE_RULE,
  DEFAULT_TRANSITION_PRESSURES,
  DECOLONIZATION_ROSTER_RULE_IDS,
  getTransitionRule,
  listTransitionRules,
} from "./rules";
export {
  evaluateTransition,
  evaluateTransitionWithDefaults,
  evaluateGoldCoastTransition,
  historicalPrior,
  pressureDelta,
} from "./evaluate";
export {
  applySovereigntyTransition,
  runTransition,
  runGoldCoastTransition,
  buildSovereignEntity,
  buildSovereignGhanaEntity,
  getSovereignSphereMembership,
  getGhanaSphereMembership,
} from "./apply";
export { buildGhanaMacroSeed, getGhanaMacroCountry } from "./ghana";
export { getTransitionMacroCountry, hasTransitionMacroSeed } from "./rosterMacros";
export { getTransitionDiagnostics, getGoldCoastTransitionDiagnostics } from "./diagnostics";
export type {
  HistoricalWindow,
  SovereigntyApplication,
  SovereigntyOutcome,
  TransitionDiagnostics,
  TransitionEvaluation,
  TransitionEvaluationInput,
  TransitionPressures,
  TransitionRule,
  UnLifecycleSnapshot,
  UnLifecycleState,
} from "./types";
