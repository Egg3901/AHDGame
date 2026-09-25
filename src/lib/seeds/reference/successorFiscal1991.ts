/**
 * General-government revenue, expenditure and balance as a share of GDP.
 * The five European transition entries are 1991 observations. Russia's
 * combined federal/subnational deficit was 11.3% of GDP and expenditure was
 * about 48%; its 36.7% revenue is the residual, not an observed line.
 * Yugoslavia uses the latest pre-start (1990) estimate: expenditure about 40%
 * of gross social product and a 2.9% cash surplus through Q3. Its 42.9%
 * opening revenue is a scenario estimate, not a 1991 outturn.
 * IMF Working Paper 94/104, Table 1:
 * https://www.elibrary.imf.org/view/journals/001/1994/104/article-A001-en.xml
 * Russia World Bank fiscal reviews:
 * https://documents1.worldbank.org/curated/en/633081468294634409/pdf/multi0page.pdf
 * https://documents1.worldbank.org/curated/en/510691468763189627/pdf/multi0page.pdf
 * Yugoslavia IMF/GATT pre-start estimates:
 * https://www.elibrary.imf.org/view/journals/001/1991/043/article-A001-en.xml
 * https://www.wto.org/gatt_docs/English/SULPDF/91530268.pdf
 */
export const SUCCESSOR_1991_GENERAL_GOVERNMENT_GDP_PERCENT = {
  BG: { revenue: 42.3, expenditure: 50.7, reportedBalance: -15.1 },
  CS: { revenue: 55.1, expenditure: 57.1, reportedBalance: -2.0 },
  HU: { revenue: 56.0, expenditure: 58.3, reportedBalance: -2.3 },
  PL: { revenue: 41.5, expenditure: 48.0, reportedBalance: -6.5 },
  RO: { revenue: 41.0, expenditure: 40.4, reportedBalance: 0.6 },
  RU: { revenue: 36.7, expenditure: 48.0, reportedBalance: -11.3 },
  YU: { revenue: 42.9, expenditure: 40.0, reportedBalance: 2.9 },
} as const;

// Bulgarian reported balance includes adjustments outside the simple
// revenue-minus-expenditure columns (external debt rescheduling and arrears).
