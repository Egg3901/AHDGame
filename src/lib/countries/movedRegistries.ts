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
import { COUNTRY_BILL_PHASES, COUNTRY_ELECTION_PHASES } from "@/lib/turn/countryPhases";
import {
  COUNTRY_CONFIGS,
  ERA_COUNTRY_CONFIG_OVERRIDES,
  REGIONAL_BILL_ASSENT_OFFICE_KEY,
} from "@/lib/constants/countries";
import { ENERGY_POSITION_BY_COUNTRY } from "@/lib/constants/cabinetEnergy";
import { INFRA_POSITION_BY_COUNTRY } from "@/lib/constants/cabinetInfra";
import { ESTATE_PORTFOLIO_BY_COUNTRY } from "@/lib/constants/cabinetEstates";
import { GROUPS } from "@/lib/constants/cabinetPositionGroups";
import {
  DEFENSE_POSITION_BY_COUNTRY,
  MILITARY_BRANCHES_BY_COUNTRY,
  MILITARY_COUNTRY_SCALE,
} from "@/lib/constants/military";
import {
  FOREIGN_AFFAIRS_POSITION_BY_COUNTRY,
  TRADE_MINISTER_POSITION_BY_COUNTRY,
} from "@/lib/constants/internationalOrganizations";
import { LEGISLATIVE_PROCESS } from "@/lib/legislature/process";
import { ORDERS_OF_BATTLE, ORDERS_OF_BATTLE_BY_ERA } from "@/lib/seeds/reference/ordersOfBattle";
import { ORDERS_BY_COUNTRY } from "@/lib/constants/cabinetOrders";
import { MECHANICS_BY_COUNTRY } from "@/lib/constants/cabinetMechanics";
import { SPAWN_ELECTIONS_REGISTRY } from "@/lib/turn/perpetualElections/registry";
import { PARLIAMENTARY_CABINET_CONFIGS } from "@/app/country/[code]/executive/cabinet/parliamentaryCabinetConfig";

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
  /**
   * For an OUTER-KEYED fixture entry, the era or preset to compare.
   *
   * ⚠️ Preset-first registries hold Japan once per era, and comparing the whole
   * object at once turns a dropped era into one opaque diff. Splitting by era
   * makes a missing 2007 fail on a line that says 2007 -- which is how earlier
   * revisions lost eras without noticing.
   */
  readonly subKey?: string;
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
 * ⚠️ The D1 design took `paths()` and `resolved()`, meaning the test had to CALL
 * each thunk. Most of these reach the database, so that was untestable. Instead
 * the test walks the live value, replaces every function with a marker, and
 * compares the result to the fixture -- which verifies the surrounding DATA and
 * the function TOPOLOGY together. A function that moved, vanished or appeared at
 * a new path fails, and so does a changed sibling value.
 */
export interface MovedThunkRegistry {
  /** Key in `__snapshots__/jp.pre-move.json`. */
  readonly name: string;
  /** The live registry's Japan entry, functions and all. */
  readonly after: () => unknown;
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

  // D3 -- institutions and elections.
  { name: "COUNTRY_CONFIGS", after: () => COUNTRY_CONFIGS.JP },
  { name: "REGIONAL_BILL_ASSENT_OFFICE_KEY", after: () => REGIONAL_BILL_ASSENT_OFFICE_KEY.JP },
  { name: "ENERGY_POSITION_BY_COUNTRY", after: () => ENERGY_POSITION_BY_COUNTRY.JP },
  { name: "INFRA_POSITION_BY_COUNTRY", after: () => INFRA_POSITION_BY_COUNTRY.JP },
  { name: "DEFENSE_POSITION_BY_COUNTRY", after: () => DEFENSE_POSITION_BY_COUNTRY.JP },
  {
    name: "FOREIGN_AFFAIRS_POSITION_BY_COUNTRY",
    after: () => FOREIGN_AFFAIRS_POSITION_BY_COUNTRY.JP,
  },
  {
    name: "TRADE_MINISTER_POSITION_BY_COUNTRY",
    after: () => TRADE_MINISTER_POSITION_BY_COUNTRY.JP,
  },
  { name: "MILITARY_BRANCHES_BY_COUNTRY", after: () => MILITARY_BRANCHES_BY_COUNTRY.JP },
  { name: "MILITARY_COUNTRY_SCALE", after: () => MILITARY_COUNTRY_SCALE.JP },
  { name: "ESTATE_PORTFOLIO_BY_COUNTRY", after: () => ESTATE_PORTFOLIO_BY_COUNTRY.JP },
  { name: "GROUPS", after: () => GROUPS.JP },
  { name: "LEGISLATIVE_PROCESS", after: () => LEGISLATIVE_PROCESS.JP },
  { name: "ORDERS_OF_BATTLE", after: () => ORDERS_OF_BATTLE.JP },

  /**
   * Not forwarded by an edit: their SOURCE FILES were relocated into the folder,
   * so these registries already read from it. Pinned anyway, because "it should
   * still work" is the assumption this harness exists to replace.
   */
  { name: "ORDERS_BY_COUNTRY", after: () => ORDERS_BY_COUNTRY.JP },
  { name: "MECHANICS_BY_COUNTRY", after: () => MECHANICS_BY_COUNTRY.JP },

  /**
   * ⚠️ Preset-first, and Japan holds entries in SIX eras here and TWO there.
   * Flattened so a single dropped era fails on its own line.
   */
  ...(["1979", "1991", "1999", "2007", "2019", "2023"] as const).map((year) => ({
    name: "ORDERS_OF_BATTLE_BY_ERA",
    subKey: year,
    after: () => ORDERS_OF_BATTLE_BY_ERA[year]?.JP,
  })),
  ...(["1953-default", "1991-default"] as const).map((preset) => ({
    name: "ERA_COUNTRY_CONFIG_OVERRIDES",
    subKey: preset,
    after: () => ERA_COUNTRY_CONFIG_OVERRIDES[preset]?.JP,
  })),
];

/**
 * The function-valued registries. The plan names TWO; there are FIVE.
 * REGION_ROSTERS belongs to D5 and is added there.
 */
export const MOVED_THUNK_REGISTRIES: readonly MovedThunkRegistry[] = [
  { name: "SPAWN_ELECTIONS_REGISTRY", after: () => SPAWN_ELECTIONS_REGISTRY.JP },
  { name: "COUNTRY_BILL_PHASES", after: () => COUNTRY_BILL_PHASES.JP },
  { name: "COUNTRY_ELECTION_PHASES", after: () => COUNTRY_ELECTION_PHASES.JP },
  { name: "PARLIAMENTARY_CABINET_CONFIGS", after: () => PARLIAMENTARY_CABINET_CONFIGS.JP },
];
