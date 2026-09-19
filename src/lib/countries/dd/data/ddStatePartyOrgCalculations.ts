/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era's DD party-org table is authored self-contained. East Germany is a
 * one-party state behind a National Front facade, so org is an authored
 * SED-dominant distribution per era with real (but captive) bloc-party
 * presence, not a vote-share × formula. Changing one era's table must not
 * affect another. (Mirrors ruStatePartyOrgCalculations.ts /
 * cnStatePartyOrgCalculations.ts.)
 *
 * Historical texture: the SED strongest in Berlin and industrial Saxony;
 * the DBD (farmers' party) strongest in the agrarian north; the LDPD
 * (liberal middle-class remnant) in the Saxon/Thuringian workshop towns; the
 * CDU (Ost) in church country — Thüringen and the Mecklenburg villages. The
 * remainder to 100 is the unaffiliated pool. By the late era the SED has
 * consolidated a few points everywhere.
 */
type DdRegionOrg = { sed: number; cdu: number; ldpd: number; ndpd: number; dbd: number };

export const DD_REGION_ORG_1953: Record<string, DdRegionOrg> = {
  BEO: { sed: 66, cdu: 6, ldpd: 8, ndpd: 5, dbd: 1 },
  MV: { sed: 54, cdu: 8, ldpd: 5, ndpd: 6, dbd: 13 },
  BB: { sed: 57, cdu: 7, ldpd: 6, ndpd: 6, dbd: 11 },
  ST: { sed: 59, cdu: 8, ldpd: 7, ndpd: 6, dbd: 8 },
  SN: { sed: 63, cdu: 7, ldpd: 9, ndpd: 6, dbd: 4 },
  TH: { sed: 59, cdu: 9, ldpd: 8, ndpd: 6, dbd: 7 },
};

export const DD_REGION_ORG_1979: Record<string, DdRegionOrg> = {
  BEO: { sed: 73, cdu: 5, ldpd: 6, ndpd: 4, dbd: 1 },
  MV: { sed: 61, cdu: 7, ldpd: 4, ndpd: 5, dbd: 11 },
  BB: { sed: 63, cdu: 6, ldpd: 5, ndpd: 5, dbd: 9 },
  ST: { sed: 65, cdu: 7, ldpd: 6, ndpd: 5, dbd: 7 },
  SN: { sed: 68, cdu: 6, ldpd: 8, ndpd: 5, dbd: 3 },
  TH: { sed: 65, cdu: 8, ldpd: 7, ndpd: 5, dbd: 6 },
};

export const DD_PARTY_TREASURY_1953 = {
  sed: 150_000,
  cdu: 20_000,
  ldpd: 20_000,
  ndpd: 15_000,
  dbd: 15_000,
};

export const DD_PARTY_TREASURY_1979 = {
  sed: 250_000,
  cdu: 30_000,
  ldpd: 30_000,
  ndpd: 25_000,
  dbd: 25_000,
};

export function getDdRegionOrg(preset: string): Record<string, DdRegionOrg> {
  return preset === "1979-default" ? DD_REGION_ORG_1979 : DD_REGION_ORG_1953;
}

export function getDdPartyTreasury(preset: string): typeof DD_PARTY_TREASURY_1953 {
  return preset === "1979-default" ? DD_PARTY_TREASURY_1979 : DD_PARTY_TREASURY_1953;
}
