/**
 * Brazil Region Census Profiles — 1999 era.
 *
 * 1999-default companion to {@link brRegionCensusData} (the 2019 profiles).
 * Anchored on IBGE Censo Demográfico 2000 (% of adult population), authored
 * independently from historical knowledge of the era — not derived by scaling
 * any other era's profiles.
 *
 * Era anchors: post-Plano-Real stabilization under Cardoso — hyperinflation
 * is gone but inequality sits near its historical peak (Gini ~0.60). São
 * Paulo's industry is restructuring/shedding jobs; secondary schooling is
 * expanding fast while university access is still narrow. Urbanization has
 * crossed ~80% nationally, with the Nordeste and Norte still trailing.
 * Income uses era-neutral relative tiers (no real thresholds).
 */

import type { BRRegionLayer1 } from "./brRegionCensusData";

export const brRegionCensusData1999: Record<string, BRRegionLayer1> = {
  // Norte — frontier cities (Manaus Zona Franca, Belém) growing; interior still rural.
  NORTE: {
    ethnicity: { branco: 24, pardo: 65, preto: 6, amarelo: 1, indigena: 4 },
    age: { young: 33, mid: 28, mature: 27, senior: 12 },
    education: { fundamental: 70, medio: 23, superior: 7 },
    income: { low: 58, middle: 35, high: 7 },
    urbanization: { urban: 62, suburban: 15, rural: 23 },
  },
  // Nordeste — still poorest; schooling expansion under FUNDEF just starting to bite.
  NORDESTE: {
    ethnicity: { branco: 29, pardo: 61, preto: 8, amarelo: 1, indigena: 1 },
    age: { young: 33, mid: 28, mature: 27, senior: 12 },
    education: { fundamental: 68, medio: 25, superior: 7 },
    income: { low: 56, middle: 37, high: 7 },
    urbanization: { urban: 65, suburban: 15, rural: 20 },
  },
  // Centro-Oeste — soy frontier consolidating; Brasília + Goiânia keep it highly urban.
  CENTRO_OESTE: {
    ethnicity: { branco: 41, pardo: 50, preto: 6, amarelo: 1, indigena: 2 },
    age: { young: 32, mid: 29, mature: 27, senior: 12 },
    education: { fundamental: 60, medio: 30, superior: 10 },
    income: { low: 43, middle: 45, high: 12 },
    urbanization: { urban: 84, suburban: 10, rural: 6 },
  },
  // Sudeste — industrial restructuring in SP; most urban and most schooled region.
  SUDESTE: {
    ethnicity: { branco: 56, pardo: 34, preto: 8, amarelo: 2, indigena: 0 },
    age: { young: 30, mid: 30, mature: 27, senior: 13 },
    education: { fundamental: 55, medio: 33, superior: 12 },
    income: { low: 36, middle: 47, high: 17 },
    urbanization: { urban: 90, suburban: 7, rural: 3 },
  },
  // Sul — diversified agro-industry; broad middle tier, still the most branco region.
  SUL: {
    ethnicity: { branco: 77, pardo: 15, preto: 5, amarelo: 2, indigena: 1 },
    age: { young: 29, mid: 29, mature: 28, senior: 14 },
    education: { fundamental: 57, medio: 32, superior: 11 },
    income: { low: 34, middle: 49, high: 17 },
    urbanization: { urban: 80, suburban: 11, rural: 9 },
  },
};
