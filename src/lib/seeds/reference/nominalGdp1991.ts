import { gdp1991LegacyLcu } from "@/lib/constants/fiscalAnchors1991";
import { IE_NOMINAL_GDP_1991_IEP } from "@/lib/countries/ie/economy";

/**
 * 1991 national nominal GDP in the currency circulating at the scenario start.
 * WDI NY.GDP.MKTP.CN retrospectively reports euro members in EUR and Turkey
 * in post-2005 TRY. Restore legacy currencies before applying native FX.
 * Sweden's observation is already in SEK.
 *
 * Primary GDP source (replace ISO3 with IRL/FRA/ITA/ESP/SWE/TUR/GRC/AUT/FIN):
 * https://api.worldbank.org/v2/country/IRL/indicator/NY.GDP.MKTP.CN?date=1991&format=json
 * Official legacy currency units per EUR:
 * https://ec.europa.eu/eurostat/cache/metadata/en/ert_bil_conv_esms.htm
 * Turkey's 2005 redenomination, 1 TRY = 1,000,000 TRL:
 * https://www3.tcmb.gov.tr/yillikrapor/2016/en/m-0-2.php
 *
 * The eight Western anchors share the sourced table in fiscalAnchors1991.
 * Ireland's separate observation is restored here. The shared table also
 * owns historical debt/expenditure where available; inherited program
 * composition retains its original sourceFiscalYear independently.
 */
export const NATIVE_NOMINAL_GDP_1991 = {
  IE: IE_NOMINAL_GDP_1991_IEP,
  FR: gdp1991LegacyLcu("FR"),
  IT: gdp1991LegacyLcu("IT"),
  ES: gdp1991LegacyLcu("ES"),
  SE: gdp1991LegacyLcu("SE"),
  TR: gdp1991LegacyLcu("TR"),
  GR: gdp1991LegacyLcu("GR"),
  AT: gdp1991LegacyLcu("AT"),
  FI: gdp1991LegacyLcu("FI"),
} as const;

/**
 * End-1991 consolidated general-government gross debt, not the narrower
 * National Debt net of liquid assets: CSO Statistical Yearbook 2013, table 9.6,
 * EUR 36,004 million, restored to circulating Irish pounds at 0.787564 IEP/EUR.
 * https://www.cso.ie/en/media/csoie/releasespublications/documents/statisticalyearbook/2013/c9publicfinance.pdf
 * Keep the sourced absolute stock: the report's 95.6% ratio uses its ESA95 GDP
 * vintage, while the opening GDP above uses the later WDI national accounts.
 */
export const IRISH_GROSS_GOVERNMENT_DEBT_1991_IEP = 36_004_000_000 * 0.787564;
