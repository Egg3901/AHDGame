/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era's RU party-org table is authored self-contained. The Soviet Union
 * is a one-party state, so org is an authored CPSU-dominant distribution per
 * era, not a vote-share × formula. Changing one era's table must not affect
 * another. (Mirrors cnStatePartyOrgCalculations.ts.)
 *
 * Historical shape: near-total party penetration in the RSFSR core; visibly
 * weaker organization in the recently-annexed western republics (MOL) in the
 * early era, converging by the late era. The other recently-annexed republics
 * (Ukraine, Byelorussia, the Baltics) are separate countries now and carry
 * their own party-organisation seeds.
 */
type RuRegionOrg = { cpsu: number };

export const RU_REGION_ORG_1953: Record<string, RuRegionOrg> = {
  CEN: { cpsu: 98 },
  NWR: { cpsu: 97 },
  NOR: { cpsu: 96 },
  CBE: { cpsu: 96 },
  VOL: { cpsu: 96 },
  NCA: { cpsu: 95 },
  URA: { cpsu: 97 },
  WSB: { cpsu: 96 },
  ESB: { cpsu: 95 },
  FEA: { cpsu: 95 },
  KAZ: { cpsu: 95 },
  TRA: { cpsu: 95 },
  CAS: { cpsu: 94 },
  MOL: { cpsu: 91 },
};

export const RU_REGION_ORG_1979: Record<string, RuRegionOrg> = {
  CEN: { cpsu: 97 },
  NWR: { cpsu: 96 },
  NOR: { cpsu: 96 },
  CBE: { cpsu: 96 },
  VOL: { cpsu: 96 },
  NCA: { cpsu: 95 },
  URA: { cpsu: 96 },
  WSB: { cpsu: 96 },
  ESB: { cpsu: 95 },
  FEA: { cpsu: 95 },
  KAZ: { cpsu: 95 },
  TRA: { cpsu: 95 },
  CAS: { cpsu: 95 },
  MOL: { cpsu: 94 },
};

export const RU_PARTY_TREASURY_1953 = { cpsu: 250_000 };
export const RU_PARTY_TREASURY_1979 = { cpsu: 350_000 };

export function getRuRegionOrg(preset: string): Record<string, RuRegionOrg> {
  return preset === "1979-default" ? RU_REGION_ORG_1979 : RU_REGION_ORG_1953;
}

export function getRuPartyTreasury(preset: string): { cpsu: number } {
  return preset === "1979-default" ? RU_PARTY_TREASURY_1979 : RU_PARTY_TREASURY_1953;
}
