import {
  COUNTRY_CONFIGS,
  COUNTRY_ORDER,
  getCountryDisplayName,
  type CountryId,
  type CountryStatus,
} from "@/lib/constants/countries";
import {
  formatCapabilityBlocker,
  TIER1_1953_AUTONOMOUS_RECLASSIFICATIONS,
  TIER1_1953_UNCONFIGURED_PROPOSED,
  tier1FollowUpIssue,
  UNCONFIGURED_BLOCKER_CAPABILITIES,
  type TierReclassificationRecord,
} from "@/lib/world/tier1Readiness1953Data";
import { build1953Tier3Registry } from "./registry/assemble";
import {
  AUTONOMY_BLOCKER,
  decolonizationDependencyEntries,
  emergentDecolonizationEntries,
  HEAD_CLAIMED_1953_ENTITY_IDS,
  PLAYER_BLOCKER,
  sphereMacroEntry,
} from "./registry/decolonization1953";
import { isShippingPreset, tierFor } from "./eraRoster";
import { JP_GEOGRAPHY } from "@/lib/countries/jp/geography";
import { expandManifestWithBackgroundCountries } from "./backgroundCountryRoster";
import { US_WORLD_REGION, US_UN_MEMBER_SINCE } from "@/lib/countries/us/geographyFacts";
import { UK_WORLD_REGION, UK_UN_MEMBER_SINCE } from "@/lib/countries/uk/geographyFacts";
import { DE_WORLD_REGION } from "@/lib/countries/de/geographyFacts";
import { CN_WORLD_REGION, CN_UN_MEMBER_SINCE } from "@/lib/countries/cn/geographyFacts";
import { IE_WORLD_REGION, IE_UN_MEMBER_SINCE } from "@/lib/countries/ie/geographyFacts";
import { RU_WORLD_REGION, RU_UN_MEMBER_SINCE } from "@/lib/countries/ru/geographyFacts";
import { DD_WORLD_REGION } from "@/lib/countries/dd/geographyFacts";
import { NG_WORLD_REGION, NG_UN_MEMBER_SINCE } from "@/lib/countries/ng/geographyFacts";
import { BR_WORLD_REGION, BR_UN_MEMBER_SINCE } from "@/lib/countries/br/geographyFacts";
import { FR_WORLD_REGION, FR_UN_MEMBER_SINCE } from "@/lib/countries/fr/geographyFacts";
import { IT_WORLD_REGION, IT_UN_MEMBER_SINCE } from "@/lib/countries/it/geographyFacts";
import { ES_WORLD_REGION, ES_UN_MEMBER_SINCE } from "@/lib/countries/es/geographyFacts";
import { SE_WORLD_REGION, SE_UN_MEMBER_SINCE } from "@/lib/countries/se/geographyFacts";
import { TR_WORLD_REGION, TR_UN_MEMBER_SINCE } from "@/lib/countries/tr/geographyFacts";
import { GR_WORLD_REGION, GR_UN_MEMBER_SINCE } from "@/lib/countries/gr/geographyFacts";
import { AT_WORLD_REGION, AT_UN_MEMBER_SINCE } from "@/lib/countries/at/geographyFacts";
import { FI_WORLD_REGION, FI_UN_MEMBER_SINCE } from "@/lib/countries/fi/geographyFacts";
import { PL_WORLD_REGION, PL_UN_MEMBER_SINCE } from "@/lib/countries/pl/geographyFacts";
import { HU_WORLD_REGION, HU_UN_MEMBER_SINCE } from "@/lib/countries/hu/geographyFacts";
import { RO_WORLD_REGION, RO_UN_MEMBER_SINCE } from "@/lib/countries/ro/geographyFacts";
import { YU_WORLD_REGION, YU_UN_MEMBER_SINCE } from "@/lib/countries/yu/geographyFacts";
import { BG_WORLD_REGION, BG_UN_MEMBER_SINCE } from "@/lib/countries/bg/geographyFacts";
import { CS_WORLD_REGION, CS_UN_MEMBER_SINCE } from "@/lib/countries/cs/geographyFacts";
import { SCO_WORLD_REGION } from "@/lib/countries/sco/geographyFacts";
import { WAL_WORLD_REGION } from "@/lib/countries/wal/geographyFacts";
import { BLR_WORLD_REGION, BLR_UN_MEMBER_SINCE } from "@/lib/countries/blr/geographyFacts";
import { UKR_WORLD_REGION, UKR_UN_MEMBER_SINCE } from "@/lib/countries/ukr/geographyFacts";
import { BAL_WORLD_REGION } from "@/lib/countries/bal/geographyFacts";

export type WorldEntityId = string;
export type WorldEntityStatus = "sovereign" | "dependent" | "emergent" | "dissolved";
export type WorldSimulationTier =
  "full-autonomous" | "sphere-macro" | "background-macro" | "historical-presence";
export type WorldEconomicArchetype = "market" | "planned" | "mixed" | "macro" | "none";
export type ReadinessResult = "ready" | "blocked";
export type LegacyCountryAccess = "player" | "economy-preview" | "hidden" | "config-fallback";
/** Treaty posture for a sphere relationship (see src/lib/world/spheres/). */
export type WorldEntityTreatyState = "none" | "proposed" | "active" | "suspended";
/**
 * Geographic coverage bucket for the #3728 Tier-3 registry gate.
 * Middle East polities are filed under `asia` (Asia / Pacific roster in the epic).
 * Egypt is filed under `africa` to match the registry checklist.
 */
export type WorldEntityRegion = "europe" | "americas" | "africa" | "asia" | "pacific";
/** Diplomatic recognition posture for map / UN / transition read models. */
export type WorldRecognitionStatus =
  "widely-recognized" | "partial" | "contested" | "unrecognized" | "dependent";
/** UN membership lifecycle — same vocabulary as historical transitions. */
export type WorldUnLifecycleState = "ineligible" | "eligible" | "applied" | "admitted" | "rejected";
/**
 * Explicit exceptional statuses for entities that are not ordinary
 * metropolitan dependencies (mandates, condominiums, disputed claimants).
 */
export type WorldExceptionalStatus =
  | "disputed-sovereignty"
  | "international-mandate"
  | "un-trust-territory"
  | "condominium"
  | "international-zone"
  | "integral-overseas";

export interface WorldEntityRelationship {
  sponsorId: WorldEntityId;
  alignment: number;
  integration: number;
  treatyIds: string[];
  /** Whether treaty obligations are live for sphere flows. Defaults to none. */
  treatyState?: WorldEntityTreatyState;
}

export interface WorldEntityLifecycle {
  earliestYear?: number;
  expectedYear?: number;
  latestYear?: number;
  transitionRuleIds: string[];
}

export interface WorldEntityRecognition {
  status: WorldRecognitionStatus;
  notes?: string;
}

export interface WorldEntityUnRecord {
  state: WorldUnLifecycleState;
  /** Year of UN admission on the historical default path, when admitted. */
  memberSinceYear?: number;
  /** Expected admission year for eligible / emergent polities. */
  expectedAdmissionYear?: number;
}

export interface WorldEntityReadiness {
  autonomous: ReadinessResult;
  player: ReadinessResult;
  hardBlockers: string[];
  flavorGaps: string[];
}

/**
 * Preset-scoped source record for a historical political entity.
 *
 * `countryId` is present only when the entity is already backed by the deep
 * CountryConfig domain. Tier-2 and Tier-3 entities can exist in the world
 * manifest before they are promoted into that much narrower type.
 */
export interface WorldEntityManifestEntry {
  entityId: WorldEntityId;
  countryId?: CountryId;
  presetId: string;
  displayName: string;
  status: WorldEntityStatus;
  parentEntityId?: WorldEntityId;
  /**
   * Additional administering powers for dual trusteeships / condominiums
   * (e.g. Somalia Trust Territories under Italy + UK in 1953).
   */
  coParentEntityIds?: readonly WorldEntityId[];
  /** Non-ordinary dependency / disputed-claimant posture (#3728). */
  exceptionalStatus?: WorldExceptionalStatus;
  /** Coverage region for the Tier-3 registry gate. Optional on legacy rows. */
  region?: WorldEntityRegion;
  simulationTier: WorldSimulationTier;
  economicArchetype: WorldEconomicArchetype;
  sphere: {
    canSponsor: boolean;
    primarySphereId?: string;
    relationships: WorldEntityRelationship[];
  };
  lifecycle: WorldEntityLifecycle;
  /** Diplomatic recognition — required for Tier-3; filled for CountryConfig rows too. */
  recognition?: WorldEntityRecognition;
  /** UN lifecycle defaults (strong priors, not rails). */
  un?: WorldEntityUnRecord;
  /**
   * Natural Earth ISO 3166-1 numeric feature IDs used as modern geometry proxies.
   * Historical entities without a clean proxy stay in `unmappedEntityIds`.
   */
  mapFeatureIds?: string[];
  readiness: WorldEntityReadiness;
  /**
   * Compatibility seam for the existing countryGameStates access model.
   * #3714 consumes this field; #3713 deliberately leaves runtime behavior
   * unchanged.
   */
  legacyAccess: LegacyCountryAccess;
  legacyStatus?: CountryStatus;
  /**
   * Visible record when a proposed Tier-1 candidate was demoted after the
   * readiness matrix (#3723). Absent when the entity was never proposed as
   * Tier 1 or remained full-autonomous.
   */
  tierReclassification?: TierReclassificationRecord;
}

export interface WorldEntityPresetManifest {
  presetId: string;
  entries: readonly WorldEntityManifestEntry[];
}

const PLANNED_ECONOMIES = new Set<CountryId>([
  "RU",
  "CN",
  "DD",
  "PL",
  "RO",
  "YU",
  "HU",
  "CS",
  "BG",
  // Union republics: the most completely planned economies in the set - there
  // was no private plot and no second economy of the Polish or Yugoslav kind.
  "UKR",
  "BLR",
  "BAL",
]);

function readinessForAccess(access: LegacyCountryAccess): WorldEntityReadiness {
  if (access === "player") {
    return { autonomous: "ready", player: "ready", hardBlockers: [], flavorGaps: [] };
  }
  if (access === "economy-preview") {
    return {
      autonomous: "ready",
      player: "blocked",
      hardBlockers: [PLAYER_BLOCKER],
      flavorGaps: [],
    };
  }
  return {
    autonomous: "blocked",
    player: "blocked",
    hardBlockers: [AUTONOMY_BLOCKER, PLAYER_BLOCKER],
    flavorGaps: [],
  };
}

function tierForAccess(access: LegacyCountryAccess): WorldSimulationTier {
  return access === "player" || access === "economy-preview"
    ? "full-autonomous"
    : "historical-presence";
}

function accessFromConfig(countryId: CountryId): LegacyCountryAccess {
  const status = COUNTRY_CONFIGS[countryId].status;
  if (status === "active") return "player";
  if (status === "beta") return "economy-preview";
  return "hidden";
}

/** Coverage region for CountryConfig-backed entities (1953 gate + diagnostics). */
export const COUNTRY_REGIONS: Record<CountryId, WorldEntityRegion> = {
  US: US_WORLD_REGION,
  BR: BR_WORLD_REGION,
  UK: UK_WORLD_REGION,
  FR: FR_WORLD_REGION,
  DE: DE_WORLD_REGION,
  DD: DD_WORLD_REGION,
  IT: IT_WORLD_REGION,
  ES: ES_WORLD_REGION,
  SE: SE_WORLD_REGION,
  IE: IE_WORLD_REGION,
  HU: HU_WORLD_REGION,
  PL: PL_WORLD_REGION,
  RO: RO_WORLD_REGION,
  YU: YU_WORLD_REGION,
  BG: BG_WORLD_REGION,
  CS: CS_WORLD_REGION,
  UKR: UKR_WORLD_REGION,
  RU: RU_WORLD_REGION,
  TR: TR_WORLD_REGION,
  JP: JP_GEOGRAPHY.worldRegion,
  CN: CN_WORLD_REGION,
  NG: NG_WORLD_REGION,
  AT: AT_WORLD_REGION,
  GR: GR_WORLD_REGION,
  FI: FI_WORLD_REGION,
  BLR: BLR_WORLD_REGION,
  BAL: BAL_WORLD_REGION,
  SCO: SCO_WORLD_REGION,
  WAL: WAL_WORLD_REGION,
};

/** UN admission year priors for CountryConfig sovereigns (strong defaults). */
export const COUNTRY_UN_MEMBER_SINCE: Partial<Record<CountryId, number>> = {
  US: US_UN_MEMBER_SINCE,
  UK: UK_UN_MEMBER_SINCE,
  FR: FR_UN_MEMBER_SINCE,
  RU: RU_UN_MEMBER_SINCE,
  CN: CN_UN_MEMBER_SINCE,
  BR: BR_UN_MEMBER_SINCE,
  DE: undefined, // FRG admitted 1973
  DD: undefined, // GDR admitted 1973
  IT: IT_UN_MEMBER_SINCE,
  ES: ES_UN_MEMBER_SINCE,
  SE: SE_UN_MEMBER_SINCE,
  TR: TR_UN_MEMBER_SINCE,
  JP: JP_GEOGRAPHY.unMemberSince,
  IE: IE_UN_MEMBER_SINCE,
  NG: NG_UN_MEMBER_SINCE,
  PL: PL_UN_MEMBER_SINCE,
  HU: HU_UN_MEMBER_SINCE,
  RO: RO_UN_MEMBER_SINCE,
  BG: BG_UN_MEMBER_SINCE,
  // The Ukrainian and Byelorussian SSRs were UN founding members in their own
  // right - Stalin's price for the Yalta voting arrangement. This is real, not a
  // modelling convenience, and it is the single largest thing that separates
  // them from the Baltic republics, whose annexation the UN never recognised and
  // which therefore have no admission year at all.
  UKR: UKR_UN_MEMBER_SINCE,
  BLR: BLR_UN_MEMBER_SINCE,
  YU: YU_UN_MEMBER_SINCE,
  CS: CS_UN_MEMBER_SINCE,
  GR: GR_UN_MEMBER_SINCE,
  AT: AT_UN_MEMBER_SINCE,
  FI: FI_UN_MEMBER_SINCE,
};

/**
 * Preset-specific sphere-sponsor eligibility (#3718).
 * Independent of human control — DDR (`DD`) is intentionally absent (non-sponsoring).
 */
const SPHERE_SPONSOR_ELIGIBILITY: Readonly<Partial<Record<string, ReadonlySet<CountryId>>>> =
  Object.freeze({
    "1953-default": Object.freeze(new Set<CountryId>(["US", "UK", "RU", "FR", "CN"])),
    "1979-default": Object.freeze(new Set<CountryId>(["US", "UK", "RU", "FR", "CN"])),
    "1991-default": Object.freeze(new Set<CountryId>(["US", "UK", "RU", "FR", "CN"])),
    "1999-default": Object.freeze(new Set<CountryId>(["US", "UK", "RU", "FR", "CN"])),
    "2007-default": Object.freeze(new Set<CountryId>(["US", "UK", "RU", "FR", "CN"])),
    "2019-default": Object.freeze(new Set<CountryId>(["US", "UK", "RU", "FR", "CN", "DE", "JP"])),
    // 2023 had NO entry, so isManifestSphereSponsor returned false for every
    // country in that preset and nothing could sponsor a sphere there.
    "2023-default": Object.freeze(new Set<CountryId>(["US", "UK", "RU", "FR", "CN", "DE", "JP"])),
    "2027-default": Object.freeze(new Set<CountryId>(["US", "UK", "RU", "FR", "CN", "DE", "JP"])),
  });
/** True when the preset matrix lists this entity as a sphere sponsor. */
export function isManifestSphereSponsor(presetId: string, entityId: WorldEntityId): boolean {
  const eligible = SPHERE_SPONSOR_ELIGIBILITY[presetId];
  if (!eligible || !eligible.has(entityId as CountryId)) return false;
  // A country that does not exist in this era cannot sponsor a sphere. Today
  // this is future-proofing (the sets only hold US/UK/RU/FR/CN/DE/JP, none of
  // which is absent anywhere), but it stops the pairing breaking silently if
  // either side changes.
  if (isShippingPreset(presetId) && tierFor(presetId, entityId as CountryId) === "absent") {
    return false;
  }
  return true;
}
function buildCountryEntry(
  presetId: string,
  countryId: CountryId,
  legacyAccess: LegacyCountryAccess
): WorldEntityManifestEntry {
  const resolvedAccess =
    legacyAccess === "config-fallback" ? accessFromConfig(countryId) : legacyAccess;
  const unMemberSince = COUNTRY_UN_MEMBER_SINCE[countryId];
  // Product decision 2026-07-25: Nigeria is a Tier-1 full country in 1953
  // (self-governing under the Macpherson/Lyttleton trajectory). Keep UN fields
  // era-honest — Nigeria was not a UN member until 1960.
  const nigeria1953 = presetId === "1953-default" && countryId === "NG";

  return {
    entityId: countryId,
    countryId,
    presetId,
    displayName: getCountryDisplayName(countryId, presetId),
    status: "sovereign",
    region: COUNTRY_REGIONS[countryId],
    simulationTier: tierForAccess(resolvedAccess),
    economicArchetype: PLANNED_ECONOMIES.has(countryId) ? "planned" : "market",
    sphere: {
      canSponsor: isManifestSphereSponsor(presetId, countryId),
      relationships: [],
    },
    lifecycle: {
      transitionRuleIds: [],
    },
    recognition: nigeria1953
      ? {
          status: "widely-recognized",
          notes:
            "Self-governing Federation of Nigeria under the Macpherson Constitution (1951) with Lyttleton reforms underway; independence window opens 1960.",
        }
      : { status: "widely-recognized" },
    un: nigeria1953
      ? { state: "eligible", expectedAdmissionYear: 1960 }
      : unMemberSince != null
        ? { state: "admitted", memberSinceYear: unMemberSince }
        : { state: "eligible", expectedAdmissionYear: 1955 },
    readiness: readinessForAccess(resolvedAccess),
    legacyAccess,
    legacyStatus:
      legacyAccess === "player"
        ? "active"
        : legacyAccess === "economy-preview"
          ? "beta"
          : legacyAccess === "hidden"
            ? "coming-soon"
            : undefined,
  };
}

function entriesFromAccess(
  presetId: string,
  access: Partial<Record<CountryId, LegacyCountryAccess>>
): WorldEntityManifestEntry[] {
  return Object.entries(access).map(([countryId, legacyAccess]) =>
    buildCountryEntry(presetId, countryId as CountryId, legacyAccess)
  );
}

function configFallbackEntries(presetId: string): WorldEntityManifestEntry[] {
  return COUNTRY_ORDER.map((countryId) =>
    buildCountryEntry(presetId, countryId, "config-fallback")
  );
}

/**
 * Tier-3 historical-presence entities that are not already Tier-1/2 on this branch.
 * Gold Coast / decolonization tracers stay authored above; the global 1953 registry
 * (#3728) fills the remainder under src/lib/world/registry/.
 */
function historicalPresenceEntries(presetId: string): WorldEntityManifestEntry[] {
  if (presetId !== "1953-default") return [];
  const registry = build1953Tier3Registry(presetId).filter(
    (entry) => !HEAD_CLAIMED_1953_ENTITY_IDS.has(entry.entityId)
  );
  return [...decolonizationDependencyEntries(presetId), ...registry];
}

/** Promote seeded AT/FI/GR/IE economies without changing their sphere/UN data. */
function promoteEuropeanSphereMacroToFullAutonomous(
  entry: WorldEntityManifestEntry,
  countryId: CountryId
): WorldEntityManifestEntry {
  return {
    ...entry,
    countryId,
    simulationTier: "full-autonomous",
    legacyAccess: "economy-preview",
    legacyStatus: "beta",
    readiness: {
      autonomous: "ready",
      player: "blocked",
      hardBlockers: [
        formatCapabilityBlocker(
          "adminDiagnostics",
          "No COUNTRY_READINESS_EXPECTATIONS entry.",
          tier1FollowUpIssue(countryId, "adminDiagnostics")
        ),
      ],
      flavorGaps: ["bespokeEvents", "artAssets", "wikiMaterial"],
    },
  };
}

/** European 1953 macro roster; AT/FI/GR/IE promote, while ES remains aggregate. */
function europeanSphereMacroEntries(presetId: string): WorldEntityManifestEntry[] {
  if (presetId !== "1953-default") return [];
  return [
    promoteEuropeanSphereMacroToFullAutonomous(
      sphereMacroEntry({
        entityId: "AT",
        presetId,
        displayName: "Austria",
        region: "europe",
        recognition: {
          status: "widely-recognized",
          notes: "Occupied sovereign; State Treaty expected 1955.",
        },
        un: { state: "eligible", expectedAdmissionYear: 1955 },
        mapFeatureIds: ["040"],
        economicArchetype: "market",
        // Occupation-era soft Western lean; US is the sole primary (#3717).
        // Neutrality settles after the 1955 State Treaty.
        primarySphereId: "US",
        relationships: [
          {
            sponsorId: "US",
            alignment: 0.45,
            integration: 0.2,
            treatyIds: ["occupation-western-1953", "marshall-plan-erp"],
            treatyState: "active",
          },
          {
            sponsorId: "UK",
            alignment: 0.4,
            integration: 0.15,
            treatyIds: ["occupation-western-1953"],
            treatyState: "active",
          },
          {
            sponsorId: "RU",
            alignment: 0.25,
            integration: 0.15,
            treatyIds: ["occupation-soviet-zone-1953"],
            treatyState: "active",
          },
        ],
      }),
      "AT"
    ),
    promoteEuropeanSphereMacroToFullAutonomous(
      sphereMacroEntry({
        entityId: "FI",
        presetId,
        displayName: "Finland",
        region: "europe",
        un: { state: "eligible", expectedAdmissionYear: 1955 },
        mapFeatureIds: ["246"],
        economicArchetype: "market",
        primarySphereId: "RU",
        relationships: [
          { sponsorId: "RU", alignment: 0.55, integration: 0.35, treatyIds: [] }, // FCMA
          { sponsorId: "SE", alignment: 0.4, integration: 0.2, treatyIds: [] },
        ],
      }),
      "FI"
    ),
    promoteEuropeanSphereMacroToFullAutonomous(
      sphereMacroEntry({
        entityId: "GR",
        presetId,
        displayName: "Greece",
        region: "europe",
        un: { state: "admitted", memberSinceYear: 1945 },
        mapFeatureIds: ["300"],
        economicArchetype: "market",
        primarySphereId: "US",
        relationships: [
          { sponsorId: "US", alignment: 0.65, integration: 0.4, treatyIds: [] }, // NATO 1952
          { sponsorId: "UK", alignment: 0.45, integration: 0.25, treatyIds: [] },
        ],
      }),
      "GR"
    ),
    promoteEuropeanSphereMacroToFullAutonomous(
      sphereMacroEntry({
        entityId: "IE",
        countryId: "IE",
        presetId,
        displayName: "Ireland",
        region: "europe",
        un: { state: "eligible", expectedAdmissionYear: 1955 },
        economicArchetype: "market",
        primarySphereId: "UK",
        relationships: [
          { sponsorId: "UK", alignment: 0.55, integration: 0.45, treatyIds: [] }, // sterling area
          { sponsorId: "US", alignment: 0.35, integration: 0.15, treatyIds: [] },
        ],
      }),
      "IE"
    ),
    // Spain: demoted to sphere-macro for 1953 ONLY (owner decision, 2026-07-28
    // coverage audit). 1953 Spain is Franco's dictatorship — congresoDiputados
    // and the Senado are both era-gated off via a shared null anchor, so a
    // "full-autonomous, economy-preview" Spain never holds an election for the
    // life of a 1953-default world; it was an economy-only power wearing a
    // Tier-1 label. Kept as a countryId-backed sphere-macro entry rather than
    // an abstract NPC; its regions/parties/budget seed
    // data still resolves, it simply is not routed through the Tier-1
    // election/player machinery. Spain stays full-autonomous economy-preview
    // in 1979/1991/1999/2007-default (Franco died 1975; 1977 was Spain's first
    // democratic election) and historical-presence in 2019-default — this
    // preset guard only ever returns entries for "1953-default", so those
    // presets are untouched. See COLD_WAR_ECONOMY / POST_COLD_WAR_ECONOMY
    // below, which still carry "ES" for 1979+; the sphere-macro entry built
    // here wins the 1953 manifest slot via last-write-wins entityId dedup in
    // apply1953Tier1MatrixAdjustments (ES is intentionally removed from that
    // function's FR/IT/SE/TR full-autonomous re-affirmation loop below).
    sphereMacroEntry({
      entityId: "ES",
      countryId: "ES",
      presetId,
      displayName: "Spain",
      region: "europe",
      un: { state: "eligible", expectedAdmissionYear: 1955 },
      economicArchetype: "market",
      primarySphereId: "US",
      relationships: [
        // Pact of Madrid, 26 Sep 1953 — US bases-for-aid agreement; Spain
        // stays outside NATO and the UN admits it only in 1955.
        { sponsorId: "US", alignment: 0.35, integration: 0.15, treatyIds: ["pact-of-madrid-1953"] },
      ],
    }),
    // PL/CS/HU/RO/BG/YU + UKR/BLR/BAL promoted to full-autonomous Tier-1
    // (product decision 2026-07-25). Sphere relationship data is re-applied on their full-country
    // entries in apply1953Tier1MatrixAdjustments — not seeded as sphere-macro.
  ];
}

/**
 * Asian / Middle Eastern 1953 sphere-macro roster (#3720).
 * No CountryIds yet — map geometry unmapped; entityIds are ISO-like codes.
 * North Yemen (YE) is the Mutawakkilite Kingdom; Burma uses MM (ISO) with era name.
 */
function asianMiddleEastSphereMacroEntries(presetId: string): WorldEntityManifestEntry[] {
  if (presetId !== "1953-default") return [];
  return [
    sphereMacroEntry({
      entityId: "JO",
      presetId,
      mapFeatureIds: ["400"],
      displayName: "Jordan",
      region: "asia",
      un: { state: "admitted", memberSinceYear: 1955 },
      economicArchetype: "market",
      primarySphereId: "UK",
      relationships: [
        { sponsorId: "UK", alignment: 0.7, integration: 0.55, treatyIds: [] }, // Arab Legion / subsidy
        { sponsorId: "US", alignment: 0.45, integration: 0.25, treatyIds: [] },
      ],
    }),
    sphereMacroEntry({
      entityId: "AF",
      presetId,
      mapFeatureIds: ["004"],
      displayName: "Afghanistan",
      region: "asia",
      economicArchetype: "market",
      primarySphereId: "US",
      relationships: [
        // Non-aligned monarchy courted by both blocs (Helmand / military missions).
        { sponsorId: "US", alignment: 0.35, integration: 0.2, treatyIds: [] },
        { sponsorId: "RU", alignment: 0.3, integration: 0.15, treatyIds: [] },
        { sponsorId: "UK", alignment: 0.25, integration: 0.1, treatyIds: [] },
      ],
    }),
    sphereMacroEntry({
      entityId: "YE",
      presetId,
      mapFeatureIds: ["887"],
      displayName: "North Yemen",
      region: "asia",
      un: { state: "ineligible" },
      economicArchetype: "market",
      relationships: [
        // Isolated Imamate; weak ties vs Aden (UK) to the south.
        { sponsorId: "UK", alignment: 0.2, integration: 0.08, treatyIds: [] },
      ],
    }),
    sphereMacroEntry({
      entityId: "MM",
      presetId,
      mapFeatureIds: ["104"],
      displayName: "Burma",
      region: "asia",
      un: { state: "admitted", memberSinceYear: 1948 },
      economicArchetype: "market",
      primarySphereId: "UK",
      relationships: [
        // Non-aligned under U Nu; residual Commonwealth links before full exit path.
        { sponsorId: "UK", alignment: 0.35, integration: 0.2, treatyIds: [] },
        { sponsorId: "US", alignment: 0.25, integration: 0.1, treatyIds: [] },
        { sponsorId: "CN", alignment: 0.2, integration: 0.1, treatyIds: [] },
      ],
    }),
    sphereMacroEntry({
      entityId: "LA",
      presetId,
      mapFeatureIds: ["418"],
      displayName: "Laos",
      region: "asia",
      economicArchetype: "market",
      primarySphereId: "FR",
      relationships: [
        { sponsorId: "FR", alignment: 0.55, integration: 0.4, treatyIds: [] }, // Associated State residual
        { sponsorId: "US", alignment: 0.35, integration: 0.2, treatyIds: [] },
      ],
    }),
    sphereMacroEntry({
      entityId: "KH",
      presetId,
      mapFeatureIds: ["116"],
      displayName: "Cambodia",
      region: "asia",
      economicArchetype: "market",
      primarySphereId: "FR",
      relationships: [
        { sponsorId: "FR", alignment: 0.5, integration: 0.35, treatyIds: [] },
        { sponsorId: "US", alignment: 0.3, integration: 0.15, treatyIds: [] },
      ],
    }),
    sphereMacroEntry({
      entityId: "TH",
      presetId,
      mapFeatureIds: ["764"],
      displayName: "Thailand",
      region: "asia",
      economicArchetype: "market",
      primarySphereId: "US",
      relationships: [
        { sponsorId: "US", alignment: 0.65, integration: 0.45, treatyIds: [] }, // SEATO-bound trajectory
        { sponsorId: "UK", alignment: 0.4, integration: 0.2, treatyIds: [] },
      ],
    }),
  ];
}

/**
 * African and American 1953 sphere-macro roster (#3721).
 * No CountryIds yet — map geometry unmapped; entityIds are ISO-like codes.
 * Colonial dependencies (Gold Coast/Congo/Algeria/etc.) stay Tier 3; NG is Tier 1.
 */
function africaAmericasSphereMacroEntries(presetId: string): WorldEntityManifestEntry[] {
  if (presetId !== "1953-default") return [];
  return [
    sphereMacroEntry({
      entityId: "ET",
      presetId,
      mapFeatureIds: ["231"],
      displayName: "Ethiopia",
      region: "africa",
      un: { state: "admitted", memberSinceYear: 1945 },
      economicArchetype: "market",
      primarySphereId: "US",
      relationships: [
        { sponsorId: "US", alignment: 0.45, integration: 0.25, treatyIds: [] }, // Kagnew / military aid
        { sponsorId: "UK", alignment: 0.3, integration: 0.15, treatyIds: [] },
      ],
    }),
    sphereMacroEntry({
      entityId: "ZA",
      presetId,
      mapFeatureIds: ["710"],
      displayName: "South Africa",
      region: "africa",
      un: { state: "admitted", memberSinceYear: 1945 },
      economicArchetype: "market",
      primarySphereId: "UK",
      relationships: [
        { sponsorId: "UK", alignment: 0.65, integration: 0.5, treatyIds: [] }, // Commonwealth / sterling
        { sponsorId: "US", alignment: 0.4, integration: 0.25, treatyIds: [] },
      ],
    }),
    sphereMacroEntry({
      entityId: "CU",
      presetId,
      mapFeatureIds: ["192"],
      displayName: "Cuba",
      region: "americas",
      economicArchetype: "market",
      relationships: [
        { sponsorId: "US", alignment: 0.75, integration: 0.65, treatyIds: [] }, // pre-revolution sugar/capital
      ],
    }),
    sphereMacroEntry({
      entityId: "GT",
      presetId,
      mapFeatureIds: ["320"],
      displayName: "Guatemala",
      region: "americas",
      economicArchetype: "market",
      relationships: [
        { sponsorId: "US", alignment: 0.55, integration: 0.45, treatyIds: [] }, // UFCO / growing hostility under Arbenz
      ],
    }),
    sphereMacroEntry({
      entityId: "PA",
      presetId,
      mapFeatureIds: ["591"],
      displayName: "Panama",
      region: "americas",
      economicArchetype: "market",
      relationships: [
        { sponsorId: "US", alignment: 0.8, integration: 0.7, treatyIds: [] }, // Canal Zone
      ],
    }),
    sphereMacroEntry({
      entityId: "NI",
      presetId,
      mapFeatureIds: ["558"],
      displayName: "Nicaragua",
      region: "americas",
      economicArchetype: "market",
      relationships: [
        { sponsorId: "US", alignment: 0.7, integration: 0.55, treatyIds: [] }, // Somoza alignment
      ],
    }),
    sphereMacroEntry({
      entityId: "CL",
      presetId,
      mapFeatureIds: ["152"],
      displayName: "Chile",
      region: "americas",
      economicArchetype: "market",
      primarySphereId: "US",
      relationships: [
        { sponsorId: "US", alignment: 0.55, integration: 0.4, treatyIds: [] }, // copper capital
        { sponsorId: "UK", alignment: 0.3, integration: 0.15, treatyIds: [] },
      ],
    }),
    sphereMacroEntry({
      entityId: "AR",
      presetId,
      mapFeatureIds: ["032"],
      displayName: "Argentina",
      region: "americas",
      economicArchetype: "market",
      primarySphereId: "UK",
      relationships: [
        // Perón third-positionism: cooler toward US than neighbours.
        { sponsorId: "US", alignment: 0.35, integration: 0.2, treatyIds: [] },
        { sponsorId: "UK", alignment: 0.4, integration: 0.25, treatyIds: [] }, // meat/sterling trade
      ],
    }),
    sphereMacroEntry({
      entityId: "MX",
      presetId,
      mapFeatureIds: ["484"],
      displayName: "Mexico",
      region: "americas",
      economicArchetype: "market",
      relationships: [{ sponsorId: "US", alignment: 0.55, integration: 0.4, treatyIds: [] }],
    }),
    sphereMacroEntry({
      entityId: "VE",
      presetId,
      mapFeatureIds: ["862"],
      displayName: "Venezuela",
      region: "americas",
      economicArchetype: "market",
      relationships: [
        { sponsorId: "US", alignment: 0.7, integration: 0.55, treatyIds: [] }, // oil majors / Pérez Jiménez
      ],
    }),
  ];
}

export function defineWorldEntityPresetManifest(
  presetId: string,
  entries: readonly WorldEntityManifestEntry[]
): WorldEntityPresetManifest {
  if (!presetId.trim()) throw new Error("World entity manifest presetId is required.");

  const seen = new Set<string>();
  const byId = new Map<string, WorldEntityManifestEntry>();
  for (const entry of entries) {
    if (entry.presetId !== presetId) {
      throw new Error(
        `World entity ${entry.entityId} belongs to ${entry.presetId}, not ${presetId}.`
      );
    }
    if (!entry.entityId.trim() || !entry.displayName.trim()) {
      throw new Error(`World entity in ${presetId} is missing an ID or display name.`);
    }
    if (seen.has(entry.entityId)) {
      throw new Error(`Duplicate world entity ${entry.entityId} in ${presetId}.`);
    }
    seen.add(entry.entityId);
    byId.set(entry.entityId, entry);

    if (entry.status === "dependent" && !entry.parentEntityId && !entry.exceptionalStatus) {
      throw new Error(
        `Dependent entity ${entry.entityId} is missing a parent or exceptional status.`
      );
    }
    if (entry.parentEntityId === entry.entityId) {
      throw new Error(`World entity ${entry.entityId} cannot depend on itself.`);
    }
    if (entry.coParentEntityIds) {
      for (const coParent of entry.coParentEntityIds) {
        if (!coParent.trim()) {
          throw new Error(`World entity ${entry.entityId} has an empty co-parent id.`);
        }
        if (coParent === entry.entityId || coParent === entry.parentEntityId) {
          throw new Error(`World entity ${entry.entityId} has an invalid co-parent ${coParent}.`);
        }
      }
    }
    if (entry.simulationTier === "historical-presence") {
      if (!entry.region) {
        throw new Error(`Tier-3 entity ${entry.entityId} is missing a coverage region.`);
      }
      if (!entry.recognition) {
        throw new Error(`Tier-3 entity ${entry.entityId} is missing recognition status.`);
      }
      if (!entry.un) {
        throw new Error(`Tier-3 entity ${entry.entityId} is missing UN lifecycle status.`);
      }
    }
    if (entry.readiness.player === "ready") {
      if (entry.readiness.autonomous !== "ready" || entry.simulationTier !== "full-autonomous") {
        throw new Error(
          `Player-ready entity ${entry.entityId} must be autonomous-ready and full-autonomous.`
        );
      }
      if (entry.readiness.hardBlockers.length > 0) {
        throw new Error(`Player-ready entity ${entry.entityId} cannot have hard blockers.`);
      }
    }
    if (entry.readiness.player === "blocked" && entry.readiness.hardBlockers.length === 0) {
      throw new Error(`Player-blocked entity ${entry.entityId} must explain why.`);
    }
    const sponsorIds = new Set<string>();
    for (const relationship of entry.sphere.relationships) {
      if (sponsorIds.has(relationship.sponsorId)) {
        throw new Error(
          `World entity ${entry.entityId} has a duplicate sphere sponsor ${relationship.sponsorId}.`
        );
      }
      sponsorIds.add(relationship.sponsorId);
      if (
        !Number.isFinite(relationship.alignment) ||
        relationship.alignment < 0 ||
        relationship.alignment > 1 ||
        !Number.isFinite(relationship.integration) ||
        relationship.integration < 0 ||
        relationship.integration > 1
      ) {
        throw new Error(`World entity ${entry.entityId} has an invalid sphere relationship value.`);
      }
      if (
        relationship.treatyState != null &&
        relationship.treatyState !== "none" &&
        relationship.treatyState !== "proposed" &&
        relationship.treatyState !== "active" &&
        relationship.treatyState !== "suspended"
      ) {
        throw new Error(`World entity ${entry.entityId} has an invalid treaty state.`);
      }
    }
    if (
      entry.sphere.primarySphereId != null &&
      entry.sphere.relationships.length > 0 &&
      !sponsorIds.has(entry.sphere.primarySphereId)
    ) {
      throw new Error(
        `World entity ${entry.entityId} primary sphere is not among its relationships.`
      );
    }
    if (entry.sphere.relationships.length > 1 && entry.sphere.primarySphereId == null) {
      throw new Error(
        `World entity ${entry.entityId} has multiple sphere relationships but no primarySphereId.`
      );
    }
  }

  for (const entry of entries) {
    if (entry.parentEntityId && !byId.has(entry.parentEntityId)) {
      throw new Error(
        `World entity ${entry.entityId} parent ${entry.parentEntityId} is not in preset ${presetId}.`
      );
    }
  }

  return { presetId, entries: [...entries] };
}

const COLD_WAR_PLAYER: CountryId[] = ["US", "UK", "RU", "DD"];
/**
 * Economy-preview Tier-1 roster for Cold War presets.
 * Nigeria + Eastern bloc (PL/CS/HU/RO/BG/YU plus the union republics
 * UKR/BLR/BAL) join FR/IT/ES/SE/TR/… as
 * full-autonomous in 1953 (product decision 2026-07-25). Ireland is also
 * economy-preview so its Tier-1 sectors remain investable, while player access
 * stays blocked.
 */
const COLD_WAR_ECONOMY: CountryId[] = [
  "FR",
  "IT",
  "ES",
  "SE",
  "TR",
  "DE",
  "JP",
  "CN",
  "BR",
  "NG",
  "PL",
  "CS",
  "HU",
  "RO",
  "BG",
  "YU",
  "UKR",
  "BLR",
  "BAL",
];
const COLD_WAR_HIDDEN_1979: CountryId[] = ["PL", "RO", "YU", "HU", "CS", "BG", "UKR", "BLR", "BAL"];
const POST_COLD_WAR_PLAYER: CountryId[] = ["US", "UK"];
const POST_COLD_WAR_ECONOMY: CountryId[] = [
  "FR",
  "IT",
  "ES",
  "SE",
  "TR",
  "DE",
  "JP",
  "CN",
  "NG",
  "BR",
  "IE",
  // AT/FI/GR: same real-configs-and-seed-data status as their FR/IT/ES/SE/TR
  // siblings (#3791) — added here so 1991/1999/2007-default also seed them
  // `status: "beta"` instead of silently freezing on config's "coming-soon".
  "AT",
  "FI",
  "GR",
];

function accessMap(
  player: readonly CountryId[],
  economy: readonly CountryId[],
  hidden: readonly CountryId[] = []
): Partial<Record<CountryId, LegacyCountryAccess>> {
  const classified = new Set<CountryId>([...player, ...economy, ...hidden]);
  const remaining = COUNTRY_ORDER.filter((countryId) => !classified.has(countryId));
  return Object.fromEntries([
    ...player.map((countryId) => [countryId, "player"] as const),
    ...economy.map((countryId) => [countryId, "economy-preview"] as const),
    ...[...hidden, ...remaining].map((countryId) => [countryId, "hidden"] as const),
  ]);
}

/**
 * Apply the #3723 Tier-1 readiness matrix outcomes to the 1953 manifest:
 * reclassify autonomous-blocked proposed Tier-1 countries, patch readiness
 * for remaining Tier-1 candidates, and add unconfigured proposed entities.
 */
function apply1953Tier1MatrixAdjustments(
  entries: WorldEntityManifestEntry[]
): WorldEntityManifestEntry[] {
  const byId = new Map(entries.map((entry) => [entry.entityId, entry] as const));

  for (const plan of TIER1_1953_AUTONOMOUS_RECLASSIFICATIONS) {
    const existing = byId.get(plan.entityId);
    if (!existing) {
      throw new Error(`Cannot reclassify missing 1953 entity ${plan.entityId}.`);
    }
    const hardBlockers = plan.autonomousBlockerCapabilityIds.map((capabilityId) =>
      formatCapabilityBlocker(
        capabilityId,
        plan.reason,
        tier1FollowUpIssue(plan.entityId, capabilityId)
      )
    );
    byId.set(plan.entityId, {
      ...existing,
      simulationTier: plan.appliedTier,
      economicArchetype: plan.economicArchetype,
      legacyAccess: "hidden",
      legacyStatus: "coming-soon",
      readiness: {
        autonomous: "blocked",
        player: "blocked",
        hardBlockers,
        flavorGaps: existing.readiness.flavorGaps,
      },
      tierReclassification: {
        proposedTier: "full-autonomous",
        appliedTier: plan.appliedTier,
        reason: plan.reason,
        followUpIssues: plan.followUpIssues,
      },
    });
  }

  // Japan 1953: explicit autonomous-ready / player-blocked resolution (#3723).
  const japan = byId.get("JP");
  if (japan) {
    byId.set("JP", {
      ...japan,
      simulationTier: "full-autonomous",
      readiness: {
        autonomous: "ready",
        player: "blocked",
        hardBlockers: [
          formatCapabilityBlocker(
            "adminDiagnostics",
            "Japan 1953 lacks established-player-country parity validation for its Diet/cabinet surface.",
            tier1FollowUpIssue("JP", "adminDiagnostics")
          ),
        ],
        flavorGaps: ["bespokeEvents", "artAssets", "wikiMaterial"],
      },
      tierReclassification: undefined,
    });
  }

  // FR/IT/SE/TR: contract-proven autonomous-ready; player-blocked on
  // adminDiagnostics (no COUNTRY_READINESS_EXPECTATIONS entry yet). #3723
  // re-promotion — do not demote via hand-authored blocker lists.
  // ES is deliberately excluded (2026-07-28 owner decision, see the ES
  // sphereMacroEntry in europeanSphereMacroEntries above) — it is a policy
  // demotion, not a readiness gap, so it must not be re-affirmed full-autonomous
  // here even though its own contract probes still report autonomous-ready.
  for (const entityId of ["FR", "IT", "SE", "TR"] as const) {
    const entry = byId.get(entityId);
    if (!entry) continue;
    byId.set(entityId, {
      ...entry,
      simulationTier: "full-autonomous",
      readiness: {
        autonomous: "ready",
        player: "blocked",
        hardBlockers: [
          formatCapabilityBlocker(
            "adminDiagnostics",
            "No COUNTRY_READINESS_EXPECTATIONS entry.",
            tier1FollowUpIssue(entityId, "adminDiagnostics")
          ),
        ],
        flavorGaps: ["bespokeEvents", "artAssets", "wikiMaterial"],
      },
      tierReclassification: undefined,
    });
  }

  // Brazil: autonomous-ready, player-blocked on cabinet + bill lifecycle.
  const brazil = byId.get("BR");
  if (brazil) {
    byId.set("BR", {
      ...brazil,
      simulationTier: "full-autonomous",
      readiness: {
        autonomous: "ready",
        player: "blocked",
        hardBlockers: [
          formatCapabilityBlocker(
            "cabinet",
            "No cabinet positions in POSITIONS_BY_COUNTRY.",
            tier1FollowUpIssue("BR", "cabinet")
          ),
          formatCapabilityBlocker(
            "billLifecycle",
            "No COUNTRY_BILL_PHASES entry.",
            tier1FollowUpIssue("BR", "billLifecycle")
          ),
        ],
        flavorGaps: ["bespokeEvents", "artAssets", "wikiMaterial"],
      },
    });
  }

  // Nigeria 1953: contract-proven autonomous-ready and player-ready now that
  // the presidential national bill lifecycle is registered.
  const nigeria = byId.get("NG");
  if (nigeria) {
    byId.set("NG", {
      ...nigeria,
      simulationTier: "full-autonomous",
      readiness: {
        autonomous: "ready",
        player: "ready",
        hardBlockers: [],
        flavorGaps: ["bespokeEvents", "artAssets", "wikiMaterial"],
      },
      tierReclassification: undefined,
    });
  }

  // Eastern bloc 1953 (PL/CS/HU/RO/BG/YU + UKR/BLR/BAL): product decision
  // 2026-07-25 promotes
  // them to Tier-1 full-autonomous / economy-preview. Contract-proven
  // autonomous-ready and player-ready (one-party + planned-economy); keep
  // economy-preview access (not auto-open) like DE/CN. Flavor gaps remain work
  // items. Preserve #3717 sphere relationship data on the full-country entries
  // (buildCountryEntry starts with relationships: []).
  const easternBlocSphere: Record<
    string,
    {
      primarySphereId?: string;
      relationships: WorldEntityRelationship[];
    }
  > = {
    PL: {
      primarySphereId: "RU",
      relationships: [{ sponsorId: "RU", alignment: 0.85, integration: 0.75, treatyIds: [] }],
    },
    CS: {
      primarySphereId: "RU",
      relationships: [{ sponsorId: "RU", alignment: 0.88, integration: 0.8, treatyIds: [] }],
    },
    HU: {
      primarySphereId: "RU",
      relationships: [{ sponsorId: "RU", alignment: 0.9, integration: 0.82, treatyIds: [] }],
    },
    RO: {
      primarySphereId: "RU",
      relationships: [{ sponsorId: "RU", alignment: 0.85, integration: 0.7, treatyIds: [] }],
    },
    BG: {
      primarySphereId: "RU",
      relationships: [{ sponsorId: "RU", alignment: 0.92, integration: 0.85, treatyIds: [] }],
    },
    // Yugoslavia: post-1948 Tito–Stalin split — non-aligned. Keep US+RU as
    // reference relationships; US is the aid/diplomatic primary (not formal
    // sphere membership). Validation requires a primary when relationships > 1.
    YU: {
      primarySphereId: "US",
      relationships: [
        { sponsorId: "US", alignment: 0.4, integration: 0.25, treatyIds: [] },
        { sponsorId: "RU", alignment: 0.2, integration: 0.1, treatyIds: [] },
      ],
    },
    // Union republics. Alignment and integration sit ABOVE every satellite,
    // including Bulgaria, because these were not allied states with their own
    // foreign ministries and their own armies - they were inside the union, on
    // the union's currency, inside the union's plan. Nothing here should read as
    // a country that could defect the way Romania drifted or Yugoslavia did.
    UKR: {
      primarySphereId: "RU",
      relationships: [{ sponsorId: "RU", alignment: 0.95, integration: 0.96, treatyIds: [] }],
    },
    BLR: {
      primarySphereId: "RU",
      relationships: [{ sponsorId: "RU", alignment: 0.97, integration: 0.97, treatyIds: [] }],
    },
    // The Baltics are the one place where alignment and integration part
    // company: administratively they are as integrated as Byelorussia, but the
    // population's consent is the lowest in the bloc, and in 1953 there is still
    // an armed resistance. Alignment is the lower number for that reason.
    BAL: {
      primarySphereId: "RU",
      relationships: [{ sponsorId: "RU", alignment: 0.86, integration: 0.95, treatyIds: [] }],
    },
  };
  for (const entityId of ["PL", "CS", "HU", "RO", "BG", "YU", "UKR", "BLR", "BAL"] as const) {
    const entry = byId.get(entityId);
    if (!entry) continue;
    const sphere = easternBlocSphere[entityId];
    // Union republics are NOT sovereign in 1953. `buildCountryEntry` stamps
    // every CountryConfig-backed entity "sovereign", which is right for the six
    // satellites - they were allied states with their own foreign ministries -
    // and wrong for UKR/BLR/BAL, which were constituent republics of the USSR.
    // The tier says how much of the simulation an entity carries; `status` says
    // who it answers to, and for these three those are different answers.
    // alignmentRoster.test.ts asserts the roster and the manifest agree here.
    const unionRepublic = entityId === "UKR" || entityId === "BLR" || entityId === "BAL";
    byId.set(entityId, {
      ...entry,
      ...(unionRepublic ? ({ status: "dependent", parentEntityId: "RU" } as const) : ({} as const)),
      simulationTier: "full-autonomous",
      economicArchetype: "planned",
      sphere: {
        canSponsor: false,
        primarySphereId: sphere.primarySphereId,
        relationships: sphere.relationships,
      },
      readiness: {
        autonomous: "ready",
        player: "ready",
        hardBlockers: [],
        flavorGaps: ["bespokeEvents", "artAssets", "wikiMaterial"],
      },
      tierReclassification: undefined,
    });
  }

  // DE / CN: contract reports player-ready; keep economy-preview access (not auto-open).
  for (const entityId of ["DE", "CN"] as const) {
    const entry = byId.get(entityId);
    if (!entry) continue;
    byId.set(entityId, {
      ...entry,
      simulationTier: "full-autonomous",
      readiness: {
        autonomous: "ready",
        player: "ready",
        hardBlockers: [],
        flavorGaps: ["bespokeEvents", "artAssets", "wikiMaterial"],
      },
    });
  }

  for (const plan of TIER1_1953_UNCONFIGURED_PROPOSED) {
    if (byId.has(plan.entityId)) {
      throw new Error(`Unconfigured proposed Tier-1 entity ${plan.entityId} already exists.`);
    }
    const hardBlockers = UNCONFIGURED_BLOCKER_CAPABILITIES.map((capabilityId) =>
      formatCapabilityBlocker(
        capabilityId,
        plan.reason,
        tier1FollowUpIssue(plan.entityId, capabilityId)
      )
    );
    hardBlockers[1] = formatCapabilityBlocker(
      UNCONFIGURED_BLOCKER_CAPABILITIES[1],
      plan.reason,
      plan.ownerIssue
    );
    const unconfiguredRegion: Record<string, WorldEntityRegion> = {
      IN: "asia",
      PK: "asia",
      IR: "asia",
      IQ: "asia",
      EG: "africa",
      SA: "asia",
      SY: "asia",
      ID: "asia",
      KP: "asia",
      KR: "asia",
      NVN: "asia",
      SVN: "asia",
    };
    const unconfiguredUn: Record<string, WorldEntityUnRecord> = {
      IN: { state: "admitted", memberSinceYear: 1945 },
      PK: { state: "admitted", memberSinceYear: 1947 },
      IR: { state: "admitted", memberSinceYear: 1945 },
      IQ: { state: "admitted", memberSinceYear: 1945 },
      EG: { state: "admitted", memberSinceYear: 1945 },
      SA: { state: "admitted", memberSinceYear: 1945 },
      SY: { state: "admitted", memberSinceYear: 1945 },
      ID: { state: "admitted", memberSinceYear: 1950 },
      KP: { state: "ineligible" },
      KR: { state: "ineligible" },
      NVN: { state: "ineligible" },
      SVN: { state: "ineligible" },
    };
    const unconfiguredMap: Record<string, string[]> = {
      IN: ["356"],
      PK: ["586"],
      IR: ["364"],
      IQ: ["368"],
      EG: ["818"],
      SA: ["682"],
      SY: ["760"],
      ID: ["360"],
      KP: ["408"],
      KR: ["410"],
      // Entity keys, not ISO numerics: unified Vietnam's 704 covers both halves
      // and so can identify neither. `vietnam-regions.json` supplies these two,
      // cut at the 17th parallel — before it existed both were `unmapped` and
      // the globe drew Vietnam as an uncoloured background country.
      NVN: ["NVN"],
      SVN: ["SVN"],
    };
    byId.set(plan.entityId, {
      entityId: plan.entityId,
      presetId: "1953-default",
      displayName: plan.displayName,
      status: "sovereign",
      region: unconfiguredRegion[plan.entityId],
      simulationTier: plan.appliedTier,
      economicArchetype: plan.economicArchetype,
      sphere: { canSponsor: false, relationships: [] },
      lifecycle: { transitionRuleIds: [] },
      recognition: { status: "widely-recognized" },
      un: unconfiguredUn[plan.entityId] ?? { state: "eligible" },
      mapFeatureIds: unconfiguredMap[plan.entityId],
      readiness: {
        autonomous: "blocked",
        player: "blocked",
        hardBlockers,
        flavorGaps: [],
      },
      legacyAccess: "hidden",
      legacyStatus: "coming-soon",
      tierReclassification: {
        proposedTier: "full-autonomous",
        appliedTier: plan.appliedTier,
        reason: plan.reason,
        followUpIssues: [
          plan.ownerIssue,
          ...UNCONFIGURED_BLOCKER_CAPABILITIES.map((id) => tier1FollowUpIssue(plan.entityId, id)),
        ],
      },
    });
  }

  return [...byId.values()];
}

/**
 * Overlay the era roster's answer onto the CountryConfig-backed entries.
 *
 * SCOPED TO `COUNTRY_ORDER` ON PURPOSE. The roster classifies the *registered*
 * world; unregistered entities keep whatever classification the manifest already
 * gives them, and there are two kinds that must not be touched:
 *
 * - **Latent countries.** UKR/BLR/BAL are `economy-preview` + full-autonomous in
 *   1953 but `hidden` + historical-presence in 1979. The roster's single
 *   `latent` tier cannot express that split, and does not need to — they are
 *   unregistered either way, which is the only thing the roster decides.
 * - **Sphere-macro, decolonization and historical-presence entities.** These
 *   are not `CountryId`s at all and carry sphere relationships this must
 *   preserve.
 *
 * So this mutates `legacyAccess`/`legacyStatus` in place rather than rebuilding
 * entries: rebuilding would discard Spain's 1953 Pact-of-Madrid relationship and
 * every tier-reclassification record.
 */
function applyRosterAccess(
  presetId: string,
  entries: readonly WorldEntityManifestEntry[]
): WorldEntityManifestEntry[] {
  if (!isShippingPreset(presetId)) return [...entries];
  const out: WorldEntityManifestEntry[] = [];
  for (const entry of entries) {
    const countryId = entry.countryId;
    if (!countryId || !COUNTRY_ORDER.includes(countryId)) {
      out.push(entry);
      continue;
    }
    const tier = tierFor(presetId, countryId);
    // A country absent from this era is not a PLAYABLE world entity in it. It
    // may still be a historical one.
    //
    // ⚠ A DISSOLVED STATE IS KEPT, NOT DROPPED. Upstream's background
    // expansion marks a state that has ceased to exist `status: "dissolved"`
    // rather than deleting it, so the world still records that East Germany,
    // Yugoslavia and Czechoslovakia existed and then did not. Dropping them
    // here would undo that a line later, and `backgroundCountryRoster.test.ts`
    // asserts 1999 still carries YU and CS as dissolved.
    //
    // This does NOT reopen "East Germany turns up in post-reunification
    // worlds". Everything player-facing -- the landing rosters, the admin reset
    // picker, seeding -- filters on `tierFor`, which still answers "absent".
    // Only the historical record keeps the row.
    if (tier === "absent") {
      if (entry.status === "dissolved") {
        out.push({ ...entry, legacyAccess: "hidden", legacyStatus: "coming-soon" });
      }
      continue;
    }
    // `latent` cannot occur here: latent countries are unregistered by
    // definition, and `eraRoster.test.ts` asserts they stay out of COUNTRY_ORDER.
    const legacyAccess: LegacyCountryAccess =
      tier === "player" ? "player" : tier === "econ" ? "economy-preview" : "hidden";
    // ONLY `legacyAccess`/`legacyStatus`. Rebuilding `simulationTier` or
    // `readiness` here destroys Spain's 1953 sphere-macro demotion, Japan's
    // recorded 1953 player blocker, and every tierReclassification record — all
    // of which are authored decisions the roster has no opinion about. The two
    // stay consistent anyway: `player` and `economy-preview` both map to
    // full-autonomous, and `hidden` to historical-presence, which is what the
    // existing entries already carry.
    out.push({
      ...entry,
      legacyAccess,
      legacyStatus:
        legacyAccess === "player"
          ? "active"
          : legacyAccess === "economy-preview"
            ? "beta"
            : "coming-soon",
    });
  }

  // Fill the gaps. The hand-written maps simply omitted several registered
  // countries — the 1991 manifest was `accessMap(POST_COLD_WAR_PLAYER,
  // POST_COLD_WAR_ECONOMY)`, which names neither Russia nor the Warsaw Pact
  // successors — so `getWorldEntityOrThrow` threw for exactly the countries
  // most likely to be misconfigured, and the readiness contract could not
  // evaluate them at all. A roster tier is a classification; every registered
  // country now has one.
  const present = new Set(out.map((entry) => entry.countryId).filter(Boolean));
  for (const countryId of COUNTRY_ORDER) {
    if (present.has(countryId)) continue;
    const tier = tierFor(presetId, countryId);
    if (tier === "absent" || tier === "latent") continue;
    out.push(
      buildCountryEntry(
        presetId,
        countryId,
        tier === "player" ? "player" : tier === "econ" ? "economy-preview" : "hidden"
      )
    );
  }
  return out;
}

/** Build a preset manifest with the roster overlaid onto its registered countries. */
function defineRosterManifest(
  presetId: string,
  entries: readonly WorldEntityManifestEntry[]
): WorldEntityPresetManifest {
  return defineWorldEntityPresetManifest(presetId, applyRosterAccess(presetId, entries));
}

export const WORLD_ENTITY_MANIFESTS: Readonly<Record<string, WorldEntityPresetManifest>> =
  Object.freeze({
    "1953-default": defineRosterManifest(
      "1953-default",
      expandManifestWithBackgroundCountries({
        presetId: "1953-default",
        entries: apply1953Tier1MatrixAdjustments([
          ...entriesFromAccess("1953-default", accessMap(COLD_WAR_PLAYER, COLD_WAR_ECONOMY)),
          ...europeanSphereMacroEntries("1953-default"),
          ...asianMiddleEastSphereMacroEntries("1953-default"),
          ...africaAmericasSphereMacroEntries("1953-default"),
          ...emergentDecolonizationEntries("1953-default"),
          ...historicalPresenceEntries("1953-default"),
        ]),
      })
    ),
    "1979-default": defineRosterManifest(
      "1979-default",
      expandManifestWithBackgroundCountries({
        presetId: "1979-default",
        entries: entriesFromAccess(
          "1979-default",
          // NG is already in COLD_WAR_ECONOMY; IE remains economy-preview in 1979+.
          // AT/FI/GR are full-autonomous in 1953 (promoted from sphere-macro by
          // europeanSphereMacroEntries' promotion override this pass) and full
          // country entries in every later preset (#3791).
          accessMap(
            COLD_WAR_PLAYER,
            [...COLD_WAR_ECONOMY, "IE", "AT", "FI", "GR"],
            COLD_WAR_HIDDEN_1979
          )
        ),
      })
    ),
    "1991-default": defineRosterManifest(
      "1991-default",
      expandManifestWithBackgroundCountries({
        presetId: "1991-default",
        entries: entriesFromAccess(
          "1991-default",
          accessMap(POST_COLD_WAR_PLAYER, POST_COLD_WAR_ECONOMY)
        ),
      })
    ),
    "1999-default": defineRosterManifest(
      "1999-default",
      expandManifestWithBackgroundCountries({
        presetId: "1999-default",
        entries: entriesFromAccess(
          "1999-default",
          accessMap(POST_COLD_WAR_PLAYER, POST_COLD_WAR_ECONOMY)
        ),
      })
    ),
    "2007-default": defineRosterManifest(
      "2007-default",
      expandManifestWithBackgroundCountries({
        presetId: "2007-default",
        entries: entriesFromAccess(
          "2007-default",
          accessMap(POST_COLD_WAR_PLAYER, POST_COLD_WAR_ECONOMY)
        ),
      })
    ),
    "2019-default": defineRosterManifest(
      "2019-default",
      expandManifestWithBackgroundCountries({
        presetId: "2019-default",
        entries: configFallbackEntries("2019-default"),
      })
    ),
    "2023-default": defineRosterManifest(
      "2023-default",
      expandManifestWithBackgroundCountries({
        presetId: "2023-default",
        entries: configFallbackEntries("2023-default"),
      })
    ),
    "2027-default": defineRosterManifest(
      "2027-default",
      expandManifestWithBackgroundCountries({
        presetId: "2027-default",
        entries: configFallbackEntries("2027-default"),
      })
    ),
  });

export function getWorldEntityPresetManifest(presetId: string): WorldEntityPresetManifest {
  const manifest = WORLD_ENTITY_MANIFESTS[presetId];
  if (!manifest) {
    throw new Error(
      `No world entity manifest exists for preset ${presetId}; refusing to use another era.`
    );
  }
  return manifest;
}

export function getWorldEntityOrThrow(
  presetId: string,
  entityId: WorldEntityId
): WorldEntityManifestEntry {
  const entry = getWorldEntityPresetManifest(presetId).entries.find(
    (candidate) => candidate.entityId === entityId
  );
  if (!entry) {
    throw new Error(
      `World entity ${entityId} is not classified for preset ${presetId}; refusing fallback.`
    );
  }
  return entry;
}
