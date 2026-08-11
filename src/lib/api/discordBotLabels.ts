import {
  COUNTRY_CONFIGS,
  getCountryConfig,
  getOfficeTypeConfig,
  type CountryId,
} from "@/lib/constants/countries";

/**
 * Display label for an office = the country config's officeType label
 * (e.g. UK/`commons` → "Member of Parliament", RU/`governor` → "Republic First
 * Secretary"). Falls back to the raw key for any office type not present in the
 * config. This is the single source of office naming for every discord-bot
 * route — it stays in sync with in-game terminology automatically.
 *
 * Delegates to `getOfficeTypeConfig` rather than reading COUNTRY_CONFIGS
 * directly, so passing a `preset` picks up per-era office overlays.
 */
export function officeLabel(countryId: CountryId, officeType: string, preset?: string): string {
  return findOfficeLabel(countryId, officeType, preset) ?? officeType;
}

/**
 * Like {@link officeLabel} but returns `undefined` when the country config has
 * no matching officeType, instead of echoing the raw key back.
 *
 * Use this for optional API response fields the Discord bot treats as
 * "authoritative label, else fall back to my own map". Election types are not
 * all office keys — snap races (`snap_commons`, `snap_bundestag`, `snap_shugiin`,
 * `snap_dail`) have no config entry — and echoing the key would make the field
 * truthy, permanently suppressing the bot's `??` fallback and rendering
 * "snap_commons" to users.
 */
export function findOfficeLabel(
  countryId: CountryId,
  officeType: string,
  preset?: string
): string | undefined {
  if (!COUNTRY_CONFIGS[countryId]) return undefined;
  return getOfficeTypeConfig(countryId, officeType, preset)?.label;
}

/**
 * The nationwide single-seat executive offices for a country, in config
 * declaration order. Replaces the hand-maintained NATIONAL_OFFICE_TYPES map,
 * which omitted BR/NG/RU/DD and still listed the dropped CA.
 */
export function nationalOfficeTypes(countryId: CountryId, preset?: string): string[] {
  if (!COUNTRY_CONFIGS[countryId]) return [];
  return getCountryConfig(countryId, preset)
    .officeTypes.filter((o) => o.isExecutive && !o.isSubNational)
    .map((o) => o.key);
}
