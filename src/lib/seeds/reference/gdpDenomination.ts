/**
 * Per-country GDP denomination marker for the 1953 preset.
 *
 * By deliberate design, country GDP is stored in LOCAL CURRENCY — the UK in
 * pounds, the USSR in rubles, France in francs, etc. Cross-country GDP
 * comparison is invalid and that is accepted.
 *
 * However, a subset of 1953 countries have their GDP values stored in USD
 * (their `currencyCode` is display-only). This module makes that convention
 * machine-readable so any consumer can ask rather than assume.
 *
 * The marker is pinned by a guard test (gdpDenomination1953.test.ts) that
 * fails if a country's denomination changes without the marker being updated.
 *
 * ## Definitive table (1953 preset)
 *
 * | Country | GDP value     | currencyCode | Denomination | Notes |
 * |---------|---------------|--------------|--------------|-------|
 * | US      | $387B         | USD          | local        | USD is its own currency |
 * | UK      | £14.4B        | GBP          | local        | |
 * | RU      | ₽1.4T         | SUR          | local        | |
 * | FR      | FFr 16,450B   | FRF          | local        | |
 * | IT      | $17B          | ITL          | usd          | Amounts are USD-anchored; ₤10.6T / 625 |
 * | ES      | ₧198B         | ESP          | local        | |
 * | SE      | kr 36B        | SEK          | local        | |
 * | TR      | ₺24B          | TRL          | local        | |
 * | GR      | ₯50B          | GRD          | local        | |
 * | AT      | öS 85B        | ATS          | local        | |
 * | FI      | mk 790B       | FIM          | local        | |
 * | DE      | DM 138B       | EUR          | local        | EUR is game proxy for DM |
 * | JP      | $25.8B        | JPY          | usd          | Amounts are USD-anchored; ¥9.3T / 360 |
 * | CN      | $33.3B        | CNY          | usd          | Amounts are USD-anchored; ¥CNY 82B / 2.46 |
 * | BR      | Cr$ 330B      | BRL          | local        | BRL is game proxy for cruzeiro |
 * | IE      | £IR 340M      | IEP          | local        | |
 * | NG      | $3.4B         | NGN          | usd          | Amounts are USD-anchored; £1.2B WAP × $2.80 |
 * | DD      | DDM 50B       | DDM          | local        | |
 * | HU      | Ft 100B       | HUF          | local        | |
 * | PL      | zł 300B       | PLZ          | local        | |
 * | RO      | lei 80B       | ROL          | local        | |
 * | YU      | YUD 100B      | YUD          | local        | |
 * | BG      | lv 40B        | BGL          | local        | |
 * | UKR     | SUR 291.7B    | SUR          | local        | |
 * | BLR     | SUR 140B      | SUR          | local        | |
 * | CS      | Kčs 200B      | CSK          | local        | |
 * | BAL     | SUR 120B      | SUR          | local        | |
 */

export type GdpDenomination = "local" | "usd";

/**
 * Per-country GDP denomination for the 1953 preset.
 *
 * "local" means the gdp value is in the country's own currency (matching
 * currencyCode). "usd" means the gdp value is in USD despite currencyCode
 * being a different unit (display-only).
 *
 * Only 1953 countries are listed. Other presets (1979, 1991, 2019, etc.)
 * are uniformly local-currency by design.
 */
export const GDP_DENOMINATION_1953: Record<string, GdpDenomination> = {
  US: "local",
  UK: "local",
  RU: "local",
  FR: "local",
  IT: "usd",
  ES: "local",
  SE: "local",
  TR: "local",
  GR: "local",
  AT: "local",
  FI: "local",
  DE: "local",
  JP: "usd",
  CN: "usd",
  BR: "local",
  IE: "local",
  NG: "usd",
  DD: "local",
  HU: "local",
  PL: "local",
  RO: "local",
  YU: "local",
  BG: "local",
  // The three Soviet union republics report in rubles, which IS their own
  // currency (SUR), so they denominate local like everyone else - the "usd"
  // cases below exist only where the authored GDP is a dollar figure.
  UKR: "local",
  BLR: "local",
  CS: "local",
  BAL: "local",
};
