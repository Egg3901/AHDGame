import type { StateDemographics } from "@/lib/db/types";

/**
 * UK region demographics — 1999 era (Blair's first term).
 *
 * Era anchor: New Labour hegemonic after the 1997 landslide. The post-industrial
 * working class is still numerically dominant in the North, Wales, Scotland and
 * the Midlands and votes solidly Labour on economics while remaining socially
 * traditional only mildly. Urban progressives are a rising but not yet dominant
 * urban bloc; graduates have not yet realigned sharply left on social issues.
 * The populist right barely exists (Referendum Party/early UKIP residue);
 * Greens are marginal. Pensioner Conservatism is at a low ebb (many 1999
 * retirees were wartime-generation Labour voters). The new-migrant bloc is
 * small outside London/West Midlands (pre-2004 EU accession). Turnout is
 * sliding toward the 2001 slump: complacent Labour-leaning groups in safe
 * seats turn out poorly, while older and rural voters remain reliable.
 *
 * Methodology: every region x group value was authored independently from
 * historical knowledge of late-1990s UK politics (1997 GE results by region,
 * 1999 devolution-era Scotland/Wales, pre-Good Friday-settlement NI politics).
 * Values were NOT derived by scaling the 2019 file; only the region IDs,
 * group IDs and the 100-point population convention are shared.
 */
export const ukRegionDemographics1999: StateDemographics[] = [
  // ── London ─────────────────────────────────────────────────────────────────
  // Cosmopolitan but pre-financial-boom; strong Labour, large established
  // minority communities, public-sector heavy inner boroughs.
  {
    _id: "LON",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 10, economicLean: -3, socialLean: 1, turnout: 58 },
      urban_progressives: { population: 16, economicLean: -3, socialLean: -3, turnout: 69 },
      suburban_homeowners: { population: 8, economicLean: 2, socialLean: 1, turnout: 70 },
      young_renters: { population: 14, economicLean: -2, socialLean: -2, turnout: 54 },
      rural_traditionalists: { population: 2, economicLean: 3, socialLean: 3, turnout: 70 },
      retirees: { population: 7, economicLean: 0, socialLean: 2, turnout: 70 },
      public_sector: { population: 11, economicLean: -3, socialLean: -2, turnout: 67 },
      moderate_centrists: { population: 12, economicLean: 0, socialLean: -1, turnout: 64 },
      populist_right: { population: 2, economicLean: 1, socialLean: 3, turnout: 44 },
      green_activists: { population: 2, economicLean: -4, socialLean: -4, turnout: 58 },
      small_business: { population: 7, economicLean: 3, socialLean: 1, turnout: 68 },
      new_britons: { population: 9, economicLean: -3, socialLean: 0, turnout: 50 },
    },
    lastUpdated: new Date(),
  },
  // ── South East England ─────────────────────────────────────────────────────
  // Tory heartland licking its 1997 wounds; large mortgage-belt suburbia and a
  // big Blair-curious centrist flank.
  {
    _id: "SEE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 12, economicLean: -3, socialLean: 1, turnout: 58 },
      urban_progressives: { population: 4, economicLean: -3, socialLean: -3, turnout: 68 },
      suburban_homeowners: { population: 19, economicLean: 2, socialLean: 2, turnout: 71 },
      young_renters: { population: 7, economicLean: -2, socialLean: -2, turnout: 54 },
      rural_traditionalists: { population: 14, economicLean: 3, socialLean: 3, turnout: 72 },
      retirees: { population: 11, economicLean: 1, socialLean: 2, turnout: 71 },
      public_sector: { population: 6, economicLean: -3, socialLean: -2, turnout: 66 },
      moderate_centrists: { population: 15, economicLean: 0, socialLean: -1, turnout: 65 },
      populist_right: { population: 2, economicLean: 1, socialLean: 3, turnout: 46 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 57 },
      small_business: { population: 8, economicLean: 3, socialLean: 1, turnout: 69 },
      new_britons: { population: 1, economicLean: -3, socialLean: 0, turnout: 46 },
    },
    lastUpdated: new Date(),
  },
  // ── South West England ─────────────────────────────────────────────────────
  // LibDem high-water-mark country: huge centrist bloc, rural and retired,
  // very little ethnic diversity, no populist right to speak of.
  {
    _id: "SWE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 11, economicLean: -3, socialLean: 1, turnout: 58 },
      urban_progressives: { population: 4, economicLean: -3, socialLean: -3, turnout: 67 },
      suburban_homeowners: { population: 13, economicLean: 2, socialLean: 2, turnout: 70 },
      young_renters: { population: 6, economicLean: -2, socialLean: -2, turnout: 53 },
      rural_traditionalists: { population: 15, economicLean: 3, socialLean: 3, turnout: 72 },
      retirees: { population: 13, economicLean: 1, socialLean: 2, turnout: 72 },
      public_sector: { population: 6, economicLean: -3, socialLean: -2, turnout: 66 },
      moderate_centrists: { population: 19, economicLean: 0, socialLean: -1, turnout: 66 },
      populist_right: { population: 2, economicLean: 1, socialLean: 3, turnout: 45 },
      green_activists: { population: 2, economicLean: -4, socialLean: -4, turnout: 58 },
      small_business: { population: 8, economicLean: 3, socialLean: 1, turnout: 69 },
      new_britons: { population: 1, economicLean: -3, socialLean: 0, turnout: 45 },
    },
    lastUpdated: new Date(),
  },
  // ── East of England ────────────────────────────────────────────────────────
  // Essex/Herts new towns swung hard to Blair in 1997; fenland farming belt
  // stays Tory. Eurosceptic undertow exists but has no electoral vehicle yet.
  {
    _id: "EAE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 13, economicLean: -3, socialLean: 1, turnout: 57 },
      urban_progressives: { population: 4, economicLean: -3, socialLean: -3, turnout: 67 },
      suburban_homeowners: { population: 17, economicLean: 2, socialLean: 2, turnout: 70 },
      young_renters: { population: 7, economicLean: -2, socialLean: -2, turnout: 53 },
      rural_traditionalists: { population: 16, economicLean: 3, socialLean: 3, turnout: 71 },
      retirees: { population: 12, economicLean: 1, socialLean: 2, turnout: 71 },
      public_sector: { population: 5, economicLean: -3, socialLean: -2, turnout: 65 },
      moderate_centrists: { population: 14, economicLean: 0, socialLean: -1, turnout: 64 },
      populist_right: { population: 2, economicLean: 1, socialLean: 3, turnout: 46 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 57 },
      small_business: { population: 8, economicLean: 3, socialLean: 1, turnout: 69 },
      new_britons: { population: 1, economicLean: -3, socialLean: 0, turnout: 45 },
    },
    lastUpdated: new Date(),
  },
  // ── East Midlands ──────────────────────────────────────────────────────────
  // Mining-and-manufacturing legacy still fresh (pits closed within the
  // decade); solidly Labour towns, Tory shires. Leicester's communities long
  // established.
  {
    _id: "EMI",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 23, economicLean: -3, socialLean: 1, turnout: 60 },
      urban_progressives: { population: 4, economicLean: -3, socialLean: -3, turnout: 66 },
      suburban_homeowners: { population: 13, economicLean: 2, socialLean: 2, turnout: 70 },
      young_renters: { population: 7, economicLean: -2, socialLean: -2, turnout: 52 },
      rural_traditionalists: { population: 13, economicLean: 3, socialLean: 3, turnout: 71 },
      retirees: { population: 10, economicLean: 0, socialLean: 2, turnout: 70 },
      public_sector: { population: 6, economicLean: -3, socialLean: -2, turnout: 65 },
      moderate_centrists: { population: 11, economicLean: 0, socialLean: -1, turnout: 63 },
      populist_right: { population: 2, economicLean: 1, socialLean: 3, turnout: 45 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 57 },
      small_business: { population: 6, economicLean: 3, socialLean: 1, turnout: 68 },
      new_britons: { population: 4, economicLean: -3, socialLean: 0, turnout: 48 },
    },
    lastUpdated: new Date(),
  },
  // ── West Midlands ──────────────────────────────────────────────────────────
  // Car-industry working class still substantial (Rover, Jaguar); Birmingham's
  // established Commonwealth-origin communities give a large new-Briton bloc
  // even in 1999.
  {
    _id: "WMI",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 22, economicLean: -3, socialLean: 1, turnout: 59 },
      urban_progressives: { population: 6, economicLean: -3, socialLean: -3, turnout: 66 },
      suburban_homeowners: { population: 12, economicLean: 2, socialLean: 2, turnout: 70 },
      young_renters: { population: 8, economicLean: -2, socialLean: -2, turnout: 52 },
      rural_traditionalists: { population: 8, economicLean: 3, socialLean: 3, turnout: 71 },
      retirees: { population: 9, economicLean: 0, socialLean: 2, turnout: 70 },
      public_sector: { population: 7, economicLean: -3, socialLean: -2, turnout: 65 },
      moderate_centrists: { population: 10, economicLean: 0, socialLean: -1, turnout: 63 },
      populist_right: { population: 2, economicLean: 1, socialLean: 3, turnout: 45 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 57 },
      small_business: { population: 5, economicLean: 3, socialLean: 1, turnout: 67 },
      new_britons: { population: 10, economicLean: -3, socialLean: 0, turnout: 50 },
    },
    lastUpdated: new Date(),
  },
  // ── Yorkshire & the Humber ─────────────────────────────────────────────────
  // Coalfield Labour at full strength; Bradford's established Pakistani
  // community; Leeds beginning its services boom but progressives still few.
  {
    _id: "YHU",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 24, economicLean: -3, socialLean: 1, turnout: 60 },
      urban_progressives: { population: 5, economicLean: -3, socialLean: -3, turnout: 66 },
      suburban_homeowners: { population: 10, economicLean: 2, socialLean: 2, turnout: 69 },
      young_renters: { population: 8, economicLean: -2, socialLean: -2, turnout: 52 },
      rural_traditionalists: { population: 11, economicLean: 3, socialLean: 3, turnout: 71 },
      retirees: { population: 11, economicLean: 0, socialLean: 2, turnout: 70 },
      public_sector: { population: 7, economicLean: -3, socialLean: -2, turnout: 65 },
      moderate_centrists: { population: 10, economicLean: 0, socialLean: -1, turnout: 62 },
      populist_right: { population: 2, economicLean: 1, socialLean: 3, turnout: 45 },
      green_activists: { population: 2, economicLean: -4, socialLean: -4, turnout: 57 },
      small_business: { population: 4, economicLean: 3, socialLean: 1, turnout: 67 },
      new_britons: { population: 6, economicLean: -3, socialLean: 0, turnout: 49 },
    },
    lastUpdated: new Date(),
  },
  // ── North West England ─────────────────────────────────────────────────────
  // Labour's deepest English well in 1999: mill towns, docks legacy, huge
  // traditional working class. Manchester's regeneration only beginning.
  {
    _id: "NWE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 27, economicLean: -3, socialLean: 1, turnout: 60 },
      urban_progressives: { population: 7, economicLean: -3, socialLean: -3, turnout: 66 },
      suburban_homeowners: { population: 9, economicLean: 2, socialLean: 2, turnout: 69 },
      young_renters: { population: 9, economicLean: -2, socialLean: -2, turnout: 52 },
      rural_traditionalists: { population: 7, economicLean: 3, socialLean: 3, turnout: 70 },
      retirees: { population: 11, economicLean: 0, socialLean: 2, turnout: 70 },
      public_sector: { population: 7, economicLean: -3, socialLean: -2, turnout: 65 },
      moderate_centrists: { population: 10, economicLean: 0, socialLean: -1, turnout: 62 },
      populist_right: { population: 2, economicLean: 1, socialLean: 3, turnout: 44 },
      green_activists: { population: 2, economicLean: -4, socialLean: -4, turnout: 57 },
      small_business: { population: 3, economicLean: 3, socialLean: 1, turnout: 66 },
      new_britons: { population: 6, economicLean: -3, socialLean: 0, turnout: 49 },
    },
    lastUpdated: new Date(),
  },
  // ── North East England ─────────────────────────────────────────────────────
  // The most Labour place in Britain in 1999 — shipyard/colliery legacy, every
  // seat red, big public-sector dependence, almost no diversity and no right.
  {
    _id: "NEE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 34, economicLean: -4, socialLean: 1, turnout: 60 },
      urban_progressives: { population: 5, economicLean: -3, socialLean: -3, turnout: 65 },
      suburban_homeowners: { population: 7, economicLean: 2, socialLean: 2, turnout: 68 },
      young_renters: { population: 9, economicLean: -2, socialLean: -2, turnout: 51 },
      rural_traditionalists: { population: 7, economicLean: 3, socialLean: 3, turnout: 70 },
      retirees: { population: 12, economicLean: -1, socialLean: 2, turnout: 70 },
      public_sector: { population: 10, economicLean: -3, socialLean: -2, turnout: 65 },
      moderate_centrists: { population: 9, economicLean: 0, socialLean: -1, turnout: 61 },
      populist_right: { population: 2, economicLean: 1, socialLean: 3, turnout: 44 },
      green_activists: { population: 2, economicLean: -4, socialLean: -4, turnout: 57 },
      small_business: { population: 2, economicLean: 3, socialLean: 1, turnout: 65 },
      new_britons: { population: 1, economicLean: -3, socialLean: 0, turnout: 44 },
    },
    lastUpdated: new Date(),
  },
  // ── Scotland ───────────────────────────────────────────────────────────────
  // Devolution year: first Holyrood election, Labour dominant with the SNP a
  // strong second (both modelled through the left-leaning mix). Tories wiped
  // out in 1997 — the right is vestigial. Turnout buoyed by devolution energy.
  {
    _id: "SCO",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 22, economicLean: -3, socialLean: 1, turnout: 62 },
      urban_progressives: { population: 11, economicLean: -3, socialLean: -3, turnout: 68 },
      suburban_homeowners: { population: 8, economicLean: 2, socialLean: 1, turnout: 69 },
      young_renters: { population: 10, economicLean: -2, socialLean: -2, turnout: 55 },
      rural_traditionalists: { population: 10, economicLean: 2, socialLean: 3, turnout: 69 },
      retirees: { population: 11, economicLean: 0, socialLean: 2, turnout: 71 },
      public_sector: { population: 10, economicLean: -3, socialLean: -2, turnout: 67 },
      moderate_centrists: { population: 11, economicLean: 0, socialLean: -1, turnout: 64 },
      populist_right: { population: 1, economicLean: 1, socialLean: 3, turnout: 42 },
      green_activists: { population: 2, economicLean: -4, socialLean: -4, turnout: 58 },
      small_business: { population: 3, economicLean: 3, socialLean: 1, turnout: 66 },
      new_britons: { population: 1, economicLean: -3, socialLean: 0, turnout: 45 },
    },
    lastUpdated: new Date(),
  },
  // ── Wales ──────────────────────────────────────────────────────────────────
  // First Assembly year; valleys Labourism at its peak, the public sector
  // already the dominant employer, Plaid's 1999 surge folded into the
  // left-leaning mix. Rural west remains traditional.
  {
    _id: "WAL",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 24, economicLean: -4, socialLean: 1, turnout: 61 },
      urban_progressives: { population: 6, economicLean: -3, socialLean: -3, turnout: 65 },
      suburban_homeowners: { population: 8, economicLean: 2, socialLean: 2, turnout: 68 },
      young_renters: { population: 7, economicLean: -2, socialLean: -2, turnout: 51 },
      rural_traditionalists: { population: 14, economicLean: 2, socialLean: 3, turnout: 70 },
      retirees: { population: 11, economicLean: 0, socialLean: 2, turnout: 70 },
      public_sector: { population: 16, economicLean: -3, socialLean: -2, turnout: 66 },
      moderate_centrists: { population: 7, economicLean: 0, socialLean: -1, turnout: 61 },
      populist_right: { population: 1, economicLean: 1, socialLean: 3, turnout: 43 },
      green_activists: { population: 2, economicLean: -4, socialLean: -4, turnout: 57 },
      small_business: { population: 3, economicLean: 3, socialLean: 1, turnout: 65 },
      new_britons: { population: 1, economicLean: -3, socialLean: 0, turnout: 44 },
    },
    lastUpdated: new Date(),
  },
  // ── Northern Ireland ───────────────────────────────────────────────────────
  // Year after the Good Friday Agreement: politics intensely mobilized
  // (referendum turnout 81%), UUP/SDLP still the leading blocs, DUP-style
  // hardline unionism (populist_right) large but not yet dominant; the Alliance
  // centre small. High turnouts across the board reflect peace-process stakes.
  {
    _id: "NIR",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 22, economicLean: -2, socialLean: 2, turnout: 66 },
      urban_progressives: { population: 8, economicLean: -3, socialLean: -2, turnout: 64 },
      suburban_homeowners: { population: 5, economicLean: 2, socialLean: 2, turnout: 66 },
      young_renters: { population: 8, economicLean: -2, socialLean: -1, turnout: 58 },
      rural_traditionalists: { population: 10, economicLean: 2, socialLean: 4, turnout: 70 },
      retirees: { population: 6, economicLean: 1, socialLean: 3, turnout: 72 },
      public_sector: { population: 8, economicLean: -3, socialLean: -1, turnout: 68 },
      moderate_centrists: { population: 11, economicLean: 0, socialLean: -1, turnout: 66 },
      populist_right: { population: 18, economicLean: 1, socialLean: 5, turnout: 70 },
      green_activists: { population: 1, economicLean: -4, socialLean: -4, turnout: 58 },
      small_business: { population: 2, economicLean: 3, socialLean: 2, turnout: 65 },
      new_britons: { population: 1, economicLean: -3, socialLean: 0, turnout: 44 },
    },
    lastUpdated: new Date(),
  },
];

export default ukRegionDemographics1999;
