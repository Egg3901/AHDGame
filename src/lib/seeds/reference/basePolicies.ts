/**
 * Base policy records for nation and each state.
 * National: realistic defaults per legislation type calibrated to Jan 2020 real-world policy.
 * State: derived from state politicalLean (-4 to +5) mapped to economic/social -3..3.
 * Used by scripts/seed-policies.ts and seedStatePolicies.
 *
 * Adding a new country: add an entry to COUNTRY_POLICY_CONFIGS with defaults, optionIndexes,
 * nationalStateId, and regions. The buildBasePolicies() loop handles the rest.
 */

import type { State } from "@/lib/db/types";
import { legislationTypes } from "./legislationTypes";
import { isLegislationTypeActive } from "@/lib/era/legislationCatalog";
import { ruRegions } from "@/lib/seeds/ru/ruRegions";
import { ddRegions } from "@/lib/seeds/dd/ddRegions";
import { huRegions } from "@/lib/seeds/hu/huRegions";
import { plRegions } from "@/lib/seeds/pl/plRegions";
import { roRegions } from "@/lib/seeds/ro/roRegions";
import { yuRegions } from "@/lib/seeds/yu/yuRegions";
import { bgRegions } from "@/lib/seeds/bg/bgRegions";
import { uaRegions } from "@/lib/seeds/ua/uaRegions";
import { blrRegions } from "@/lib/seeds/blr/blrRegions";
import { csRegions } from "@/lib/seeds/cs/csRegions";
import { balRegions } from "@/lib/seeds/bal/balRegions";
import { easternBlocPolicyConfig } from "@/lib/seeds/shared/easternBlocLegislation";
import { COUNTRY_POLICY_CONFIGS_2019 } from "./basePolicies2019";
import { getStateLean } from "@/lib/utils/demographics";

export type BasePolicyRecord = {
  scope: "national" | "state";
  stateId?: string;
  legislationTypeId: string;
  economic: number;
  social: number;
  /** Default policy option ID (center option) for national policies */
  policyOptionId?: string;
  /** Default policy option index (center = 3) for national policies */
  policyOptionIndex?: number;
  /**
   * Direction of effect from the seeded option, derived from the option's stance
   * (-1 left, 0 center, +1 right). Required by the runtime weighted-target engine
   * (policyEffects.ts) — without it, `policy.effectDirection * 3` evaluates to
   * NaN and contaminates metric targets.
   */
  effectDirection: number;
  updatedAt: Date;
};

// ═════════════════════════════════════════════════════════════════════════════
//  Country Policy Configuration
// ═════════════════════════════════════════════════════════════════════════════

export interface CountryPolicyConfig {
  /** stateId used for national-scope policy records (e.g. "federal", "uk_national") */
  nationalStateId: string;
  /** eco/soc defaults for non-tax national legislation types */
  defaults: Record<string, { economic: number; social: number }>;
  /** override option indexes for tax types and specific policies */
  optionIndexes: Record<string, number>;
  /** state/region data source for sub-national records */
  regions: State[];
}

/**
 * Per-country policy configuration, legacy union.
 *
 * The sixteen modern blocks now live in `basePolicies2019.ts` and are spread in
 * here; the eleven below belong to eras that ended, and are kept because
 * `budgets.ts` reads them for the 1979 and 1991 budget seeds. Nothing is
 * duplicated: this map has exactly one source for every key.
 *
 * ⚠️ This is NOT the 2019 policy seed any more. `getBasePolicies("2019-default")`
 * builds from `COUNTRY_POLICY_CONFIGS_2019` alone, so a modern world no longer
 * picks up `su`, `dd` or the Warsaw-Pact blocks. Do not point a preset at this
 * map to "get everything" — that is the defect it used to have.
 *
 * economic/social: -3 (left/lib) to +3 (right/trad), 0 = center.
 */
export const COUNTRY_POLICY_CONFIGS: Record<string, CountryPolicyConfig> = {
  ...COUNTRY_POLICY_CONFIGS_2019,
  su: {
    nationalStateId: "su_national",
    defaults: {
      su_enterprise_levy: { economic: -3, social: 0 },
      su_individual_income_tax: { economic: 0, social: 0 },
      su_turnover_tax: { economic: 0, social: 0 },
      su_social_insurance: { economic: 0, social: 0 },
      su_customs_tariff: { economic: -3, social: 0 },
      su_economic_system: { economic: -4, social: 0 },
      su_political_system: { economic: 0, social: 3 },
      su_price_controls: { economic: -3, social: 0 },
      su_agriculture: { economic: -3, social: 0 },
      su_civil_liberties: { economic: 0, social: 3 },
      su_defense_spending: { economic: -2, social: 1 },
      su_housing: { economic: -3, social: 0 },
    },
    optionIndexes: {
      su_enterprise_levy: 4, // Enterprise Profit Remittance Statute
      su_individual_income_tax: 1, // Flat Citizens' Levy
      su_turnover_tax: 2, // Turnover Tax Schedule
      su_social_insurance: 1, // Unified Social Insurance Statute
      su_customs_tariff: 2, // Foreign Trade Monopoly Statute
      su_economic_system: 4, // Economic Organization Law (orthodox Gosplan)
      su_political_system: 3, // Article 6 Statute (one-party)
      su_price_controls: 2, // State Price Regulation Statute
      su_agriculture: 2, // Collective Agriculture Statute
      su_civil_liberties: 2, // State Information & Order Statute
      su_defense_spending: 2, // Defense and Military-Industrial Statute
      su_housing: 2, // State Housing Allocation Statute
    },
    regions: ruRegions,
  },

  // ── France (1979 Fifth Republic — market economy + large welfare state) ─────
  dd: {
    nationalStateId: "dd_national",
    defaults: {
      dd_enterprise_levy: { economic: -3, social: 0 },
      dd_income_tax: { economic: 0, social: 0 },
      dd_product_tax: { economic: 0, social: 0 },
      dd_social_insurance: { economic: 0, social: 0 },
      dd_foreign_trade: { economic: -3, social: 0 },
      dd_economic_system: { economic: -4, social: 0 },
      dd_political_system: { economic: 0, social: 3 }, // SED leading role
      dd_price_controls: { economic: -3, social: 0 },
      dd_civil_liberties: { economic: 0, social: 3 }, // Stasi security state
      dd_housing: { economic: -2, social: 0 },
    },
    optionIndexes: {
      dd_enterprise_levy: 3, // VEB Surplus Remittance Statute
      dd_income_tax: 1, // Citizens' Income Tax Statute
      dd_product_tax: 2, // Product Tax Schedule
      dd_social_insurance: 1, // Unified Social Insurance Statute
      dd_foreign_trade: 2, // Foreign Trade Monopoly Statute
      dd_economic_system: 3, // Economic Order Law (orthodox plan)
      dd_political_system: 3, // Leading Role Statute (SED monopoly)
      dd_price_controls: 2, // Price Regulation Statute
      dd_civil_liberties: 2, // State Security Statute
      dd_housing: 2, // Housing Allocation Statute
    },
    regions: ddRegions,
  },

  // ── Hungary (1979 — MSZMP "goulash communism"; shared Eastern-bloc set) ──────
  hu: {
    nationalStateId: "hu_national",
    defaults: easternBlocPolicyConfig("hu").defaults,
    optionIndexes: easternBlocPolicyConfig("hu").optionIndexes,
    regions: huRegions,
  },

  // ── Batch-A Eastern-bloc one-party states (shared planned-economy set) ───────
  pl: {
    nationalStateId: "pl_national",
    defaults: easternBlocPolicyConfig("pl").defaults,
    optionIndexes: easternBlocPolicyConfig("pl").optionIndexes,
    regions: plRegions,
  },
  ro: {
    nationalStateId: "ro_national",
    defaults: easternBlocPolicyConfig("ro").defaults,
    optionIndexes: easternBlocPolicyConfig("ro").optionIndexes,
    regions: roRegions,
  },
  yu: {
    nationalStateId: "yu_national",
    defaults: easternBlocPolicyConfig("yu").defaults,
    optionIndexes: easternBlocPolicyConfig("yu").optionIndexes,
    regions: yuRegions,
  },
  bg: {
    nationalStateId: "bg_national",
    defaults: easternBlocPolicyConfig("bg").defaults,
    optionIndexes: easternBlocPolicyConfig("bg").optionIndexes,
    regions: bgRegions,
  },
  blr: {
    nationalStateId: "blr_national",
    defaults: easternBlocPolicyConfig("blr").defaults,
    optionIndexes: easternBlocPolicyConfig("blr").optionIndexes,
    regions: blrRegions,
  },
  ukr: {
    nationalStateId: "ukr_national",
    defaults: easternBlocPolicyConfig("ukr").defaults,
    optionIndexes: easternBlocPolicyConfig("ukr").optionIndexes,
    regions: uaRegions,
  },
  cs: {
    nationalStateId: "cs_national",
    defaults: easternBlocPolicyConfig("cs").defaults,
    optionIndexes: easternBlocPolicyConfig("cs").optionIndexes,
    regions: csRegions,
  },
  bal: {
    nationalStateId: "bal_national",
    defaults: easternBlocPolicyConfig("bal").defaults,
    optionIndexes: easternBlocPolicyConfig("bal").optionIndexes,
    regions: balRegions,
  },
};

// ── Backward-compatible re-exports for budgets.ts and other consumers ────────
export const NATIONAL_DEFAULTS = COUNTRY_POLICY_CONFIGS.us.defaults;
export const UK_NATIONAL_DEFAULTS = COUNTRY_POLICY_CONFIGS.uk.defaults;
export const NATIONAL_DEFAULT_OPTION_INDEXES = COUNTRY_POLICY_CONFIGS.us.optionIndexes;
export const UK_NATIONAL_DEFAULT_OPTION_INDEXES = COUNTRY_POLICY_CONFIGS.uk.optionIndexes;

// ═════════════════════════════════════════════════════════════════════════════
//  State-level policy derivation
// ═════════════════════════════════════════════════════════════════════════════

function clampScore(n: number): number {
  return Math.max(-3, Math.min(3, Math.round(n)));
}

/** State base: from politicalLean (-4..+5). Types with strong social dimension use social axis; else economic. */
function stateDefault(
  legislationTypeId: string,
  politicalLean: number
): { economic: number; social: number } {
  const score = clampScore(politicalLean * 0.6);
  if (
    legislationTypeId === "us_law_enforcement_criminal_justice" ||
    legislationTypeId === "us_reproductive_rights" ||
    legislationTypeId === "us_gun_control"
  ) {
    return { economic: 0, social: score };
  }
  if (
    legislationTypeId === "us_school_standards" ||
    legislationTypeId === "us_housing" ||
    legislationTypeId === "us_state_housing"
  ) {
    return { economic: score, social: score };
  }
  return { economic: score, social: 0 };
}

// ═════════════════════════════════════════════════════════════════════════════
//  Build base policy records for all countries
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Build the full `BasePolicyRecord[]` set from a country-config map.
 *
 * Originally read `COUNTRY_POLICY_CONFIGS` directly; parameterised in
 * Phase 5 so a preset-specific config (e.g. `COUNTRY_POLICY_CONFIGS_1991`)
 * can be passed in instead. The output shape and semantics are unchanged —
 * national + regional records per country, regional records derived from
 * `getStateLean` × `stateDefault` for non-tax types.
 *
 * Callers: `getBasePolicies(preset)` selects the right config map.
 */
function buildBasePolicies(
  configs: Record<string, CountryPolicyConfig> = COUNTRY_POLICY_CONFIGS_2019,
  /**
   * Preset starting year. When provided, applies the era policy vacuum: types
   * whose window postdates this year seed NO default policy (an old-era world
   * boots empty for domains that do not exist yet). Undefined ⇒ no vacuum
   * (byte-identical legacy — the module-level `basePolicies` export).
   */
  startYear?: number
): BasePolicyRecord[] {
  const now = new Date();
  const out: BasePolicyRecord[] = [];

  for (const [countryScope, config] of Object.entries(configs)) {
    // Filter legislation types for this country
    // US also picks up types with undefined countryScope (legacy)
    const countryTypes = legislationTypes.filter(
      (lt) =>
        lt.countryScope === countryScope || (countryScope === "us" && lt.countryScope === undefined)
    );

    // National records (exclude state-only types)
    for (const lt of countryTypes) {
      if (lt.allowedScope === "state") continue;
      // Policy vacuum (preset-keyed): skip domains that do not exist yet.
      if (startYear !== undefined && !isLegislationTypeActive(lt._id, startYear)) continue;

      const d = config.defaults[lt._id] ?? { economic: 0, social: 0 };
      const overrideIdx = config.optionIndexes[lt._id];
      const optIndex = overrideIdx ?? 3;
      const option = lt.policyOptions?.[optIndex];
      out.push({
        scope: "national",
        stateId: config.nationalStateId,
        legislationTypeId: lt._id,
        economic: d.economic,
        social: d.social,
        policyOptionId: option?.id,
        policyOptionIndex: option ? optIndex : undefined,
        effectDirection: option?.effectDirection ?? 0,
        updatedAt: now,
      });
    }

    // Regional records — for types scoped to state level.
    // US/UK use allowedScope: "state". JP uses effectTarget.scope/taxRateChange.scope.
    const regionalTypes = countryTypes.filter(
      (lt) =>
        lt.allowedScope === "state" ||
        (countryScope === "jp" &&
          !lt.nationalOnly &&
          (lt.effectTarget?.scope === "state" || lt.taxRateChange?.scope === "state"))
    );

    for (const region of config.regions) {
      for (const lt of regionalTypes) {
        // Policy vacuum (preset-keyed): skip state domains that do not exist yet.
        if (startYear !== undefined && !isLegislationTypeActive(lt._id, startYear)) continue;
        const centerIndex = Math.floor((lt.policyOptions?.length ?? 0) / 2);
        const centerOption = lt.policyOptions?.[centerIndex];
        const d =
          lt.policyDomain === "tax"
            ? { economic: 0, social: 0 }
            : stateDefault(lt._id, getStateLean(region));
        out.push({
          scope: "state",
          stateId: region._id,
          legislationTypeId: lt._id,
          economic: d.economic,
          social: d.social,
          policyOptionId: centerOption?.id,
          policyOptionIndex: centerIndex,
          effectDirection: centerOption?.effectDirection ?? 0,
          updatedAt: now,
        });
      }
    }
  }

  return out;
}

/**
 * The 2019 policy set, un-vacuumed and preset-blind.
 *
 * Consumed by `scripts/seed/seed-policies.ts` (through the `scripts/seeds`
 * re-export), a manual upsert with no preset argument. It builds from
 * `COUNTRY_POLICY_CONFIGS_2019`, so it covers sixteen countries rather than the
 * legacy union's twenty-seven: running it no longer writes Warsaw-Pact or Soviet
 * policy rows into a world that has none.
 *
 * ⚠️ Preset-aware callers must use `getBasePolicies(preset)` instead. This export
 * skips the era vacuum, so it still emits types whose window opens after 2019
 * (`cn_common_prosperity`, 2021). That is unchanged and pre-existing.
 */
export const basePolicies = buildBasePolicies(COUNTRY_POLICY_CONFIGS_2019);
export default basePolicies;

/**
 * Preset-aware accessor. `2019-default` (and any unknown / "empty" /
 * "no-parties" variant) returns the canonical `basePolicies` array.
 * `1991-default` returns a parallel array built from
 * `COUNTRY_POLICY_CONFIGS_1991`.
 *
 * Used by `seedStatePolicies` on bootstrap + reset so a 1991 game starts
 * with era-correct policy positions (Bush-era US, Major-era UK, Kaifu-era
 * JP, Kohl-era DE, Haughey-era IE, post-Tiananmen CN) rather than the
 * Jan 2020 snapshot baked into `basePolicies`.
 */
export async function getBasePolicies(preset: string): Promise<BasePolicyRecord[]> {
  if (preset === "1953-default") {
    const { COUNTRY_POLICY_CONFIGS_1953 } = await import("./basePolicies1953");
    return buildBasePolicies(COUNTRY_POLICY_CONFIGS_1953, 1953);
  }
  if (preset === "1979-default") {
    const { COUNTRY_POLICY_CONFIGS_1979 } = await import("./basePolicies1979");
    return buildBasePolicies(COUNTRY_POLICY_CONFIGS_1979, 1979);
  }
  if (preset === "1991-default") {
    const { COUNTRY_POLICY_CONFIGS_1991 } = await import("./basePolicies1991");
    return buildBasePolicies(COUNTRY_POLICY_CONFIGS_1991, 1991);
  }
  if (preset === "1999-default") {
    const { COUNTRY_POLICY_CONFIGS_1999 } = await import("./basePolicies1999");
    return buildBasePolicies(COUNTRY_POLICY_CONFIGS_1999, 1999);
  }
  if (preset === "2007-default") {
    const { COUNTRY_POLICY_CONFIGS_2007 } = await import("./basePolicies2007");
    return buildBasePolicies(COUNTRY_POLICY_CONFIGS_2007, 2007);
  }
  if (preset === "2023-default") {
    const { COUNTRY_POLICY_CONFIGS_2023 } = await import("./basePolicies2023");
    return buildBasePolicies(COUNTRY_POLICY_CONFIGS_2023, 2023);
  }
  if (preset === "2027-default") {
    const { COUNTRY_POLICY_CONFIGS_2027 } = await import("./basePolicies2027");
    return buildBasePolicies(COUNTRY_POLICY_CONFIGS_2027, 2027);
  }
  // 2019 and its deliberate aliases ("empty", "2019-no-parties"), plus any
  // unrecognised preset. Builds from COUNTRY_POLICY_CONFIGS_2019, NOT the legacy
  // union: the union still carries su/dd and the Warsaw-Pact blocks for
  // budgets.ts, and returning it here is exactly how a 2019 reset came to seed
  // Poland the Leading Role Statute.
  //
  // Still a fall-through rather than a throw. `preset` is a bare string, so
  // throwing would turn a typo into a failed reset; unrecognised presets get the
  // modern era, which is the same answer they got before.
  //
  // Vacuum at 2019 so a modern world doesn't seed a domain that opens after it
  // (e.g. cn_common_prosperity 2021).
  return buildBasePolicies(COUNTRY_POLICY_CONFIGS_2019, 2019);
}
