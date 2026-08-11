import type { PoliticalMetricId, PoliticalMetricsCountryId } from "../types";

/**
 * Sparse per-region deltas applied to NATIONAL_BASELINES_1953 (clamped 0–100 at
 * seed time). Unlisted regions inherit the national base unchanged. Region ids
 * must exist in the country's campaign-start region seed (states1953 /
 * ukRegions1953 / ruRegions1953) — enforced by seedData.test.ts.
 *
 * Texture rationale (comments only — never shown to players):
 * US — union belt vs right-to-work South; Jim Crow South on integration and due
 * process; Appalachian deprivation; postwar research/industrial hubs.
 * UK — London/Southeast prosperity; unionized industrial North with smog and
 * deprivation; coalfield Wales; sectarian-divided Northern Ireland.
 * RU — Moscow/Leningrad service and research advantage; camp-system periphery;
 * under-served Central Asia; Urals defense industry concentration.
 */
export const REGIONAL_MODIFIERS_1953: Record<
  PoliticalMetricsCountryId,
  Record<string, Partial<Record<PoliticalMetricId, number>>>
> = {
  US: {
    MI: { "economy.workerSecurity": 8, "economy.productivity": 4 },
    PA: { "economy.workerSecurity": 6, "environment.urbanAir": -6 },
    NY: {
      "economy.householdIncome": 6,
      "infrastructure.transit": 8,
      "infrastructure.publicHousing": 6,
    },
    CT: { "economy.householdIncome": 8, "education.attainment": 6 },
    CA: {
      "economy.productivity": 5,
      "education.research": 6,
      "infrastructure.highways": 5,
    },
    TX: { "environment.resourceDev": 8, "environment.extraction": 6 },
    WV: {
      "economy.mobility": -10,
      "economy.householdIncome": -8,
      "infrastructure.utilities": -6,
    },
    AR: { "economy.mobility": -8, "society.integration": -10 },
    MS: {
      "society.integration": -18,
      "order.dueProcess": -12,
      "economy.mobility": -10,
      "education.universalSchooling": -12,
      "education.attainment": -8,
    },
    AL: {
      "society.integration": -15,
      "order.dueProcess": -10,
      "economy.mobility": -8,
      "education.universalSchooling": -10,
    },
    GA: {
      "society.integration": -12,
      "order.dueProcess": -8,
      "education.universalSchooling": -8,
    },
    SC: {
      "society.integration": -14,
      "order.dueProcess": -9,
      "education.universalSchooling": -9,
    },
  },
  UK: {
    LON: {
      "economy.householdIncome": 6,
      "infrastructure.transit": 8,
      "education.research": 5,
      "health.universalCare": 3,
    },
    SEE: { "economy.householdIncome": 5, "infrastructure.ownership": 6 },
    NEE: {
      "economy.mobility": -8,
      "economy.householdIncome": -6,
      "economy.workerSecurity": 6,
    },
    NWE: {
      "economy.workerSecurity": 5,
      "environment.urbanAir": -8,
      "economy.mobility": -5,
    },
    YHU: {
      "economy.workerSecurity": 4,
      "environment.urbanAir": -6,
      "economy.mobility": -4,
    },
    WAL: {
      "economy.workerSecurity": 6,
      "economy.mobility": -7,
      "environment.resourceDev": 6,
      "environment.urbanAir": -5,
    },
    SCO: {
      "infrastructure.publicHousing": 4,
      "economy.mobility": -6,
      "education.universalSchooling": 4,
    },
    NIR: {
      "society.integration": -12,
      "economy.mobility": -10,
      "order.dueProcess": -6,
      "economy.householdIncome": -8,
    },
    SWE: { "environment.stewardship": 4, "infrastructure.transit": -5 },
    EAE: { "environment.stewardship": 3, "infrastructure.utilities": -4 },
  },
  RU: {
    CEN: {
      "infrastructure.utilities": 6,
      "education.research": 5,
      "infrastructure.transit": 6,
      "economy.householdIncome": 5,
      "health.universalCare": 5,
    },
    NWR: {
      "education.research": 6,
      "economy.productivity": 5,
      "infrastructure.transit": 5,
    },
    URA: {
      "economy.productivity": 6,
      "defense.defenseIndustry": 7,
      "environment.urbanAir": -8,
    },
    VOL: { "economy.productivity": 3 },
    CBE: { "economy.mobility": -5, "economy.householdIncome": -4 },
    // The RU "UKR" block is gone: Ukraine is its own country now, not an RU
    // region, so the modifier keyed off a region id that no longer exists in
    // ruRegions1953. Ukraine's own regional character lives in its seed and its
    // derived non-playable board; this table only covers the four playable
    // countries (POLITICAL_METRIC_COUNTRY_IDS).
    NCA: { "society.integration": -8, "order.dueProcess": -6 },
    TRA: { "society.integration": -4, "economy.householdIncome": -3 },
    KAZ: {
      "economy.mobility": -8,
      "infrastructure.utilities": -10,
      "health.universalCare": -8,
      "society.integration": -5,
      "environment.resourceDev": 5,
    },
    CAS: {
      "infrastructure.utilities": -12,
      "health.universalCare": -10,
      "education.universalSchooling": -8,
      "education.attainment": -10,
      "economy.mobility": -6,
    },
    WSB: {
      "infrastructure.utilities": -8,
      "environment.resourceDev": 8,
      "order.dueProcess": -8,
      "infrastructure.transit": -6,
    },
    ESB: {
      "infrastructure.utilities": -8,
      "environment.resourceDev": 8,
      "order.dueProcess": -8,
      "infrastructure.transit": -6,
    },
    FEA: {
      "infrastructure.utilities": -9,
      "infrastructure.transit": -8,
      "environment.resourceDev": 6,
      "order.dueProcess": -6,
    },
    NOR: {
      "order.dueProcess": -10,
      "infrastructure.utilities": -8,
      "environment.resourceDev": 7,
    },
  },
  DD: {
    // Both Cold-War presets seed DD on the eastern-Länder codes
    // (BEO/MV/BB/ST/SN/TH). Berlin: supply-priority capital, worst war damage,
    // the open sector west; Saxony: the industrial belt with its lignite smog
    // and research seats; the north: agrarian, resettler-settled, cleaner air,
    // thinner infrastructure.
    BEO: {
      "economy.householdIncome": 6,
      "infrastructure.publicHousing": -6,
      "infrastructure.transit": 8,
      "governance.openness": 5,
      "order.deterrence": 4,
    },
    MV: {
      "economy.productivity": -6,
      "infrastructure.utilities": -5,
      "environment.urbanAir": 8,
      "society.integration": 5,
    },
    BB: {
      "environment.resourceDev": 6,
      "environment.urbanAir": -4,
      "economy.productivity": 2,
    },
    ST: {
      "economy.productivity": 4,
      "environment.urbanAir": -7,
      "environment.conservation": -5,
      "health.outcomes": -3,
    },
    SN: {
      "economy.productivity": 6,
      "education.research": 6,
      "environment.urbanAir": -8,
      "environment.resourceDev": 8,
    },
    TH: {
      "education.research": 5,
      "economy.productivity": 3,
      "environment.urbanAir": 3,
    },
  },
};
