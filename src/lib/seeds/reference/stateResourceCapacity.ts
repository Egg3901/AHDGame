/**
 * Per-state extraction capacity (commodity units/turn ceiling per resource).
 * Used by `computeExtractionCapacityMultipliers` during turn processing.
 *
 * Reference: a $10M/day extraction company with a 0.20 rate produces
 *   oil: ($10M × 0.20) / $80 = 25,000 bbl/turn
 *   coal: ($10M × 0.20) / $150 = 13,333 tons/turn
 *   copper: ($10M × 0.10) / $9,000 = 111 tons/turn
 *   natural_gas: ($10M × 0.12) / $25 = 48,000 MMBtu/turn
 *   timber: ($10M × 0.08) / $400 = 2,000 m³/turn
 *
 * States not listed here are seeded with `resources: {}`, which caps extraction
 * of every resource at 0 for that state (prevents unbounded supply inflating
 * the commodity margin math).
 */

import type { CountryId } from "@/lib/constants/countries";
import type { ExtractableResource } from "@/lib/constants/commodities";

export interface StateResourceCapacityEntry {
  countryId: CountryId;
  resources: Partial<Record<ExtractableResource, number>>;
}

// Extraction-capacity remediation Phase 2 (2026-07-05): iron is the one resource
// that is genuinely per-state capacity-bound (77% reachable utilization, 37/42
// mined states maxed at t855) — adoption/placement can't help where the deposit
// itself is the ceiling. All iron capacities below were raised ×1.8 so reachable
// iron capacity clears local demand with headroom. The live prod game is bumped by
// the same factor out-of-band (fresh resets seed these values directly).
export const STATE_RESOURCE_CAPACITY: Record<string, StateResourceCapacityEntry> = {
  // ── United States ─────────────────────────────────────────────────────
  "US:TX": { countryId: "US", resources: { oil: 450000, natural_gas: 2250000, coal: 15000 } },
  "US:AK": {
    countryId: "US",
    resources: { oil: 225000, natural_gas: 600000, coal: 3000, rare_earth: 3000 },
  },
  "US:ND": { countryId: "US", resources: { oil: 180000, natural_gas: 300000, coal: 37500 } },
  "US:NM": { countryId: "US", resources: { oil: 150000, natural_gas: 300000, rare_earth: 4500 } },
  "US:WY": {
    countryId: "US",
    resources: {
      oil: 90000,
      natural_gas: 600000,
      coal: 450000,
      timber: 45000,
      rare_earth: 3000,
    },
  },
  "US:OK": { countryId: "US", resources: { oil: 120000, natural_gas: 525000 } },
  "US:CO": { countryId: "US", resources: { oil: 75000, natural_gas: 450000, coal: 52500 } },
  "US:CA": {
    countryId: "US",
    resources: { oil: 60000, natural_gas: 120000, timber: 75000, rare_earth: 9000 },
  },
  "US:LA": { countryId: "US", resources: { oil: 52500, natural_gas: 375000 } },
  "US:UT": { countryId: "US", resources: { oil: 37500, rare_earth: 6000 } },
  "US:KS": { countryId: "US", resources: { oil: 22500, natural_gas: 90000 } },
  "US:MT": {
    countryId: "US",
    resources: { oil: 30000, coal: 105000, rare_earth: 2250, timber: 105000 },
  },
  "US:PA": { countryId: "US", resources: { natural_gas: 1200000, coal: 120000 } },
  "US:WV": { countryId: "US", resources: { natural_gas: 750000, coal: 225000 } },
  "US:OH": { countryId: "US", resources: { natural_gas: 225000, coal: 30000 } },
  "US:KY": { countryId: "US", resources: { coal: 150000 } },
  "US:VA": { countryId: "US", resources: { coal: 60000, timber: 30000 } },
  "US:IL": { countryId: "US", resources: { coal: 90000 } },
  "US:IN": { countryId: "US", resources: { coal: 45000 } },
  "US:MN": { countryId: "US", resources: { iron: 675000, timber: 37500 } },
  "US:MI": { countryId: "US", resources: { iron: 135000, rare_earth: 1200, timber: 30000 } },
  "US:AZ": { countryId: "US", resources: { rare_earth: 14857 } },
  "US:NV": { countryId: "US", resources: { rare_earth: 7286, timber: 15000 } },
  "US:ID": { countryId: "US", resources: { rare_earth: 1200, timber: 90000 } },
  "US:OR": { countryId: "US", resources: { timber: 150000 } },
  "US:WA": { countryId: "US", resources: { timber: 120000 } },
  "US:ME": { countryId: "US", resources: { timber: 60000 } },
  "US:GA": { countryId: "US", resources: { timber: 67500 } },
  "US:WI": { countryId: "US", resources: { timber: 37500, iron: 18000 } },
  // Northeast — mostly timber, minor gas
  "US:NY": { countryId: "US", resources: { timber: 45000, natural_gas: 22500 } },
  "US:MA": { countryId: "US", resources: { timber: 7500, natural_gas: 15000 } },
  "US:CT": { countryId: "US", resources: { timber: 3000 } },
  "US:VT": { countryId: "US", resources: { timber: 37500 } },
  "US:NH": { countryId: "US", resources: { timber: 30000 } },
  "US:NJ": { countryId: "US", resources: { natural_gas: 7500 } },
  "US:DE": { countryId: "US", resources: { natural_gas: 7500 } },
  "US:MD": { countryId: "US", resources: { coal: 4500, timber: 12000 } },
  "US:RI": { countryId: "US", resources: { timber: 750 } },
  // Southeast — coal, timber, oil/gas
  "US:AL": { countryId: "US", resources: { coal: 60000, timber: 75000 } },
  "US:TN": { countryId: "US", resources: { coal: 30000, timber: 52500 } },
  "US:NC": { countryId: "US", resources: { timber: 67500 } },
  "US:SC": { countryId: "US", resources: { timber: 45000 } },
  "US:FL": { countryId: "US", resources: { oil: 7500, timber: 45000 } },
  "US:MS": { countryId: "US", resources: { natural_gas: 120000, oil: 30000, timber: 37500 } },
  "US:AR": { countryId: "US", resources: { natural_gas: 225000, oil: 22500, timber: 60000 } },
  // Midwest
  "US:MO": { countryId: "US", resources: { coal: 22500, timber: 30000, iron: 9000 } },
  "US:IA": { countryId: "US", resources: { coal: 7500, natural_gas: 7500 } },
  "US:NE": { countryId: "US", resources: { oil: 15000, natural_gas: 60000 } },
  "US:SD": { countryId: "US", resources: { rare_earth: 750, timber: 12000 } },
  // Pacific
  "US:HI": { countryId: "US", resources: { timber: 7500 } },

  // ── United Kingdom ────────────────────────────────────────────────────
  "UK:SCO": { countryId: "UK", resources: { oil: 120000, natural_gas: 300000, timber: 22500 } },
  "UK:NEE": { countryId: "UK", resources: { coal: 30000, iron: 9000 } },
  "UK:YHU": { countryId: "UK", resources: { coal: 22500, iron: 14400 } },
  "UK:WAL": { countryId: "UK", resources: { coal: 15000, timber: 22500 } },
  "UK:NWE": { countryId: "UK", resources: { coal: 7500, timber: 12000 } },
  "UK:EMI": { countryId: "UK", resources: { coal: 12000, iron: 13500 } },
  "UK:WMI": { countryId: "UK", resources: { coal: 7500, iron: 8100 } },
  "UK:EAE": { countryId: "UK", resources: { natural_gas: 15000, timber: 7500 } },
  "UK:SWE": { countryId: "UK", resources: { rare_earth: 538, timber: 12000 } },
  "UK:SEE": { countryId: "UK", resources: { timber: 7500 } },
  "UK:NIR": { countryId: "UK", resources: { coal: 3000, timber: 6000 } },
  "UK:LON": { countryId: "UK", resources: { timber: 750 } },

  // ── Germany ───────────────────────────────────────────────────────────
  "DE:NW": { countryId: "DE", resources: { coal: 90000, iron: 45000 } },
  "DE:SL": { countryId: "DE", resources: { coal: 22500, iron: 27000 } },
  "DE:SN": { countryId: "DE", resources: { coal: 45000, rare_earth: 1286 } },
  "DE:BB": { countryId: "DE", resources: { coal: 60000 } },
  "DE:ST": { countryId: "DE", resources: { coal: 37500 } },
  "DE:NI": {
    countryId: "DE",
    resources: { natural_gas: 120000, oil: 15000, iron: 27000, rare_earth: 857 },
  },
  "DE:SH": { countryId: "DE", resources: { oil: 7500 } },
  "DE:BY": { countryId: "DE", resources: { rare_earth: 600, timber: 30000 } },
  "DE:BW": { countryId: "DE", resources: { timber: 22500 } },
  "DE:RP": { countryId: "DE", resources: { rare_earth: 300 } },
  "DE:TH": { countryId: "DE", resources: { rare_earth: 480, timber: 18000 } },
  "DE:HE": { countryId: "DE", resources: { timber: 15000 } },
  "DE:MV": { countryId: "DE", resources: { natural_gas: 22500, timber: 12000 } },
  "DE:HH": { countryId: "DE", resources: { timber: 750 } },
  "DE:BRE": { countryId: "DE", resources: { timber: 750 } },
  "DE:BE": { countryId: "DE", resources: { timber: 750 } },

  // ── Japan ─────────────────────────────────────────────────────────────
  // Hokkaido: major coal (historical Ishikari/Kitakyushu), forestry, offshore gas
  "JP:HOK": { countryId: "JP", resources: { coal: 45000, timber: 60000, natural_gas: 15000 } },
  // Kyushu: historical coal (Miike/Yubari), iron sand, some gas
  "JP:KYU": {
    countryId: "JP",
    resources: { coal: 45000, iron: 18000, timber: 15000, natural_gas: 12000 },
  },
  // Tohoku: forestry, rare earth (Minamisoma), offshore gas
  "JP:TOH": { countryId: "JP", resources: { timber: 30000, rare_earth: 300, natural_gas: 20000 } },
  // Chubu: offshore gas (Niigata/Akita basin), coal (small), iron sand (San'in), copper (historic)
  "JP:CHU": {
    countryId: "JP",
    resources: {
      coal: 200000,
      iron: 144000,
      oil: 50000,
      natural_gas: 250000,
      rare_earth: 2000,
      timber: 22500,
    },
  },
  // Kinki South: limited surface resources, some coal/iron from minor deposits
  "JP:KNS": {
    countryId: "JP",
    resources: { coal: 80000, iron: 72000, oil: 20000, natural_gas: 100000, rare_earth: 180 },
  },
  // Kansai: historical copper (Kamaishi), coal (minor), offshore oil/gas (Kii channel)
  "JP:KAN": {
    countryId: "JP",
    resources: {
      coal: 120000,
      iron: 108000,
      oil: 30000,
      natural_gas: 150000,
      timber: 37500,
      rare_earth: 60,
    },
  },
  // Chugoku: coal, some iron
  "JP:CGK": { countryId: "JP", resources: { coal: 30000, iron: 9000, timber: 15000 } },
  // Shikoku: copper (Besshi historic), minor resources
  "JP:SHI": { countryId: "JP", resources: { rare_earth: 545, timber: 12000 } },

  // ── China ─────────────────────────────────────────────────────────────
  // Keys are countryId-prefixed because CN macro-region codes (HB, etc.)
  // collide with German Bundesländer (DE HB = Bremen). The consumer in
  // seedStateResourceCapacity.ts tries `CN:${state._id}` first, falling
  // back to the bare key for non-CN states.
  // Dongbei (Northeast) — Daqing oil, major coal, Anshan iron ore
  "CN:DB": {
    countryId: "CN",
    resources: { oil: 225000, natural_gas: 75000, coal: 500000, iron: 216000, rare_earth: 600 },
  },
  // Huabei (North) — Shanxi/Inner Mongolia coal dominance, Bayan Obo rare earths, Bohai oil
  "CN:HB": {
    countryId: "CN",
    resources: {
      coal: 1500000,
      oil: 75000,
      natural_gas: 75000,
      iron: 270000,
      rare_earth: 15000,
    },
  },
  // Huadong (East) — Shandong/Anhui coal, Jiangxi copper and rare earths, offshore gas
  "CN:HD": {
    countryId: "CN",
    resources: { coal: 300000, oil: 30000, natural_gas: 75000, rare_earth: 20571 },
  },
  // Huazhong (Central) — Henan coal, Hubei/Hunan iron ore and copper
  "CN:HZ": {
    countryId: "CN",
    resources: { coal: 450000, iron: 108000, rare_earth: 4500 },
  },
  // Huanan (South) — Guangxi coal, Jiangxi/Guangdong heavy rare earths
  "CN:HN": {
    countryId: "CN",
    resources: { coal: 180000, rare_earth: 7200 },
  },
  // Xinan (Southwest) — Sichuan gas basin, Guizhou/Yunnan coal, Yunnan copper, Sichuan REE
  // Panzhihua (攀枝花) is China's #2 iron ore district; added iron capacity.
  "CN:XN": {
    countryId: "CN",
    resources: {
      coal: 600000,
      natural_gas: 450000,
      iron: 324000,
      rare_earth: 19643,
      timber: 90000,
    },
  },
  // Xibei (Northwest) — Xinjiang oil & gas, massive coal, some REE
  "CN:XB": {
    countryId: "CN",
    resources: { oil: 150000, natural_gas: 375000, coal: 750000, rare_earth: 2400 },
  },

  // ── Ireland ───────────────────────────────────────────────────────────
  // Resource-poor country; main asset is Corrib offshore gas (West) and plantation timber
  "IE:DUB": { countryId: "IE", resources: { timber: 3000 } },
  "IE:KIL": { countryId: "IE", resources: { timber: 6000 } },
  "IE:MID": { countryId: "IE", resources: { timber: 4500 } },
  "IE:WEX": { countryId: "IE", resources: { timber: 6000 } },
  "IE:LIM": { countryId: "IE", resources: { natural_gas: 30000, timber: 7500 } },
  // Cork: Cork/Kerry historical copper (Allihies), some gas exploration
  "IE:COR": { countryId: "IE", resources: { natural_gas: 7500, timber: 9000, rare_earth: 321 } },
  // Galway: Corrib gas field (Mayo), Connacht forestry
  "IE:GAL": { countryId: "IE", resources: { natural_gas: 30000, timber: 9000 } },
  "IE:DON": { countryId: "IE", resources: { natural_gas: 7500, timber: 7500 } },

  // ── Brazil ────────────────────────────────────────────────────────────
  // Norte: Carajás iron ore (world's largest mine), Sossego/Salobo copper, Amazon timber, pre-salt oil
  "BR:NORTE": {
    countryId: "BR",
    resources: { oil: 15000, iron: 405000, rare_earth: 16143, timber: 225000 },
  },
  // Nordeste: offshore oil/gas, Bahia iron ore, limited timber
  "BR:NORDESTE": {
    countryId: "BR",
    resources: { oil: 22500, natural_gas: 60000, iron: 54000, timber: 22500 },
  },
  // Centro-Oeste: cerrado mineral deposits, some Goiás copper and REE
  "BR:CENTRO_OESTE": {
    countryId: "BR",
    resources: { rare_earth: 5107, iron: 27000, timber: 37500 },
  },
  // Sudeste: Campos/Santos Basin oil (Brazil's largest), Minas Gerais Iron Quadrangle, REE
  "BR:SUDESTE": {
    countryId: "BR",
    resources: {
      oil: 375000,
      natural_gas: 225000,
      iron: 405000,
      coal: 22500,
      rare_earth: 4200,
    },
  },
  // Sul: Santa Catarina coal (Brazil's main coal region), Paraná/SC plantation timber
  "BR:SUL": { countryId: "BR", resources: { coal: 52500, timber: 52500, oil: 7500 } },

  // ── Nigeria ────────────────────────────────────────────────────────────
  // 1991: Nigeria was ~1.9M bbl/day (≈700M bbl/yr). At $25/bbl ≈ $17.5B/yr oil revenue.
  // Scale: US:TX = 450k bbl/turn. Nigeria total ≈ 2× Texas peak. Distributed by zone.
  // South-South (Niger Delta): ~60% of national oil. Bonny Light, Forcados, Brass.
  "NG:SOUTH_SOUTH": {
    countryId: "NG",
    resources: { oil: 300000, natural_gas: 450000, timber: 45000 },
  },
  // South-West (Lagos / Ondo): ~15% of national oil. Offshore OML, some gas.
  "NG:SOUTH_WEST": {
    countryId: "NG",
    resources: { oil: 90000, natural_gas: 150000, timber: 30000 },
  },
  // South-East (Imo / Abia): ~10% of national oil. Imo River oil, some gas.
  // Enugu coal (colonial-era, pre-oil) survives the 1953 oil strip.
  "NG:SOUTH_EAST": {
    countryId: "NG",
    resources: { oil: 60000, natural_gas: 75000, coal: 15000, timber: 22500 },
  },
  // North-Central (Benue / Niger): ~8% of national oil. Minor fields, agriculture.
  // Jos Plateau tin/columbite (mined since the 1900s) modelled as rare_earth.
  "NG:NORTH_CENTRAL": {
    countryId: "NG",
    resources: { oil: 45000, natural_gas: 30000, rare_earth: 1200, timber: 15000 },
  },
  // North-West (Kano / Sokoto): marginal. No significant oil in 1991. Agriculture.
  "NG:NORTH_WEST": {
    countryId: "NG",
    resources: { timber: 7500 },
  },
  // North-East (Borno / Bauchi): marginal. Chad Basin exploration not yet productive.
  "NG:NORTH_EAST": {
    countryId: "NG",
    resources: { timber: 7500 },
  },

  // ── Soviet Union (plays under countryId "RU") ─────────────────────────
  // A 1953 resource superpower. West Siberian (Tyumen) oil & gas are in the base
  // map at modern scale but stripped for 1953 — the fields weren't found until 1960.
  "RU:CEN": { countryId: "RU", resources: { coal: 30000 } }, // Moscow basin lignite; industrial core
  "RU:NWR": { countryId: "RU", resources: { timber: 45000, iron: 9000 } }, // Leningrad, Karelia
  "RU:NOR": {
    countryId: "RU",
    resources: { timber: 225000, rare_earth: 6000, coal: 30000, oil: 15000 },
  }, // Kola apatite; Pechora coal; Ukhta oil; boreal timber
  "RU:CBE": { countryId: "RU", resources: { iron: 54000 } }, // Kursk Magnetic Anomaly
  "RU:VOL": { countryId: "RU", resources: { oil: 135000, natural_gas: 45000 } }, // Volga-Urals "Second Baku"
  "RU:NCA": { countryId: "RU", resources: { oil: 45000, natural_gas: 15000 } }, // Grozny, Kuban
  "RU:URA": {
    countryId: "RU",
    resources: { iron: 216000, oil: 45000, coal: 45000, timber: 60000, rare_earth: 1500 },
  }, // Magnitogorsk/Nizhny Tagil metallurgy; Bashkir oil
  "RU:WSB": {
    countryId: "RU",
    resources: { coal: 150000, oil: 120000, natural_gas: 150000, timber: 90000 },
  }, // Kuzbass coal; Tyumen oil/gas stripped pre-1960
  "RU:ESB": { countryId: "RU", resources: { timber: 300000, coal: 30000, rare_earth: 2400 } }, // East Siberian forests & minerals
  "RU:FEA": { countryId: "RU", resources: { timber: 90000, coal: 22500, oil: 15000 } }, // Far East; Sakhalin oil
  // (Ukraine's Donbass/Krivoy Rog/Dashava budget moved to the "UKR:*" entries
  // below when Ukraine became its own playable country; the old "RU:UKR" key
  // matched no state and left every UKR state seeded with zero deposits.)
  "RU:KAZ": {
    countryId: "RU",
    resources: { coal: 90000, oil: 30000, iron: 27000, rare_earth: 1200 },
  }, // Karaganda coal; Emba oil
  "RU:TRA": { countryId: "RU", resources: { oil: 150000, natural_gas: 15000 } }, // Baku — the historic Soviet oil capital
  "RU:CAS": { countryId: "RU", resources: { natural_gas: 45000, oil: 15000, coal: 15000 } }, // Central Asian gas & oil
  "RU:MOL": { countryId: "RU", resources: { timber: 3000 } }, // Moldavia — agrarian
  "RU:BEL": { countryId: "RU", resources: { timber: 30000 } }, // Belorussia — forest & peat
  "RU:BLT": { countryId: "RU", resources: { coal: 22500, timber: 30000 } }, // Estonian oil shale (as coal); Baltic timber

  // ── Ukraine (playable country; split of the former "RU:UKR" budget) ───
  // The pre-split combined entry authored coal 300000 / iron 270000 /
  // natural_gas 45000 for all of Ukraine; the split preserves those totals and
  // places them where the deposits are, so the country-level calibration the
  // original author chose survives the state breakdown.
  "UKR:UKR_DON": { countryId: "UKR", resources: { coal: 270000, natural_gas: 15000 } }, // Donbass, the USSR's premier coal basin
  "UKR:UKR_DNI": { countryId: "UKR", resources: { iron: 243000, coal: 30000 } }, // Krivoy Rog iron; Dnieper industry
  "UKR:UKR_WES": { countryId: "UKR", resources: { natural_gas: 30000, oil: 15000, timber: 22500 } }, // Dashava gas; Boryslav oil; Carpathian timber
  "UKR:UKR_KYI": { countryId: "UKR", resources: { timber: 15000 } }, // Polesian forests
  "UKR:UKR_SOU": { countryId: "UKR", resources: { iron: 27000 } }, // Kerch iron ore
  // UKR_POD, agrarian Podillia: no authored deposits.

  // ── Poland ────────────────────────────────────────────────────────────
  // Upper Silesia was Europe's second coal basin after the Ruhr in 1953.
  "PL:PL_SLK": { countryId: "PL", resources: { coal: 300000 } }, // Upper Silesian hard coal
  "PL:PL_DSL": { countryId: "PL", resources: { coal: 60000 } }, // Wałbrzych basin
  "PL:PL_MAL": { countryId: "PL", resources: { coal: 45000 } }, // Kraków/Jaworzno basin
  "PL:PL_POM": { countryId: "PL", resources: { timber: 22500 } }, // Pomeranian forests
  "PL:PL_EAS": { countryId: "PL", resources: { timber: 30000 } }, // Białowieża/eastern forests

  // ── Czechoslovakia ────────────────────────────────────────────────────
  "CS:CS_BOH": { countryId: "CS", resources: { coal: 120000 } }, // North Bohemian lignite
  "CS:CS_MOR": { countryId: "CS", resources: { coal: 120000, iron: 13500 } }, // Ostrava-Karviná coal; Vítkovice iron
  "CS:CS_SVK": { countryId: "CS", resources: { iron: 13500, timber: 30000 } }, // Slovak Ore Mountains; Carpathian timber

  // ── Hungary ───────────────────────────────────────────────────────────
  // (Bauxite, Hungary's real 1953 headline mineral, has no engine resource.)
  "HU:HU_TRW": { countryId: "HU", resources: { coal: 60000 } }, // Tatabánya/Veszprém brown coal
  "HU:HU_NOR": { countryId: "HU", resources: { coal: 45000, iron: 9000 } }, // Borsod coal; Miskolc-area iron

  // ── Romania ───────────────────────────────────────────────────────────
  // Ploiești was Europe's largest oil district outside the USSR in 1953.
  "RO:RO_MUN": { countryId: "RO", resources: { oil: 90000, natural_gas: 15000 } }, // Ploiești oil
  "RO:RO_TRA": { countryId: "RO", resources: { natural_gas: 90000, timber: 22500 } }, // Transylvanian methane fields
  "RO:RO_OLT": { countryId: "RO", resources: { coal: 45000, oil: 15000 } }, // Jiu Valley coal
  "RO:RO_MOL": { countryId: "RO", resources: { oil: 15000 } }, // Bacău oil

  // ── Bulgaria ──────────────────────────────────────────────────────────
  "BG:BG_THR": { countryId: "BG", resources: { coal: 60000 } }, // Maritsa lignite
  "BG:BG_SW": { countryId: "BG", resources: { coal: 22500, timber: 15000 } }, // Pernik coal; Rila/Pirin timber

  // ── Byelorussia ───────────────────────────────────────────────────────
  "BLR:BLR_MIN": { countryId: "BLR", resources: { timber: 9000 } },
  "BLR:BLR_HOM": { countryId: "BLR", resources: { timber: 15000 } }, // Polesian forests
  "BLR:BLR_VIT": { countryId: "BLR", resources: { timber: 15000 } },

  // ── Baltics ───────────────────────────────────────────────────────────
  "BAL:BAL_EST": { countryId: "BAL", resources: { oil: 9000 } }, // kukersite oil shale
  "BAL:BAL_LVA": { countryId: "BAL", resources: { timber: 15000 } },
  "BAL:BAL_LTU": { countryId: "BAL", resources: { timber: 9000 } },

  // ── Yugoslavia ────────────────────────────────────────────────────────
  // (Bor copper and Trepča lead/zinc, the famous ones, have no engine resource.)
  "YU:YU_BIH": { countryId: "YU", resources: { coal: 90000, iron: 27000 } }, // Bosnian lignite; Ljubija iron for Zenica
  "YU:YU_SRB": { countryId: "YU", resources: { coal: 60000 } }, // Kolubara lignite
  "YU:YU_KOS": { countryId: "YU", resources: { coal: 45000 } }, // Kosovo lignite
  "YU:YU_SLO": { countryId: "YU", resources: { coal: 30000, timber: 22500 } }, // Trbovlje coal; Alpine timber
  "YU:YU_CRO": { countryId: "YU", resources: { oil: 15000, timber: 22500 } }, // Slavonian oil; Croatian forests
  "YU:YU_MKD": { countryId: "YU", resources: { iron: 4500 } }, // Macedonian iron
  "YU:YU_MNE": { countryId: "YU", resources: { timber: 9000 } }, // Montenegrin forests
  "YU:YU_VOJ": { countryId: "YU", resources: { oil: 9000 } }, // Vojvodina oil, minor

  // ── East Germany (DDR) ────────────────────────────────────────────────
  // The world's largest lignite producer; no domestic oil/gas (Soviet imports +
  // Leuna synthetic fuel from brown coal). Keyed to the six seeded Länder.
  "DD:SN": { countryId: "DD", resources: { coal: 55000, timber: 8000, rare_earth: 300 } }, // Saxon lignite; Ore Mountains
  "DD:ST": { countryId: "DD", resources: { coal: 50000, timber: 4000 } }, // central-German lignite (Halle/Bitterfeld)
  "DD:BB": { countryId: "DD", resources: { coal: 60000, timber: 5000 } }, // Lausitz lignite
  "DD:TH": { countryId: "DD", resources: { timber: 10000 } }, // Thuringian forest
  "DD:MV": { countryId: "DD", resources: { timber: 3000 } }, // Mecklenburg timber

  // ── France ────────────────────────────────────────────────────────────
  "FR:FR_IDF": { countryId: "FR", resources: { timber: 3000 } }, // Paris basin — negligible
  "FR:FR_NOR": { countryId: "FR", resources: { coal: 75000 } }, // Nord-Pas-de-Calais coal basin
  "FR:FR_EST": { countryId: "FR", resources: { iron: 180000, coal: 45000, natural_gas: 7500 } }, // Lorraine minette iron; coal; potash
  "FR:FR_OUE": { countryId: "FR", resources: { timber: 15000 } }, // Brittany/Normandy
  "FR:FR_SOU": { countryId: "FR", resources: { natural_gas: 90000, oil: 15000, timber: 45000 } }, // Lacq gas; Parentis oil; Landes pine
  "FR:FR_ARA": { countryId: "FR", resources: { timber: 30000, coal: 15000 } }, // Alpine timber; Massif Central coal
  "FR:FR_MED": { countryId: "FR", resources: { timber: 9000 } }, // Provence (bauxite n/a here)
  "FR:FR_CEN": { countryId: "FR", resources: { timber: 9000 } }, // Center — agrarian

  // ── Italy ─────────────────────────────────────────────────────────────
  "IT:IT_NW": { countryId: "IT", resources: { iron: 18000, timber: 22500 } }, // Aosta iron; Alpine timber
  "IT:IT_NE": { countryId: "IT", resources: { natural_gas: 90000, timber: 22500 } }, // Po Valley (Cortemaggiore) gas
  "IT:IT_TUS": { countryId: "IT", resources: { iron: 27000, timber: 15000 } }, // Elba iron; pyrite; Apennine timber
  "IT:IT_LAZ": { countryId: "IT", resources: { timber: 9000 } }, // Lazio
  "IT:IT_CAM": { countryId: "IT", resources: { timber: 7500 } }, // Campania
  "IT:IT_SUD": { countryId: "IT", resources: { natural_gas: 15000, timber: 9000 } }, // southern gas
  "IT:IT_SIC": { countryId: "IT", resources: { oil: 30000, natural_gas: 30000 } }, // Ragusa/Gela oil; Sicilian gas
  "IT:IT_SAR": { countryId: "IT", resources: { coal: 22500, timber: 9000 } }, // Sulcis coal (lignite)

  // ── Spain ─────────────────────────────────────────────────────────────
  "ES:ES_MAD": { countryId: "ES", resources: { timber: 3000 } }, // Madrid — negligible
  "ES:ES_CAT": { countryId: "ES", resources: { coal: 15000, timber: 12000 } }, // Catalan potash/lignite
  "ES:ES_AND": { countryId: "ES", resources: { coal: 22500, iron: 18000 } }, // Peñarroya; Rio Tinto district
  "ES:ES_VAL": { countryId: "ES", resources: { timber: 6000 } }, // Valencia & Murcia
  "ES:ES_PVB": { countryId: "ES", resources: { iron: 54000, timber: 9000 } }, // Vizcaya iron — Spanish steel base
  "ES:ES_GAL": { countryId: "ES", resources: { timber: 30000 } }, // Galicia timber (tungsten n/a)
  "ES:ES_NOR": { countryId: "ES", resources: { coal: 60000, iron: 22500, timber: 15000 } }, // Asturias coal basin
  "ES:ES_CEN": { countryId: "ES", resources: { timber: 9000 } }, // Castile & Islands

  // ── Sweden ────────────────────────────────────────────────────────────
  "SE:SE_STH": { countryId: "SE", resources: { timber: 6000 } }, // Stockholm — negligible
  "SE:SE_GOT": { countryId: "SE", resources: { timber: 22500 } }, // Western Sweden
  "SE:SE_SKA": { countryId: "SE", resources: { coal: 7500 } }, // Höganäs coal
  "SE:SE_EAS": { countryId: "SE", resources: { timber: 15000 } }, // Eastern Sweden
  "SE:SE_SML": { countryId: "SE", resources: { timber: 30000 } }, // Småland forests
  "SE:SE_VML": { countryId: "SE", resources: { iron: 90000, timber: 22500 } }, // Bergslagen iron district
  "SE:SE_NOR": { countryId: "SE", resources: { iron: 216000, timber: 225000, rare_earth: 1500 } }, // Kiruna/Malmberget iron; northern forests
  "SE:SE_UPP": { countryId: "SE", resources: { iron: 27000, timber: 45000 } }, // Dannemora iron; Falun (copper historic)

  // ── Turkey ────────────────────────────────────────────────────────────
  "GR:GR_ATT": { countryId: "GR", resources: {} }, // Athens basin — services, no primary extraction
  "GR:GR_MAC": { countryId: "GR", resources: { coal: 30000, timber: 6000 } }, // Ptolemaida lignite field; northern forests
  "GR:GR_THE": { countryId: "GR", resources: { timber: 3000 } }, // Pindus foothills
  "GR:GR_EPC": { countryId: "GR", resources: { timber: 7500 } }, // Pindus and Agrafa forests
  "GR:GR_PEL": { countryId: "GR", resources: { coal: 12000 } }, // Megalopolis lignite
  "GR:GR_ISL": { countryId: "GR", resources: {} }, // shipping and tourism, no extraction

  // ── Austria ───────────────────────────────────────────────────────────
  "AT:AT_VIE": { countryId: "AT", resources: {} }, // capital — services, no primary extraction
  "AT:AT_NOE": { countryId: "AT", resources: { oil: 22500, natural_gas: 7500 } }, // Zistersdorf/Matzen oilfield (Vienna Basin)
  "AT:AT_OOE": { countryId: "AT", resources: { timber: 15000 } }, // Salzkammergut and Mühlviertel forests (salt n/a)
  "AT:AT_STK": { countryId: "AT", resources: { iron: 37500, timber: 15000, coal: 7500 } }, // Erzberg iron; Styrian forests; Fohnsdorf lignite
  "AT:AT_TYR": { countryId: "AT", resources: { timber: 9000 } }, // Alpine forests

  // ── Finland ───────────────────────────────────────────────────────────
  "FI:FI_UUS": { countryId: "FI", resources: { timber: 6000 } }, // capital region — services; some forest
  "FI:FI_SW": { countryId: "FI", resources: { timber: 9000 } }, // southwest forests + archipelago
  "FI:FI_HAM": { countryId: "FI", resources: { timber: 30000 } }, // lake-district forest industries
  "FI:FI_EAS": { countryId: "FI", resources: { timber: 45000 } }, // the eastern forest heartland
  "FI:FI_OST": { countryId: "FI", resources: { timber: 22500, iron: 7500 } }, // Bothnian forests; Raahe (Rautaruukki) works
  "FI:FI_LAP": { countryId: "FI", resources: { timber: 15000, iron: 7500 } }, // Lapland forests; Kemi/Otanmäki-belt mines
  "TR:TR_IST": { countryId: "TR", resources: { coal: 7500 } }, // Marmara — minor
  "TR:TR_ANK": { countryId: "TR", resources: { coal: 15000 } }, // Central lignite
  "TR:TR_IZM": { countryId: "TR", resources: { coal: 22500, timber: 9000 } }, // Soma lignite; Aegean timber
  "TR:TR_MED": { countryId: "TR", resources: { timber: 12000 } }, // Taurus timber (chromite n/a)
  "TR:TR_BLA": { countryId: "TR", resources: { coal: 60000, timber: 30000 } }, // Zonguldak — Turkey's only hard-coal basin
  "TR:TR_ESA": { countryId: "TR", resources: { iron: 45000 } }, // Divriği iron ore
  "TR:TR_SEA": { countryId: "TR", resources: { oil: 30000, natural_gas: 7500 } }, // Batman oilfields
  "TR:TR_CEN": { countryId: "TR", resources: { coal: 22500 } }, // Anatolian lignite
};

/**
 * Per-resource headroom multiplier applied to every seeded capacity value.
 *
 * The hand-authored per-state ceilings above were calibrated for early-game
 * output and became a binding clamp as economies matured: by turn ~787 the
 * live game had iron/oil/natural_gas extraction pinned at ~30% of revenue-based
 * output purely because state capacity ran below demand (audit t786). These
 * multipliers give fresh seeds enough headroom that a matured economy reaches
 * roughly its geological supply ceiling before the clamp bites, without
 * changing early-game behaviour (early output sits far below capacity either
 * way). copper/rare_earth are scaled too but remain effectively source-limited
 * (few states carry them). Tune here rather than editing 88 per-state literals.
 */
export const RESOURCE_CAPACITY_HEADROOM: Record<ExtractableResource, number> = {
  iron: 7,
  oil: 3,
  natural_gas: 3,
  coal: 2,
  rare_earth: 3,
  timber: 3,
};

function scaleResources(
  resources: Partial<Record<ExtractableResource, number>>
): Partial<Record<ExtractableResource, number>> {
  const out: Partial<Record<ExtractableResource, number>> = {};
  for (const [resource, value] of Object.entries(resources) as [ExtractableResource, number][]) {
    out[resource] = Math.round(value * (RESOURCE_CAPACITY_HEADROOM[resource] ?? 1));
  }
  return out;
}

/**
 * Returns a preset-aware resource capacity map with the headroom multiplier
 * applied. For pre-oil-discovery eras, resources that didn't yet exist are
 * zeroed out:
 *   - Nigeria oil: commercial production began 1958 (discovery 1956)
 *   - UK North Sea oil/gas: first production 1969 (UK:SCO)
 *   - West Siberian (Tyumen) oil/gas: discovered 1960, decades from output (RU:WSB)
 */
export function getStateResourceCapacity(
  preset: string
): Record<string, StateResourceCapacityEntry> {
  const PRE_NIGERIA_OIL = new Set(["1953-default"]);
  const PRE_NORTH_SEA = new Set(["1953-default"]);
  const PRE_WEST_SIBERIA_OIL = new Set(["1953-default"]);

  // Clone with headroom applied so callers always get scaled ceilings.
  const result: Record<string, StateResourceCapacityEntry> = {};
  for (const [key, entry] of Object.entries(STATE_RESOURCE_CAPACITY)) {
    result[key] = { countryId: entry.countryId, resources: scaleResources(entry.resources) };
  }

  if (PRE_NIGERIA_OIL.has(preset)) {
    // Nigeria had no commercial oil in this era — zero it out across all zones
    for (const key of ["NG:SOUTH_SOUTH", "NG:SOUTH_WEST", "NG:SOUTH_EAST", "NG:NORTH_CENTRAL"]) {
      const base = result[key];
      if (base) {
        const { oil: _oil, natural_gas: _ng, ...rest } = base.resources;
        result[key] = { ...base, resources: rest };
      }
    }
  }

  if (PRE_NORTH_SEA.has(preset)) {
    // UK:SCO North Sea oil/gas: first production 1969
    const sco = result["UK:SCO"];
    if (sco) {
      const { oil: _oil, natural_gas: _ng, ...rest } = sco.resources;
      result["UK:SCO"] = { ...sco, resources: rest };
    }
  }

  if (PRE_WEST_SIBERIA_OIL.has(preset)) {
    // RU:WSB Tyumen oil/gas: discovered 1960. In 1953 the Kuzbass coal and
    // Siberian timber remain, but the oil & gas fields do not yet exist.
    const wsb = result["RU:WSB"];
    if (wsb) {
      const { oil: _oil, natural_gas: _ng, ...rest } = wsb.resources;
      result["RU:WSB"] = { ...wsb, resources: rest };
    }
  }

  return result;
}
