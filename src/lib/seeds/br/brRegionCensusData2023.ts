/**
 * Brazil Region Census Profiles — 2023 era.
 *
 * 2023-default companion to {@link brRegionCensusData} (the 2019 profiles).
 * Anchored on IBGE Censo Demográfico 2022 (% of adult population), authored
 * independently from historical knowledge of the era — not derived by scaling
 * any other era's profiles.
 *
 * Era anchors: an aging Brazil — fertility well below replacement, senior
 * share climbing everywhere (highest in the Sul). Pardo is now the national
 * plurality as self-classification keeps shifting. The Centro-Oeste is an
 * agro powerhouse with above-average incomes; the Nordeste remains the
 * poorest region despite two decades of convergence. Evangelical growth
 * (~30% nationally) reshapes the urban periphery but is not a Layer 1 field.
 * Income uses era-neutral relative tiers.
 */

import type { BRRegionLayer1 } from "./brRegionCensusData";

export const brRegionCensusData2023: Record<string, BRRegionLayer1> = {
  // Norte — youngest region, but even here the senior share is rising; pardo supermajority.
  NORTE: {
    ethnicity: { branco: 19, pardo: 69, preto: 7, amarelo: 1, indigena: 4 },
    age: { young: 29, mid: 28, mature: 28, senior: 15 },
    education: { fundamental: 56, medio: 31, superior: 13 },
    income: { low: 51, middle: 39, high: 10 },
    urbanization: { urban: 74, suburban: 13, rural: 13 },
  },
  // Nordeste — still the poorest region; rising preto self-identification.
  NORDESTE: {
    ethnicity: { branco: 24, pardo: 64, preto: 10, amarelo: 1, indigena: 1 },
    age: { young: 29, mid: 28, mature: 28, senior: 15 },
    education: { fundamental: 54, medio: 33, superior: 13 },
    income: { low: 49, middle: 41, high: 10 },
    urbanization: { urban: 75, suburban: 14, rural: 11 },
  },
  // Centro-Oeste — agro powerhouse; high incomes, near-total urbanization of residence.
  CENTRO_OESTE: {
    ethnicity: { branco: 35, pardo: 55, preto: 8, amarelo: 1, indigena: 1 },
    age: { young: 28, mid: 29, mature: 28, senior: 15 },
    education: { fundamental: 46, medio: 37, superior: 17 },
    income: { low: 36, middle: 47, high: 17 },
    urbanization: { urban: 91, suburban: 6, rural: 3 },
  },
  // Sudeste — branco share dips below half; most schooled and most urban region.
  SUDESTE: {
    ethnicity: { branco: 49, pardo: 38, preto: 11, amarelo: 2, indigena: 0 },
    age: { young: 26, mid: 30, mature: 28, senior: 16 },
    education: { fundamental: 42, medio: 37, superior: 21 },
    income: { low: 31, middle: 46, high: 23 },
    urbanization: { urban: 94, suburban: 4, rural: 2 },
  },
  // Sul — oldest age structure in Brazil; still the most branco region.
  SUL: {
    ethnicity: { branco: 71, pardo: 19, preto: 6, amarelo: 2, indigena: 2 },
    age: { young: 25, mid: 28, mature: 29, senior: 18 },
    education: { fundamental: 44, medio: 37, superior: 19 },
    income: { low: 29, middle: 48, high: 23 },
    urbanization: { urban: 88, suburban: 8, rural: 4 },
  },
};
