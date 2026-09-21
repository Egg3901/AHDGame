import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import {
  getCountrySectorWeights1953,
  getCountrySectorRaw1953,
  STATE_SECTOR_WEIGHT_OVERRIDES_1953,
} from "./sectorSeedWeights1953";
import { getCountrySectorWeights1979 } from "./sectorSeedWeights1979";
import { getCountrySectorWeights1991 } from "./sectorSeedWeights1991";
import { getCountrySectorWeights1999 } from "./sectorSeedWeights1999";
import { getCountrySectorWeights2007 } from "./sectorSeedWeights2007";
import { getCountrySectorWeights2023 } from "./sectorSeedWeights2023";
import { JP_ECONOMY } from "@/lib/countries/jp/economy";
import { getCountrySectorWeights2027 } from "./sectorSeedWeights2027";
import { US_ECONOMY } from "@/lib/countries/us/economy";
import { UK_ECONOMY } from "@/lib/countries/uk/economy";
import { DE_ECONOMY } from "@/lib/countries/de/economy";
import { CN_ECONOMY } from "@/lib/countries/cn/economy";
import { IE_ECONOMY } from "@/lib/countries/ie/economy";
import { RU_ECONOMY } from "@/lib/countries/ru/economy";
import { DD_ECONOMY } from "@/lib/countries/dd/economy";
import { NG_ECONOMY } from "@/lib/countries/ng/economy";
import { BR_ECONOMY } from "@/lib/countries/br/economy";
import { FR_ECONOMY } from "@/lib/countries/fr/economy";
import { IT_ECONOMY } from "@/lib/countries/it/economy";
import { ES_ECONOMY } from "@/lib/countries/es/economy";
import { SE_ECONOMY } from "@/lib/countries/se/economy";
import { TR_ECONOMY } from "@/lib/countries/tr/economy";
import { GR_ECONOMY } from "@/lib/countries/gr/economy";
import { AT_ECONOMY } from "@/lib/countries/at/economy";
import { FI_ECONOMY } from "@/lib/countries/fi/economy";
import { PL_ECONOMY } from "@/lib/countries/pl/economy";
import { HU_ECONOMY } from "@/lib/countries/hu/economy";
import { RO_ECONOMY } from "@/lib/countries/ro/economy";
import { YU_ECONOMY } from "@/lib/countries/yu/economy";
import { BG_ECONOMY } from "@/lib/countries/bg/economy";
import { CS_ECONOMY } from "@/lib/countries/cs/economy";
import { SCO_ECONOMY } from "@/lib/countries/sco/economy";
import { WAL_ECONOMY } from "@/lib/countries/wal/economy";
import { BLR_ECONOMY } from "@/lib/countries/blr/economy";
import { UKR_ECONOMY } from "@/lib/countries/ukr/economy";
import { BAL_ECONOMY } from "@/lib/countries/bal/economy";

type SectorWeightMap = Partial<Record<CorporationType, number>>;

// Partial regional overrides should bend, not erase, the national sector baseline.
const PARTIAL_STATE_BASELINE_WEIGHT = 0.5;

function normalise(raw: SectorWeightMap): Record<CorporationType, number> {
  const entries = CORPORATION_TYPES.map((t) => [t, raw[t] ?? 0] as const);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total === 0) {
    const even = 1 / CORPORATION_TYPES.length;
    return Object.fromEntries(CORPORATION_TYPES.map((t) => [t, even])) as Record<
      CorporationType,
      number
    >;
  }
  return Object.fromEntries(entries.map(([t, v]) => [t, v / total])) as Record<
    CorporationType,
    number
  >;
}

function mergeStateOverride(
  countryRaw: SectorWeightMap,
  stateRaw: SectorWeightMap
): SectorWeightMap {
  const isCompleteOverride = CORPORATION_TYPES.every((sectorType) => stateRaw[sectorType] != null);
  if (isCompleteOverride) return stateRaw;

  return Object.fromEntries(
    CORPORATION_TYPES.map((sectorType) => [
      sectorType,
      (countryRaw[sectorType] ?? 0) * PARTIAL_STATE_BASELINE_WEIGHT + (stateRaw[sectorType] ?? 0),
    ])
  ) as SectorWeightMap;
}

export const COUNTRY_SECTOR_WEIGHTS: Record<CountryId, SectorWeightMap> = {
  US: US_ECONOMY.sectorWeights.base,
  UK: UK_ECONOMY.sectorWeights.base,
  // Latent - mirrors UK; dedicated SCO weights are not authored.
  SCO: SCO_ECONOMY.sectorWeights.base,
  // Latent - mirrors UK; dedicated WAL weights are not authored.
  WAL: WAL_ECONOMY.sectorWeights.base,
  DE: DE_ECONOMY.sectorWeights.base,
  JP: JP_ECONOMY.sectorWeights.base,
  CN: CN_ECONOMY.sectorWeights.base,
  IE: IE_ECONOMY.sectorWeights.base,
  BR: BR_ECONOMY.sectorWeights.base,
  NG: NG_ECONOMY.sectorWeights.base,
  // Hungary — planned socialist economy: heavy industry + agriculture, minimal
  // finance/tech/media.
  HU: HU_ECONOMY.sectorWeights.base,
  // Eastern Bloc planned economies (normalized at read).
  PL: PL_ECONOMY.sectorWeights.base,
  RO: RO_ECONOMY.sectorWeights.base,
  YU: YU_ECONOMY.sectorWeights.base,
  BG: BG_ECONOMY.sectorWeights.base,
  // Ukraine. Post-Soviet shape even in the eras where it is not seeded: the
  // Donbas/Dnieper metallurgical belt and the black-earth grain surplus are the
  // two things that survive every regime change.
  UKR: UKR_ECONOMY.sectorWeights.base,
  BLR: BLR_ECONOMY.sectorWeights.base,
  CS: CS_ECONOMY.sectorWeights.base,
  BAL: BAL_ECONOMY.sectorWeights.base,
  // USSR — command economy: heavy industry, energy/extraction, defense, agriculture.
  RU: RU_ECONOMY.sectorWeights.base,
  // France 1979 — diversified mixed economy: manufacturing/autos, nuclear energy,
  // finance, agriculture (largest in W. Europe), tourism/services, defense (arms).
  FR: FR_ECONOMY.sectorWeights.base,
  // Italy 1979 — manufacturing/SME-led (north), autos (FIAT), fashion/retail,
  // tourism/entertainment, agriculture (south), state holdings (IRI/ENI energy).
  IT: IT_ECONOMY.sectorWeights.base,
  ES: ES_ECONOMY.sectorWeights.base,
  SE: SE_ECONOMY.sectorWeights.base,
  GR: GR_ECONOMY.sectorWeights.base,
  AT: AT_ECONOMY.sectorWeights.base,
  FI: FI_ECONOMY.sectorWeights.base,
  TR: TR_ECONOMY.sectorWeights.base,
  DD: DD_ECONOMY.sectorWeights.base,
};

export const STATE_SECTOR_WEIGHT_OVERRIDES: Partial<Record<string, SectorWeightMap>> = {
  // ── US ──────────────────────────────────────────────────────────────────
  CA: {
    technology: 20,
    real_estate: 11,
    media_entertainment: 17,
    healthcare: 7,
    financial: 7,
    retail: 6,
    construction: 5,
    chemical_industries: 4,
    agriculture: 4,
    logistics: 4,
    manufacturing: 4,
    telecommunications: 4,
    defense: 3,
    energy: 2,
    automobiles: 1,
    extraction: 1,
  },
  TX: {
    energy: 16,
    real_estate: 12,
    technology: 9,
    financial: 8,
    chemical_industries: 7,
    manufacturing: 7,
    construction: 7,
    retail: 7,
    healthcare: 7,
    logistics: 5,
    agriculture: 4,
    defense: 3,
    extraction: 3,
    telecommunications: 2,
    media_entertainment: 2,
    automobiles: 1,
  },
  NY: {
    financial: 18,
    real_estate: 14,
    media_entertainment: 16,
    healthcare: 9,
    retail: 7,
    technology: 7,
    construction: 6,
    telecommunications: 5,
    logistics: 4,
    chemical_industries: 3,
    manufacturing: 3,
    defense: 2,
    energy: 2,
    agriculture: 2,
    automobiles: 1,
    extraction: 1,
  },
  FL: {
    real_estate: 17,
    media_entertainment: 16,
    healthcare: 11,
    retail: 8,
    construction: 7,
    financial: 7,
    logistics: 6,
    technology: 6,
    defense: 5,
    agriculture: 4,
    telecommunications: 3,
    chemical_industries: 3,
    manufacturing: 3,
    energy: 2,
    automobiles: 1,
    extraction: 1,
  },
  WA: {
    technology: 19,
    logistics: 11,
    real_estate: 11,
    healthcare: 9,
    retail: 7,
    financial: 7,
    construction: 7,
    manufacturing: 6,
    media_entertainment: 7,
    agriculture: 4,
    defense: 4,
    telecommunications: 3,
    energy: 2,
    chemical_industries: 1,
    automobiles: 1,
    extraction: 1,
  },
  MA: {
    technology: 16,
    healthcare: 15,
    financial: 11,
    real_estate: 10,
    chemical_industries: 9,
    retail: 7,
    construction: 6,
    manufacturing: 6,
    media_entertainment: 6,
    telecommunications: 4,
    logistics: 3,
    defense: 3,
    energy: 1,
    agriculture: 1,
    automobiles: 1,
    extraction: 1,
  },
  IL: {
    financial: 15,
    logistics: 11,
    real_estate: 11,
    healthcare: 9,
    manufacturing: 8,
    retail: 8,
    construction: 7,
    technology: 6,
    media_entertainment: 9,
    agriculture: 4,
    chemical_industries: 4,
    telecommunications: 3,
    defense: 2,
    automobiles: 1,
    energy: 1,
    extraction: 1,
  },
  MI: {
    automobiles: 20,
    manufacturing: 17,
    real_estate: 10,
    healthcare: 9,
    retail: 7,
    financial: 6,
    construction: 6,
    logistics: 5,
    technology: 4,
    chemical_industries: 4,
    energy: 3,
    agriculture: 2,
    defense: 2,
    telecommunications: 2,
    media_entertainment: 2,
    extraction: 1,
  },
  WV: {
    extraction: 20,
    energy: 13,
    healthcare: 13,
    chemical_industries: 10,
    manufacturing: 9,
    real_estate: 8,
    construction: 7,
    retail: 6,
    logistics: 4,
    agriculture: 2,
    defense: 2,
    financial: 1,
    technology: 1,
    telecommunications: 1,
    media_entertainment: 2,
    automobiles: 1,
  },
  AK: {
    energy: 20,
    extraction: 16,
    defense: 10,
    construction: 10,
    real_estate: 9,
    retail: 8,
    healthcare: 8,
    logistics: 7,
    agriculture: 5,
    financial: 3,
    telecommunications: 2,
    media_entertainment: 2,
    manufacturing: 1,
    technology: 1,
    automobiles: 1,
    chemical_industries: 1,
  },
  ND: {
    energy: 22,
    agriculture: 18,
    extraction: 10,
    construction: 9,
    real_estate: 9,
    retail: 8,
    healthcare: 8,
    financial: 6,
    logistics: 4,
    manufacturing: 2,
    defense: 1,
    telecommunications: 1,
    technology: 1,
    chemical_industries: 1,
    media_entertainment: 2,
    automobiles: 1,
  },
  NV: {
    media_entertainment: 26,
    real_estate: 18,
    retail: 10,
    construction: 9,
    financial: 8,
    healthcare: 7,
    logistics: 6,
    technology: 4,
    energy: 3,
    manufacturing: 2,
    agriculture: 2,
    telecommunications: 2,
    defense: 1,
    automobiles: 1,
    extraction: 1,
    chemical_industries: 1,
  },
  HI: {
    media_entertainment: 26,
    real_estate: 14,
    defense: 12,
    construction: 9,
    retail: 9,
    healthcare: 8,
    agriculture: 6,
    financial: 5,
    logistics: 5,
    telecommunications: 3,
    technology: 1,
    manufacturing: 1,
    energy: 1,
    chemical_industries: 1,
    automobiles: 1,
    extraction: 1,
  },
  LA: {
    energy: 18,
    chemical_industries: 14,
    real_estate: 10,
    healthcare: 9,
    manufacturing: 8,
    retail: 7,
    construction: 7,
    logistics: 7,
    extraction: 5,
    agriculture: 4,
    financial: 4,
    defense: 3,
    telecommunications: 2,
    media_entertainment: 2,
    technology: 1,
    automobiles: 1,
  },
  NC: {
    financial: 14,
    technology: 12,
    healthcare: 11,
    real_estate: 11,
    manufacturing: 10,
    retail: 8,
    construction: 7,
    logistics: 5,
    agriculture: 5,
    defense: 4,
    telecommunications: 4,
    chemical_industries: 3,
    energy: 2,
    media_entertainment: 3,
    automobiles: 1,
    extraction: 1,
  },
  SD: {
    financial: 18,
    agriculture: 16,
    real_estate: 11,
    healthcare: 10,
    retail: 9,
    construction: 8,
    manufacturing: 6,
    logistics: 5,
    energy: 4,
    technology: 3,
    defense: 3,
    telecommunications: 3,
    media_entertainment: 2,
    chemical_industries: 1,
    automobiles: 1,
    extraction: 1,
  },
  DC: {
    media_entertainment: 20,
    financial: 16,
    real_estate: 14,
    defense: 12,
    technology: 10,
    healthcare: 9,
    retail: 7,
    construction: 5,
    logistics: 4,
    telecommunications: 3,
    chemical_industries: 1,
    manufacturing: 1,
    energy: 1,
    agriculture: 1,
    automobiles: 1,
    extraction: 1,
  },
  // US additional state overrides
  AL: { manufacturing: 14, defense: 8, agriculture: 6, logistics: 6 },
  AR: { agriculture: 14, manufacturing: 9, retail: 8, logistics: 6 },
  AZ: { technology: 15, real_estate: 12, defense: 7, construction: 7 },
  CO: { technology: 15, energy: 8, defense: 7, real_estate: 11 },
  CT: { financial: 16, healthcare: 11, defense: 6, technology: 7 },
  DE: { financial: 17, chemical_industries: 12, logistics: 7, healthcare: 7 },
  GA: { logistics: 12, media_entertainment: 9, financial: 9, manufacturing: 8 },
  IA: { agriculture: 18, energy: 8, financial: 7, manufacturing: 7 },
  ID: { agriculture: 14, technology: 7, construction: 7, extraction: 5 },
  IN: { manufacturing: 16, automobiles: 10, logistics: 7, agriculture: 5 },
  KS: { agriculture: 15, manufacturing: 9, energy: 7, defense: 6 },
  KY: { manufacturing: 14, logistics: 9, automobiles: 7, agriculture: 5 },
  MD: { defense: 14, healthcare: 11, technology: 10, financial: 7 },
  ME: { agriculture: 12, healthcare: 10, energy: 5, logistics: 5 },
  MN: { healthcare: 12, financial: 10, agriculture: 8, technology: 8 },
  MO: { logistics: 10, agriculture: 8, manufacturing: 9, financial: 8 },
  MS: { agriculture: 13, manufacturing: 9, energy: 6, logistics: 6 },
  MT: { agriculture: 16, extraction: 10, energy: 7, logistics: 5 },
  NE: { agriculture: 17, financial: 8, logistics: 7, manufacturing: 6 },
  NH: { technology: 11, financial: 10, manufacturing: 7, healthcare: 8 },
  NJ: { chemical_industries: 12, financial: 11, logistics: 10, healthcare: 8 },
  NM: { energy: 13, defense: 11, extraction: 8, technology: 5 },
  OH: { manufacturing: 14, healthcare: 10, logistics: 8, energy: 6 },
  OK: { energy: 16, agriculture: 8, extraction: 8, construction: 7 },
  OR: { technology: 12, agriculture: 8, logistics: 7, manufacturing: 7 },
  PA: { healthcare: 13, manufacturing: 10, energy: 8, financial: 8, extraction: 4 },
  RI: { healthcare: 12, financial: 11, media_entertainment: 6, technology: 6 },
  SC: { manufacturing: 15, automobiles: 10, logistics: 8, agriculture: 5 },
  TN: { healthcare: 11, media_entertainment: 8, logistics: 8, automobiles: 6 },
  UT: { technology: 14, financial: 9, construction: 8, real_estate: 10 },
  VA: { defense: 14, technology: 10, financial: 9, logistics: 6 },
  VT: { agriculture: 13, healthcare: 9, energy: 5, retail: 7 },
  WI: { manufacturing: 14, agriculture: 9, healthcare: 9, automobiles: 4 },
  WY: { energy: 22, extraction: 18, agriculture: 6, logistics: 4 },

  // UK
  LON: {
    financial: 22,
    real_estate: 18,
    media_entertainment: 15,
    technology: 9,
    retail: 7,
    healthcare: 6,
    telecommunications: 5,
    construction: 5,
    logistics: 4,
    defense: 3,
    chemical_industries: 2,
    manufacturing: 2,
    energy: 1,
    agriculture: 1,
    automobiles: 1,
    extraction: 1,
  },
  SCO: {
    extraction: 14,
    energy: 13,
    real_estate: 11,
    financial: 10,
    manufacturing: 9,
    retail: 8,
    healthcare: 8,
    construction: 7,
    agriculture: 6,
    media_entertainment: 7,
    technology: 4,
    defense: 3,
    logistics: 3,
    telecommunications: 3,
    chemical_industries: 2,
    automobiles: 1,
  },
  // UK regional additions
  SEE: { technology: 12, financial: 10, real_estate: 13, defense: 6, healthcare: 8 },
  SWE: { technology: 10, defense: 8, agriculture: 6, media_entertainment: 6, logistics: 6 },
  EAE: { technology: 11, agriculture: 8, manufacturing: 9, logistics: 7, defense: 5 },
  EMI: { manufacturing: 14, logistics: 9, automobiles: 6, construction: 7 },
  WMI: { automobiles: 15, manufacturing: 14, logistics: 8, healthcare: 7 },
  YHU: { manufacturing: 12, logistics: 9, healthcare: 8, energy: 5 },
  NWE: { media_entertainment: 16, healthcare: 9, manufacturing: 9, financial: 8, technology: 8 },
  NEE: { energy: 12, extraction: 8, manufacturing: 11, chemical_industries: 7 },
  WAL: { manufacturing: 10, energy: 9, agriculture: 7, logistics: 6 },
  NIR: { agriculture: 16, manufacturing: 8, logistics: 7, healthcare: 8 },

  BY: {
    automobiles: 18,
    manufacturing: 14,
    technology: 12,
    chemical_industries: 10,
    real_estate: 9,
    financial: 7,
    healthcare: 6,
    construction: 6,
    retail: 5,
    logistics: 4,
    energy: 3,
    agriculture: 2,
    defense: 1,
    media_entertainment: 2,
    telecommunications: 1,
    extraction: 1,
  },
  BE: {
    technology: 16,
    media_entertainment: 21,
    real_estate: 12,
    financial: 9,
    healthcare: 8,
    construction: 7,
    retail: 6,
    logistics: 5,
    telecommunications: 4,
    manufacturing: 4,
    defense: 3,
    chemical_industries: 2,
    energy: 1,
    agriculture: 1,
    automobiles: 1,
    extraction: 1,
  },
  // Germany
  BW: { automobiles: 16, manufacturing: 15, technology: 12, chemical_industries: 10 },
  NW: { manufacturing: 15, chemical_industries: 11, logistics: 8, energy: 7, financial: 8 },
  HE: { financial: 16, logistics: 10, technology: 9, healthcare: 7 },
  RP: { chemical_industries: 13, manufacturing: 11, logistics: 7, agriculture: 4 },
  SL: { automobiles: 15, manufacturing: 14, energy: 7, extraction: 3 },
  NI: { automobiles: 10, manufacturing: 11, agriculture: 8, energy: 8, logistics: 7 },
  SH: { energy: 15, logistics: 10, agriculture: 6 },
  HH: { logistics: 16, media_entertainment: 10, financial: 10, technology: 8 },
  BRE: { logistics: 14, automobiles: 10, manufacturing: 9, defense: 5 },
  BB: { energy: 12, agriculture: 8, logistics: 6, manufacturing: 6 },
  MV: { agriculture: 10, energy: 8, logistics: 6, media_entertainment: 5 },
  SN: { technology: 12, manufacturing: 13, automobiles: 8, chemical_industries: 7 },
  ST: { chemical_industries: 12, energy: 9, agriculture: 7, manufacturing: 9 },
  TH: { manufacturing: 12, technology: 9, automobiles: 8, healthcare: 7 },

  // Japan
  KAN: {
    financial: 16,
    technology: 14,
    real_estate: 12,
    retail: 9,
    media_entertainment: 13,
    manufacturing: 7,
    healthcare: 7,
    construction: 6,
    logistics: 4,
    telecommunications: 4,
    chemical_industries: 3,
    automobiles: 2,
    defense: 1,
    energy: 1,
    agriculture: 1,
    extraction: 1,
  },
  CGK: {
    automobiles: 18,
    manufacturing: 16,
    technology: 10,
    real_estate: 10,
    chemical_industries: 9,
    financial: 7,
    logistics: 7,
    healthcare: 6,
    retail: 5,
    construction: 4,
    energy: 3,
    agriculture: 2,
    defense: 1,
    telecommunications: 1,
    media_entertainment: 2,
    extraction: 1,
  },
  HOK: { agriculture: 16, energy: 10, healthcare: 8, media_entertainment: 5 },
  TOH: { manufacturing: 11, energy: 8, agriculture: 8, technology: 7 },
  CHU: { automobiles: 18, manufacturing: 15, technology: 10, energy: 5 },
  KNS: { manufacturing: 11, technology: 10, financial: 10, healthcare: 8, real_estate: 10 },
  SHI: { agriculture: 9, chemical_industries: 8, energy: 6, manufacturing: 8 },
  KYU: {
    automobiles: 12,
    manufacturing: 12,
    technology: 9,
    agriculture: 6,
    energy: 6,
    chemical_industries: 7,
  },

  // China — keys are countryId-prefixed because CN macro-region codes (HB,
  // HD, etc.) collide with German Bundesländer (DE HB = Bremen). The lookup
  // function tries the compound key first, then falls back to the bare key.
  "CN:DB": { manufacturing: 17, energy: 10, extraction: 8, agriculture: 6 },
  "CN:HB": { financial: 13, technology: 13, media_entertainment: 5, defense: 5, energy: 8 },
  "CN:HD": {
    technology: 14,
    manufacturing: 16,
    financial: 10,
    logistics: 8,
    chemical_industries: 7,
  },
  "CN:HZ": { manufacturing: 17, agriculture: 7, logistics: 7, construction: 8, automobiles: 5 },
  "CN:HN": { technology: 15, manufacturing: 16, logistics: 9, retail: 8, telecommunications: 5 },
  "CN:XN": { energy: 10, agriculture: 7, construction: 8, extraction: 7, technology: 8 },
  "CN:XB": { energy: 15, extraction: 12, agriculture: 8, defense: 5, chemical_industries: 6 },

  // Ireland
  DUB: { technology: 24, financial: 18, media_entertainment: 5, real_estate: 11, logistics: 7 },
  KIL: { construction: 14, real_estate: 16, logistics: 8, technology: 6 },
  MID: { agriculture: 9, energy: 5, construction: 9, healthcare: 9 },
  WEX: { manufacturing: 9, agriculture: 7, logistics: 7, retail: 7 },
  LIM: { chemical_industries: 15, technology: 10, manufacturing: 9, logistics: 7 },
  COR: { chemical_industries: 24, technology: 13, manufacturing: 10, healthcare: 8 },
  GAL: { chemical_industries: 16, manufacturing: 10, technology: 11, healthcare: 9 },
  DON: { agriculture: 10, manufacturing: 7, logistics: 7, healthcare: 9 },

  // Brazil
  NORTE: { extraction: 18, energy: 12, agriculture: 12, logistics: 6, manufacturing: 6 },
  NORDESTE: { energy: 14, agriculture: 9, retail: 8, manufacturing: 8, media_entertainment: 5 },
  CENTRO_OESTE: { agriculture: 24, logistics: 10, energy: 8, extraction: 7 },
  SUDESTE: {
    financial: 13,
    manufacturing: 13,
    automobiles: 8,
    chemical_industries: 8,
    technology: 6,
    logistics: 7,
  },
  SUL: { agriculture: 14, manufacturing: 12, automobiles: 8, chemical_industries: 7, logistics: 7 },
};

export function getStateSectorWeights(
  stateId: string,
  countryId: CountryId,
  preset: string
): Record<CorporationType, number> {
  if (preset === "1953-default") {
    // 1953-era weights: peak manufacturing (~26% GDP), Korean War defense
    // (~14% GDP), Big Three auto dominance, zero tech/telecom. The country-level
    // baseline is bent by era-correct per-state specialties
    // (STATE_SECTOR_WEIGHT_OVERRIDES_1953) where authored; countries without a
    // 1953 bundle fall back to an even split.
    const countryRaw = getCountrySectorRaw1953(countryId);
    const stateRaw =
      STATE_SECTOR_WEIGHT_OVERRIDES_1953[`${countryId}:${stateId}`] ??
      STATE_SECTOR_WEIGHT_OVERRIDES_1953[stateId];
    if (!stateRaw && Object.keys(countryRaw).length === 0) {
      return getCountrySectorWeights1953(countryId);
    }
    const raw = stateRaw ? mergeStateOverride(countryRaw, stateRaw) : countryRaw;
    return normalise(raw);
  }
  if (preset === "1979-default") {
    // 1979-era weights: peak manufacturing, energy crisis, rising defense, low
    // tech/finance. State-level overrides aren't authored separately for 1979, so
    // the country-level 1979 bundle applies uniformly.
    return getCountrySectorWeights1979(countryId);
  }
  if (preset === "1991-default") {
    // 1991-era weights: state-level overrides aren't authored separately for
    // 1991, so the country-level 1991 bundle applies uniformly. State-level
    // 1991 specialization can be added in `STATE_SECTOR_WEIGHT_OVERRIDES_1991`
    // later if regional fidelity becomes important.
    return getCountrySectorWeights1991(countryId);
  }
  if (preset === "1999-default") {
    // 1999-era weights: manufacturing/telecom/auto up (dot-com + telecom boom,
    // pre-China-WTO), defense and energy low. US only; other countries fall back
    // to even distribution until authored.
    return getCountrySectorWeights1999(countryId);
  }
  if (preset === "2007-default") {
    // 2007-era weights: real-estate/finance/manufacturing/auto up (housing-bubble
    // peak, pre-crash, pre-offshoring-acceleration), technology down vs 2019.
    // US only; other countries fall back to even distribution until authored.
    return getCountrySectorWeights2007(countryId);
  }
  if (preset === "2023-default") {
    // 2023-era weights: technology/healthcare up, manufacturing down vs 2019.
    // US only; other countries fall back to even distribution until authored.
    return getCountrySectorWeights2023(countryId);
  }
  if (preset === "2027-default") {
    return getCountrySectorWeights2027(countryId);
  }
  const countryRaw = COUNTRY_SECTOR_WEIGHTS[countryId] ?? COUNTRY_SECTOR_WEIGHTS.US;
  // Try countryId-prefixed key first (used where state IDs collide across
  // countries, e.g. CN HB vs DE HB) and fall back to the bare key for the
  // common no-collision case.
  const stateRaw =
    STATE_SECTOR_WEIGHT_OVERRIDES[`${countryId}:${stateId}`] ??
    STATE_SECTOR_WEIGHT_OVERRIDES[stateId];
  const raw = stateRaw ? mergeStateOverride(countryRaw, stateRaw) : countryRaw;
  return normalise(raw);
}
