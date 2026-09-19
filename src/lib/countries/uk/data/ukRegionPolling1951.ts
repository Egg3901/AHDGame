/**
 * 1951 UK Regional Polling Data
 *
 * Vote share percentages for Westminster voting intention by region, derived
 * from the 1951 General Election (the election nearest the 1953 era start):
 * Conservative (incl. National Liberal allies) 48.0%, Labour 48.8%, Liberal
 * 2.5% nationally. Sources: UK Parliament Library research briefings /
 * F.W.S. Craig, British Parliamentary Election Results.
 *
 * Used by `calculateUKStatePartyOrgs` when the active preset is
 * `1953-default`. Compared to the 1992/2020 datasets:
 *  - The historic Liberal Party (`uk_liberal`, a 1953-only default seed)
 *    replaces the Liberal Democrats (founded 1988 — zeroed here; the party is
 *    preset-gated out of 1953 anyway, so the slug would skip on DB lookup).
 *  - Greens (founded 1990) and Reform UK don't exist — zero / no entry.
 *  - SCO 1951 was a Unionist(Con)/Labour dead heat (~48/48); the SNP polled
 *    ~0.3% and stood 2 candidates — seeded 0 (no meaningful presence).
 *  - WAL: Labour dominant (~60%); Liberals kept a rural-Wales redoubt (~7%);
 *    Plaid Cymru ~0.7% — seeded 1.
 *  - NIR: Ulster Unionists dominant (~63%, 9 of 12 seats), mapped to
 *    `uk_conservative` (the UUP took the Conservative whip at Westminster
 *    until 1972; the UUP default seed itself is 1991-only). The nationalist
 *    bloc and NI Labour hold the remaining ~37% — see the NIR entry below.
 *
 * EVERY region's shares must sum to ~100. They are normalized against each
 * other when registration is seeded (`registration: voteShare` in
 * ukStatePartyOrgCalculations.ts), so a region that sums to less than 100
 * does NOT leave the remainder unaligned — it inflates whichever parties ARE
 * seeded. NIR previously listed only `uk_conservative: 63` and summed to 63,
 * which normalized the Unionists to ~100% of the region's registered support
 * and produced an 18-of-18 Commons sweep in play (ticket #1032).
 */

export const UK_REGION_POLLING_1951: Record<string, Record<string, number>> = {
  LON: {
    uk_labour: 51,
    uk_conservative: 46,
    uk_liberal: 2,
    uk_libdem: 0,
    uk_green: 0,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  SEE: {
    uk_labour: 39,
    uk_conservative: 58,
    uk_liberal: 3,
    uk_libdem: 0,
    uk_green: 0,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  SWE: {
    // West Country — the strongest surviving English Liberal tradition
    uk_labour: 41,
    uk_conservative: 53,
    uk_liberal: 6,
    uk_libdem: 0,
    uk_green: 0,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  EAE: {
    uk_labour: 43,
    uk_conservative: 54,
    uk_liberal: 3,
    uk_libdem: 0,
    uk_green: 0,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  EMI: {
    uk_labour: 50,
    uk_conservative: 47,
    uk_liberal: 3,
    uk_libdem: 0,
    uk_green: 0,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  WMI: {
    // Birmingham's Unionist tradition kept the West Midlands a dead heat
    uk_labour: 49,
    uk_conservative: 49,
    uk_liberal: 2,
    uk_libdem: 0,
    uk_green: 0,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  YHU: {
    uk_labour: 54,
    uk_conservative: 44,
    uk_liberal: 2,
    uk_libdem: 0,
    uk_green: 0,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  NWE: {
    uk_labour: 52,
    uk_conservative: 46,
    uk_liberal: 2,
    uk_libdem: 0,
    uk_green: 0,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  NEE: {
    uk_labour: 61,
    uk_conservative: 37,
    uk_liberal: 2,
    uk_libdem: 0,
    uk_green: 0,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  SCO: {
    // 1951 Scotland: Unionist (Con) 48.6 / Labour 47.9 — no SNP presence
    uk_labour: 48,
    uk_conservative: 48,
    uk_liberal: 3,
    uk_libdem: 0,
    uk_green: 0,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 0,
  },
  WAL: {
    uk_labour: 60,
    uk_conservative: 31,
    uk_liberal: 7,
    uk_libdem: 0,
    uk_green: 0,
    uk_snp: 0,
    uk_plaid: 1,
    uk_dup: 0,
    uk_sf: 0,
  },
  NIR: {
    // Ulster Unionists ~63% mapped to uk_conservative (see header). DUP
    // (founded 1971) is preset-gated out of 1953.
    //
    // The nationalist bloc (~30%) is carried by `uk_sf`, which is the only
    // Irish-nationalist party the 1953 roster seeds — it has no
    // `validForPresets` gate, unlike UUP (1991-only) and DUP. This is a
    // deliberate stand-in rather than a claim about 1951: the nationalist
    // vote that year went to the Nationalist Party / Anti-Partition League,
    // and Sinn Féin did not contest Westminster until 1955. Carrying the
    // bloc anachronistically is far closer to the period than the previous
    // seed, which gave Northern Ireland no nationalist party at all and let
    // the Unionists take every seat unopposed. Replace this with a
    // 1953-gated Nationalist Party if one is ever added.
    //
    // NI Labour takes ~7%; it ran separately from British Labour but shares
    // the `uk_labour` slug, the only mainland-left vehicle seeded here.
    uk_labour: 7,
    uk_conservative: 63,
    uk_liberal: 0,
    uk_libdem: 0,
    uk_green: 0,
    uk_snp: 0,
    uk_plaid: 0,
    uk_dup: 0,
    uk_sf: 30,
  },
};

export default UK_REGION_POLLING_1951;
