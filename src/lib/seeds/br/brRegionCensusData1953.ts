/**
 * Brazil Region Census Profiles — 1953 era.
 *
 * 1953-default companion to {@link brRegionCensusData} (the 2019 profiles).
 * Anchored on IBGE Censo Demográfico 1950.
 *
 * Era anchors (Vargas second presidency / pre-Kubitschek): Getúlio Vargas
 * had returned to the presidency via election in 1950 and would die by
 * suicide in August 1954; national literacy was ~50%; rural population was
 * ~64% nationally; the Nordeste was devastated by recurrent droughts; the
 * industrial expansion of the Sudeste (SP–ABC steel and auto belt) was only
 * beginning; income was very low with extreme inequality; Brasília was not
 * yet built (construction began 1956). The Norte frontier was essentially
 * Amazon forest with tiny riverine towns. All income tiers era-neutral.
 */

import type { BRRegionLayer1 } from "./brRegionCensusData";

export const brRegionCensusData1953: Record<string, BRRegionLayer1> = {
  // Norte — Amazon river towns; sparse; near-zero formal economy.
  NORTE: {
    ethnicity: { branco: 22, pardo: 66, preto: 5, amarelo: 1, indigena: 6 },
    age: { young: 42, mid: 27, mature: 22, senior: 9 },
    education: { fundamental: 92, medio: 7, superior: 1 },
    income: { low: 78, middle: 19, high: 3 },
    urbanization: { urban: 26, suburban: 10, rural: 64 },
  },
  // Nordeste — lowest literacy in Brazil; severe structural poverty; droughts.
  NORDESTE: {
    ethnicity: { branco: 28, pardo: 61, preto: 10, amarelo: 0, indigena: 1 },
    age: { young: 43, mid: 27, mature: 22, senior: 8 },
    education: { fundamental: 92, medio: 6, superior: 2 },
    income: { low: 82, middle: 15, high: 3 },
    urbanization: { urban: 32, suburban: 12, rural: 56 },
  },
  // Centro-Oeste — Mato Grosso frontier and Goiás; Brasília not yet begun.
  CENTRO_OESTE: {
    ethnicity: { branco: 42, pardo: 48, preto: 7, amarelo: 1, indigena: 2 },
    age: { young: 40, mid: 27, mature: 24, senior: 9 },
    education: { fundamental: 84, medio: 13, superior: 3 },
    income: { low: 62, middle: 33, high: 5 },
    urbanization: { urban: 46, suburban: 13, rural: 41 },
  },
  // Sudeste — São Paulo industrial core; large Italian/Japanese immigration base.
  SUDESTE: {
    ethnicity: { branco: 66, pardo: 24, preto: 7, amarelo: 2, indigena: 1 },
    age: { young: 37, mid: 28, mature: 25, senior: 10 },
    education: { fundamental: 80, medio: 16, superior: 4 },
    income: { low: 52, middle: 40, high: 8 },
    urbanization: { urban: 66, suburban: 11, rural: 23 },
  },
  // Sul — European smallholder belt; Germany/Italy/Poland descendants; more literate.
  SUL: {
    ethnicity: { branco: 84, pardo: 9, preto: 4, amarelo: 2, indigena: 1 },
    age: { young: 37, mid: 27, mature: 26, senior: 10 },
    education: { fundamental: 82, medio: 15, superior: 3 },
    income: { low: 50, middle: 42, high: 8 },
    urbanization: { urban: 42, suburban: 13, rural: 45 },
  },
};
