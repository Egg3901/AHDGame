/**
 * 1953 Tier-3 / world-coverage registry (#3728).
 *
 * Deep module: callers get a complete historical-presence entry list plus
 * coverage diagnostics. Region files are implementation detail.
 *
 * `assemble.ts` is imported by the manifest (no diagnostics cycle);
 * this barrel re-exports the full public surface for tests and admin tools.
 */
export { build1953Tier3Registry } from "./assemble";
export { EXPECTED_1953_ENTITIES_BY_REGION, ALL_EXPECTED_1953_ENTITY_IDS } from "./checklist1953";
export {
  getWorldCoverageDiagnostics,
  assert1953CoverageComplete,
  listExpectedEntitiesForRegion,
  type WorldCoverageDiagnostics,
} from "./coverageDiagnostics";
export { FORBIDDEN_1953_DISPLAY_NAMES, FORBIDDEN_NAME_ALLOWLIST_IDS } from "./modernNameBanlist";
