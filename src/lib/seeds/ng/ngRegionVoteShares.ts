/**
 * Nigeria zonal presidential vote-share tables, by era and party (percent).
 *
 * Consumed by `ngStatePartyOrgCalculations` to derive seed state-party-org
 * levels, and (later) by the NG election engine. Kept as a standalone seed
 * module mirroring `ieRegionVoteShares` / `jpRegionVoteShares1990`.
 */

/**
 * 1953 late-colonial triad under Macpherson/Lyttelton. Approximate regional
 * strength mapped onto the modern 6-zone grid (Northern → NW/NE/NC; Western →
 * SW; Eastern → SE/SS). Calibrated loosely to 1951 regional + 1954 federal
 * patterns: NPC sweeps the North (Middle Belt more contested), AG dominates
 * the West, NCNC the East. Not pinpoint-precise — org seeding only.
 */
export const NG_REGION_VOTE_SHARES_1953: Record<string, Record<string, number>> = {
  NORTH_WEST: { npc: 78, ncnc: 12, ag: 10 },
  NORTH_EAST: { npc: 75, ncnc: 15, ag: 10 },
  NORTH_CENTRAL: { npc: 55, ncnc: 25, ag: 20 },
  SOUTH_WEST: { ag: 62, ncnc: 28, npc: 10 },
  SOUTH_SOUTH: { ncnc: 55, ag: 35, npc: 10 },
  SOUTH_EAST: { ncnc: 72, ag: 20, npc: 8 },
};

/**
 * 1991 Third Republic two-party system. SDP (Social Democratic Party) was
 * dominant in the South-West (Abiola's base) and competitive in North-Central;
 * NRC (National Republican Convention) was dominant in North-West, North-East,
 * and South-East.
 */
export const NG_REGION_VOTE_SHARES_1991: Record<string, Record<string, number>> = {
  NORTH_WEST: { sdp: 42, nrc: 58 },
  NORTH_EAST: { sdp: 45, nrc: 55 },
  NORTH_CENTRAL: { sdp: 58, nrc: 42 },
  SOUTH_WEST: { sdp: 72, nrc: 28 },
  SOUTH_SOUTH: { sdp: 55, nrc: 45 },
  SOUTH_EAST: { sdp: 48, nrc: 52 },
};

/**
 * Estimated 2019 presidential vote share by geopolitical zone and party (%).
 * Simplified from actual regional patterns. APC dominant in NW/NE/SW (Buhari
 * coalition); PDP strong in NC/SS/SE (Atiku / Jonathan base); LP/NNPP/APGA
 * smaller regional players.
 */
export const NG_REGION_VOTE_SHARES_2019: Record<string, Record<string, number>> = {
  NORTH_WEST: { apc: 65, pdp: 30, lp: 1, nnpp: 1, apga: 1 },
  NORTH_EAST: { apc: 55, pdp: 35, lp: 2, nnpp: 2, apga: 1 },
  NORTH_CENTRAL: { apc: 45, pdp: 45, lp: 3, nnpp: 3, apga: 2 },
  SOUTH_WEST: { apc: 50, pdp: 30, lp: 10, nnpp: 2, apga: 3 },
  SOUTH_SOUTH: { apc: 20, pdp: 60, lp: 8, nnpp: 3, apga: 5 },
  SOUTH_EAST: { apc: 10, pdp: 50, lp: 8, nnpp: 4, apga: 25 },
};
