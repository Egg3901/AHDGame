/**
 * Modern-name fallbacks that must not appear as 1953 display names (#3728).
 * Matching is case-insensitive exact displayName equality.
 */
export const FORBIDDEN_1953_DISPLAY_NAMES: readonly string[] = Object.freeze([
  "Ghana", // emergent target only — dependency is Gold Coast
  "Sri Lanka",
  "Myanmar",
  "Zimbabwe",
  "Zambia",
  "Malawi",
  "Botswana",
  "Lesotho",
  "Namibia",
  "Belize",
  "Guyana",
  "Suriname",
  "Benin",
  "Burkina Faso",
  "Mali",
  "Tanzania",
  "Democratic Republic of the Congo",
  "DRC",
  "Timor-Leste",
  "East Timor",
  "United Arab Emirates",
  "UAE",
  "Vanuatu",
  "eSwatini",
  "Eswatini",
  "Côte d'Ivoire",
  "Cote d'Ivoire",
  "North Macedonia",
  "Czechia",
  "Czech Republic",
  "Slovakia",
  "Bangladesh",
  "South Sudan",
  "Eritrea",
  "Djibouti",
  "Malaysia", // use Federation of Malaya
]);

/**
 * Entity IDs that may legitimately use a forbidden display name
 * (e.g. emergent Ghana target row).
 */
export const FORBIDDEN_NAME_ALLOWLIST_IDS: ReadonlySet<string> = new Set(["GH", "GY"]);
