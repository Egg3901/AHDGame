/**
 * National nominal GDP anchors for the January 1991 successor roster, in the
 * currency units that circulated at the scenario start. WDI retrospectively
 * expresses pre-redenomination GDP in today's currency units, so the original
 * units are restored here before they can be compared with regional GDP or
 * 1991 budget figures. YU uses the latest published pre-start SFRY total
 * (1990); it is an opening-year estimate, not an observed 1991 outturn.
 *
 * WDI indicator NY.GDP.MKTP.CN (country/year in each URL):
 * https://api.worldbank.org/v2/country/POL/indicator/NY.GDP.MKTP.CN?date=1991&format=json
 * https://api.worldbank.org/v2/country/HUN/indicator/NY.GDP.MKTP.CN?date=1991&format=json
 * https://api.worldbank.org/v2/country/ROU/indicator/NY.GDP.MKTP.CN?date=1991&format=json
 * https://api.worldbank.org/v2/country/BGR/indicator/NY.GDP.MKTP.CN?date=1991&format=json
 * https://api.worldbank.org/v2/country/RUS/indicator/NY.GDP.MKTP.CN?date=1991&format=json
 * https://api.worldbank.org/v2/country/CZE/indicator/NY.GDP.MKTP.CN?date=1991&format=json
 * https://api.worldbank.org/v2/country/SVK/indicator/NY.GDP.MKTP.CN?date=1991&format=json
 * WDI's Slovak historical LCU series is restated in EUR. Restore the common
 * koruna using the European Commission's fixed SKK/EUR rate of 30.1260:
 * https://economy-finance.ec.europa.eu/euro/eu-countries-and-euro/slovakia-and-euro_en
 * UNSD SNA93 table 1.3, SFR Yugoslavia 1990 GDP in YUD:
 * https://data.un.org/Data.aspx?d=SNA&f=group_code:103;country_code:890
 */
export const SUCCESSOR_NOMINAL_GDP_1991 = {
  // 1995 redenomination: 10,000 old złoty per new złoty.
  PL: 904_856_405_000_000,
  HU: 2_605_808_215_000,
  // 2005 redenomination: 10,000 old lei per new leu.
  RO: 2_203_900_000_000,
  // 1999 redenomination: 1,000 old leva per new lev.
  BG: 69_379_000_000,
  // 1998 redenomination: 1,000 old rubles per new ruble.
  RU: 1_398_500_000_000,
  // Czech WDI value is in koruna; Slovak WDI value is retrospectively in EUR.
  CS: 886_403_288_000 + 11_696_633_000 * 30.126,
  // Latest available pre-start SFRY observation (1990), not a 1991 actual.
  YU: 1_147_787_000_000,
} as const;

export const CS_1991_CZECH_GDP_CSK = 886_403_288_000;
export const CS_1991_SLOVAK_GDP_CSK = 11_696_633_000 * 30.126;
