import type { StateDemographics } from "@/lib/db/types";

/**
 * UK region demographics — 1979 era (Winter of Discontent / Thatcher's first victory).
 *
 * Every region × group value here was authored INDEPENDENTLY from the historical
 * record of late-1970s Britain — NOT derived by scaling the 2019 file. The same
 * 12 region IDs and 12 voter-group IDs are used (the simulation requires a
 * stable group taxonomy across eras); populations sum to 100 per region.
 *
 * Era anchors:
 * - Trade-union membership at its all-time peak (~13.2m, ~55% density). The
 *   post_industrial_workers group — here representing the still-employed
 *   industrial/unionised working class — dominates the North, Midlands,
 *   Scotland, and Wales, and leans strongly economically left (-3/-4).
 * - Council housing at its peak (~32% of households): a huge tenant working
 *   class, folded into post_industrial_workers and young_renters.
 * - Ethnic-minority communities small (~4% of population) and concentrated in
 *   London and the West Midlands; new_britons is small everywhere else but
 *   kept non-zero per the file convention.
 * - No green bloc (Ecology Party polled ~0.1% in 1979) and no populist-right
 *   bloc outside fringe NF support — both pinned at ~1, except Northern
 *   Ireland where populist_right models hardline unionism at Troubles peak.
 * - Liberal vote modest (13.8% in 1979, down from Feb 1974): moderate_centrists
 *   smaller than later eras.
 * - Turnout high across the board (76% nationally in 1979); pensioner turnout
 *   very high, young turnout markedly better than modern eras.
 * - Urban progressives are the pre-Blair "old left" intelligentsia: more
 *   economically left, less socially liberal than their 2019 counterparts.
 */
export const ukRegionDemographics1979: StateDemographics[] = [
  // ── London ─────────────────────────────────────────────────────────────────
  // 1979 London: still a manufacturing and dock city in decline, big council
  // estates, GLC public-sector workforce, East End NF flashpoints, growing
  // Caribbean and South Asian communities.
  {
    _id: "LON",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 16, economicLean: -3, socialLean: 1, turnout: 70 },
      urban_progressives: { population: 9, economicLean: -4, socialLean: -2, turnout: 76 },
      suburban_homeowners: { population: 8, economicLean: 2, socialLean: 2, turnout: 76 },
      young_renters: { population: 14, economicLean: -2, socialLean: -2, turnout: 64 },
      rural_traditionalists: { population: 1, economicLean: 3, socialLean: 4, turnout: 76 },
      retirees: { population: 8, economicLean: 0, socialLean: 3, turnout: 80 },
      public_sector: { population: 12, economicLean: -4, socialLean: -1, turnout: 74 },
      moderate_centrists: { population: 10, economicLean: 0, socialLean: -1, turnout: 73 },
      populist_right: { population: 3, economicLean: 0, socialLean: 5, turnout: 58 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 60 },
      small_business: { population: 8, economicLean: 3, socialLean: 2, turnout: 76 },
      new_britons: { population: 10, economicLean: -3, socialLean: 1, turnout: 55 },
    },
    lastUpdated: new Date(),
  },
  // ── South East England ─────────────────────────────────────────────────────
  // Stockbroker belt and Home Counties: the engine of Thatcher's 1979 win.
  // Owner-occupier and rural-Tory dominance; Liberal pockets in market towns.
  {
    _id: "SEE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 12, economicLean: -3, socialLean: 2, turnout: 70 },
      urban_progressives: { population: 3, economicLean: -4, socialLean: -2, turnout: 75 },
      suburban_homeowners: { population: 17, economicLean: 3, socialLean: 2, turnout: 80 },
      young_renters: { population: 8, economicLean: -1, socialLean: -2, turnout: 64 },
      rural_traditionalists: { population: 16, economicLean: 3, socialLean: 4, turnout: 79 },
      retirees: { population: 12, economicLean: 1, socialLean: 3, turnout: 81 },
      public_sector: { population: 8, economicLean: -3, socialLean: -1, turnout: 74 },
      moderate_centrists: { population: 13, economicLean: 0, socialLean: -1, turnout: 75 },
      populist_right: { population: 1, economicLean: 1, socialLean: 5, turnout: 58 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 60 },
      small_business: { population: 8, economicLean: 3, socialLean: 2, turnout: 78 },
      new_britons: { population: 1, economicLean: -3, socialLean: 1, turnout: 52 },
    },
    lastUpdated: new Date(),
  },
  // ── South West England ─────────────────────────────────────────────────────
  // Deeply rural, farming and retirement coast; the Liberals' strongest
  // surviving regional tradition (Devon/Cornwall).
  {
    _id: "SWE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 10, economicLean: -3, socialLean: 2, turnout: 70 },
      urban_progressives: { population: 3, economicLean: -4, socialLean: -2, turnout: 74 },
      suburban_homeowners: { population: 13, economicLean: 3, socialLean: 2, turnout: 79 },
      young_renters: { population: 7, economicLean: -1, socialLean: -2, turnout: 62 },
      rural_traditionalists: { population: 19, economicLean: 3, socialLean: 4, turnout: 79 },
      retirees: { population: 14, economicLean: 1, socialLean: 3, turnout: 82 },
      public_sector: { population: 7, economicLean: -3, socialLean: -1, turnout: 73 },
      moderate_centrists: { population: 16, economicLean: 0, socialLean: -1, turnout: 76 },
      populist_right: { population: 1, economicLean: 1, socialLean: 5, turnout: 58 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 60 },
      small_business: { population: 8, economicLean: 3, socialLean: 2, turnout: 78 },
      new_britons: { population: 1, economicLean: -3, socialLean: 1, turnout: 50 },
    },
    lastUpdated: new Date(),
  },
  // ── East of England ────────────────────────────────────────────────────────
  // Fenland farming and market towns plus early commuter overspill (new towns
  // like Basildon/Harlow give a notable working-class strand).
  {
    _id: "EAE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 13, economicLean: -3, socialLean: 2, turnout: 70 },
      urban_progressives: { population: 3, economicLean: -4, socialLean: -2, turnout: 74 },
      suburban_homeowners: { population: 14, economicLean: 3, socialLean: 2, turnout: 79 },
      young_renters: { population: 7, economicLean: -1, socialLean: -2, turnout: 62 },
      rural_traditionalists: { population: 20, economicLean: 3, socialLean: 4, turnout: 78 },
      retirees: { population: 12, economicLean: 1, socialLean: 3, turnout: 81 },
      public_sector: { population: 7, economicLean: -3, socialLean: -1, turnout: 73 },
      moderate_centrists: { population: 12, economicLean: 0, socialLean: -1, turnout: 74 },
      populist_right: { population: 1, economicLean: 1, socialLean: 5, turnout: 58 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 60 },
      small_business: { population: 9, economicLean: 3, socialLean: 2, turnout: 77 },
      new_britons: { population: 1, economicLean: -3, socialLean: 1, turnout: 50 },
    },
    lastUpdated: new Date(),
  },
  // ── East Midlands ──────────────────────────────────────────────────────────
  // Coalfields (Notts/Derbyshire), hosiery and engineering at full employment;
  // Leicester's East African Asian community already significant by 1979.
  {
    _id: "EMI",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 25, economicLean: -3, socialLean: 2, turnout: 72 },
      urban_progressives: { population: 3, economicLean: -4, socialLean: -2, turnout: 73 },
      suburban_homeowners: { population: 11, economicLean: 3, socialLean: 2, turnout: 78 },
      young_renters: { population: 7, economicLean: -1, socialLean: -2, turnout: 62 },
      rural_traditionalists: { population: 15, economicLean: 3, socialLean: 4, turnout: 78 },
      retirees: { population: 9, economicLean: 1, socialLean: 3, turnout: 80 },
      public_sector: { population: 8, economicLean: -3, socialLean: -1, turnout: 73 },
      moderate_centrists: { population: 9, economicLean: 0, socialLean: -1, turnout: 73 },
      populist_right: { population: 2, economicLean: 0, socialLean: 5, turnout: 58 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 60 },
      small_business: { population: 6, economicLean: 3, socialLean: 2, turnout: 76 },
      new_britons: { population: 4, economicLean: -3, socialLean: 1, turnout: 54 },
    },
    lastUpdated: new Date(),
  },
  // ── West Midlands ──────────────────────────────────────────────────────────
  // Britain's manufacturing heart in 1979: car plants (Longbridge, BL), metal
  // trades, very high union density. Birmingham/Wolverhampton South Asian and
  // Caribbean communities well established; NF active.
  {
    _id: "WMI",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 27, economicLean: -3, socialLean: 2, turnout: 71 },
      urban_progressives: { population: 4, economicLean: -4, socialLean: -2, turnout: 73 },
      suburban_homeowners: { population: 10, economicLean: 3, socialLean: 2, turnout: 78 },
      young_renters: { population: 8, economicLean: -2, socialLean: -2, turnout: 62 },
      rural_traditionalists: { population: 9, economicLean: 3, socialLean: 4, turnout: 78 },
      retirees: { population: 8, economicLean: 1, socialLean: 3, turnout: 80 },
      public_sector: { population: 8, economicLean: -4, socialLean: -1, turnout: 73 },
      moderate_centrists: { population: 8, economicLean: 0, socialLean: -1, turnout: 72 },
      populist_right: { population: 3, economicLean: 0, socialLean: 5, turnout: 58 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 60 },
      small_business: { population: 6, economicLean: 3, socialLean: 2, turnout: 75 },
      new_britons: { population: 8, economicLean: -3, socialLean: 1, turnout: 54 },
    },
    lastUpdated: new Date(),
  },
  // ── Yorkshire & the Humber ─────────────────────────────────────────────────
  // Coal, steel (Sheffield/Scunthorpe), textiles (Bradford wool, in decline but
  // still employing). NUM heartland on the eve of the Thatcher confrontation.
  {
    _id: "YHU",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 29, economicLean: -4, socialLean: 2, turnout: 72 },
      urban_progressives: { population: 4, economicLean: -4, socialLean: -2, turnout: 73 },
      suburban_homeowners: { population: 8, economicLean: 2, socialLean: 2, turnout: 77 },
      young_renters: { population: 8, economicLean: -2, socialLean: -2, turnout: 62 },
      rural_traditionalists: { population: 11, economicLean: 3, socialLean: 4, turnout: 78 },
      retirees: { population: 9, economicLean: 0, socialLean: 3, turnout: 80 },
      public_sector: { population: 9, economicLean: -4, socialLean: -1, turnout: 73 },
      moderate_centrists: { population: 8, economicLean: 0, socialLean: -1, turnout: 72 },
      populist_right: { population: 2, economicLean: 0, socialLean: 5, turnout: 58 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 60 },
      small_business: { population: 5, economicLean: 3, socialLean: 2, turnout: 75 },
      new_britons: { population: 6, economicLean: -3, socialLean: 1, turnout: 53 },
    },
    lastUpdated: new Date(),
  },
  // ── North West England ─────────────────────────────────────────────────────
  // Cotton-belt towns, Merseyside docks, engineering — the densest union
  // membership in England. Council-estate Labour loyalty at its peak.
  {
    _id: "NWE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 30, economicLean: -4, socialLean: 2, turnout: 72 },
      urban_progressives: { population: 5, economicLean: -4, socialLean: -2, turnout: 73 },
      suburban_homeowners: { population: 8, economicLean: 2, socialLean: 2, turnout: 77 },
      young_renters: { population: 9, economicLean: -2, socialLean: -2, turnout: 62 },
      rural_traditionalists: { population: 7, economicLean: 3, socialLean: 4, turnout: 77 },
      retirees: { population: 9, economicLean: 0, socialLean: 3, turnout: 80 },
      public_sector: { population: 9, economicLean: -4, socialLean: -1, turnout: 73 },
      moderate_centrists: { population: 8, economicLean: 0, socialLean: -1, turnout: 72 },
      populist_right: { population: 2, economicLean: 0, socialLean: 5, turnout: 58 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 60 },
      small_business: { population: 5, economicLean: 3, socialLean: 2, turnout: 74 },
      new_britons: { population: 7, economicLean: -3, socialLean: 1, turnout: 53 },
    },
    lastUpdated: new Date(),
  },
  // ── North East England ─────────────────────────────────────────────────────
  // Shipbuilding (Wear/Tyne), coal, steel (Consett still open in 1979) —
  // the most union-saturated, council-housed region in England.
  {
    _id: "NEE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 38, economicLean: -4, socialLean: 2, turnout: 72 },
      urban_progressives: { population: 4, economicLean: -4, socialLean: -2, turnout: 72 },
      suburban_homeowners: { population: 6, economicLean: 2, socialLean: 2, turnout: 76 },
      young_renters: { population: 8, economicLean: -2, socialLean: -2, turnout: 61 },
      rural_traditionalists: { population: 7, economicLean: 3, socialLean: 4, turnout: 77 },
      retirees: { population: 10, economicLean: -1, socialLean: 3, turnout: 79 },
      public_sector: { population: 12, economicLean: -4, socialLean: -1, turnout: 73 },
      moderate_centrists: { population: 7, economicLean: 0, socialLean: -1, turnout: 71 },
      populist_right: { population: 1, economicLean: 0, socialLean: 5, turnout: 56 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 60 },
      small_business: { population: 5, economicLean: 3, socialLean: 2, turnout: 74 },
      new_britons: { population: 1, economicLean: -3, socialLean: 1, turnout: 50 },
    },
    lastUpdated: new Date(),
  },
  // ── Scotland ───────────────────────────────────────────────────────────────
  // Clydeside shipbuilding/heavy engineering, coal, peak council housing
  // (>50% of Scottish households). 1979: devolution referendum fell, SNP
  // slumped, Labour dominant in the central belt; rural Tory Scotland still real.
  {
    _id: "SCO",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 28, economicLean: -4, socialLean: 1, turnout: 74 },
      urban_progressives: { population: 6, economicLean: -4, socialLean: -2, turnout: 74 },
      suburban_homeowners: { population: 7, economicLean: 2, socialLean: 2, turnout: 76 },
      young_renters: { population: 10, economicLean: -2, socialLean: -2, turnout: 64 },
      rural_traditionalists: { population: 11, economicLean: 3, socialLean: 4, turnout: 76 },
      retirees: { population: 10, economicLean: 0, socialLean: 3, turnout: 79 },
      public_sector: { population: 11, economicLean: -4, socialLean: -1, turnout: 74 },
      moderate_centrists: { population: 8, economicLean: 0, socialLean: -1, turnout: 72 },
      populist_right: { population: 1, economicLean: 1, socialLean: 4, turnout: 56 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 60 },
      small_business: { population: 5, economicLean: 3, socialLean: 2, turnout: 74 },
      new_britons: { population: 2, economicLean: -3, socialLean: 1, turnout: 50 },
    },
    lastUpdated: new Date(),
  },
  // ── Wales ──────────────────────────────────────────────────────────────────
  // South Wales coal and steel (Port Talbot, Llanwern) at near-full strength;
  // valleys Labour loyalty absolute. 1979 devolution referendum lost 4:1.
  // Large public sector; rural Welsh-speaking west adds Plaid/rural strands.
  {
    _id: "WAL",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 30, economicLean: -4, socialLean: 1, turnout: 74 },
      urban_progressives: { population: 4, economicLean: -4, socialLean: -2, turnout: 72 },
      suburban_homeowners: { population: 6, economicLean: 2, socialLean: 2, turnout: 76 },
      young_renters: { population: 7, economicLean: -2, socialLean: -2, turnout: 62 },
      rural_traditionalists: { population: 15, economicLean: 2, socialLean: 4, turnout: 78 },
      retirees: { population: 10, economicLean: 0, socialLean: 3, turnout: 79 },
      public_sector: { population: 15, economicLean: -4, socialLean: -1, turnout: 74 },
      moderate_centrists: { population: 5, economicLean: 0, socialLean: -1, turnout: 71 },
      populist_right: { population: 1, economicLean: 0, socialLean: 5, turnout: 56 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 60 },
      small_business: { population: 5, economicLean: 3, socialLean: 2, turnout: 74 },
      new_britons: { population: 1, economicLean: -3, socialLean: 1, turnout: 48 },
    },
    lastUpdated: new Date(),
  },
  // ── Northern Ireland ───────────────────────────────────────────────────────
  // Troubles at their height. populist_right models hardline unionism (DUP
  // surging post-1979 Euro election, UUP base); shipbuilding (Harland & Wolff)
  // and textiles still employing; sectarian turnout very high.
  {
    _id: "NIR",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 22, economicLean: -3, socialLean: 3, turnout: 70 },
      urban_progressives: { population: 4, economicLean: -3, socialLean: -2, turnout: 66 },
      suburban_homeowners: { population: 4, economicLean: 2, socialLean: 3, turnout: 70 },
      young_renters: { population: 8, economicLean: -2, socialLean: 0, turnout: 60 },
      rural_traditionalists: { population: 12, economicLean: 2, socialLean: 5, turnout: 74 },
      retirees: { population: 7, economicLean: 0, socialLean: 4, turnout: 76 },
      public_sector: { population: 9, economicLean: -3, socialLean: 0, turnout: 70 },
      moderate_centrists: { population: 6, economicLean: 0, socialLean: -1, turnout: 66 },
      populist_right: { population: 24, economicLean: 1, socialLean: 5, turnout: 76 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 58 },
      small_business: { population: 2, economicLean: 3, socialLean: 3, turnout: 70 },
      new_britons: { population: 1, economicLean: -3, socialLean: 1, turnout: 46 },
    },
    lastUpdated: new Date(),
  },
];

export default ukRegionDemographics1979;
