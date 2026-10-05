/**
 * UK 1991 social lean inputs use the published BSA demographic gradient in
 * rejection of traditional gender roles. These are seed proxies for social
 * attitudes, not party vote shares or measured regional ideology scores.
 * getUkModel combines them with each region's census and turnout composition.
 */

/**
 * NatCen, British Social Attitudes 35, Gender, Table 1, printed p63:
 * https://natcen.ac.uk/sites/default/files/2023-08/bsa35_full-report.pdf
 *
 * The 1991 column measures disagreement with the male-breadwinner model.
 * Proxy coordinate: 5 * (1 - 2 * disagreement / 100), with lower values
 * representing more liberal attitudes. Non-disagreement includes neutral and
 * unknown answers, so this is not a net agreement score or a full social index.
 *
 * Age crosswalk: 18-29 uses the published 18-34 value (67%). For 30-44,
 * blend 18-34 (67%) and 35-44 (54%) by band widths 5:10. For 45-64, average
 * 45-54 (44%) and 55-64 (25%). For 65+, average 65-74 (16%) and 75+ (11%).
 * The width/older-band averages are explicit approximations, not sample weights.
 *
 * Education uses the four published categories (31%, 46%, 54%, 67%).
 * Income is a relative-tier proxy: bottom group (23%), mean middle groups
 * (30%, 50%), top group (53%). No modern nominal pound thresholds are imported.
 * This Great Britain source does not measure Northern Ireland's separate
 * attitudes. NIR retains its census mix; no religious or constitutional lean
 * is inferred from its ethnicity or the GB survey.
 */
export const UK_SOCIAL_ATTITUDES_1991 = {
  age: { young: -1.7, mid: -0.83, mature: 1.55, senior: 3.65 },
  education: {
    no_qualifications: 1.9,
    gcse_equivalent: 0.4,
    a_level_equivalent: -0.4,
    degree_plus: -1.7,
  },
  income: { low: 2.7, middle: 1.0, high: -0.3 },
} as const;
