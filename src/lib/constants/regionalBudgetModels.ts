import type { CountryId } from "./countries";

/**
 * Countries whose regions run on the Länder REVENUE-SHARING model: a slice of
 * the national income tax and VAT collected in-territory, a per-Land trade tax,
 * and a federal equalization grant on top (`processLaenderRegionalBudgets`).
 *
 * A list rather than a config probe because the model is not inferable from one
 * field: `federalEqualizationGrantPerCapita` has a default, so its absence would
 * silently opt a country in. Being named here is the declaration.
 *
 * DD is on this model and NOT the one-party central-transfer model, despite
 * being a one-party state, because that model's only regional revenue term
 * multiplies by `dd.tax.domesticCorporateTax` — authored at 0%. See the DD
 * config block and `processLaenderRegionalBudgets` (#1323).
 */
export const LAENDER_MODEL_COUNTRIES: readonly CountryId[] = ["DE", "DD"];
