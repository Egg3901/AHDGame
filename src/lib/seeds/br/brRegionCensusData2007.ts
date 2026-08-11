/**
 * Brazil Region Census Profiles — 2007 era.
 *
 * 2007-default companion to {@link brRegionCensusData} (the 2019 profiles).
 * Anchored on IBGE PNAD 2007 (% of adult population), authored independently
 * from historical knowledge of the era — not derived by scaling any other
 * era's profiles.
 *
 * Era anchors: Lula-era commodity boom. Bolsa Família and a rising minimum
 * wage are lifting the Nordeste's bottom tier into a new lower-middle
 * ("classe C"); the Centro-Oeste agro boom (soy, cattle, sugarcane) pulls in
 * workers and capital. Self-classification keeps shifting branco → pardo.
 * University enrollment is expanding (ProUni, private faculdades) but
 * attainment among adults still lags. Income uses era-neutral relative tiers.
 */

import type { BRRegionLayer1 } from "./brRegionCensusData";

export const brRegionCensusData2007: Record<string, BRRegionLayer1> = {
  // Norte — fastest population growth; urbanizing but the interior lags badly.
  NORTE: {
    ethnicity: { branco: 22, pardo: 67, preto: 6, amarelo: 1, indigena: 4 },
    age: { young: 32, mid: 28, mature: 27, senior: 13 },
    education: { fundamental: 64, medio: 27, superior: 9 },
    income: { low: 55, middle: 37, high: 8 },
    urbanization: { urban: 68, suburban: 14, rural: 18 },
  },
  // Nordeste — Bolsa Família epicenter; poverty falling fast from a deep base.
  NORDESTE: {
    ethnicity: { branco: 27, pardo: 62, preto: 9, amarelo: 1, indigena: 1 },
    age: { young: 32, mid: 28, mature: 27, senior: 13 },
    education: { fundamental: 62, medio: 29, superior: 9 },
    income: { low: 53, middle: 39, high: 8 },
    urbanization: { urban: 70, suburban: 14, rural: 16 },
  },
  // Centro-Oeste — agro-boom incomes above national average; mechanized fields, urban workforce.
  CENTRO_OESTE: {
    ethnicity: { branco: 39, pardo: 52, preto: 7, amarelo: 1, indigena: 1 },
    age: { young: 31, mid: 29, mature: 27, senior: 13 },
    education: { fundamental: 54, medio: 33, superior: 13 },
    income: { low: 40, middle: 46, high: 14 },
    urbanization: { urban: 87, suburban: 9, rural: 4 },
  },
  // Sudeste — services-led recovery; classe C expansion in the periferias.
  SUDESTE: {
    ethnicity: { branco: 53, pardo: 36, preto: 9, amarelo: 2, indigena: 0 },
    age: { young: 28, mid: 30, mature: 28, senior: 14 },
    education: { fundamental: 50, medio: 34, superior: 16 },
    income: { low: 34, middle: 47, high: 19 },
    urbanization: { urban: 92, suburban: 6, rural: 2 },
  },
  // Sul — oldest age structure outside the Sudeste; strong smallholder + industrial mix.
  SUL: {
    ethnicity: { branco: 75, pardo: 16, preto: 5, amarelo: 2, indigena: 2 },
    age: { young: 27, mid: 29, mature: 29, senior: 15 },
    education: { fundamental: 51, medio: 34, superior: 15 },
    income: { low: 32, middle: 49, high: 19 },
    urbanization: { urban: 84, suburban: 9, rural: 7 },
  },
};
