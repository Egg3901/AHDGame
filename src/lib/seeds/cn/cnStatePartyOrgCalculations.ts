/**
 * SEED INDEPENDENCE - DO NOT DERIVE FROM ANOTHER ERA.
 * Each era's CN party-org table is authored self-contained. China is a
 * one-party state, so org is an authored CCP-dominant distribution per era,
 * not a vote-share × formula. Changing one era's table must not affect another.
 */
type CnRegionOrg = { ccp: number; cdl: number; cndca: number };

export const CN_REGION_ORG_2019: Record<string, CnRegionOrg> = {
  DB: { ccp: 94, cdl: 2, cndca: 3 },
  HB: { ccp: 96, cdl: 4, cndca: 4 },
  HD: { ccp: 95, cdl: 5, cndca: 5 },
  HZ: { ccp: 95, cdl: 4, cndca: 2 },
  HN: { ccp: 94, cdl: 2, cndca: 4 },
  XN: { ccp: 96, cdl: 3, cndca: 2 },
  XB: { ccp: 96, cdl: 2, cndca: 1 },
};

export const CN_REGION_ORG_1991: Record<string, CnRegionOrg> = {
  DB: { ccp: 97, cdl: 1, cndca: 1 },
  HB: { ccp: 98, cdl: 2, cndca: 2 },
  HD: { ccp: 97, cdl: 3, cndca: 3 },
  HZ: { ccp: 98, cdl: 2, cndca: 1 },
  HN: { ccp: 97, cdl: 1, cndca: 2 },
  XN: { ccp: 98, cdl: 1, cndca: 1 },
  XB: { ccp: 98, cdl: 1, cndca: 1 },
};

export const CN_PARTY_TREASURY_2019 = { ccp: 500_000, cdl: 10_000, cndca: 10_000 };
export const CN_PARTY_TREASURY_1991 = { ccp: 250_000, cdl: 4_000, cndca: 4_000 };

/**
 * 2027-default org table. Authored literal for 2027: the party-state
 * structure is unchanged in the 14th NPC term (2023 to 2028), so every
 * region carries the modern (2019) distribution verbatim. Kept as its own
 * named table so a future 2027 divergence edits this table only and no
 * other era moves with it.
 */
export const CN_REGION_ORG_2027: Record<string, CnRegionOrg> = {
  DB: { ccp: 94, cdl: 2, cndca: 3 },
  HB: { ccp: 96, cdl: 4, cndca: 4 },
  HD: { ccp: 95, cdl: 5, cndca: 5 },
  HZ: { ccp: 95, cdl: 4, cndca: 2 },
  HN: { ccp: 94, cdl: 2, cndca: 4 },
  XN: { ccp: 96, cdl: 3, cndca: 2 },
  XB: { ccp: 96, cdl: 2, cndca: 1 },
};

/** 2027-default treasury table. Same rationale as `CN_REGION_ORG_2027`. */
export const CN_PARTY_TREASURY_2027 = { ccp: 500_000, cdl: 10_000, cndca: 10_000 };

export function getCnRegionOrg(preset: string): Record<string, CnRegionOrg> {
  if (preset === "1991-default") return CN_REGION_ORG_1991;
  if (preset === "2027-default") return CN_REGION_ORG_2027;
  return CN_REGION_ORG_2019;
}

export function getCnPartyTreasury(preset: string): { ccp: number; cdl: number; cndca: number } {
  if (preset === "1991-default") return CN_PARTY_TREASURY_1991;
  if (preset === "2027-default") return CN_PARTY_TREASURY_2027;
  return CN_PARTY_TREASURY_2019;
}
