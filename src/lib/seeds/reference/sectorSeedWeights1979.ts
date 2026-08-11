/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's seed data. All values are authored for 1979 directly.
 * Type-only imports are allowed.
 */

/**
 * 1979-era national sector weights for all 15 player/ECON countries.
 *
 * Relative percentage-of-GDP allocations across the 17 game sectors, calibrated
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

type SectorWeightMap = Partial<Record<CorporationType, number>>;

export const COUNTRY_SECTOR_WEIGHTS_1979: Record<string, SectorWeightMap> = {
  US: {
    manufacturing: 18,
    real_estate: 10,
    retail: 8,
    automobiles: 8,
    energy: 7,
    agriculture: 6,
    construction: 6,
    healthcare: 5,
    financial: 5,
    chemical_industries: 5,
    defense: 5,
    extraction: 4,
    logistics: 4,
    telecommunications: 3,
    technology: 2,
    media: 2,
    entertainment: 2,
  },
  // UK: de-industrialization beginning but manufacturing dominant (Sheffield steel,
  // Midlands autos, Rolls-Royce, ICI). Coal/NUM large. North Sea oil. Pre-Big-Bang
  // financial. Thatcher elected May 1979.
  UK: {
    manufacturing: 22,
    energy: 9,
    retail: 9,
    real_estate: 8,
    construction: 7,
    chemical_industries: 6,
    extraction: 6,
    agriculture: 5,
    defense: 5,
    healthcare: 4,
    financial: 4,
    automobiles: 4,
    logistics: 4,
    telecommunications: 3,
    technology: 1,
    media: 2,
    entertainment: 1,
  },
  // DE: manufacturing PEAK (VW/BMW/Mercedes; BASF/Hoechst/Bayer; Siemens/Thyssen).
  // Schmidt/FDP coalition. Export-led. Pre-Frankfurt financial expansion.
  DE: {
    manufacturing: 28,
    automobiles: 10,
    chemical_industries: 8,
    energy: 7,
    construction: 7,
    real_estate: 6,
    retail: 7,
    agriculture: 5,
    defense: 5,
    financial: 3,
    logistics: 4,
    healthcare: 3,
    extraction: 2,
    telecommunications: 2,
    technology: 1,
    media: 1,
    entertainment: 1,
  },
  // JP: manufacturing PEAK (Sony/Toyota/Honda; steel/shipbuilding; electronics for
  // export). MITI-directed economy. Low financial (protected banking). No real estate
  // bubble yet (comes 1986-89).
  JP: {
    manufacturing: 30,
    automobiles: 12,
    technology: 5,
    chemical_industries: 6,
    energy: 5,
    retail: 6,
    real_estate: 5,
    construction: 6,
    agriculture: 4,
    defense: 1,
    healthcare: 3,
    logistics: 5,
    financial: 3,
    telecommunications: 2,
    extraction: 1,
    media: 2,
    entertainment: 4,
  },
  // FR: large nationalised sector (steel/coal/PSA/Renault). Giscard d'Estaing.
  // High agriculture (CAP subsidies). Minitel telecom project beginning.
  FR: {
    manufacturing: 22,
    agriculture: 6,
    chemical_industries: 7,
    energy: 8,
    retail: 8,
    real_estate: 8,
    construction: 7,
    automobiles: 6,
    defense: 5,
    financial: 4,
    healthcare: 4,
    extraction: 2,
    logistics: 4,
    telecommunications: 3,
    technology: 1,
    media: 3,
    entertainment: 2,
  },
  // IT: manufacturing (textiles/fashion/ceramics/Fiat); North-South divide; large
  // state sector (ENI/IRI). High retail (family businesses). Tourism/media growing.
  IT: {
    manufacturing: 22,
    retail: 10,
    agriculture: 6,
    construction: 8,
    chemical_industries: 5,
    energy: 6,
    automobiles: 6,
    real_estate: 7,
    healthcare: 4,
    defense: 3,
    financial: 3,
    logistics: 4,
    telecommunications: 2,
    extraction: 2,
    technology: 1,
    media: 5,
    entertainment: 6,
  },
  // ES: post-Franco industrialisation (steel/SEAT/chemical); large tourism; major
  // agriculture. Suárez UCD transition government. Banking reform beginning.
  ES: {
    manufacturing: 18,
    agriculture: 10,
    retail: 9,
    construction: 8,
    energy: 7,
    real_estate: 7,
    automobiles: 5,
    chemical_industries: 5,
    entertainment: 7,
    financial: 3,
    healthcare: 3,
    defense: 3,
    extraction: 4,
    logistics: 4,
    telecommunications: 2,
    technology: 1,
    media: 3,
  },
  // SE: Swedish model at peak (Volvo/SAAB/Ericsson/SKF/ASEA); large public healthcare.
  // Fälldin Centre coalition. Low financial (banking crisis came later — 1990s).
  SE: {
    manufacturing: 20,
    healthcare: 10,
    energy: 7,
    retail: 8,
    construction: 7,
    automobiles: 6,
    chemical_industries: 5,
    defense: 4,
    real_estate: 5,
    financial: 4,
    agriculture: 4,
    logistics: 5,
    telecommunications: 4,
    technology: 3,
    media: 4,
    entertainment: 2,
    extraction: 2,
  },
  // TR: large agriculture (cotton/grain/tobacco); growing manufacturing (textiles/steel);
  // construction boom; Ecevit/Demirel political instability pre-1980 coup.
  TR: {
    agriculture: 22,
    manufacturing: 15,
    construction: 10,
    retail: 10,
    energy: 8,
    extraction: 4,
    real_estate: 6,
    healthcare: 4,
    defense: 5,
    chemical_industries: 4,
    automobiles: 3,
    financial: 3,
    logistics: 4,
    telecommunications: 2,
    technology: 1,
    media: 2,
    entertainment: 3,
  },
  // CN: command economy — heavy steel/coal/chemical; agriculture dominant (rural ~80%);
  // defence-industrial complex. Deng Xiaoping Four Modernisations (1978) just beginning.
  // No financial sector, no real estate market.
  CN: {
    agriculture: 30,
    manufacturing: 22,
    extraction: 10,
    energy: 8,
    construction: 7,
    defense: 8,
    chemical_industries: 5,
    logistics: 4,
    retail: 3,
    healthcare: 2,
    telecommunications: 1,
    technology: 0,
    financial: 0,
    real_estate: 0,
    automobiles: 0,
    media: 0,
    entertainment: 0,
  },
  // BR: import substitution industrialisation (steel/chemical/auto); Petrobras dominant;
  // large agriculture (soy/coffee/sugar). Figueiredo military government. Uneven development.
  BR: {
    manufacturing: 18,
    agriculture: 16,
    energy: 10,
    extraction: 8,
    construction: 8,
    retail: 7,
    real_estate: 6,
    chemical_industries: 5,
    automobiles: 5,
    healthcare: 3,
    financial: 4,
    defense: 3,
    logistics: 4,
    telecommunications: 2,
    technology: 1,
    media: 2,
    entertainment: 2,
  },
  // IE: agriculture/agri-food dominant; manufacturing small (UK-owned branches);
  // tiny financial sector (IFSC came 1987). Lynch/FF. Low tax FDI attraction beginning.
  IE: {
    agriculture: 25,
    retail: 12,
    manufacturing: 12,
    construction: 10,
    real_estate: 8,
    energy: 7,
    chemical_industries: 5,
    healthcare: 5,
    financial: 4,
    defense: 2,
    automobiles: 2,
    extraction: 2,
    logistics: 4,
    telecommunications: 2,
    technology: 1,
    media: 3,
    entertainment: 4,
  },
  // NG: oil extraction completely dominant; Obasanjo military → civilian transition 1979.
  // Petrodollar construction boom. Manufacturing near-absent.
  NG: {
    extraction: 40,
    energy: 15,
    construction: 12,
    agriculture: 10,
    retail: 7,
    manufacturing: 5,
    real_estate: 4,
    healthcare: 2,
    financial: 2,
    defense: 3,
    logistics: 4,
    telecommunications: 1,
    technology: 0,
    automobiles: 1,
    chemical_industries: 1,
    media: 1,
    entertainment: 2,
  },
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
    media: 0,
    entertainment: 1,
  },
  // DD: GDR Kombinat system — chemical (Leuna), machinery, textiles, brown coal
  // (lignite). Honecker hard-line communist. No financial market, no real estate.
  DD: {
    manufacturing: 25,
    chemical_industries: 15,
    extraction: 12,
    energy: 10,
    agriculture: 10,
    defense: 10,
    construction: 7,
    healthcare: 4,
    retail: 3,
    logistics: 4,
    telecommunications: 1,
    technology: 1,
    automobiles: 1,
    real_estate: 0,
    financial: 0,
    media: 1,
    entertainment: 1,
  },

  // ───────────────────────────────────────────────────────────────────────────
  //  WARSAW-PACT SATELLITES — 1979
  //
  //  These eight were previously ABSENT from this map entirely. On a miss
  //  `getCountrySectorWeights1979` returns an even 1/N across all 17 sectors,
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
  PL: {
    manufacturing: 24,
    extraction: 14, // Silesian coal; Legnica copper now mature
    agriculture: 12, // still the least collectivised in the bloc — private farms
    defense: 10,
    chemical_industries: 8,
    energy: 7,
    construction: 7,
    logistics: 5,
    healthcare: 4,
    retail: 3,
    automobiles: 2, // FSO Polonez, Fiat 126p licence build
    telecommunications: 1,
    media: 1,
    entertainment: 1,
    financial: 1,
    real_estate: 0,
    technology: 0,
  },

  // Kádár's Hungary: the New Economic Mechanism has given it the bloc's most
  // consumer-facing economy — "goulash communism", a real retail sector, Ikarus
  // buses exported across the bloc, and mature pharmaceuticals.
  HU: {
    manufacturing: 24,
    agriculture: 14, // household plots genuinely productive under the NEM
    chemical_industries: 10, // Richter Gedeon, BorsodChem
    defense: 8,
    extraction: 6, // bauxite declining
    energy: 6,
    construction: 7,
    logistics: 5,
    healthcare: 5,
    retail: 5, // the most developed consumer retail in the bloc
    automobiles: 3, // Ikarus
    telecommunications: 2,
    media: 2,
    entertainment: 2,
    financial: 1,
    real_estate: 0,
    technology: 0,
  },

  // Ceaușescu's Romania: forced heavy industry and petrochemicals, financed by
  // the Western debt he begins repaying through the 1980s austerity.
  RO: {
    manufacturing: 24,
    agriculture: 18, // still the most agrarian pact member
    extraction: 10, // Ploiești oil past peak but significant
    chemical_industries: 10, // petrochemical build-out
    energy: 7,
    defense: 9, // large army; the most autonomous pact military
    construction: 7,
    logistics: 4,
    healthcare: 4,
    retail: 2,
    automobiles: 2, // Dacia
    telecommunications: 1,
    media: 1,
    entertainment: 1,
    financial: 0,
    real_estate: 0,
    technology: 0,
  },

  // Zhivkov's Bulgaria: the bloc's agricultural and electronics specialist under
  // CMEA division of labour — it built computers for the whole Comecon market.
  BG: {
    manufacturing: 22,
    agriculture: 18, // wine, tobacco, canned goods for the bloc
    chemical_industries: 9,
    energy: 8, // Kozloduy nuclear
    extraction: 6,
    defense: 8,
    construction: 7,
    logistics: 5,
    healthcare: 4,
    retail: 3,
    technology: 3, // Pravetz computers — the CMEA's electronics assignment
    telecommunications: 2,
    automobiles: 1,
    media: 1,
    entertainment: 2,
    financial: 1,
    real_estate: 0,
  },

  // Husák's normalised Czechoslovakia: still the bloc's most industrial economy,
  // Škoda and the Slovak arms plants, but visibly stagnating after 1968.
  CS: {
    manufacturing: 30, // the most industrial economy in the pact
    chemical_industries: 10,
    defense: 10, // Slovak arms industry exported bloc-wide
    energy: 7,
    extraction: 7, // Ostrava coal, uranium
    agriculture: 9,
    construction: 7,
    logistics: 5,
    healthcare: 4,
    retail: 3,
    automobiles: 3, // Škoda, Tatra
    telecommunications: 1,
    media: 1,
    entertainment: 2,
    financial: 1,
    real_estate: 0,
    technology: 0,
  },

  // Tito's Yugoslavia — non-aligned, self-managed, and the only seeded socialist
  // economy with genuine tourism, retail and a banking sector, because it traded
  // with the West throughout. Also the highest inflation in the region.
  YU: {
    manufacturing: 22,
    agriculture: 14, // never collectivised after 1953
    construction: 9, // the famous export construction industry
    energy: 7,
    extraction: 7,
    chemical_industries: 7,
    defense: 8, // Total National Defence doctrine; large domestic arms industry
    logistics: 5,
    retail: 5,
    healthcare: 4,
    entertainment: 5, // Adriatic tourism — unique in socialist Europe
    financial: 3, // real banks, Western credit lines
    automobiles: 2, // Zastava
    telecommunications: 1,
    media: 1,
    real_estate: 0,
    technology: 0,
  },

  // Byelorussian SSR: the USSR's machine-building and petrochemical assembly
  // shop — MAZ/BelAZ trucks, MTZ tractors, the Polatsk and Mazyr refineries.
  // Ukraine, 1979. The union's industrial second centre, and past its peak: the
  // Donbas seams are deep and dear, the metallurgical plant is ageing, and the
  // republic's growth has flattened while its share of union output stays huge.
  // Agriculture is far smaller than in 1953 in employment terms but still the
  // union's granary.
  UKR: {
    manufacturing: 27, // steel, heavy machinery, shipbuilding at Mykolaiv
    agriculture: 14, // mechanised, still the union's grain and sugar surplus
    extraction: 10, // Donbas coal past peak; Kryvyi Rih ore
    energy: 9, // thermal + the first Ukrainian reactors coming online
    chemical_industries: 8,
    defense: 9, // Kyiv and Odesa military districts; Pivdenmash missiles
    construction: 7,
    logistics: 5, // Odesa, the Dnieper, the export rail corridors
    healthcare: 4,
    retail: 3,
    technology: 1, // Paton institute welding; Kyiv cybernetics
    automobiles: 1, // ZAZ Zaporozhets; LAZ buses
    telecommunications: 1,
    media: 1,
    entertainment: 1,
    financial: 0,
    real_estate: 0,
  },

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
    media: 1,
    entertainment: 0,
    financial: 0,
    real_estate: 0,
    technology: 0,
  },

  // Baltic SSRs: the most developed and most consumer-oriented corner of the
  // USSR — VEF and RAF in Riga, Estonian oil shale power, the Klaipėda port.
  BAL: {
    manufacturing: 26,
    agriculture: 13, // the USSR's most productive farming
    energy: 9, // Estonian oil shale
    chemical_industries: 8,
    defense: 8,
    construction: 7,
    logistics: 6, // Baltic ports
    healthcare: 5,
    retail: 4, // the best-supplied shops in the Union
    extraction: 4, // oil shale
    technology: 3, // VEF electronics
    telecommunications: 2,
    entertainment: 2,
    media: 1,
    automobiles: 2, // RAF minibuses
    financial: 0,
    real_estate: 0,
  },
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
