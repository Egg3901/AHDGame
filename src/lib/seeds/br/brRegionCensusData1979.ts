/**
 * Brazil Region Census Profiles — 1979 era.
 *
 * 1979-default companion to {@link brRegionCensusData} (the 2019 profiles).
 * Anchored on IBGE Censo Demográfico 1980 (% of adult population), authored
 * independently from historical knowledge of the era — not derived by scaling
 * any other era's profiles.
 *
 * Era anchors: tail of the military regime; the "milagre econômico" has
 * stalled into the oil-shock debt squeeze. Population is very young; mass
 * rural-to-urban migration is in full swing but the Nordeste and Norte remain
 * heavily rural. The Norte frontier (Transamazônica, mining, colonization
 * projects) is just opening. Literacy and schooling are low, worst in the
 * Nordeste; university attainment is a thin elite slice everywhere. Income
 * uses era-neutral relative tiers (no cruzeiro thresholds).
 */

import type { BRRegionLayer1 } from "./brRegionCensusData";

export const brRegionCensusData1979: Record<string, BRRegionLayer1> = {
  // Norte — frontier opening; sparse, young, heavily rural, highest indígena share.
  NORTE: {
    ethnicity: { branco: 28, pardo: 62, preto: 4, amarelo: 1, indigena: 5 },
    age: { young: 40, mid: 27, mature: 23, senior: 10 },
    education: { fundamental: 84, medio: 12, superior: 4 },
    income: { low: 66, middle: 29, high: 5 },
    urbanization: { urban: 45, suburban: 13, rural: 42 },
  },
  // Nordeste — poorest, lowest literacy, still close to half rural; out-migration south.
  NORDESTE: {
    ethnicity: { branco: 32, pardo: 58, preto: 8, amarelo: 1, indigena: 1 },
    age: { young: 40, mid: 27, mature: 23, senior: 10 },
    education: { fundamental: 84, medio: 12, superior: 4 },
    income: { low: 68, middle: 27, high: 5 },
    urbanization: { urban: 48, suburban: 14, rural: 38 },
  },
  // Centro-Oeste — cerrado settlement frontier; young Brasília anchors the urban share.
  CENTRO_OESTE: {
    ethnicity: { branco: 45, pardo: 46, preto: 6, amarelo: 1, indigena: 2 },
    age: { young: 38, mid: 28, mature: 24, senior: 10 },
    education: { fundamental: 76, medio: 18, superior: 6 },
    income: { low: 52, middle: 40, high: 8 },
    urbanization: { urban: 66, suburban: 14, rural: 20 },
  },
  // Sudeste — industrial core of the milagre; SP/Rio absorb internal migrants.
  SUDESTE: {
    ethnicity: { branco: 64, pardo: 27, preto: 7, amarelo: 2, indigena: 0 },
    age: { young: 35, mid: 29, mature: 25, senior: 11 },
    education: { fundamental: 70, medio: 22, superior: 8 },
    income: { low: 42, middle: 46, high: 12 },
    urbanization: { urban: 83, suburban: 9, rural: 8 },
  },
  // Sul — European-settlement smallholder belt; still substantially rural in 1979.
  SUL: {
    ethnicity: { branco: 82, pardo: 11, preto: 4, amarelo: 2, indigena: 1 },
    age: { young: 35, mid: 28, mature: 26, senior: 11 },
    education: { fundamental: 72, medio: 21, superior: 7 },
    income: { low: 40, middle: 48, high: 12 },
    urbanization: { urban: 62, suburban: 14, rural: 24 },
  },
};
