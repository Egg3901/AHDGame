import type { StateDemographics } from "@/lib/db/types";

/**
 * UK region demographics — 2007 era (Blair-to-Brown handover).
 *
 * Era anchor: Labour's third term, pre-crash boom. The 2004 EU-accession
 * migration wave is visibly growing the new-migrant bloc in eastern farming
 * counties, the Midlands and London. London and the South East are heavily
 * financialized — a swelling, prosperous suburban/commuter electorate. Urban
 * progressives are numerous but soured by Iraq (depressed turnout, drift to
 * the Lib Dems). UKIP and the BNP are stirring — the populist right is a real
 * if still small bloc, strongest in Essex/fens and northern towns. Cameron's
 * decontaminating Conservatives are reviving suburban turnout. Scotland is on
 * the eve of the SNP's first Holyrood win; NI has just seen the DUP/Sinn Fein
 * displacement of UUP/SDLP. Turnout overall remains depressed (2005 GE: 61%).
 *
 * Methodology: every region x group value was authored independently from
 * historical knowledge of mid-2000s UK politics (2005 GE results by region,
 * 2007 Holyrood/Senedd elections, 2004-07 migration statistics). Values were
 * NOT derived by scaling the 2019 or 1999 files; only the region IDs, group
 * IDs and the 100-point population convention are shared.
 */
export const ukRegionDemographics2007: StateDemographics[] = [
  // ── London ─────────────────────────────────────────────────────────────────
  // Financial-boom London: young, increasingly diverse, Livingstone-era
  // progressive politics, accession-wave migrants arriving in volume.
  {
    _id: "LON",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 8, economicLean: -3, socialLean: 1, turnout: 54 },
      urban_progressives: { population: 18, economicLean: -3, socialLean: -3, turnout: 64 },
      suburban_homeowners: { population: 8, economicLean: 2, socialLean: 1, turnout: 67 },
      young_renters: { population: 16, economicLean: -1, socialLean: -3, turnout: 50 },
      rural_traditionalists: { population: 2, economicLean: 3, socialLean: 3, turnout: 69 },
      retirees: { population: 6, economicLean: 1, socialLean: 2, turnout: 70 },
      public_sector: { population: 10, economicLean: -3, socialLean: -2, turnout: 65 },
      moderate_centrists: { population: 10, economicLean: 0, socialLean: -1, turnout: 62 },
      populist_right: { population: 3, economicLean: 1, socialLean: 4, turnout: 48 },
      green_activists: { population: 3, economicLean: -4, socialLean: -4, turnout: 60 },
      small_business: { population: 5, economicLean: 3, socialLean: 1, turnout: 67 },
      new_britons: { population: 11, economicLean: -2, socialLean: 0, turnout: 42 },
    },
    lastUpdated: new Date(),
  },
  // ── South East England ─────────────────────────────────────────────────────
  // Commuter belt riding the financial boom; Cameron's revival strongest here.
  {
    _id: "SEE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 11, economicLean: -3, socialLean: 1, turnout: 55 },
      urban_progressives: { population: 5, economicLean: -3, socialLean: -3, turnout: 64 },
      suburban_homeowners: { population: 19, economicLean: 2, socialLean: 1, turnout: 69 },
      young_renters: { population: 8, economicLean: -1, socialLean: -3, turnout: 50 },
      rural_traditionalists: { population: 13, economicLean: 3, socialLean: 3, turnout: 71 },
      retirees: { population: 12, economicLean: 1, socialLean: 2, turnout: 72 },
      public_sector: { population: 5, economicLean: -3, socialLean: -2, turnout: 65 },
      moderate_centrists: { population: 13, economicLean: 0, socialLean: -1, turnout: 63 },
      populist_right: { population: 4, economicLean: 1, socialLean: 4, turnout: 50 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 59 },
      small_business: { population: 8, economicLean: 3, socialLean: 1, turnout: 68 },
      new_britons: { population: 1, economicLean: -2, socialLean: 0, turnout: 42 },
    },
    lastUpdated: new Date(),
  },
  // ── South West England ─────────────────────────────────────────────────────
  // Still the LibDems' strongest region; retirees and rural traditionalists
  // numerous; UKIP's earliest grassroots (its 2009-era bastion) emerging.
  {
    _id: "SWE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 10, economicLean: -3, socialLean: 1, turnout: 55 },
      urban_progressives: { population: 5, economicLean: -3, socialLean: -3, turnout: 64 },
      suburban_homeowners: { population: 13, economicLean: 2, socialLean: 1, turnout: 68 },
      young_renters: { population: 7, economicLean: -1, socialLean: -3, turnout: 50 },
      rural_traditionalists: { population: 14, economicLean: 3, socialLean: 3, turnout: 71 },
      retirees: { population: 13, economicLean: 1, socialLean: 2, turnout: 73 },
      public_sector: { population: 5, economicLean: -3, socialLean: -2, turnout: 65 },
      moderate_centrists: { population: 18, economicLean: 0, socialLean: -1, turnout: 64 },
      populist_right: { population: 4, economicLean: 1, socialLean: 4, turnout: 51 },
      green_activists: { population: 3, economicLean: -4, socialLean: -4, turnout: 60 },
      small_business: { population: 7, economicLean: 3, socialLean: 1, turnout: 68 },
      new_britons: { population: 1, economicLean: -2, socialLean: 0, turnout: 41 },
    },
    lastUpdated: new Date(),
  },
  // ── East of England ────────────────────────────────────────────────────────
  // Fenland farms drawing the accession migration wave (Peterborough, Boston
  // hinterland); Essex euroscepticism giving early UKIP its strongest soil.
  {
    _id: "EAE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 12, economicLean: -3, socialLean: 1, turnout: 54 },
      urban_progressives: { population: 5, economicLean: -3, socialLean: -3, turnout: 64 },
      suburban_homeowners: { population: 17, economicLean: 2, socialLean: 1, turnout: 68 },
      young_renters: { population: 8, economicLean: -1, socialLean: -3, turnout: 50 },
      rural_traditionalists: { population: 15, economicLean: 3, socialLean: 3, turnout: 70 },
      retirees: { population: 12, economicLean: 1, socialLean: 2, turnout: 72 },
      public_sector: { population: 4, economicLean: -3, socialLean: -2, turnout: 64 },
      moderate_centrists: { population: 12, economicLean: 0, socialLean: -1, turnout: 62 },
      populist_right: { population: 5, economicLean: 1, socialLean: 4, turnout: 51 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 59 },
      small_business: { population: 7, economicLean: 3, socialLean: 1, turnout: 68 },
      new_britons: { population: 2, economicLean: -2, socialLean: 0, turnout: 38 },
    },
    lastUpdated: new Date(),
  },
  // ── East Midlands ──────────────────────────────────────────────────────────
  // Post-industrial towns still Labour but loosening; accession migrants in
  // food-processing belts; BNP flickering in old coalfield wards.
  {
    _id: "EMI",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 21, economicLean: -3, socialLean: 1, turnout: 55 },
      urban_progressives: { population: 4, economicLean: -3, socialLean: -3, turnout: 63 },
      suburban_homeowners: { population: 13, economicLean: 2, socialLean: 1, turnout: 68 },
      young_renters: { population: 7, economicLean: -1, socialLean: -3, turnout: 49 },
      rural_traditionalists: { population: 12, economicLean: 3, socialLean: 3, turnout: 70 },
      retirees: { population: 10, economicLean: 1, socialLean: 2, turnout: 71 },
      public_sector: { population: 5, economicLean: -3, socialLean: -2, turnout: 64 },
      moderate_centrists: { population: 9, economicLean: 0, socialLean: -1, turnout: 61 },
      populist_right: { population: 5, economicLean: 1, socialLean: 4, turnout: 51 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 58 },
      small_business: { population: 6, economicLean: 3, socialLean: 1, turnout: 67 },
      new_britons: { population: 7, economicLean: -2, socialLean: 0, turnout: 42 },
    },
    lastUpdated: new Date(),
  },
  // ── West Midlands ──────────────────────────────────────────────────────────
  // MG Rover's 2005 collapse fresh; Birmingham diverse and growing more so;
  // BNP/early-UKIP presence in the Black Country.
  {
    _id: "WMI",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 20, economicLean: -3, socialLean: 1, turnout: 55 },
      urban_progressives: { population: 7, economicLean: -3, socialLean: -3, turnout: 63 },
      suburban_homeowners: { population: 12, economicLean: 2, socialLean: 1, turnout: 68 },
      young_renters: { population: 9, economicLean: -1, socialLean: -3, turnout: 49 },
      rural_traditionalists: { population: 7, economicLean: 3, socialLean: 3, turnout: 70 },
      retirees: { population: 9, economicLean: 1, socialLean: 2, turnout: 71 },
      public_sector: { population: 6, economicLean: -3, socialLean: -2, turnout: 64 },
      moderate_centrists: { population: 8, economicLean: 0, socialLean: -1, turnout: 61 },
      populist_right: { population: 5, economicLean: 1, socialLean: 4, turnout: 51 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 58 },
      small_business: { population: 5, economicLean: 3, socialLean: 1, turnout: 66 },
      new_britons: { population: 11, economicLean: -2, socialLean: 0, turnout: 44 },
    },
    lastUpdated: new Date(),
  },
  // ── Yorkshire & the Humber ─────────────────────────────────────────────────
  // Labour heartland with cracks showing: BNP council wins around Barnsley and
  // Bradford's 2001-riot aftermath; Leeds services boom growing the centre.
  {
    _id: "YHU",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 21, economicLean: -3, socialLean: 1, turnout: 55 },
      urban_progressives: { population: 6, economicLean: -3, socialLean: -3, turnout: 63 },
      suburban_homeowners: { population: 10, economicLean: 2, socialLean: 1, turnout: 67 },
      young_renters: { population: 9, economicLean: -1, socialLean: -3, turnout: 49 },
      rural_traditionalists: { population: 10, economicLean: 3, socialLean: 3, turnout: 70 },
      retirees: { population: 11, economicLean: 1, socialLean: 2, turnout: 71 },
      public_sector: { population: 6, economicLean: -3, socialLean: -2, turnout: 64 },
      moderate_centrists: { population: 8, economicLean: 0, socialLean: -1, turnout: 61 },
      populist_right: { population: 6, economicLean: 1, socialLean: 4, turnout: 52 },
      green_activists: { population: 2, economicLean: -4, socialLean: -4, turnout: 58 },
      small_business: { population: 4, economicLean: 3, socialLean: 1, turnout: 66 },
      new_britons: { population: 7, economicLean: -2, socialLean: 0, turnout: 43 },
    },
    lastUpdated: new Date(),
  },
  // ── North West England ─────────────────────────────────────────────────────
  // Manchester's regeneration in full swing (growing progressive/renter core);
  // mill-town Labourism eroding at the edges; BNP active in east Lancashire.
  {
    _id: "NWE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 24, economicLean: -3, socialLean: 1, turnout: 55 },
      urban_progressives: { population: 8, economicLean: -3, socialLean: -3, turnout: 63 },
      suburban_homeowners: { population: 9, economicLean: 2, socialLean: 1, turnout: 67 },
      young_renters: { population: 9, economicLean: -1, socialLean: -3, turnout: 49 },
      rural_traditionalists: { population: 7, economicLean: 3, socialLean: 3, turnout: 70 },
      retirees: { population: 11, economicLean: 1, socialLean: 2, turnout: 71 },
      public_sector: { population: 6, economicLean: -3, socialLean: -2, turnout: 64 },
      moderate_centrists: { population: 8, economicLean: 0, socialLean: -1, turnout: 61 },
      populist_right: { population: 5, economicLean: 1, socialLean: 4, turnout: 51 },
      green_activists: { population: 2, economicLean: -4, socialLean: -4, turnout: 58 },
      small_business: { population: 3, economicLean: 3, socialLean: 1, turnout: 65 },
      new_britons: { population: 8, economicLean: -2, socialLean: 0, turnout: 43 },
    },
    lastUpdated: new Date(),
  },
  // ── North East England ─────────────────────────────────────────────────────
  // Still overwhelmingly Labour but post-industrial loyalty fraying; 2004
  // regional-assembly referendum rejection signalled anti-politics mood.
  {
    _id: "NEE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 30, economicLean: -3, socialLean: 1, turnout: 55 },
      urban_progressives: { population: 6, economicLean: -3, socialLean: -3, turnout: 62 },
      suburban_homeowners: { population: 7, economicLean: 2, socialLean: 1, turnout: 66 },
      young_renters: { population: 8, economicLean: -1, socialLean: -3, turnout: 48 },
      rural_traditionalists: { population: 7, economicLean: 3, socialLean: 3, turnout: 69 },
      retirees: { population: 12, economicLean: 0, socialLean: 2, turnout: 70 },
      public_sector: { population: 8, economicLean: -3, socialLean: -2, turnout: 64 },
      moderate_centrists: { population: 7, economicLean: 0, socialLean: -1, turnout: 60 },
      populist_right: { population: 7, economicLean: 1, socialLean: 4, turnout: 52 },
      green_activists: { population: 2, economicLean: -4, socialLean: -4, turnout: 58 },
      small_business: { population: 2, economicLean: 3, socialLean: 1, turnout: 64 },
      new_britons: { population: 4, economicLean: -2, socialLean: 0, turnout: 40 },
    },
    lastUpdated: new Date(),
  },
  // ── Scotland ───────────────────────────────────────────────────────────────
  // May 2007: the SNP edges Labour at Holyrood for the first time. Politics
  // still left-of-centre across the board; the right marginal; Greens hold
  // Holyrood seats.
  {
    _id: "SCO",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 19, economicLean: -3, socialLean: 1, turnout: 57 },
      urban_progressives: { population: 12, economicLean: -3, socialLean: -3, turnout: 65 },
      suburban_homeowners: { population: 9, economicLean: 2, socialLean: 1, turnout: 67 },
      young_renters: { population: 11, economicLean: -1, socialLean: -3, turnout: 51 },
      rural_traditionalists: { population: 9, economicLean: 2, socialLean: 3, turnout: 68 },
      retirees: { population: 12, economicLean: 0, socialLean: 2, turnout: 71 },
      public_sector: { population: 9, economicLean: -3, socialLean: -2, turnout: 66 },
      moderate_centrists: { population: 10, economicLean: 0, socialLean: -1, turnout: 62 },
      populist_right: { population: 2, economicLean: 1, socialLean: 3, turnout: 46 },
      green_activists: { population: 3, economicLean: -4, socialLean: -4, turnout: 60 },
      small_business: { population: 3, economicLean: 3, socialLean: 1, turnout: 65 },
      new_britons: { population: 1, economicLean: -2, socialLean: 0, turnout: 42 },
    },
    lastUpdated: new Date(),
  },
  // ── Wales ──────────────────────────────────────────────────────────────────
  // 2007 Senedd election yields the Labour–Plaid "One Wales" coalition;
  // valleys Labourism still strong but thinning; public sector dominant.
  {
    _id: "WAL",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 21, economicLean: -3, socialLean: 1, turnout: 56 },
      urban_progressives: { population: 7, economicLean: -3, socialLean: -3, turnout: 63 },
      suburban_homeowners: { population: 9, economicLean: 2, socialLean: 1, turnout: 67 },
      young_renters: { population: 7, economicLean: -1, socialLean: -3, turnout: 49 },
      rural_traditionalists: { population: 13, economicLean: 2, socialLean: 3, turnout: 69 },
      retirees: { population: 12, economicLean: 0, socialLean: 2, turnout: 70 },
      public_sector: { population: 15, economicLean: -3, socialLean: -2, turnout: 65 },
      moderate_centrists: { population: 6, economicLean: 0, socialLean: -1, turnout: 60 },
      populist_right: { population: 3, economicLean: 1, socialLean: 4, turnout: 49 },
      green_activists: { population: 2, economicLean: -4, socialLean: -4, turnout: 58 },
      small_business: { population: 3, economicLean: 3, socialLean: 1, turnout: 64 },
      new_britons: { population: 2, economicLean: -2, socialLean: 0, turnout: 39 },
    },
    lastUpdated: new Date(),
  },
  // ── Northern Ireland ───────────────────────────────────────────────────────
  // St Andrews restoration year: DUP and Sinn Fein now the two poles (the DUP
  // surge keeps populist_right large and mobilized); Alliance centre still
  // modest; politics highly polarized, turnout strong by GB standards.
  {
    _id: "NIR",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 20, economicLean: -2, socialLean: 2, turnout: 62 },
      urban_progressives: { population: 9, economicLean: -3, socialLean: -2, turnout: 61 },
      suburban_homeowners: { population: 6, economicLean: 2, socialLean: 2, turnout: 63 },
      young_renters: { population: 8, economicLean: -1, socialLean: -2, turnout: 52 },
      rural_traditionalists: { population: 9, economicLean: 2, socialLean: 4, turnout: 68 },
      retirees: { population: 7, economicLean: 1, socialLean: 3, turnout: 70 },
      public_sector: { population: 7, economicLean: -3, socialLean: -1, turnout: 66 },
      moderate_centrists: { population: 12, economicLean: 0, socialLean: -1, turnout: 62 },
      populist_right: { population: 17, economicLean: 1, socialLean: 5, turnout: 67 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 57 },
      small_business: { population: 2, economicLean: 3, socialLean: 2, turnout: 63 },
      new_britons: { population: 2, economicLean: -2, socialLean: 0, turnout: 38 },
    },
    lastUpdated: new Date(),
  },
];

export default ukRegionDemographics2007;
