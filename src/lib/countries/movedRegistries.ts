import { CABINET_IDENTITY } from "@/lib/constants/cabinetIdentity";
import { NATIONAL_ADDRESS_NAME } from "@/lib/constants/countries";
import { ECONOMY_TEXT } from "@/lib/constants/economyIdentity";
import { EXECUTIVE_SEALS } from "@/lib/constants/executiveSeals";
import { EXECUTIVE_SURFACE } from "@/lib/constants/executiveSurface";
import { EXECUTIVE_TEXT, POLICY_TEXT } from "@/lib/constants/institutionIdentity";
import { NATIONAL_IDENTITY } from "@/lib/constants/nationalIdentity";
import { NATIONAL_STATS_IDENTITY } from "@/lib/constants/nationalStatsIdentity";
import { SURFACES } from "@/lib/constants/parliamentaryExecutiveSurface";
import { REGION_CENSUS_LABELS } from "@/lib/constants/regionCensusLabels";
import { TREASURY_TEXT } from "@/lib/constants/treasuryIdentity";
import { COUNTRY_HISTORICAL_NAMES, COUNTRY_MODERN_NAMES } from "@/lib/banking/npcBanks";
import { STATE_DISPLAY_NAMES } from "@/lib/commodity-map/commodityRegionMappings";

/**
 * The faithful-replacement table. Each entry names one registry that now
 * FORWARDS to Japan's folder, and reads what it hands back.
 *
 * ⚠️ `after` reads the LIVE registry on purpose, and `before` is deliberately
 * NOT here. The pre-move value lives only in the committed snapshot fixture, and
 * the test supplies it. If `before` read the live registry too, the comparison
 * would be the new thing against itself: that tautology is not hypothetical, it
 * happened in Plan C task C0 when rewiring `getPresetSeats` made its
 * faithful-replacement test vacuous until it was rebuilt from raw source arrays.
 *
 * `name` is the fixture key, so a typo fails rather than silently skipping.
 *
 * ⚠️ No filesystem access in this module. Reading the fixture belongs to the
 * test, not to src code that ships.
 */
export interface MovedRegistry {
  /** Key in `__snapshots__/jp.pre-move.json`. */
  readonly name: string;
  /** What the forwarding registry hands back for Japan, today. */
  readonly after: () => unknown;
}

/**
 * Registries whose values are FUNCTIONS.
 *
 * ⚠️ `toEqual` compares functions by REFERENCE, so the ordinary harness is
 * silent on these. Capture the reference pre-move and a re-export passes
 * tautologically; re-declare the thunk and it fails despite identical
 * behaviour. Either way the plan's only proof is blind.
 *
 * Measured, there are THREE, not the two the plan names: SPAWN_ELECTIONS_REGISTRY,
 * REGION_ROSTERS, and COUNTRY_BILL_PHASES.
 *
 * ⚠️ REGION_ROSTERS is NESTED, not flat, so paths walk country then era.
 *
 * Assert BEHAVIOUR, not identity: call the thunk, compare its resolved value,
 * and pin the key set so a silently dropped era fails.
 */
export interface MovedThunkRegistry {
  readonly name: string;
  /** Every path to a thunk, e.g. ["JP", "1991"]. */
  readonly paths: () => readonly (readonly string[])[];
  /** Resolved output keyed by joined path, captured before the move. */
  readonly resolved: () => Promise<Record<string, unknown>>;
}

/**
 * D2 moved 15 registries. The plan's D2 list names 16, but TREASURY_IDENTITY is
 * DERIVED -- treasuryIdentity.ts composes it from TREASURY_TEXT plus the national
 * palette -- so only the authored text moves and the derived registry recomposes
 * itself. Forwarding both would create a second source of the same values.
 */
export const MOVED_REGISTRIES: readonly MovedRegistry[] = [
  { name: "CABINET_IDENTITY", after: () => CABINET_IDENTITY.JP },
  { name: "NATIONAL_IDENTITY", after: () => NATIONAL_IDENTITY.JP },
  { name: "NATIONAL_STATS_IDENTITY", after: () => NATIONAL_STATS_IDENTITY.JP },
  { name: "TREASURY_TEXT", after: () => TREASURY_TEXT.JP },
  { name: "ECONOMY_TEXT", after: () => ECONOMY_TEXT.JP },
  { name: "EXECUTIVE_TEXT", after: () => EXECUTIVE_TEXT.JP },
  { name: "POLICY_TEXT", after: () => POLICY_TEXT.JP },
  { name: "EXECUTIVE_SEALS", after: () => EXECUTIVE_SEALS.JP },
  { name: "EXECUTIVE_SURFACE", after: () => EXECUTIVE_SURFACE.JP },
  { name: "SURFACES", after: () => SURFACES.JP },
  { name: "REGION_CENSUS_LABELS", after: () => REGION_CENSUS_LABELS.JP },
  { name: "NATIONAL_ADDRESS_NAME", after: () => NATIONAL_ADDRESS_NAME.JP },
  { name: "STATE_DISPLAY_NAMES", after: () => STATE_DISPLAY_NAMES.JP },
  { name: "COUNTRY_HISTORICAL_NAMES", after: () => COUNTRY_HISTORICAL_NAMES.JP },
  { name: "COUNTRY_MODERN_NAMES", after: () => COUNTRY_MODERN_NAMES.JP },
];

/** Populated by D3 and D5, which own the function-valued registries. */
export const MOVED_THUNK_REGISTRIES: readonly MovedThunkRegistry[] = [];
