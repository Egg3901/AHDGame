/**
 * 2024 UK Regional Vote Shares
 *
 * Vote share percentages by region from the 4 July 2024 general election
 * (fought on the 2023 Periodic Review boundaries). Used by
 * `calculateUKStatePartyOrgs` when the active preset is `2027-default`.
 *
 * Primary source: House of Commons Library briefing CBP-10009 "General
 * election 2024: Results and analysis"
 * (https://commonslibrary.parliament.uk/research-briefings/cbp-10009/).
 * English regional figures cross-checked against the per-region results
 * tables (which cite CBP-10009): East of England Con 30.6 / Lab 29.4 /
 * Reform 17.5 / LD 13.2 / Green 6.9; East Midlands Lab 35.3 / Con 29.4 /
 * Reform 18.9 / LD 6.4 / Green 6.3; London Lab 43.0 / Con 20.6 / LD 11.0 /
 * Green 10.0 / Reform 8.7; North East Lab 45.4 / Con 20.3 / Reform 19.9 /
 * Green 6.0 / LD 5.8; North West Lab 44.0 / Con 18.8 / Reform 16.6 / LD 7.8 /
 * Green 7.0; South East Con 30.6 / Lab 24.5 / LD 21.9 / Reform 14.0 /
 * Green 6.9; South West Con 28.2 / LD 24.7 / Lab 24.5 / Reform 13.8 /
 * Green 7.4; West Midlands Lab 34.0 / Con 27.6 / Reform 18.1 / LD 8.8 /
 * Green 6.5; Yorkshire and the Humber Lab 40.9 / Con 22.8 / Reform 16.7 /
 * Green 7.5 / LD 7.1. Scotland: Lab 35.3 / SNP 30.0 / Con 12.7 / LD 9.7 /
 * Reform 7.0 / Green 3.8. Wales: Lab 37.0 / Con 18.2 / Reform 16.9 /
 * Plaid 14.8 / LD 6.5 / Green 4.7. Northern Ireland: SF 27.0 / DUP 22.1 /
 * Alliance 15.0 / UUP 12.2 / SDLP 11.1 / TUV 6.2.
 *
 * Compared to the 2020 dataset: Labour landslide on a modest vote rise
 * (Conservative collapse to ~24% nationally), Reform UK at 14.3%
 * nationally and second in most English regions, SNP down to 30% in
 * Scotland, DUP down to 22% in Northern Ireland with Sinn Fein first.
 * Alliance and SDLP are not seeded as default parties, so their shares go
 * unallocated rather than being folded into a party that did not win them.
 * NIR keeps the 2020 file's shape: mainland parties at 0 except small LD
 * and Green entries, UUP at its actual 12%.
 */

export const UK_REGION_POLLING_2024: Record<string, Record<string, number>> = {
  LON: {
    uk_labour: 43,
    uk_conservative: 21,
    uk_libdem: 11,
    uk_green: 10,
    uk_reform: 9,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  SEE: {
    uk_labour: 25,
    uk_conservative: 31,
    uk_libdem: 22,
    uk_green: 7,
    uk_reform: 14,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  SWE: {
    uk_labour: 25,
    uk_conservative: 28,
    uk_libdem: 25,
    uk_green: 7,
    uk_reform: 14,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  EAE: {
    uk_labour: 29,
    uk_conservative: 31,
    uk_libdem: 13,
    uk_green: 7,
    uk_reform: 17,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  EMI: {
    uk_labour: 35,
    uk_conservative: 29,
    uk_libdem: 6,
    uk_green: 6,
    uk_reform: 19,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  WMI: {
    uk_labour: 34,
    uk_conservative: 28,
    uk_libdem: 9,
    uk_green: 6,
    uk_reform: 18,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  YHU: {
    uk_labour: 41,
    uk_conservative: 23,
    uk_libdem: 7,
    uk_green: 7,
    uk_reform: 17,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  NWE: {
    uk_labour: 44,
    uk_conservative: 19,
    uk_libdem: 8,
    uk_green: 7,
    uk_reform: 17,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  NEE: {
    uk_labour: 45,
    uk_conservative: 20,
    uk_libdem: 6,
    uk_green: 6,
    uk_reform: 20,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  SCO: {
    uk_labour: 35,
    uk_conservative: 13,
    uk_libdem: 10,
    uk_green: 4,
    uk_reform: 7,
    uk_snp: 30,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  WAL: {
    uk_labour: 37,
    uk_conservative: 18,
    uk_libdem: 7,
    uk_green: 5,
    uk_reform: 17,
    uk_snp: 0,
    uk_plaid: 15,
    uk_dup: 0,
    uk_sf: 0,
  },
  NIR: {
    // Northern Ireland 2024: SF 27.0 first past the DUP 22.1; UUP 12.2
    // holds one seat. Alliance 15.0 and SDLP 11.1 are not seeded as
    // default parties, so their shares go unallocated.
    uk_labour: 0,
    uk_conservative: 0,
    uk_libdem: 1,
    uk_green: 1,
    uk_reform: 0,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 22,
    uk_sf: 27,
    // 1991-only default, only added when the active preset is 1991. Kept
    // at its actual 2024 share so the key exists in every era table.
    uk_uup: 12,
  },
};

export default UK_REGION_POLLING_2024;
