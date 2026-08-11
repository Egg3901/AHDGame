/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
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

export function getCnRegionOrg(preset: string): Record<string, CnRegionOrg> {
  return preset === "1991-default" ? CN_REGION_ORG_1991 : CN_REGION_ORG_2019;
}

export function getCnPartyTreasury(preset: string): { ccp: number; cdl: number; cndca: number } {
  return preset === "1991-default" ? CN_PARTY_TREASURY_1991 : CN_PARTY_TREASURY_2019;
}
