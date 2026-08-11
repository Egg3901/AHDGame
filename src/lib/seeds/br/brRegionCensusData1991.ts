/**
 * Brazil Region Census Profiles — 1991 era.
 *
 * 1991-default companion to {@link brRegionCensusData} (the 2019 profiles).
 * Selected at render time via the preset registry under the `1991-default`
 * reset preset.
 *
 * Sources / methodology (approximate, % of adult population): IBGE Censo
 * Demográfico 1991. Strong regional contrasts: the South is predominantly
 * branco (European descent); the North/Northeast are majority pardo with the
 * highest indígena share in the North; the Southeast is the most urban and
 * schooled. Income uses era-neutral relative tiers (no cruzeiro/real
 * thresholds).
 *
 * Directional vs the 2019 profiles: lower `superior` attainment and lower
 * urbanization, strongest in the North and Northeast.
 */

import type { BRRegionLayer1 } from "./brRegionCensusData";

export const brRegionCensusData1991: Record<string, BRRegionLayer1> = {
  // Norte (Amazon) — majority pardo, highest indígena share, least urban.
  NORTE: {
    ethnicity: { branco: 25, pardo: 64, preto: 5, amarelo: 1, indigena: 5 },
    age: { young: 34, mid: 27, mature: 27, senior: 12 },
    education: { fundamental: 74, medio: 20, superior: 6 },
    income: { low: 60, middle: 34, high: 6 },
    urbanization: { urban: 55, suburban: 15, rural: 30 },
  },
  // Nordeste — poorest region, high pardo + preto share.
  NORDESTE: {
    ethnicity: { branco: 30, pardo: 60, preto: 8, amarelo: 1, indigena: 1 },
    age: { young: 34, mid: 27, mature: 27, senior: 12 },
    education: { fundamental: 72, medio: 22, superior: 6 },
    income: { low: 58, middle: 36, high: 6 },
    urbanization: { urban: 60, suburban: 16, rural: 24 },
  },
  // Centro-Oeste — agricultural frontier; Brasília lifts the urban share.
  CENTRO_OESTE: {
    ethnicity: { branco: 42, pardo: 49, preto: 6, amarelo: 1, indigena: 2 },
    age: { young: 33, mid: 28, mature: 27, senior: 12 },
    education: { fundamental: 66, medio: 26, superior: 8 },
    income: { low: 45, middle: 44, high: 11 },
    urbanization: { urban: 78, suburban: 12, rural: 10 },
  },
  // Sudeste — São Paulo / Rio / Minas, most developed + most urban.
  SUDESTE: {
    ethnicity: { branco: 58, pardo: 33, preto: 7, amarelo: 2, indigena: 0 },
    age: { young: 31, mid: 29, mature: 27, senior: 13 },
    education: { fundamental: 60, medio: 30, superior: 10 },
    income: { low: 38, middle: 48, high: 14 },
    urbanization: { urban: 88, suburban: 8, rural: 4 },
  },
  // Sul — predominantly branco (European settlement).
  SUL: {
    ethnicity: { branco: 78, pardo: 14, preto: 5, amarelo: 2, indigena: 1 },
    age: { young: 30, mid: 28, mature: 28, senior: 14 },
    education: { fundamental: 62, medio: 29, superior: 9 },
    income: { low: 36, middle: 50, high: 14 },
    urbanization: { urban: 76, suburban: 12, rural: 12 },
  },
};
