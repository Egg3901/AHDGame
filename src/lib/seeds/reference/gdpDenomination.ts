import { JP_GDP_DENOMINATION_1953 } from "@/lib/countries/jp/economy";
import { US_ECONOMY } from "@/lib/countries/us/economy";
import { UK_ECONOMY } from "@/lib/countries/uk/economy";
import { DE_ECONOMY } from "@/lib/countries/de/economy";
import { CN_ECONOMY } from "@/lib/countries/cn/economy";
import { IE_ECONOMY } from "@/lib/countries/ie/economy";
import { RU_ECONOMY } from "@/lib/countries/ru/economy";
import { DD_ECONOMY } from "@/lib/countries/dd/economy";
import { NG_ECONOMY } from "@/lib/countries/ng/economy";
import { BR_ECONOMY } from "@/lib/countries/br/economy";
import { FR_ECONOMY } from "@/lib/countries/fr/economy";
import { IT_ECONOMY } from "@/lib/countries/it/economy";
import { ES_ECONOMY } from "@/lib/countries/es/economy";
import { SE_ECONOMY } from "@/lib/countries/se/economy";
import { TR_ECONOMY } from "@/lib/countries/tr/economy";
import { GR_ECONOMY } from "@/lib/countries/gr/economy";
import { AT_ECONOMY } from "@/lib/countries/at/economy";
import { FI_ECONOMY } from "@/lib/countries/fi/economy";
import { PL_ECONOMY } from "@/lib/countries/pl/economy";
import { HU_ECONOMY } from "@/lib/countries/hu/economy";
import { RO_ECONOMY } from "@/lib/countries/ro/economy";
import { YU_ECONOMY } from "@/lib/countries/yu/economy";
import { BG_ECONOMY } from "@/lib/countries/bg/economy";
import { CS_ECONOMY } from "@/lib/countries/cs/economy";
import { BLR_ECONOMY } from "@/lib/countries/blr/economy";
import { UKR_ECONOMY } from "@/lib/countries/ukr/economy";
import { BAL_ECONOMY } from "@/lib/countries/bal/economy";

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
/*
 * ⚠️ `Partial`, MATCHING WHAT THE DOC ABOVE ALREADY SAYS. "Only 1953 countries
 * are listed" -- the type claimed every string key had a denomination, which was
 * never true, and only became a compile error once the folders started
 * forwarding an optional field into it.
 */
export const GDP_DENOMINATION_1953: Partial<Record<string, GdpDenomination>> = {
  US: US_ECONOMY.gdpDenomination1953,
  UK: UK_ECONOMY.gdpDenomination1953,
  RU: RU_ECONOMY.gdpDenomination1953,
  FR: FR_ECONOMY.gdpDenomination1953,
  IT: IT_ECONOMY.gdpDenomination1953,
  ES: ES_ECONOMY.gdpDenomination1953,
  SE: SE_ECONOMY.gdpDenomination1953,
  TR: TR_ECONOMY.gdpDenomination1953,
  GR: GR_ECONOMY.gdpDenomination1953,
  AT: AT_ECONOMY.gdpDenomination1953,
  FI: FI_ECONOMY.gdpDenomination1953,
  DE: DE_ECONOMY.gdpDenomination1953,
  JP: JP_GDP_DENOMINATION_1953,
  CN: CN_ECONOMY.gdpDenomination1953,
  BR: BR_ECONOMY.gdpDenomination1953,
  IE: IE_ECONOMY.gdpDenomination1953,
  NG: NG_ECONOMY.gdpDenomination1953,
  DD: DD_ECONOMY.gdpDenomination1953,
  HU: HU_ECONOMY.gdpDenomination1953,
  PL: PL_ECONOMY.gdpDenomination1953,
  RO: RO_ECONOMY.gdpDenomination1953,
  YU: YU_ECONOMY.gdpDenomination1953,
  BG: BG_ECONOMY.gdpDenomination1953,
  // The three Soviet union republics report in rubles, which IS their own
  // currency (SUR), so they denominate local like everyone else - the "usd"
  // cases below exist only where the authored GDP is a dollar figure.
  UKR: UKR_ECONOMY.gdpDenomination1953,
  BLR: BLR_ECONOMY.gdpDenomination1953,
  CS: CS_ECONOMY.gdpDenomination1953,
  BAL: BAL_ECONOMY.gdpDenomination1953,
};
