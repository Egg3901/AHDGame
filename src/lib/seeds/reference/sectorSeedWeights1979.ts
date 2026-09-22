/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's seed data. All values are authored for 1979 directly.
 * Type-only imports are allowed.
 */

/**
 * 1979-era national sector weights for all 15 player/ECON countries.
 *
 * Relative percentage-of-GDP allocations across the 16 game sectors, calibrated
 * to ~1979 historical value-added shares. Era characteristics:
 *   - Manufacturing HIGH for industrialized countries (peak before de-industrialization)
 *   - Technology/Telecommunications VERY LOW (pre-PC, pre-mobile, PTT monopolies)
 *   - Financial LOW (pre-Big-Bang, Reg-Q, Glass-Steagall limits)
 *   - Real estate LOWER than post-2000 (high interest rates suppress values)
 *   - Energy HIGH (1979 oil shock — energy companies at peak nominal value)
 *   - Command economies (SU/CN/DD): zero financial/real_estate; defense/extraction dominant
 * All weights are normalised at read time, so only relative magnitudes matter.
 */

import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import { JP_ECONOMY } from "@/lib/countries/jp/economy";
import { US_ECONOMY } from "@/lib/countries/us/economy";
import { UK_ECONOMY } from "@/lib/countries/uk/economy";
import { DE_ECONOMY } from "@/lib/countries/de/economy";
import { CN_ECONOMY } from "@/lib/countries/cn/economy";
import { IE_ECONOMY } from "@/lib/countries/ie/economy";
import { DD_ECONOMY } from "@/lib/countries/dd/economy";
import { NG_ECONOMY } from "@/lib/countries/ng/economy";
import { BR_ECONOMY } from "@/lib/countries/br/economy";
import { FR_ECONOMY } from "@/lib/countries/fr/economy";
import { IT_ECONOMY } from "@/lib/countries/it/economy";
import { ES_ECONOMY } from "@/lib/countries/es/economy";
import { SE_ECONOMY } from "@/lib/countries/se/economy";
import { TR_ECONOMY } from "@/lib/countries/tr/economy";
import { PL_ECONOMY } from "@/lib/countries/pl/economy";
import { HU_ECONOMY } from "@/lib/countries/hu/economy";
import { RO_ECONOMY } from "@/lib/countries/ro/economy";
import { YU_ECONOMY } from "@/lib/countries/yu/economy";
import { BG_ECONOMY } from "@/lib/countries/bg/economy";
import { CS_ECONOMY } from "@/lib/countries/cs/economy";
import { UKR_ECONOMY } from "@/lib/countries/ukr/economy";
import { BAL_ECONOMY } from "@/lib/countries/bal/economy";

type SectorWeightMap = Partial<Record<CorporationType, number>>;

export const COUNTRY_SECTOR_WEIGHTS_1979: Record<string, SectorWeightMap> = {
  US: US_ECONOMY.sectorWeights.byEra["1979"],
  // UK: de-industrialization beginning but manufacturing dominant (Sheffield steel,
  // Midlands autos, Rolls-Royce, ICI). Coal/NUM large. North Sea oil. Pre-Big-Bang
  // financial. Thatcher elected May 1979.
  UK: UK_ECONOMY.sectorWeights.byEra["1979"],
  // DE: manufacturing PEAK (VW/BMW/Mercedes; BASF/Hoechst/Bayer; Siemens/Thyssen).
  // Schmidt/FDP coalition. Export-led. Pre-Frankfurt financial expansion.
  DE: DE_ECONOMY.sectorWeights.byEra["1979"],
  // JP: manufacturing PEAK (Sony/Toyota/Honda; steel/shipbuilding; electronics for
  // export). MITI-directed economy. Low financial (protected banking). No real estate
  // bubble yet (comes 1986-89).
  JP: JP_ECONOMY.sectorWeights.byEra["1979"],
  // FR: large nationalised sector (steel/coal/PSA/Renault). Giscard d'Estaing.
  // High agriculture (CAP subsidies). Minitel telecom project beginning.
  FR: FR_ECONOMY.sectorWeights.byEra["1979"],
  // IT: manufacturing (textiles/fashion/ceramics/Fiat); North-South divide; large
  // state sector (ENI/IRI). High retail (family businesses). Tourism/media growing.
  IT: IT_ECONOMY.sectorWeights.byEra["1979"],
  // ES: post-Franco industrialisation (steel/SEAT/chemical); large tourism; major
  // agriculture. Suárez UCD transition government. Banking reform beginning.
  ES: ES_ECONOMY.sectorWeights.byEra["1979"],
  // SE: Swedish model at peak (Volvo/SAAB/Ericsson/SKF/ASEA); large public healthcare.
  // Fälldin Centre coalition. Low financial (banking crisis came later — 1990s).
  SE: SE_ECONOMY.sectorWeights.byEra["1979"],
  // TR: large agriculture (cotton/grain/tobacco); growing manufacturing (textiles/steel);
  // construction boom; Ecevit/Demirel political instability pre-1980 coup.
  TR: TR_ECONOMY.sectorWeights.byEra["1979"],
  // CN: command economy — heavy steel/coal/chemical; agriculture dominant (rural ~80%);
  // defence-industrial complex. Deng Xiaoping Four Modernisations (1978) just beginning.
  // No financial sector, no real estate market.
  CN: CN_ECONOMY.sectorWeights.byEra["1979"],
  // BR: import substitution industrialisation (steel/chemical/auto); Petrobras dominant;
  // large agriculture (soy/coffee/sugar). Figueiredo military government. Uneven development.
  BR: BR_ECONOMY.sectorWeights.byEra["1979"],
  // IE: agriculture/agri-food dominant; manufacturing small (UK-owned branches);
  // tiny financial sector (IFSC came 1987). Lynch/FF. Low tax FDI attraction beginning.
  IE: IE_ECONOMY.sectorWeights.byEra["1979"],
  // NG: oil extraction completely dominant; Obasanjo military → civilian transition 1979.
  // Petrodollar construction boom. Manufacturing near-absent.
  NG: NG_ECONOMY.sectorWeights.byEra["1979"],
  // SU: command economy — heavy industry, energy export (Siberian oil+gas at peak),
  // collective agriculture, defence-industrial complex dominant. Brezhnev stagnation.
  SU: {
    manufacturing: 20,
    energy: 15,
    defense: 15,
    extraction: 12,
    agriculture: 12,
    construction: 8,
    chemical_industries: 7,
    logistics: 5,
    healthcare: 2,
    telecommunications: 1,
    retail: 2,
    real_estate: 0,
    financial: 0,
    automobiles: 0,
    technology: 0,
    media_entertainment: 1,
  },
  // DD: GDR Kombinat system — chemical (Leuna), machinery, textiles, brown coal
  // (lignite). Honecker hard-line communist. No financial market, no real estate.
  DD: DD_ECONOMY.sectorWeights.byEra["1979"],

  // ───────────────────────────────────────────────────────────────────────────
  //  WARSAW-PACT SATELLITES — 1979
  //
  //  These eight were previously ABSENT from this map entirely. On a miss
  //  `getCountrySectorWeights1979` returns an even 1/N across all 16 sectors,
  //  so a 1979 Poland got a perfectly flat economy — no Silesian coal, no
  //  shipyards, and technology/media/financial weighted the same as heavy
  //  manufacturing. The 1953 bundle has all eight; only 1979 was missing them.
  //
  //  Common shape vs 1953: agriculture roughly halved by two decades of
  //  collectivisation and industrial migration, manufacturing and chemicals up,
  //  and a real (if small) consumer, telecom and services tail — but still no
  //  financial or real-estate market anywhere in the bloc.
  // ───────────────────────────────────────────────────────────────────────────

  // Gierek's Poland: Western-credit-financed industrial expansion, Silesian coal
  // still the export earner, the Gdańsk/Gdynia yards a year from Solidarity.
  PL: PL_ECONOMY.sectorWeights.byEra["1979"],

  // Kádár's Hungary: the New Economic Mechanism has given it the bloc's most
  // consumer-facing economy — "goulash communism", a real retail sector, Ikarus
  // buses exported across the bloc, and mature pharmaceuticals.
  HU: HU_ECONOMY.sectorWeights.byEra["1979"],

  // Ceaușescu's Romania: forced heavy industry and petrochemicals, financed by
  // the Western debt he begins repaying through the 1980s austerity.
  RO: RO_ECONOMY.sectorWeights.byEra["1979"],

  // Zhivkov's Bulgaria: the bloc's agricultural and electronics specialist under
  // CMEA division of labour — it built computers for the whole Comecon market.
  BG: BG_ECONOMY.sectorWeights.byEra["1979"],

  // Husák's normalised Czechoslovakia: still the bloc's most industrial economy,
  // Škoda and the Slovak arms plants, but visibly stagnating after 1968.
  CS: CS_ECONOMY.sectorWeights.byEra["1979"],

  // Tito's Yugoslavia — non-aligned, self-managed, and the only seeded socialist
  // economy with genuine tourism, retail and a banking sector, because it traded
  // with the West throughout. Also the highest inflation in the region.
  YU: YU_ECONOMY.sectorWeights.byEra["1979"],

  // Byelorussian SSR: the USSR's machine-building and petrochemical assembly
  // shop — MAZ/BelAZ trucks, MTZ tractors, the Polatsk and Mazyr refineries.
  // Ukraine, 1979. The union's industrial second centre, and past its peak: the
  // Donbas seams are deep and dear, the metallurgical plant is ageing, and the
  // republic's growth has flattened while its share of union output stays huge.
  // Agriculture is far smaller than in 1953 in employment terms but still the
  // union's granary.
  UKR: UKR_ECONOMY.sectorWeights.byEra["1979"],

  BY: {
    manufacturing: 30,
    chemical_industries: 12, // Polatsk/Mazyr refining; Salihorsk potash
    agriculture: 14,
    energy: 7,
    defense: 10, // forward Soviet military district
    extraction: 6, // potash
    construction: 7,
    logistics: 5, // the western transit corridor
    healthcare: 4,
    retail: 2,
    automobiles: 1,
    telecommunications: 1,
    media_entertainment: 1,
    financial: 0,
    real_estate: 0,
    technology: 0,
  },

  // Baltic SSRs: the most developed and most consumer-oriented corner of the
  // USSR — VEF and RAF in Riga, Estonian oil shale power, the Klaipėda port.
  BAL: BAL_ECONOMY.sectorWeights.byEra["1979"],
};

/**
 * Runtime countryId -> 1979 national-bundle key. Two Soviet republics play under
 * a different CountryId than the key their authored bundle lives under: the USSR
 * plays as "RU" (bundle "SU") and Byelorussia as "BLR" (bundle "BY"). Ukraine
 * needs no alias: its bundle is authored under its own id "UKR". Mirrors
 * `BUNDLE_KEY_ALIASES_1953`.
 *
 * Without this the USSR — the largest economy in the 1979 world — missed its own
 * bundle and fell through to the even 1/N split below, seeding a Soviet economy
 * with no manufacturing or defense weighting at all.
 */
const BUNDLE_KEY_ALIASES_1979: Record<string, string> = { RU: "SU", BLR: "BY" };

/**
 * Returns the 1979 country-level sector weight map.
 * Used by `getStateSectorWeights` when the active preset is `1979-default`.
 */
export function getCountrySectorWeights1979(countryId: CountryId): Record<CorporationType, number> {
  const key = BUNDLE_KEY_ALIASES_1979[countryId as string] ?? (countryId as string);
  const raw = COUNTRY_SECTOR_WEIGHTS_1979[key] ?? {};
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
