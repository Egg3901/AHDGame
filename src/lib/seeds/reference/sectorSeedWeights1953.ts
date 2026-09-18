/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's seed data. All values are authored for 1953 directly.
 * Type-only imports are allowed.
 *
 * ⚠ THE `JP_SECTOR_WEIGHTS_1953` VALUE IMPORT BELOW DOES NOT BREAK THIS.
 * The rule forbids deriving 1953 from ANOTHER ERA. That module holds Japan's
 * 1953 weights, authored for 1953, and this file forwards to them unchanged --
 * the data moved into Japan's country folder, it was not transformed from 1979.
 * An import of `jpSectorWeights1979` here would be the violation.
 */

/**
 * 1953-era national sector weights, US only.
 *
 * Relative percentage-of-GDP allocations across the 17 game sectors, calibrated
 * to ~1953 BEA value-added shares — a *peak-manufacturing, defense-dominant,
 * pre-service-economy* era. Relative to the 1979 and later bundles:
 *   - manufacturing at its absolute PEAK (~25-30% of GDP; WWII-built capacity
 *     running at full tilt; autos, steel, chemicals, rubber all dominant)
 *   - defense VERY HIGH (~14% of GDP; Korean War + NATO nuclear buildup; the
 *     largest peacetime defense share in US history)
 *   - automobiles VERY HIGH (Big Three: GM/Ford/Chrysler have ~100% of US market;
 *     no Japanese/European competition; GI Bill + suburbs driving sales)
 *   - agriculture high (~8% of GDP; farm sector still ~15% of labor force)
 *   - energy high (coal ~51% of primary energy; oil/gas growing; no nuclear yet)
 *   - chemical_industries elevated (DuPont-era; postwar plastics/synthetic rubber boom)
 *   - construction elevated (Levittown suburban boom; GI Bill mortgages)
 *   - technology NEAR ZERO (ENIAC-era; no commercial computers; no silicon)
 *   - telecommunications LOW (AT&T monopoly; all landlines; no TV advertising scale yet)
 *   - financial LOW (Glass-Steagall in full force; no derivatives; regulated rates)
 *   - healthcare LOW (pre-Medicare/Medicaid; mostly private cash-pay; tiny sector)
 *   - media LOW (newspapers peak; TV just emerging; no cable)
 *   - entertainment LOW (Hollywood declining post-HUAC; early TV eating cinema)
 *   - retail moderate (pre-mall era; downtown department stores; no national chains)
 *   - real_estate lower than 1979 (low mortgage rates via FHA/VA but small market)
 *   - logistics moderate (truck + rail; pre-Interstate; trucking regulated)
 * All weights are normalised at read time, so only relative magnitudes matter.
 *
 * Other countries remain on the 2019-default weights until country-specific
 * 1953 data is authored. `getCountrySectorWeights1953` returns an even
 * distribution for any country not in the map.
 */

import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import { JP_SECTOR_WEIGHTS_1953 } from "@/lib/countries/jp/data/jpSectorWeights1953";
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
import { GR_ECONOMY } from "@/lib/countries/gr/economy";
import { AT_ECONOMY } from "@/lib/countries/at/economy";
import { FI_ECONOMY } from "@/lib/countries/fi/economy";
import { PL_ECONOMY } from "@/lib/countries/pl/economy";
import { HU_ECONOMY } from "@/lib/countries/hu/economy";
import { RO_ECONOMY } from "@/lib/countries/ro/economy";
import { YU_ECONOMY } from "@/lib/countries/yu/economy";
import { BG_ECONOMY } from "@/lib/countries/bg/economy";
import { CS_ECONOMY } from "@/lib/countries/cs/economy";
import { UKR_ECONOMY } from "@/lib/countries/ukr/economy";
import { BAL_ECONOMY } from "@/lib/countries/bal/economy";

export type SectorWeightMap = Partial<Record<CorporationType, number>>;

export const COUNTRY_SECTOR_WEIGHTS_1953: Record<string, SectorWeightMap> = {
  US: US_ECONOMY.sectorWeights.byEra["1953"],
  UK: UK_ECONOMY.sectorWeights.byEra["1953"],
  DE: DE_ECONOMY.sectorWeights.byEra["1953"],
  JP: JP_SECTOR_WEIGHTS_1953,
  CN: CN_ECONOMY.sectorWeights.byEra["1953"],
  BR: BR_ECONOMY.sectorWeights.byEra["1953"],
  IE: IE_ECONOMY.sectorWeights.byEra["1953"],
  NG: NG_ECONOMY.sectorWeights.byEra["1953"],
  FR: FR_ECONOMY.sectorWeights.byEra["1953"],
  IT: IT_ECONOMY.sectorWeights.byEra["1953"],
  ES: ES_ECONOMY.sectorWeights.byEra["1953"],
  SE: SE_ECONOMY.sectorWeights.byEra["1953"],
  GR: GR_ECONOMY.sectorWeights.byEra["1953"],
  AT: AT_ECONOMY.sectorWeights.byEra["1953"],
  FI: FI_ECONOMY.sectorWeights.byEra["1953"],
  TR: TR_ECONOMY.sectorWeights.byEra["1953"],
  SU: {
    manufacturing: 25, // Stalinist heavy industry at peak; steel/coal/machinebuilding priority
    defense: 18, // Korean War + Stalin's military budget; atom bomb (1949) + H-bomb (1953); largest share
    energy: 12, // coal dominant; oil (Baku); hydroelectric (GOELRO plan); nuclear just starting
    construction: 10, // Stalin's "Seven Sisters" skyscrapers; dam/canal projects; post-WWII rebuild
    agriculture: 8, // collective farms; Stalin starved sector; grain below pre-1917 per capita
    extraction: 8, // coal; iron ore; oil; gold (Kolyma Gulag labour); strategic metals
    chemical_industries: 5, // synthetic rubber; explosives; fertilizer for collectivized farms
    logistics: 5, // Soviet Railways; Volga-Don Canal (1952); limited trucks
    telecommunications: 2, // state monopoly; party/military priority; scarce for civilians
    media: 2, // Pravda; Izvestia; TASS; purely state propaganda
    financial: 1, // Gosbank monopoly; no private finance
    real_estate: 1, // state-allocated housing; kommunalka; no market
    healthcare: 1, // Semashko system; free universal; underfunded
    retail: 1, // state shops; queuing; black market
    automobiles: 0, // Moskvitch; GAZ Pobeda; elite Zil; negligible consumer auto
    technology: 0, // BESM-1 (1953); no commercial market
    entertainment: 0, // Bolshoi; socialist realism cinema; approved culture only
  },

  DD: DD_ECONOMY.sectorWeights.byEra["1953"],

  // Soviet-bloc / Cominform states (1953 Stalinist-era command economies — the
  // Warsaw Pact was not signed until May 1955; bloc ties were Cominform/Comecon +
  // bilateral). YU is listed here for sector-weight convenience but was expelled
  // from Cominform in 1948 and pursued a non-aligned path (see YU block below).
  HU: HU_ECONOMY.sectorWeights.byEra["1953"],

  PL: PL_ECONOMY.sectorWeights.byEra["1953"],

  RO: RO_ECONOMY.sectorWeights.byEra["1953"],

  YU: YU_ECONOMY.sectorWeights.byEra["1953"],

  CS: CS_ECONOMY.sectorWeights.byEra["1953"],

  BG: BG_ECONOMY.sectorWeights.byEra["1953"],

  // Ukraine (Ukrainian SSR), 1953. Two economies in one republic: the Donbas
  // coal field and the Dnieper metallurgical belt, restored at almost any cost
  // after the occupation, sitting on top of the union's largest grain and sugar
  // surplus. Consumer sectors barely exist - reconstruction had absolute
  // priority, and the 1946-47 famine is only six years past.
  UKR: UKR_ECONOMY.sectorWeights.byEra["1953"],

  BY: {
    manufacturing: 20, // MAZ trucks; machine building; postwar Soviet investment massive
    agriculture: 25, // traditional base; recovering from WWII; potato, flax, dairy
    defense: 12, // frontline Soviet republic; large garrison; strategic position
    construction: 10, // massive reconstruction (~80% of Minsk destroyed); showcase Soviet rebuild
    logistics: 5, // key USSR transit hub; Brest–Terespol rail gateway to West
    extraction: 5, // peat (half of USSR peat reserves); potash Soligorsk; timber
    energy: 5, // peat-fired power stations; Moscow grid integration
    chemical_industries: 4, // potash fertilizers starting; defence chemicals
    healthcare: 4, // Soviet polyclinics; Minsk Medical Institute
    retail: 2, // state shops; reconstruction priority over consumer goods
    media: 1, // Zvezda; Belarusian Radio; censored
    financial: 1, // Gosbank branch; no autonomy
    real_estate: 1,
    telecommunications: 1,
    automobiles: 2, // MAZ/BELAZ early trucks; no private cars
    entertainment: 1, // Kupala National Theatre; folk music
    technology: 0,
  },

  BAL: BAL_ECONOMY.sectorWeights.byEra["1953"],
};

/**
 * Runtime countryId -> 1953 national-bundle key. Two Soviet republics play under
 * a different CountryId than the key their authored bundle lives under: the USSR
 * plays as "RU" (bundle "SU") and Byelorussia as "BLR" (bundle "BY"). Ukraine
 * needs no alias: its bundle is authored under its own id "UKR". Without
 * these aliases their economies would seed an even sector split in 1953.
 */
const BUNDLE_KEY_ALIASES_1953: Record<string, string> = { RU: "SU", BLR: "BY" };
function bundleKey1953(countryId: CountryId | string): string {
  return BUNDLE_KEY_ALIASES_1953[countryId as string] ?? (countryId as string);
}

/**
 * Era-correct 1953 per-state / per-region sector specialties, keyed
 * "<runtimeCountryId>:<regionCode>". These are PARTIAL maps: they bend the
 * country-level 1953 baseline toward each region's real 1953 economy (see
 * `mergeStateOverride`). Authored for 1953 directly, so they carry the era's
 * character: peak manufacturing, coal/oil/ore extraction, cotton/grain/dairy
 * agriculture, Big-Three autos in the Midwest, shipbuilding and textiles in
 * Britain, heavy industry across the Urals and Donbass. No `technology` sector
 * (commercially ~0 in 1953) and only nascent `entertainment` (film, tourism).
 */
export const STATE_SECTOR_WEIGHT_OVERRIDES_1953: Record<string, SectorWeightMap> = {
  // United States (1950-census 48 states + DC; AK/HI still territories)
  "US:AL": { manufacturing: 16, agriculture: 16, extraction: 8 }, // Birmingham steel; cotton
  "US:AK": { extraction: 12, logistics: 6, agriculture: 4 }, // gold, fishing, canneries
  "US:AZ": { extraction: 20, agriculture: 12, defense: 8 }, // copper; cotton; airbases
  "US:AR": { agriculture: 22, extraction: 8 }, // cotton, rice; bauxite/oil
  "US:CA": { agriculture: 16, entertainment: 14, defense: 12, extraction: 8, energy: 6 }, // Central Valley; Hollywood; aerospace; LA oil
  "US:CO": { extraction: 14, agriculture: 12, defense: 8 }, // mining; ranching
  "US:CT": { defense: 16, manufacturing: 16, financial: 12 }, // submarines/aircraft; Hartford insurance
  "US:DE": { chemical_industries: 22, manufacturing: 12, financial: 8 }, // DuPont
  "US:DC": { financial: 12, media: 10, real_estate: 10 }, // federal district services
  "US:FL": { agriculture: 18, entertainment: 12, real_estate: 10, construction: 8 }, // citrus; tourism
  "US:GA": { agriculture: 16, manufacturing: 14, logistics: 8 }, // cotton; textiles
  "US:HI": { agriculture: 20, defense: 14, entertainment: 8 }, // sugar/pineapple; Pearl Harbor
  "US:ID": { agriculture: 20, extraction: 10, logistics: 8 }, // potatoes; silver; timber
  "US:IL": { manufacturing: 16, logistics: 12, agriculture: 12, financial: 10 }, // Chicago rail hub
  "US:IN": { manufacturing: 22, automobiles: 10, agriculture: 10 }, // Gary steel
  "US:IA": { agriculture: 26, manufacturing: 8 }, // corn, hogs
  "US:KS": { agriculture: 22, defense: 8, extraction: 6 }, // wheat; Wichita aircraft
  "US:KY": { agriculture: 16, extraction: 14 }, // tobacco; coal
  "US:LA": { extraction: 18, chemical_industries: 10, agriculture: 10 }, // oil/gas; sugar
  "US:ME": { manufacturing: 14, agriculture: 10, logistics: 8 }, // paper; fishing/timber
  "US:MD": { manufacturing: 16, defense: 12, financial: 8 }, // Bethlehem Steel; Navy
  "US:MA": { manufacturing: 16, financial: 12, healthcare: 10 }, // machinery; insurance; hospitals
  "US:MI": { automobiles: 26, manufacturing: 12 }, // Detroit Big Three
  "US:MN": { extraction: 16, agriculture: 14, manufacturing: 8 }, // Mesabi iron
  "US:MS": { agriculture: 24, manufacturing: 8 }, // cotton
  "US:MO": { manufacturing: 14, agriculture: 12, automobiles: 8, logistics: 8 }, // St Louis/KC
  "US:MT": { extraction: 18, agriculture: 14 }, // copper mining; ranching
  "US:NE": { agriculture: 26 }, // corn, cattle
  "US:NV": { extraction: 20, entertainment: 12 }, // mining; nascent gaming
  "US:NH": { manufacturing: 16, agriculture: 6 }, // textiles/machinery
  "US:NJ": { chemical_industries: 18, manufacturing: 14, financial: 8 }, // pharma
  "US:NM": { extraction: 14, defense: 12, agriculture: 8 }, // oil/potash/uranium; Los Alamos/Sandia
  "US:NY": { financial: 20, media: 12, manufacturing: 12, real_estate: 10 }, // Wall Street; publishing
  "US:NC": { manufacturing: 18, agriculture: 14 }, // textiles; tobacco
  "US:ND": { agriculture: 28 }, // wheat
  "US:OH": { manufacturing: 20, automobiles: 10, chemical_industries: 8 }, // steel; Akron rubber
  "US:OK": { extraction: 20, agriculture: 12 }, // oil
  "US:OR": { logistics: 12, agriculture: 12, manufacturing: 8 }, // timber/lumber
  "US:PA": { manufacturing: 22, extraction: 12, financial: 8 }, // US Steel; anthracite coal
  "US:RI": { manufacturing: 20, financial: 8 }, // textiles/jewelry
  "US:SC": { manufacturing: 18, agriculture: 14 }, // textiles
  "US:SD": { agriculture: 26, extraction: 6 }, // livestock/wheat; Homestake gold
  "US:TN": { manufacturing: 12, agriculture: 12, energy: 10, defense: 8 }, // TVA; Oak Ridge
  "US:TX": { extraction: 20, agriculture: 12, energy: 10 }, // oil; cattle/cotton
  "US:UT": { extraction: 16, defense: 8, agriculture: 8 }, // copper mining
  "US:VT": { agriculture: 18, manufacturing: 8, extraction: 8 }, // dairy; granite/marble
  "US:VA": { defense: 14, agriculture: 12, manufacturing: 10 }, // Norfolk Navy; tobacco
  "US:WA": { defense: 16, logistics: 10, agriculture: 10, energy: 8 }, // Boeing; ports; hydro
  "US:WV": { extraction: 22, chemical_industries: 8, energy: 6 }, // coal
  "US:WI": { agriculture: 18, manufacturing: 14 }, // dairy
  "US:WY": { extraction: 20, agriculture: 10, energy: 6 }, // coal/oil
  // United Kingdom (NUTS1 regions)
  "UK:LON": { financial: 22, media: 12, real_estate: 10, retail: 8 }, // the City; Fleet Street
  "UK:SEE": { manufacturing: 12, financial: 8, agriculture: 8, retail: 8 },
  "UK:SWE": { agriculture: 16, manufacturing: 8, logistics: 6 }, // farming; Plymouth naval
  "UK:EAE": { agriculture: 20, manufacturing: 6 }, // East Anglia arable
  "UK:EMI": { manufacturing: 20, extraction: 8 }, // hosiery; coal
  "UK:WMI": { manufacturing: 22, automobiles: 10 }, // Birmingham metal trades/cars
  "UK:YHU": { manufacturing: 20, extraction: 8 }, // Sheffield steel, Leeds wool; coal
  "UK:NWE": { manufacturing: 22, logistics: 8 }, // Lancashire cotton; Liverpool port
  "UK:NEE": { manufacturing: 18, extraction: 12 }, // Tyneside shipbuilding; coal
  "UK:SCO": { manufacturing: 16, extraction: 10, agriculture: 8 }, // Clyde shipbuilding; coal
  "UK:WAL": { extraction: 20, manufacturing: 14 }, // South Wales coal; Port Talbot steel
  "UK:NIR": { manufacturing: 16, agriculture: 12 }, // Belfast shipbuilding; linen/farming
  // Soviet Union (regions play under countryId "RU")
  "RU:CEN": { manufacturing: 22, defense: 12 }, // Moscow industrial core
  "RU:NWR": { manufacturing: 18, defense: 12 }, // Leningrad
  "RU:NOR": { extraction: 16, logistics: 8 }, // Kola nickel/apatite; timber
  "RU:CBE": { agriculture: 24 }, // Central Black Earth grain
  "RU:VOL": { manufacturing: 14, energy: 10, extraction: 8 }, // Volga industry/hydro; "Second Baku" oil
  "RU:NCA": { agriculture: 18, extraction: 10 }, // Kuban grain; Grozny oil
  "RU:URA": { manufacturing: 20, extraction: 14, defense: 10 }, // Urals metallurgy/heavy industry
  "RU:WSB": { extraction: 18, manufacturing: 12 }, // Kuzbass coal
  "RU:ESB": { extraction: 16, energy: 8, logistics: 6 }, // minerals; Siberian hydro
  "RU:FEA": { extraction: 14, logistics: 8, defense: 8 }, // gold, fishing; Pacific
  // Ukrainian SSR — the republic's own regions, now that Ukraine is a country
  // rather than an RU region. (The "RU:UKR"/"RU:BEL"/"RU:BLT" lines below are the
  // old single-region aggregates; they only apply where RU still seeds them.)
  "UKR:UKR_KYI": { manufacturing: 18, media: 8, healthcare: 6 }, // the republican capital and its machine works
  "UKR:UKR_WES": { agriculture: 30, extraction: 6 }, // Galicia/Volhynia: smallholding farms, Boryslav oil, timber
  "UKR:UKR_POD": { agriculture: 34 }, // sugar beet and grain; no plan showpiece at all
  "UKR:UKR_DON": { extraction: 30, manufacturing: 20, energy: 10 }, // Donbas coal, coke and steel
  "UKR:UKR_DNI": { manufacturing: 26, extraction: 16 }, // Zaporizhzhia/Dnipro steel; Kryvyi Rih ore
  "UKR:UKR_SOU": { agriculture: 20, logistics: 12, defense: 8 }, // Odesa port; Mykolaiv yards; steppe grain
  // Byelorussian SSR — rebuilt from near-total destruction; farm republic still.
  "BLR:BLR_MIN": { manufacturing: 20, construction: 12 }, // MAZ/MTZ; Minsk rebuilt from rubble
  "BLR:BLR_BRE": { agriculture: 28, logistics: 10 }, // the Brest transit gateway; Polesian farming
  "BLR:BLR_HOM": { agriculture: 24, extraction: 8 }, // peat and timber; Gomel machine works
  "BLR:BLR_GRO": { agriculture: 30 }, // the most agrarian and most Catholic oblast
  "BLR:BLR_MOG": { agriculture: 22, manufacturing: 12 },
  "BLR:BLR_VIT": { agriculture: 22, manufacturing: 12, energy: 6 }, // peat-fired power
  // Baltic republics — annexed 1940, still the best-supplied corner of the USSR.
  "BAL:BAL_EST": { extraction: 14, energy: 12, manufacturing: 18 }, // oil shale is the republic's whole energy story
  "BAL:BAL_LVA": { manufacturing: 24, logistics: 10, telecommunications: 4 }, // VEF Riga; the largest Baltic port
  "BAL:BAL_LTU": { agriculture: 26, manufacturing: 12, logistics: 6 }, // dairy and Klaipeda; least industrialised of the three
  "RU:UKR": { extraction: 16, manufacturing: 16, agriculture: 12 }, // Donbass coal; Dnipro steel; grain
  "RU:KAZ": { agriculture: 16, extraction: 14 }, // Virgin Lands; Karaganda coal
  "RU:TRA": { extraction: 20, agriculture: 8 }, // Baku oil
  "RU:CAS": { agriculture: 22, extraction: 6 }, // Central Asian cotton
  "RU:MOL": { agriculture: 26 }, // wine, fruit, grain
  "RU:BEL": { agriculture: 18, manufacturing: 10, logistics: 6 },
  "RU:BLT": { manufacturing: 14, logistics: 10, agriculture: 10 }, // Baltic ports
  // East Germany (DDR) — the six seeded eastern Länder (BEO/MV/BB/ST/SN/TH)
  "DD:BEO": { manufacturing: 14, media: 12, retail: 8 }, // East Berlin: administration, print, assembly
  "DD:MV": { agriculture: 22, logistics: 8 }, // Mecklenburg farming; Rostock port
  "DD:BB": { energy: 12, manufacturing: 12, agriculture: 8 }, // Lausitz lignite power; Eisenhuettenstadt steel
  "DD:ST": { chemical_industries: 20, manufacturing: 10 }, // Leuna/Buna/Bitterfeld chemicals; Magdeburg machine-building
  "DD:SN": { manufacturing: 20, automobiles: 8, extraction: 8 }, // Chemnitz machine-building; Zwickau autos; lignite
  "DD:TH": { manufacturing: 16, agriculture: 8 }, // Jena optics; Suhl workshops; Thuringian farming
  // West Germany (Bundesländer)
  "DE:NW": { manufacturing: 24, extraction: 12, chemical_industries: 8 }, // Ruhr coal, steel, heavy industry
  "DE:SL": { extraction: 16, manufacturing: 16 }, // Saarland coal & steel
  "DE:BW": { manufacturing: 20, automobiles: 12 }, // Stuttgart: Daimler, precision engineering
  "DE:BY": { manufacturing: 14, agriculture: 12, automobiles: 6 }, // Bavaria: farming + emerging industry
  "DE:HE": { financial: 16, chemical_industries: 12 }, // Frankfurt finance; Hoechst chemicals
  "DE:RP": { chemical_industries: 18, agriculture: 8 }, // BASF Ludwigshafen; Moselle wine
  "DE:NI": { manufacturing: 12, automobiles: 10, agriculture: 10, extraction: 8 }, // VW Wolfsburg; Salzgitter; gas
  "DE:SH": { agriculture: 16, logistics: 8 }, // farming; Kiel shipbuilding
  "DE:HH": { logistics: 18, manufacturing: 10, media: 8 }, // Hamburg port, shipyards, press
  "DE:BRE": { logistics: 16, manufacturing: 10 }, // Bremen port & shipbuilding
  "DE:BE": { manufacturing: 12, media: 10, retail: 8 }, // West Berlin
  // France
  "FR:FR_IDF": { financial: 16, manufacturing: 14, media: 10, automobiles: 6 }, // Paris: Renault/Citroën, banking, press
  "FR:FR_NOR": { extraction: 16, manufacturing: 16 }, // Nord: coal, textiles, steel
  "FR:FR_EST": { manufacturing: 18, extraction: 14 }, // Lorraine iron & steel; Alsace industry
  "FR:FR_OUE": { agriculture: 20, logistics: 8 }, // Brittany/Normandy farming; Atlantic ports
  "FR:FR_SOU": { agriculture: 14, energy: 8, extraction: 8 }, // Aquitaine: Lacq gas, farming, Landes timber
  "FR:FR_ARA": { manufacturing: 16, energy: 8 }, // Lyon industry; Alpine hydro
  "FR:FR_MED": { agriculture: 12, logistics: 10, entertainment: 8 }, // Marseille port; Riviera; farming
  "FR:FR_CEN": { agriculture: 22 }, // Beauce/Centre grain belt
  // Italy
  "IT:IT_NW": { manufacturing: 20, automobiles: 12 }, // Turin FIAT; Milan/Genoa industrial triangle
  "IT:IT_NE": { manufacturing: 12, agriculture: 14, energy: 8 }, // Po Valley farming; gas; Veneto textiles
  "IT:IT_TUS": { manufacturing: 12, extraction: 8, entertainment: 8 }, // Tuscan industry; iron/pyrite; tourism
  "IT:IT_LAZ": { financial: 12, media: 12, construction: 8 }, // Rome: government, Cinecittà, building
  "IT:IT_CAM": { manufacturing: 12, agriculture: 12, logistics: 8 }, // Naples industry; farming; port
  "IT:IT_SUD": { agriculture: 24 }, // the agrarian Mezzogiorno
  "IT:IT_SIC": { agriculture: 16, extraction: 12 }, // citrus, sulfur; Ragusa oil
  "IT:IT_SAR": { agriculture: 16, extraction: 10 }, // pastoral; Sulcis coal
  // Spain
  "ES:ES_MAD": { financial: 14, manufacturing: 10, media: 8 }, // Madrid: capital, services
  "ES:ES_CAT": { manufacturing: 22, retail: 6 }, // Barcelona: Spain's industrial heart, textiles
  "ES:ES_AND": { agriculture: 22, extraction: 8 }, // olives; Rio Tinto/Peñarroya mining
  "ES:ES_VAL": { agriculture: 20, logistics: 8 }, // citrus; Valencia port
  "ES:ES_PVB": { manufacturing: 22, extraction: 10 }, // Bilbao iron & steel, shipbuilding
  "ES:ES_GAL": { agriculture: 16, logistics: 8 }, // farming, fishing; Vigo
  "ES:ES_NOR": { extraction: 18, manufacturing: 14 }, // Asturias coal; northern steel
  "ES:ES_CEN": { agriculture: 22 }, // Castilian grain
  // Sweden
  "SE:SE_STH": { financial: 14, manufacturing: 10, media: 8 }, // Stockholm services
  "SE:SE_GOT": { manufacturing: 18, automobiles: 10, logistics: 8 }, // Göteborg: Volvo/SKF, port
  "SE:SE_SKA": { agriculture: 18, manufacturing: 8 }, // Skåne farming; Malmö industry
  "SE:SE_EAS": { manufacturing: 16, agriculture: 8 }, // Linköping (SAAB); farming
  "SE:SE_SML": { manufacturing: 16, extraction: 6 }, // small-industry & glass belt
  "SE:SE_VML": { manufacturing: 18, extraction: 14 }, // Bergslagen iron & steel
  "SE:SE_NOR": { extraction: 20, logistics: 8, energy: 8 }, // Kiruna iron; timber; hydro
  "SE:SE_UPP": { manufacturing: 14, extraction: 10, agriculture: 8 }, // mills & mining
  // Turkey
  "GR:GR_ATT": { manufacturing: 14, logistics: 12, financial: 8 }, // Athens–Piraeus: industry, port, banks
  "GR:GR_MAC": { agriculture: 16, manufacturing: 8, energy: 6 }, // Thessaloniki + tobacco plain; lignite
  "GR:GR_THE": { agriculture: 20, manufacturing: 4 }, // the wheat plain
  "GR:GR_EPC": { agriculture: 16, extraction: 6 }, // mountain smallholding; bauxite
  "GR:GR_PEL": { agriculture: 18, energy: 6 }, // currants/olives; Megalopolis lignite
  "GR:GR_ISL": { logistics: 16, agriculture: 10 }, // shipping islands; Crete farming
  "AT:AT_VIE": { manufacturing: 14, financial: 10, retail: 8 }, // the imperial capital: industry, banks, commerce
  "AT:AT_NOE": { agriculture: 18, energy: 8, manufacturing: 6 }, // eastern grain belt; Zistersdorf oil (USIA)
  "AT:AT_OOE": { manufacturing: 16, energy: 8, agriculture: 10 }, // VOEST Linz; Salzkammergut; Alpine hydro
  "AT:AT_STK": { manufacturing: 14, extraction: 10, agriculture: 10 }, // Erzberg iron; Mur-Mürz steel valley
  "AT:AT_TYR": { entertainment: 10, energy: 8, agriculture: 10 }, // Alpine tourism; hydro; mountain farming
  "FI:FI_UUS": { manufacturing: 12, financial: 8, logistics: 8 }, // Helsinki: engineering, banks, the port
  "FI:FI_SW": { agriculture: 14, manufacturing: 10, logistics: 8 }, // Turku shipyards (reparations ships); farm coast
  "FI:FI_HAM": { manufacturing: 16, extraction: 8, agriculture: 12 }, // Tampere textiles/metal; lake-district sawmills
  "FI:FI_EAS": { agriculture: 18, extraction: 14, energy: 6 }, // smallholder east; the forest heartland
  "FI:FI_OST": { agriculture: 18, extraction: 10, manufacturing: 8 }, // Bothnian farms; timber ports
  "FI:FI_LAP": { extraction: 16, energy: 10, agriculture: 8 }, // Lapland logging; Oulujoki/Kemijoki hydro
  "TR:TR_IST": { manufacturing: 16, logistics: 12, financial: 8 }, // Istanbul: industry, port, trade
  "TR:TR_ANK": { agriculture: 12, defense: 8, construction: 8 }, // capital; Anatolian farming
  "TR:TR_IZM": { agriculture: 16, logistics: 8, manufacturing: 6 }, // Aegean farming; Izmir port
  "TR:TR_MED": { agriculture: 20, logistics: 6 }, // Çukurova cotton; Mersin port
  "TR:TR_BLA": { extraction: 16, agriculture: 12 }, // Zonguldak coal; tea/hazelnut
  "TR:TR_ESA": { agriculture: 18, extraction: 8 }, // pastoral; Divriği iron
  "TR:TR_SEA": { agriculture: 16, extraction: 12 }, // cotton; Batman oil
  "TR:TR_CEN": { agriculture: 22 }, // Anatolian grain steppe
  // Japan
  "JP:KAN": { manufacturing: 24, financial: 12, media: 8 }, // Tokyo/Kanto: industrial + financial core
  "JP:KNS": { manufacturing: 22, retail: 6 }, // Osaka/Kinki: Hanshin industrial belt
  "JP:CHU": { manufacturing: 20, automobiles: 14 }, // Nagoya/Chubu: Toyota, machinery
  "JP:KYU": { manufacturing: 16, extraction: 12 }, // Kitakyushu steel; Miike/Chikuho coal
  "JP:TOH": { agriculture: 18, extraction: 6 }, // Tohoku rice; mining
  "JP:HOK": { agriculture: 16, extraction: 10, logistics: 6 }, // Hokkaido farming, coal, fishing
  "JP:CGK": { manufacturing: 12, extraction: 8, agriculture: 8 }, // Chugoku
  "JP:SHI": { agriculture: 16, manufacturing: 8 }, // Shikoku
  // China (macro-regions)
  "CN:DB": { manufacturing: 22, extraction: 12 }, // Dongbei: Anshan steel, heavy industry
  "CN:HB": { extraction: 14, agriculture: 12, manufacturing: 10 }, // Huabei: Shanxi coal; North China plain
  "CN:HD": { manufacturing: 16, agriculture: 12, logistics: 8 }, // Huadong: Shanghai industry, Yangtze delta
  "CN:HZ": { agriculture: 20, extraction: 8 }, // Huazhong: central grain; Henan coal
  "CN:HN": { agriculture: 18, manufacturing: 8 }, // Huanan: Guangdong/Pearl delta
  "CN:XN": { agriculture: 16, extraction: 12 }, // Xinan: Sichuan basin; SW minerals
  "CN:XB": { extraction: 16, agriculture: 12 }, // Xibei: Xinjiang oil/coal; NW pastoral
  // Brazil
  "BR:SUDESTE": { manufacturing: 20, extraction: 10, financial: 10 }, // São Paulo/Minas: industrial core, iron
  "BR:SUL": { agriculture: 18, manufacturing: 10 }, // Rio Grande do Sul: farming + industry
  "BR:NORDESTE": { agriculture: 20, extraction: 6 }, // sugar/cotton; offshore oil
  "BR:NORTE": { extraction: 16, agriculture: 8 }, // Amazon: Carajás iron, timber
  "BR:CENTRO_OESTE": { agriculture: 24 }, // cerrado ranching & grain
  // Ireland
  "IE:DUB": { financial: 12, manufacturing: 10, retail: 8 }, // Dublin services
  "IE:KIL": { agriculture: 20 }, // southeast tillage
  "IE:MID": { agriculture: 20, energy: 6 }, // Midlands farming; peat/turf power
  "IE:WEX": { agriculture: 22 }, // Wexford tillage
  "IE:LIM": { agriculture: 16, manufacturing: 8, energy: 6 }, // Limerick; Shannon/Ardnacrusha hydro
  "IE:COR": { agriculture: 14, manufacturing: 10, logistics: 8 }, // Cork harbour, food processing
  "IE:GAL": { agriculture: 18, logistics: 6 }, // Galway/west farming, fishing
  "IE:DON": { agriculture: 18 }, // Donegal farming, fishing
  // Nigeria (1953 — pre-oil; petroleum production began 1958)
  "NG:SOUTH_SOUTH": { agriculture: 18, extraction: 8, logistics: 6 }, // Niger Delta palm produce; (oil post-1958)
  "NG:SOUTH_WEST": { agriculture: 18, logistics: 8, retail: 6 }, // Yorubaland cocoa; Lagos trade
  "NG:SOUTH_EAST": { agriculture: 20, extraction: 6 }, // palm produce; Enugu coal
  "NG:NORTH_CENTRAL": { agriculture: 20, extraction: 6 }, // Jos tin/columbite; farming
  "NG:NORTH_WEST": { agriculture: 24 }, // groundnuts, cotton
  "NG:NORTH_EAST": { agriculture: 24 }, // groundnuts, livestock
};

/** Raw (un-normalized) 1953 country sector map, with RU aliased to SU. */
export function getCountrySectorRaw1953(countryId: CountryId): SectorWeightMap {
  return COUNTRY_SECTOR_WEIGHTS_1953[bundleKey1953(countryId)] ?? {};
}

/**
 * Returns the 1953 country-level sector weight map.
 * Used by `getStateSectorWeights` when the active preset is `1953-default`.
 */
export function getCountrySectorWeights1953(countryId: CountryId): Record<CorporationType, number> {
  const raw = COUNTRY_SECTOR_WEIGHTS_1953[bundleKey1953(countryId)] ?? {};
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
