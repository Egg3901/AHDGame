/**
 * NPP (Non-Player Politician) Generator
 * Generates AI-controlled politicians based on state party organization
 */

import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type {
  NPP,
  NPPPersonality,
  PolicyPositions,
  OfficeType,
  StatePartyOrg,
  PoliticalParty,
  LegislationType,
} from "@/lib/db/types";
import { generateUniqueNPPNameAndGender } from "./nameGenerator";
import type { NPPGender, NPPEthnicity } from "@/lib/db/types";
import { COUNTRY_CONFIGS, isParliamentarySystem, type CountryId } from "@/lib/constants/countries";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { deriveDomainPositions } from "./domainPositions";
import { NPP_ECONOMY_DEFAULTS } from "./economyDefaults";
import { NPP_POLITICAL_INFLUENCE_FLOOR } from "@shared/constants/formulas";
import fs from "fs";
import path from "path";

// ── Politician image pool (country/gender/ethnicity-gated) ───────────────────

interface PoliticianImage {
  /** Parsed from `url` at load; null when the filename carries no year. */
  photoYear?: number | null;
  id: string;
  name: string;
  /** Country the pool was built for — a CountryId, or an alias target below. */
  country: string;
  gender: NPPGender;
  ethnicity: NPPEthnicity;
  url: string;
}

/**
 * Countries that borrow another country's portrait pool.
 *
 * East Germany takes the modern German pool rather than a pool of SED
 * officials; Scotland and Wales take the UK pool. A country absent from both
 * this map and the data file simply gets no portrait, which is what every
 * non-US/UK country did before the pool was widened.
 */
const PORTRAIT_COUNTRY_ALIASES: Record<string, string> = {
  DD: "DE",
  SCO: "UK",
  WAL: "UK",
};

let politicianImageCache: PoliticianImage[] | null = null;

/**
 * Year the photograph is from, read out of its source URL.
 *
 * Commons filenames usually carry the year ("...portrait_2019.jpg"). About a
 * third of the pool has one, and that third is overwhelmingly modern — 307 of
 * 345 are 2000 or later. So this catches almost exactly the press photos that
 * wreck a historical world, which is the whole point.
 *
 * Parsed from the URL already in the file rather than stored as a second field:
 * a duplicated year would be free to drift from the image it describes.
 *
 * Deliberately conservative. An unparsed URL yields null, and null means
 * "unknown", NOT "old" — an undated portrait stays eligible everywhere rather
 * than being assumed archival on no evidence.
 */
function photoYearFromUrl(url: string): number | null {
  const m = /(1[89]\d\d|20[0-2]\d)/.exec(url);
  if (!m) return null;
  const year = Number(m[1]);
  return Number.isFinite(year) ? year : null;
}

function loadPoliticianImages(): PoliticianImage[] {
  if (politicianImageCache) return politicianImageCache;
  try {
    const filePath = path.join(process.cwd(), "src", "data", "npp-politician-images.json");
    if (!fs.existsSync(filePath)) return [];
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as PoliticianImage[];
    politicianImageCache = data
      .filter((p) => p.url)
      .map((p) => ({ ...p, photoYear: photoYearFromUrl(p.url) }));
    return politicianImageCache;
  } catch {
    return [];
  }
}

/**
 * How far AFTER the in-game year a photograph may still be used.
 *
 * Asymmetric on purpose. A 1953 world drawing a 2015 press photo is the bug;
 * a 2019 world drawing a 2024 photo is not — near-contemporary reads fine, and
 * being strict forwards would strip the modern pool for no gain. Twenty years
 * keeps 1953 clear of everything from the 1980s on while leaving every modern
 * era its full set.
 */
const PORTRAIT_FUTURE_GRACE_YEARS = 20;

/** Portraits plausible for a world at `year`. Null year (no clock) keeps them all. */
export function portraitsForYear<T extends { photoYear?: number | null }>(
  pool: T[],
  year: number | null | undefined
): T[] {
  if (year == null || !Number.isFinite(year)) return pool;
  const eligible = pool.filter(
    (p) => p.photoYear == null || p.photoYear <= year + PORTRAIT_FUTURE_GRACE_YEARS
  );
  // Never empty the pool: a country whose every portrait is dated modern still
  // needs a face, and a missing portrait is worse than an anachronistic one.
  return eligible.length > 0 ? eligible : pool;
}

/**
 * Pick a random image from the politician pool filtered by country, gender, and ethnicity.
 * Falls back progressively: exact match → country+gender → country only.
 * Excludes any portrait whose real-world name matches the NPP's generated name to avoid
 * accidentally assigning e.g. Hillary Clinton's photo to an NPP also named Hillary Clinton.
 * Returns an internal route path so the image URL can be updated without DB migrations.
 */
export function selectPoliticianImage(
  countryId: CountryId,
  gender: NPPGender,
  ethnicity: NPPEthnicity,
  nppName: string,
  /**
   * Live in-game year. Filters out photographs that could not exist yet — a
   * 1953 politician drawing a 2010s press photo. Omitted/null keeps the whole
   * pool, so a world with no era clock is unchanged.
   */
  year?: number | null
): string | undefined {
  const nppNameLower = nppName.toLowerCase();
  const poolCountry = PORTRAIT_COUNTRY_ALIASES[countryId] ?? countryId;
  const all = portraitsForYear(
    loadPoliticianImages().filter(
      (p) => p.country === poolCountry && p.name.toLowerCase() !== nppNameLower
    ),
    year
  );
  if (all.length === 0) return undefined;

  const byGenderAndEthnicity = all.filter((p) => p.gender === gender && p.ethnicity === ethnicity);
  const byGender =
    byGenderAndEthnicity.length > 0 ? byGenderAndEthnicity : all.filter((p) => p.gender === gender);
  const pool = byGender.length > 0 ? byGender : all;

  const chosen = pool[Math.floor(Math.random() * pool.length)];
  return `/api/images/npp-politicians/${chosen.id}`;
}

// ── Ethnicity weighted random ─────────────────────────────────────────────────

// Approximate demographic proportions per country — used to assign NPP ethnicity
// so images stay representative of each country's political class.
const ETHNICITY_WEIGHTS: Record<string, Array<[NPPEthnicity, number]>> = {
  US: [
    ["white", 60],
    ["hispanic", 18],
    ["black", 13],
    ["asian", 6],
    ["other", 3],
  ],
  UK: [
    ["white", 81],
    ["asian", 7],
    ["other", 7],
    ["black", 3],
    ["hispanic", 2],
  ],
  // The countries below were on DEFAULT_ETHNICITY_WEIGHTS until their portrait
  // pools existed, which meant a Japanese or Nigerian NPP was assigned "white"
  // 70% of the time. The weights track each country's own political class, and
  // they must stay in step with the ethnicity tags the portrait builder writes
  // (COUNTRIES in scripts/build-npp-portraits.mjs) or the exact-match tier of
  // selectPoliticianImage never hits and every pick falls back to gender only.
  DE: [
    ["white", 88],
    ["asian", 4],
    ["other", 5],
    ["black", 2],
    ["hispanic", 1],
  ],
  DD: [
    ["white", 95],
    ["asian", 2],
    ["other", 2],
    ["black", 1],
    ["hispanic", 0],
  ],
  FR: [
    ["white", 82],
    ["black", 7],
    ["other", 7],
    ["asian", 3],
    ["hispanic", 1],
  ],
  IT: [
    ["white", 91],
    ["other", 4],
    ["black", 3],
    ["asian", 1],
    ["hispanic", 1],
  ],
  ES: [
    ["white", 87],
    ["hispanic", 7],
    ["other", 3],
    ["black", 2],
    ["asian", 1],
  ],
  SE: [
    ["white", 86],
    ["other", 7],
    ["asian", 4],
    ["black", 2],
    ["hispanic", 1],
  ],
  TR: [
    ["white", 93],
    ["other", 5],
    ["asian", 1],
    ["black", 1],
    ["hispanic", 0],
  ],
  RU: [
    ["white", 88],
    ["asian", 6],
    ["other", 5],
    ["black", 1],
    ["hispanic", 0],
  ],
  IE: [
    ["white", 90],
    ["other", 4],
    ["asian", 3],
    ["black", 2],
    ["hispanic", 1],
  ],
  AT: [
    ["white", 90],
    ["other", 5],
    ["asian", 3],
    ["black", 1],
    ["hispanic", 1],
  ],
  GR: [
    ["white", 92],
    ["other", 4],
    ["asian", 2],
    ["black", 1],
    ["hispanic", 1],
  ],
  FI: [
    ["white", 93],
    ["other", 4],
    ["asian", 2],
    ["black", 1],
    ["hispanic", 0],
  ],
  JP: [
    ["asian", 97],
    ["other", 2],
    ["white", 1],
    ["black", 0],
    ["hispanic", 0],
  ],
  CN: [
    ["asian", 98],
    ["other", 2],
    ["white", 0],
    ["black", 0],
    ["hispanic", 0],
  ],
  NG: [
    ["black", 97],
    ["other", 2],
    ["white", 1],
    ["asian", 0],
    ["hispanic", 0],
  ],
  // Brazil's political class does not map cleanly onto these five buckets;
  // "hispanic" is the closest available label for the pardo/branco majority and
  // is what the BR portraits are tagged with.
  BR: [
    ["hispanic", 62],
    ["white", 22],
    ["black", 12],
    ["other", 3],
    ["asian", 1],
  ],
  SCO: [
    ["white", 92],
    ["asian", 4],
    ["other", 2],
    ["black", 1],
    ["hispanic", 1],
  ],
  WAL: [
    ["white", 93],
    ["asian", 3],
    ["other", 2],
    ["black", 1],
    ["hispanic", 1],
  ],
};

const DEFAULT_ETHNICITY_WEIGHTS: Array<[NPPEthnicity, number]> = [
  ["white", 70],
  ["black", 10],
  ["hispanic", 10],
  ["asian", 8],
  ["other", 2],
];

export function weightedRandomEthnicity(countryId: CountryId): NPPEthnicity {
  const weights = ETHNICITY_WEIGHTS[countryId] ?? DEFAULT_ETHNICITY_WEIGHTS;
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [value, weight] of weights) {
    r -= weight;
    if (r <= 0) return value;
  }
  return weights[weights.length - 1][0];
}

/**
 * Configuration for NPP generation
 */
interface NPPGenerationConfig {
  state: string;
  party: string;
  countryId?: CountryId;
  targetOffice?: OfficeType | null;
  quality?: number; // -20 to +30 based on party org
  /**
   * Live in-game year. Keeps a 1953 politician from drawing a 2010s press
   * photo. Omitted = no era clock, whole portrait pool.
   */
  year?: number | null;
}

/**
 * Generate a random number within a range
 */
function randomInRange(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/**
 * Clamp a value between min and max
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Calculate quality bonus based on party org level
 * @param partyOrg 0-100 party organization level
 * @returns -20 to +30 quality modifier
 */
export function calculateQualityBonus(partyOrg: number): number {
  // At 50 org: 0% bonus
  // At 80 org: +30% bonus
  // At 30 org: -20% bonus
  return (partyOrg - 50) * 0.6;
}

/**
 * Generate personality traits for an NPP
 * @param quality Quality bonus affects trait ranges
 */
function generatePersonality(quality: number = 0): NPPPersonality {
  // Base ranges: 30-70, quality shifts the center
  const qualityShift = quality * 0.3;

  return {
    loyalty: clamp(randomInRange(30 + qualityShift, 70 + qualityShift), 0, 100),
    ambition: clamp(randomInRange(20, 80), 0, 100), // Ambition less affected by quality
    stubbornness: clamp(randomInRange(20 - qualityShift * 0.5, 60 - qualityShift * 0.5), 0, 100),
  };
}

/**
 * Generate policy positions based on party alignment
 * @param party The political party
 * @param countryId The country (required for sequentialId lookups)
 * @param quality Quality bonus affects how close to party median
 */
// LegislationTypes are seed-driven and rarely change at runtime — cache them
// across NPP generations within a single process to avoid a full collection
// scan per NPP during bulk seeding. Cleared on next process restart so admin
// edits via the legislation-type CRUD UI propagate without manual reset.
let legislationTypeCache: LegislationType[] | null = null;
let legislationTypeCacheAt = 0;
const LEGISLATION_TYPE_CACHE_TTL_MS = 60_000;

async function getLegislationTypesCached(
  db: Awaited<ReturnType<typeof getDb>>
): Promise<LegislationType[]> {
  const now = Date.now();
  if (legislationTypeCache && now - legislationTypeCacheAt < LEGISLATION_TYPE_CACHE_TTL_MS) {
    return legislationTypeCache;
  }
  legislationTypeCache = await db
    .collection<LegislationType>("legislationTypes")
    .find({})
    .toArray();
  legislationTypeCacheAt = now;
  return legislationTypeCache;
}

async function generatePolicyPositions(
  partyId: string,
  countryId: CountryId,
  quality: number = 0
): Promise<PolicyPositions> {
  const db = await getDb();

  // Parties are uniquely identified by (sequentialId, countryId).
  const seqId = parseInt(partyId, 10);
  const party = Number.isFinite(seqId)
    ? await db
        .collection<PoliticalParty>("politicalParties")
        .findOne({ sequentialId: seqId, countryId })
    : null;

  // Default positions if party not found
  let baseEconomic = 0;
  let baseSocial = 0;

  if (party) {
    baseEconomic = party.economicPosition;
    baseSocial = party.socialPosition;
  }

  // Higher quality = closer to party median (less variance)
  // Quality ranges from -20 to +30, normalize to variance factor
  const varianceFactor = Math.max(0.5, 2 - (quality + 20) / 25);

  // Generate positions with variance around party base
  const economic = clamp(baseEconomic + randomInRange(-varianceFactor, varianceFactor), -5, 5);

  const social = clamp(baseSocial + randomInRange(-varianceFactor, varianceFactor), -5, 5);

  const economicRounded = Math.round(economic * 10) / 10;
  const socialRounded = Math.round(social * 10) / 10;

  // Derive per-legislation-type stances so the cross-pressure resolver has
  // ideology + donor signal beyond the small economic tint.
  const legislationTypes = await getLegislationTypesCached(db);
  const domainPositions = deriveDomainPositions(legislationTypes, economicRounded, socialRounded);

  return {
    economic: economicRounded,
    social: socialRounded,
    domainPositions,
  };
}

/**
 * Generate political influence for NPPs
 * All NPPs start at 10% (the NPP decay floor) regardless of office
 */
function generatePoliticalInfluence(): number {
  // All NPPs start at the decay floor; per-turn decay can't take them below it.
  return NPP_POLITICAL_INFLUENCE_FLOOR;
}

/**
 * Generate favorability based on party org and quality
 */
function generateFavorability(quality: number = 0): number {
  // Base favorability around 45-55, quality affects it
  const base = 50 + quality * 0.2;
  return clamp(randomInRange(base - 10, base + 10), 20, 80);
}

/**
 * Generate a single NPP
 */
export async function generateNPP(config: NPPGenerationConfig): Promise<NPP> {
  const db = await getDb();

  // Get existing NPP names to ensure uniqueness
  const existingNPPs = await db
    .collection<NPP>("npps")
    .find({ retiredAt: null })
    .project({ name: 1 })
    .toArray();
  const existingNames = existingNPPs.map((n) => n.name);

  const quality = config.quality ?? 0;
  const now = new Date();

  // Use explicitly provided countryId, defaulting to US
  const countryId = config.countryId ?? ("US" as const);

  // Generate unique name with gender for image selection (country-specific names)
  const nameResult = generateUniqueNPPNameAndGender(existingNames, 100, countryId, config.year);
  if (!nameResult) {
    throw new Error("Failed to generate unique NPP name");
  }
  const { name, gender } = nameResult;

  // Assign ethnicity weighted by country demographics, then pick a matching portrait
  const ethnicity = weightedRandomEthnicity(countryId);
  const avatarUrl = selectPoliticianImage(countryId, gender, ethnicity, name, config.year);

  // Generate components
  const personality = generatePersonality(quality);
  const policies = await generatePolicyPositions(config.party, countryId, quality);
  const politicalInfluence = generatePoliticalInfluence();
  const favorability = generateFavorability(quality);

  const npp: NPP = {
    _id: new ObjectId(),
    name,
    gender,
    ethnicity,
    countryId,
    homeState: config.state,
    politicalInfluence,
    favorability,
    policies,
    party: config.party,
    currentOffice: config.targetOffice ?? null,
    ...(avatarUrl && { avatarUrl }),
    personality,
    generatedAt: now,
    retiredAt: null,
    influenceState: {
      totalTimesInfluenced: 0,
    },
    // Economy fields — initialized at creation (donor base 1 so NPPs earn a
    // small donor income from turn one) via the shared SSOT so every creation
    // path stays consistent.
    ...NPP_ECONOMY_DEFAULTS,
    // Cross-pressure voting modifiers — initialized empty so the decay
    // pass always has a stable object to iterate.
    archetypeApprovals: {},
    // Election cooldown tracking — initialized empty for consistent shape.
    electionCooldowns: {},
    createdAt: now,
    updatedAt: now,
  };

  return npp;
}

/**
 * Generate and save an NPP to the database
 */
export async function createNPP(config: NPPGenerationConfig): Promise<NPP> {
  const db = await getDb();
  const npp = await generateNPP(config);

  // Assign sequential ID
  const sequentialId = await getNextSequentialId(db, "npp");
  const nppWithId: NPP = { ...npp, sequentialId };

  await db.collection<NPP>("npps").insertOne(nppWithId);

  return nppWithId;
}

/**
 * Calculate how many NPPs a party should generate based on its current org.
 * - 100% org = fill every election in state
 * - Every 20% below 100% reduces NPPs by 1
 * - Minimum 1 NPP per party per state
 * @param totalElections Total elections in the state
 * @param partyOrg Party current organization (0-100) in this state
 * @returns Number of NPPs to generate
 */
export function calculateNPPsToGenerate(totalElections: number, partyOrg: number): number {
  const reduction = Math.floor((100 - partyOrg) / 20);
  return Math.max(1, totalElections - reduction);
}

/**
 * Check if an NPP should be generated for a single race (random)
 * Note: For bulk generation, use calculateNPPsToGenerate instead
 * @param partyOrg Party organization level (0-100)
 * @returns true if an NPP should be generated
 * @deprecated Use calculateNPPsToGenerate for deterministic generation
 */
export function shouldGenerateNPP(partyOrg: number): boolean {
  // Candidate availability = partyOrg / 100
  // Higher org = higher chance of fielding a candidate
  return Math.random() < partyOrg / 100;
}

/**
 * Generate NPPs for an election
 * @param stateId State abbreviation
 * @param electionType Type of election
 * @param parties Array of party IDs to generate for
 */
export async function generateNPPsForElection(
  stateId: string,
  electionType: "senate" | "house" | "governor" | "commons",
  parties?: string[],
  countryId: CountryId = "US"
): Promise<NPP[]> {
  const db = await getDb();
  const generatedNPPs: NPP[] = [];

  // Default parties based on country — parliamentary systems use UK-style parties
  const countryConfig = COUNTRY_CONFIGS[countryId];
  const defaultParties = isParliamentarySystem(countryConfig)
    ? ["uk_labour", "uk_conservative"]
    : ["democrat", "republican"];
  const partiesToUse = parties ?? defaultParties;

  for (const partyId of partiesToUse) {
    // Get state party org
    const statePartyKey = `${stateId}_${partyId}`;
    const statePartyOrg = await db.collection<StatePartyOrg>("statePartyOrg").findOne({
      _id: statePartyKey,
    });

    // No statePartyOrg row → the party has no seeded presence in this state:
    // do not field. The old `?? 50` default handed a party with NO org row a
    // BETTER org than parties with real single-digit org (1953 UK Liberals at
    // 7-12), and let regional parties contest states they don't operate in.
    if (!statePartyOrg) continue;
    if (statePartyOrg.hasPresence === false) continue;
    const partyOrg = Math.max(0, statePartyOrg.organization ?? 0);

    // Check if we should generate an NPP
    if (shouldGenerateNPP(partyOrg)) {
      const quality = calculateQualityBonus(partyOrg);

      // Create office type based on election
      let targetOffice: OfficeType | undefined;
      switch (electionType) {
        case "senate":
          targetOffice = { type: "senate", state: stateId };
          break;
        case "house":
          targetOffice = { type: "house", state: stateId, seatsHeld: 1 };
          break;
        case "governor":
          targetOffice = { type: "governor", state: stateId };
          break;
        case "commons":
          targetOffice = { type: "commons", state: stateId };
          break;
      }

      const npp = await createNPP({
        state: stateId,
        party: partyId,
        countryId,
        targetOffice,
        quality,
      });

      generatedNPPs.push(npp);
    }
  }

  return generatedNPPs;
}

/**
 * Get all active (non-retired) NPPs
 */
export async function getActiveNPPs(): Promise<NPP[]> {
  const db = await getDb();
  return db.collection<NPP>("npps").find({ retiredAt: null }).toArray();
}

/**
 * Get NPPs by state
 */
export async function getNPPsByState(stateId: string): Promise<NPP[]> {
  const db = await getDb();
  return db.collection<NPP>("npps").find({ homeState: stateId, retiredAt: null }).toArray();
}

/**
 * Get NPPs holding office
 */
export async function getNPPsWithOffice(): Promise<NPP[]> {
  const db = await getDb();
  return db
    .collection<NPP>("npps")
    .find({ currentOffice: { $ne: null }, retiredAt: null })
    .toArray();
}

/**
 * Retire an NPP
 */
export async function retireNPP(nppId: ObjectId): Promise<void> {
  const db = await getDb();
  const now = new Date();

  await db.collection<NPP>("npps").updateOne(
    { _id: nppId },
    {
      $set: {
        retiredAt: now,
        currentOffice: null,
        updatedAt: now,
      },
    }
  );
}

// ── Technocrat NPP spawn ──────────────────────────────────────────────────────

const CENTRAL_BANKER_GIVEN = [
  "Reginald",
  "Margaret",
  "Otto",
  "Hannah",
  "Augustus",
  "Eleanor",
  "Theodore",
  "Iris",
];
const CENTRAL_BANKER_FAMILY = [
  "Finch",
  "Harding",
  "Voss",
  "Marchetti",
  "Okafor",
  "Lindqvist",
  "Castellan",
  "Pillai",
];

function pickTechnocratName(): string {
  const g = CENTRAL_BANKER_GIVEN[Math.floor(Math.random() * CENTRAL_BANKER_GIVEN.length)];
  const f = CENTRAL_BANKER_FAMILY[Math.floor(Math.random() * CENTRAL_BANKER_FAMILY.length)];
  return `${g} ${f}`;
}

/**
 * Spawn a technocrat NPP (non-political AI actor) for a given role, e.g. an
 * autonomous central-bank chair. Technocrats are excluded from election entry,
 * bill voting, action AI, and fund generation — they exist to hold an
 * appointed office and act within that office's narrow scope.
 */
export async function spawnTechnocratNpp(db: Db, countryId: CountryId, role: string): Promise<NPP> {
  const _id = new ObjectId();
  const now = new Date();
  const doc: NPP = {
    _id,
    countryId,
    name: pickTechnocratName(),
    homeState: "",
    politicalInfluence: 0,
    favorability: 50,
    policies: { economic: 0, social: 0, domainPositions: {} },
    party: "",
    currentOffice: null,
    personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
    generatedAt: now,
    retiredAt: null,
    createdAt: now,
    updatedAt: now,
    isTechnocrat: true,
    technocratRole: role,
    funds: 0,
    actionPoints: 0,
  };
  await db.collection<NPP>("npps").insertOne(doc);
  return doc;
}

/**
 * Update NPP's office
 */
export async function updateNPPOffice(nppId: ObjectId, office: OfficeType | null): Promise<void> {
  const db = await getDb();
  const now = new Date();

  await db.collection<NPP>("npps").updateOne(
    { _id: nppId },
    {
      $set: {
        currentOffice: office,
        updatedAt: now,
      },
    }
  );
}
