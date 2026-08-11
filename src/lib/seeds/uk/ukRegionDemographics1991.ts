import type { StateDemographics } from "@/lib/db/types";

/**
 * UK region demographics — 1991 era (John Major's first years; run-up to the
 * 1992 general election).
 *
 * Every region × group value here was authored INDEPENDENTLY from the
 * historical record of early-1990s Britain — NOT derived by scaling the 2019
 * file or the old 1991 multiplier table. The same 12 region IDs and 12
 * voter-group IDs are used; populations sum to 100 per region.
 *
 * Era anchors:
 * - Deindustrialization well underway (manufacturing ~22% of GDP, down from
 *   the 1970s but far above 2019): post_industrial_workers still the largest
 *   bloc in the North, Scotland, and Wales, but well below 1979 levels and
 *   less monolithically left — Essex-man working-class Toryism is real
 *   (economicLean softened toward -2/-3, turnout off its 1979 peak).
 * - Right-to-Buy created a new suburban/estate homeowner bloc: the
 *   suburban_homeowners group is markedly larger than in 1979, especially in
 *   the South East, East, and Midlands — the core of Major's 1992 coalition.
 * - Greens tiny: the 1989 Euro-election blip (15%) had collapsed by 1991 —
 *   pinned at 1-2 everywhere.
 * - No UKIP, no Referendum Party yet: populist_right is fringe (~1-2), except
 *   Northern Ireland where it continues to model hardline unionism.
 * - Pre-Blair urban progressives modest; ethnic-minority population ~5-6%
 *   nationally, concentrated in London, the West Midlands, and northern
 *   textile towns.
 * - Liberal Democrats newly merged (1988) and recovering: moderate_centrists
 *   solid in the South West and southern England.
 * - Turnout still healthy (77.7% at the 1992 GE); pensioner turnout very
 *   high, young turnout lower than 1979 but well above modern lows.
 */
export const ukRegionDemographics1991: StateDemographics[] = [
  // ── London ─────────────────────────────────────────────────────────────────
  // Docklands redevelopment, Big Bang finance boom and bust, growing graduate
  // professional class; inner boroughs solidly Labour, suburbs Tory.
  {
    _id: "LON",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 11, economicLean: -3, socialLean: 1, turnout: 64 },
      urban_progressives: { population: 14, economicLean: -3, socialLean: -3, turnout: 74 },
      suburban_homeowners: { population: 10, economicLean: 3, socialLean: 2, turnout: 76 },
      young_renters: { population: 15, economicLean: -1, socialLean: -3, turnout: 60 },
      rural_traditionalists: { population: 1, economicLean: 3, socialLean: 4, turnout: 74 },
      retirees: { population: 7, economicLean: 0, socialLean: 3, turnout: 79 },
      public_sector: { population: 10, economicLean: -3, socialLean: -2, turnout: 72 },
      moderate_centrists: { population: 9, economicLean: 0, socialLean: -2, turnout: 72 },
      populist_right: { population: 2, economicLean: 0, socialLean: 5, turnout: 55 },
      green_activists: { population: 2, economicLean: -4, socialLean: -4, turnout: 62 },
      small_business: { population: 8, economicLean: 3, socialLean: 1, turnout: 74 },
      new_britons: { population: 11, economicLean: -3, socialLean: 0, turnout: 54 },
    },
    lastUpdated: new Date(),
  },
  // ── South East England ─────────────────────────────────────────────────────
  // The heartland of the property-owning democracy: Right-to-Buy plus the
  // 1980s housing boom (and the negative-equity hangover by 1991).
  {
    _id: "SEE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 11, economicLean: -2, socialLean: 2, turnout: 64 },
      urban_progressives: { population: 4, economicLean: -3, socialLean: -3, turnout: 73 },
      suburban_homeowners: { population: 22, economicLean: 3, socialLean: 2, turnout: 79 },
      young_renters: { population: 8, economicLean: -1, socialLean: -3, turnout: 60 },
      rural_traditionalists: { population: 14, economicLean: 3, socialLean: 4, turnout: 78 },
      retirees: { population: 12, economicLean: 1, socialLean: 3, turnout: 80 },
      public_sector: { population: 6, economicLean: -3, socialLean: -2, turnout: 72 },
      moderate_centrists: { population: 12, economicLean: 0, socialLean: -2, turnout: 74 },
      populist_right: { population: 1, economicLean: 1, socialLean: 5, turnout: 55 },
      green_activists: { population: 2, economicLean: -4, socialLean: -4, turnout: 62 },
      small_business: { population: 7, economicLean: 3, socialLean: 1, turnout: 76 },
      new_britons: { population: 1, economicLean: -3, socialLean: 0, turnout: 50 },
    },
    lastUpdated: new Date(),
  },
  // ── South West England ─────────────────────────────────────────────────────
  // Rural-retirement Toryism with the strongest Lib Dem challenge in Britain
  // (Paddy Ashdown's Yeovil, Cornwall/Devon targets in 1992).
  {
    _id: "SWE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 10, economicLean: -2, socialLean: 2, turnout: 64 },
      urban_progressives: { population: 4, economicLean: -3, socialLean: -3, turnout: 72 },
      suburban_homeowners: { population: 16, economicLean: 3, socialLean: 2, turnout: 78 },
      young_renters: { population: 7, economicLean: -1, socialLean: -3, turnout: 58 },
      rural_traditionalists: { population: 17, economicLean: 3, socialLean: 4, turnout: 78 },
      retirees: { population: 14, economicLean: 1, socialLean: 3, turnout: 81 },
      public_sector: { population: 6, economicLean: -3, socialLean: -2, turnout: 71 },
      moderate_centrists: { population: 15, economicLean: 0, socialLean: -2, turnout: 75 },
      populist_right: { population: 1, economicLean: 1, socialLean: 5, turnout: 55 },
      green_activists: { population: 2, economicLean: -4, socialLean: -4, turnout: 62 },
      small_business: { population: 7, economicLean: 3, socialLean: 1, turnout: 76 },
      new_britons: { population: 1, economicLean: -3, socialLean: 0, turnout: 48 },
    },
    lastUpdated: new Date(),
  },
  // ── East of England ────────────────────────────────────────────────────────
  // "Essex man" territory: new-town Right-to-Buy owners (Basildon 1992 the
  // emblem) alongside arable farming and market-town Conservatism.
  {
    _id: "EAE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 12, economicLean: -2, socialLean: 2, turnout: 64 },
      urban_progressives: { population: 4, economicLean: -3, socialLean: -3, turnout: 72 },
      suburban_homeowners: { population: 19, economicLean: 3, socialLean: 2, turnout: 78 },
      young_renters: { population: 8, economicLean: -1, socialLean: -3, turnout: 58 },
      rural_traditionalists: { population: 17, economicLean: 3, socialLean: 4, turnout: 77 },
      retirees: { population: 12, economicLean: 1, socialLean: 3, turnout: 80 },
      public_sector: { population: 6, economicLean: -3, socialLean: -2, turnout: 71 },
      moderate_centrists: { population: 11, economicLean: 0, socialLean: -2, turnout: 73 },
      populist_right: { population: 1, economicLean: 1, socialLean: 5, turnout: 55 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 60 },
      small_business: { population: 8, economicLean: 3, socialLean: 1, turnout: 75 },
      new_britons: { population: 1, economicLean: -3, socialLean: 0, turnout: 48 },
    },
    lastUpdated: new Date(),
  },
  // ── East Midlands ──────────────────────────────────────────────────────────
  // Pits closing but not yet gone (post-1984 strike); engineering and hosiery
  // shrinking; skilled workers who bought their council houses trending Tory.
  {
    _id: "EMI",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 21, economicLean: -2, socialLean: 2, turnout: 66 },
      urban_progressives: { population: 4, economicLean: -3, socialLean: -3, turnout: 71 },
      suburban_homeowners: { population: 15, economicLean: 2, socialLean: 2, turnout: 77 },
      young_renters: { population: 8, economicLean: -1, socialLean: -3, turnout: 58 },
      rural_traditionalists: { population: 13, economicLean: 3, socialLean: 4, turnout: 77 },
      retirees: { population: 9, economicLean: 1, socialLean: 3, turnout: 79 },
      public_sector: { population: 6, economicLean: -3, socialLean: -2, turnout: 71 },
      moderate_centrists: { population: 8, economicLean: 0, socialLean: -2, turnout: 71 },
      populist_right: { population: 2, economicLean: 0, socialLean: 5, turnout: 55 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 60 },
      small_business: { population: 7, economicLean: 3, socialLean: 1, turnout: 74 },
      new_britons: { population: 6, economicLean: -3, socialLean: 0, turnout: 52 },
    },
    lastUpdated: new Date(),
  },
  // ── West Midlands ──────────────────────────────────────────────────────────
  // Hit hardest by the early-80s manufacturing collapse; car industry shrunken
  // but surviving (Rover). Large, established South Asian communities.
  {
    _id: "WMI",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 22, economicLean: -3, socialLean: 2, turnout: 66 },
      urban_progressives: { population: 6, economicLean: -3, socialLean: -3, turnout: 71 },
      suburban_homeowners: { population: 13, economicLean: 2, socialLean: 2, turnout: 77 },
      young_renters: { population: 9, economicLean: -1, socialLean: -3, turnout: 58 },
      rural_traditionalists: { population: 8, economicLean: 3, socialLean: 4, turnout: 77 },
      retirees: { population: 9, economicLean: 1, socialLean: 3, turnout: 79 },
      public_sector: { population: 6, economicLean: -3, socialLean: -2, turnout: 71 },
      moderate_centrists: { population: 7, economicLean: 0, socialLean: -2, turnout: 70 },
      populist_right: { population: 2, economicLean: 0, socialLean: 5, turnout: 55 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 60 },
      small_business: { population: 7, economicLean: 3, socialLean: 1, turnout: 73 },
      new_britons: { population: 10, economicLean: -3, socialLean: 0, turnout: 53 },
    },
    lastUpdated: new Date(),
  },
  // ── Yorkshire & the Humber ─────────────────────────────────────────────────
  // Post-strike coalfields in terminal decline, Sheffield steel halved;
  // Bradford/Kirklees textile communities now a settled minority population.
  {
    _id: "YHU",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 24, economicLean: -3, socialLean: 2, turnout: 66 },
      urban_progressives: { population: 6, economicLean: -3, socialLean: -3, turnout: 71 },
      suburban_homeowners: { population: 12, economicLean: 2, socialLean: 2, turnout: 76 },
      young_renters: { population: 9, economicLean: -1, socialLean: -3, turnout: 58 },
      rural_traditionalists: { population: 10, economicLean: 3, socialLean: 4, turnout: 77 },
      retirees: { population: 10, economicLean: 0, socialLean: 3, turnout: 79 },
      public_sector: { population: 7, economicLean: -3, socialLean: -2, turnout: 71 },
      moderate_centrists: { population: 7, economicLean: 0, socialLean: -2, turnout: 70 },
      populist_right: { population: 2, economicLean: 0, socialLean: 5, turnout: 55 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 60 },
      small_business: { population: 5, economicLean: 3, socialLean: 1, turnout: 73 },
      new_britons: { population: 7, economicLean: -3, socialLean: 0, turnout: 52 },
    },
    lastUpdated: new Date(),
  },
  // ── North West England ─────────────────────────────────────────────────────
  // Merseyside militancy era just ended (Hatton ousted 1986); Manchester
  // beginning its regeneration; cotton towns post-industrial and Labour.
  {
    _id: "NWE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 25, economicLean: -3, socialLean: 2, turnout: 66 },
      urban_progressives: { population: 7, economicLean: -3, socialLean: -3, turnout: 71 },
      suburban_homeowners: { population: 11, economicLean: 2, socialLean: 2, turnout: 76 },
      young_renters: { population: 10, economicLean: -1, socialLean: -3, turnout: 58 },
      rural_traditionalists: { population: 7, economicLean: 3, socialLean: 4, turnout: 76 },
      retirees: { population: 10, economicLean: 0, socialLean: 3, turnout: 79 },
      public_sector: { population: 7, economicLean: -3, socialLean: -2, turnout: 71 },
      moderate_centrists: { population: 7, economicLean: 0, socialLean: -2, turnout: 70 },
      populist_right: { population: 2, economicLean: 0, socialLean: 5, turnout: 55 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 60 },
      small_business: { population: 5, economicLean: 3, socialLean: 1, turnout: 72 },
      new_britons: { population: 8, economicLean: -3, socialLean: 0, turnout: 52 },
    },
    lastUpdated: new Date(),
  },
  // ── North East England ─────────────────────────────────────────────────────
  // Shipyards closing (Sunderland 1988), Consett steel gone (1980), but
  // Nissan arrives (1986): an economy in painful transition, still the most
  // Labour region in England.
  {
    _id: "NEE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 31, economicLean: -3, socialLean: 2, turnout: 66 },
      urban_progressives: { population: 5, economicLean: -3, socialLean: -3, turnout: 70 },
      suburban_homeowners: { population: 9, economicLean: 2, socialLean: 2, turnout: 75 },
      young_renters: { population: 9, economicLean: -2, socialLean: -3, turnout: 57 },
      rural_traditionalists: { population: 7, economicLean: 3, socialLean: 4, turnout: 76 },
      retirees: { population: 11, economicLean: -1, socialLean: 3, turnout: 78 },
      public_sector: { population: 10, economicLean: -3, socialLean: -2, turnout: 71 },
      moderate_centrists: { population: 8, economicLean: 0, socialLean: -2, turnout: 69 },
      populist_right: { population: 2, economicLean: 0, socialLean: 5, turnout: 54 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 60 },
      small_business: { population: 5, economicLean: 3, socialLean: 1, turnout: 72 },
      new_britons: { population: 2, economicLean: -3, socialLean: 0, turnout: 48 },
    },
    lastUpdated: new Date(),
  },
  // ── Scotland ───────────────────────────────────────────────────────────────
  // Ravenscraig on the brink, poll-tax revolt fresh (introduced in Scotland
  // 1989), Tory Scotland collapsing toward its 1997 wipeout; SNP's "Free by
  // '93" surge modelled through the left-leaning mix.
  {
    _id: "SCO",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 23, economicLean: -3, socialLean: 1, turnout: 70 },
      urban_progressives: { population: 9, economicLean: -3, socialLean: -3, turnout: 72 },
      suburban_homeowners: { population: 9, economicLean: 2, socialLean: 2, turnout: 74 },
      young_renters: { population: 11, economicLean: -2, socialLean: -3, turnout: 60 },
      rural_traditionalists: { population: 10, economicLean: 3, socialLean: 4, turnout: 74 },
      retirees: { population: 11, economicLean: 0, socialLean: 3, turnout: 78 },
      public_sector: { population: 9, economicLean: -3, socialLean: -2, turnout: 72 },
      moderate_centrists: { population: 8, economicLean: 0, socialLean: -2, turnout: 70 },
      populist_right: { population: 2, economicLean: 1, socialLean: 4, turnout: 54 },
      green_activists: { population: 2, economicLean: -4, socialLean: -4, turnout: 60 },
      small_business: { population: 4, economicLean: 3, socialLean: 1, turnout: 72 },
      new_britons: { population: 2, economicLean: -3, socialLean: 0, turnout: 48 },
    },
    lastUpdated: new Date(),
  },
  // ── Wales ──────────────────────────────────────────────────────────────────
  // Coal nearly finished (a handful of pits left), steel consolidated but
  // surviving; inward-investment branch plants arriving; public sector and
  // valleys Labour loyalty still defining.
  {
    _id: "WAL",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 24, economicLean: -3, socialLean: 1, turnout: 70 },
      urban_progressives: { population: 6, economicLean: -3, socialLean: -3, turnout: 70 },
      suburban_homeowners: { population: 9, economicLean: 2, socialLean: 2, turnout: 74 },
      young_renters: { population: 7, economicLean: -2, socialLean: -3, turnout: 58 },
      rural_traditionalists: { population: 14, economicLean: 2, socialLean: 4, turnout: 77 },
      retirees: { population: 11, economicLean: 0, socialLean: 3, turnout: 78 },
      public_sector: { population: 15, economicLean: -3, socialLean: -2, turnout: 72 },
      moderate_centrists: { population: 5, economicLean: 0, socialLean: -2, turnout: 68 },
      populist_right: { population: 2, economicLean: 0, socialLean: 5, turnout: 54 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 60 },
      small_business: { population: 5, economicLean: 3, socialLean: 1, turnout: 72 },
      new_britons: { population: 1, economicLean: -3, socialLean: 0, turnout: 46 },
    },
    lastUpdated: new Date(),
  },
  // ── Northern Ireland ───────────────────────────────────────────────────────
  // Troubles ongoing but Brooke talks beginning (1991); populist_right still
  // models hardline unionism; Alliance's cross-community centre modest;
  // heavy security-related public-sector employment.
  {
    _id: "NIR",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 20, economicLean: -3, socialLean: 3, turnout: 68 },
      urban_progressives: { population: 6, economicLean: -3, socialLean: -2, turnout: 64 },
      suburban_homeowners: { population: 5, economicLean: 2, socialLean: 3, turnout: 68 },
      young_renters: { population: 8, economicLean: -2, socialLean: -1, turnout: 58 },
      rural_traditionalists: { population: 10, economicLean: 2, socialLean: 5, turnout: 72 },
      retirees: { population: 7, economicLean: 0, socialLean: 4, turnout: 75 },
      public_sector: { population: 8, economicLean: -3, socialLean: 0, turnout: 69 },
      moderate_centrists: { population: 8, economicLean: 0, socialLean: -1, turnout: 64 },
      populist_right: { population: 23, economicLean: 1, socialLean: 5, turnout: 74 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 56 },
      small_business: { population: 3, economicLean: 3, socialLean: 3, turnout: 68 },
      new_britons: { population: 1, economicLean: -3, socialLean: 0, turnout: 44 },
    },
    lastUpdated: new Date(),
  },
];

export default ukRegionDemographics1991;
