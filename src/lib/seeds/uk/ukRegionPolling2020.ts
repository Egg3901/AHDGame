/**
 * 2020 UK Regional Polling Data
 *
 * Vote share percentages for Westminster voting intention by region.
 * Data sources: 2020 polling aggregators adjusted from 2019 GE results.
 *
 * Percentages represent each party's vote share in that region.
 * Regional parties (SNP, Plaid) are 0% outside their nations.
 */

export const UK_REGION_POLLING_2020: Record<string, Record<string, number>> = {
  LON: {
    uk_labour: 42,
    uk_conservative: 28,
    uk_libdem: 15,
    uk_green: 8,
    uk_reform: 4,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  SEE: {
    uk_labour: 28,
    uk_conservative: 45,
    uk_libdem: 18,
    uk_green: 5,
    uk_reform: 3,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  SWE: {
    uk_labour: 22,
    uk_conservative: 48,
    uk_libdem: 20,
    uk_green: 6,
    uk_reform: 3,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  EAE: {
    uk_labour: 30,
    uk_conservative: 44,
    uk_libdem: 16,
    uk_green: 6,
    uk_reform: 3,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  EMI: {
    uk_labour: 35,
    uk_conservative: 42,
    uk_libdem: 12,
    uk_green: 5,
    uk_reform: 5,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  WMI: {
    uk_labour: 38,
    uk_conservative: 40,
    uk_libdem: 10,
    uk_green: 5,
    uk_reform: 6,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  YHU: {
    uk_labour: 40,
    uk_conservative: 38,
    uk_libdem: 10,
    uk_green: 5,
    uk_reform: 6,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  NWE: {
    uk_labour: 45,
    uk_conservative: 32,
    uk_libdem: 12,
    uk_green: 5,
    uk_reform: 5,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  NEE: {
    uk_labour: 48,
    uk_conservative: 30,
    uk_libdem: 10,
    uk_green: 5,
    uk_reform: 6,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  SCO: {
    uk_labour: 18,
    uk_conservative: 22,
    uk_libdem: 8,
    uk_green: 2,
    uk_reform: 1,
    uk_snp: 48,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  WAL: {
    uk_labour: 38,
    uk_conservative: 32,
    uk_libdem: 10,
    uk_green: 4,
    uk_reform: 4,
    uk_snp: 0,
    uk_plaid: 11,
    uk_dup: 0,
    uk_sf: 0,
  },
  NIR: {
    // Northern Ireland has its own party system — DUP and Sinn Féin are the major parties
    uk_labour: 0,
    uk_conservative: 0,
    uk_libdem: 1,
    uk_green: 1,
    uk_reform: 0,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 30,
    uk_sf: 27,
    // 1991-only default — only added when the active preset is 1991. ~12%
    // matches their 2019 GE share; included so a 1991 reset gives UUP a
    // starting Org row in NIR rather than no presence at all.
    uk_uup: 12,
  },
};

export default UK_REGION_POLLING_2020;
