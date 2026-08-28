/**
 * Archetype-aware country readiness contracts (#3722).
 *
 * Separates autonomous safety from player parity so a Tier-1 country can run
 * under NPP control while remaining player-blocked until every mechanical
 * capability applicable to its government/economic archetype is present.
 *
 * Flavor gaps (events, art, wiki) are reported but never become hard blockers.
 *
 * Public surface is intentionally small: resolve archetypes, evaluate a pure
 * report from evidence, collect static evidence, and gate player opening.
 */

import {
  COUNTRY_CONFIGS,
  isParliamentarySystem,
  isPresidentialGovernmentType,
  type CountryId,
  type GovernmentType,
} from "@/lib/constants/countries";
import { COUNTRY_READINESS_EXPECTATIONS } from "@/lib/constants/countryReadinessExpectations";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { FOREX_ACTIVE_COUNTRIES } from "@/lib/constants/currencies";
import { MARKETIZATION_SCHEDULE } from "@/lib/constants/commandEconomy";
import { getNationalBudgetSeedConfigsForPreset } from "@/lib/seeds/reference/budgets";
import { COUNTRY_BILL_PHASES, COUNTRY_ELECTION_PHASES } from "@/lib/turn/countryPhases";
import {
  getWorldEntityOrThrow,
  type ReadinessResult,
  type WorldEconomicArchetype,
} from "@/lib/world/worldEntityManifest";
import type { PartySeed } from "@/lib/seeds/reference/politicalParties";
import { frParties } from "@/lib/seeds/fr/frParties";
import { itParties } from "@/lib/seeds/it/itParties";
import { esParties } from "@/lib/seeds/es/esParties";
import { seParties } from "@/lib/seeds/se/seParties";
import { trParties } from "@/lib/seeds/tr/trParties";
import { plParties } from "@/lib/seeds/pl/plParties";
import { csParties } from "@/lib/seeds/cs/csParties";
import { huParties } from "@/lib/seeds/hu/huParties";
import { roParties } from "@/lib/seeds/ro/roParties";
import { bgParties } from "@/lib/seeds/bg/bgParties";
import { uaParties } from "@/lib/seeds/ua/uaParties";
import { blrParties } from "@/lib/seeds/blr/blrParties";
import { balParties } from "@/lib/seeds/bal/balParties";
import { yuParties } from "@/lib/seeds/yu/yuParties";

// ─── Capability catalogue ────────────────────────────────────────────────────

export const CAPABILITY_IDS = [
  "fullAutonomousTier",
  "institutionsConfigured",
  "regionsAuthored",
  "partiesAuthored",
  "economyModel",
  "budgetsAuthored",
  "electionCycle",
  "cabinet",
  "billLifecycle",
  "onePartyMood",
  "plannedEconomyControls",
  "adminDiagnostics",
  "bespokeEvents",
  "artAssets",
  "wikiMaterial",
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export type CapabilityKind = "mechanical" | "flavor";

export type ReadinessScope = "autonomous" | "player";

export type ReadinessArchetype =
  "market" | "parliamentary" | "presidential" | "one-party" | "planned-economy";

export interface CapabilityRequirement {
  capabilityId: CapabilityId;
  kind: CapabilityKind;
  /** Scopes that require this capability when the archetype applies. */
  requiredFor: readonly ReadinessScope[];
}

export interface CapabilityEvidence {
  present: boolean;
  /** Human-readable proof for admin diagnostics. */
  evidence: string;
}

export type CapabilityEvidenceMap = Partial<Record<CapabilityId, CapabilityEvidence>>;

export interface FailedCapability {
  capabilityId: CapabilityId;
  label: string;
  evidence: string;
}

export interface CapabilityDiagnostic {
  capabilityId: CapabilityId;
  label: string;
  kind: CapabilityKind;
  requiredFor: ReadinessScope[];
  present: boolean;
  evidence: string;
  /** How this capability affects the report. */
  status: "pass" | "hard-block" | "flavor-gap" | "not-required";
}

export interface CountryReadinessReport {
  countryId: CountryId;
  presetId: string;
  archetypes: ReadinessArchetype[];
  autonomous: ReadinessResult;
  player: ReadinessResult;
  hardBlockers: FailedCapability[];
  flavorGaps: FailedCapability[];
  capabilities: CapabilityDiagnostic[];
}

export class PlayerOpenBlockedError extends Error {
  readonly report: CountryReadinessReport;

  constructor(report: CountryReadinessReport) {
    const names = report.hardBlockers.map((b) => b.capabilityId).join(", ");
    super(
      `Cannot open ${report.countryId} to players for ${report.presetId}: hard blockers — ${names || "player not ready"}`
    );
    this.name = "PlayerOpenBlockedError";
    this.report = report;
  }
}

const CAPABILITY_LABELS: Record<CapabilityId, string> = {
  fullAutonomousTier: "Full-autonomous simulation tier",
  institutionsConfigured: "Institutions and offices configured",
  regionsAuthored: "Regions authored",
  partiesAuthored: "Parties authored",
  economyModel: "Economy model wired",
  budgetsAuthored: "National budgets authored for preset",
  electionCycle: "Election cycle registered",
  cabinet: "Cabinet positions defined",
  billLifecycle: "Bill lifecycle registered",
  onePartyMood: "One-party popular mood profile",
  plannedEconomyControls: "Planned-economy controls",
  adminDiagnostics: "Admin readiness diagnostics registered",
  bespokeEvents: "Bespoke events",
  artAssets: "Art assets",
  wikiMaterial: "Wiki material",
};

/** Shared mechanical baseline for every full-country archetype. */
const BASE_MECHANICAL: CapabilityRequirement[] = [
  {
    capabilityId: "fullAutonomousTier",
    kind: "mechanical",
    requiredFor: ["autonomous", "player"],
  },
  {
    capabilityId: "institutionsConfigured",
    kind: "mechanical",
    requiredFor: ["autonomous", "player"],
  },
  {
    capabilityId: "regionsAuthored",
    kind: "mechanical",
    requiredFor: ["autonomous", "player"],
  },
  {
    capabilityId: "partiesAuthored",
    kind: "mechanical",
    requiredFor: ["autonomous", "player"],
  },
  {
    capabilityId: "budgetsAuthored",
    kind: "mechanical",
    requiredFor: ["autonomous", "player"],
  },
  {
    capabilityId: "electionCycle",
    kind: "mechanical",
    requiredFor: ["autonomous", "player"],
  },
  {
    capabilityId: "cabinet",
    kind: "mechanical",
    requiredFor: ["player"],
  },
  {
    capabilityId: "adminDiagnostics",
    kind: "mechanical",
    requiredFor: ["player"],
  },
];

const FLAVOR_REQUIREMENTS: CapabilityRequirement[] = [
  { capabilityId: "bespokeEvents", kind: "flavor", requiredFor: ["player"] },
  { capabilityId: "artAssets", kind: "flavor", requiredFor: ["player"] },
  { capabilityId: "wikiMaterial", kind: "flavor", requiredFor: ["player"] },
];

/**
 * Per-archetype capability overlays. Profiles are additive — a country that is
 * both parliamentary and market must satisfy the union of both overlays.
 */
export const READINESS_PROFILES: Record<ReadinessArchetype, readonly CapabilityRequirement[]> =
  Object.freeze({
    market: Object.freeze<CapabilityRequirement[]>([
      ...BASE_MECHANICAL,
      {
        capabilityId: "economyModel",
        kind: "mechanical",
        requiredFor: ["autonomous", "player"] as const,
      },
      {
        capabilityId: "billLifecycle",
        kind: "mechanical",
        requiredFor: ["player"] as const,
      },
      ...FLAVOR_REQUIREMENTS,
    ]),
    parliamentary: Object.freeze<CapabilityRequirement[]>([
      ...BASE_MECHANICAL,
      {
        capabilityId: "cabinet",
        kind: "mechanical",
        // Parliamentary NPP governments need a cabinet to staff ministries.
        requiredFor: ["autonomous", "player"] as const,
      },
      {
        capabilityId: "billLifecycle",
        kind: "mechanical",
        requiredFor: ["autonomous", "player"] as const,
      },
      ...FLAVOR_REQUIREMENTS,
    ]),
    presidential: Object.freeze<CapabilityRequirement[]>([
      ...BASE_MECHANICAL,
      {
        capabilityId: "billLifecycle",
        kind: "mechanical",
        requiredFor: ["player"] as const,
      },
      ...FLAVOR_REQUIREMENTS,
    ]),
    "one-party": Object.freeze<CapabilityRequirement[]>([
      ...BASE_MECHANICAL,
      {
        capabilityId: "cabinet",
        kind: "mechanical",
        requiredFor: ["autonomous", "player"] as const,
      },
      {
        capabilityId: "billLifecycle",
        kind: "mechanical",
        requiredFor: ["autonomous", "player"] as const,
      },
      {
        capabilityId: "onePartyMood",
        kind: "mechanical",
        requiredFor: ["player"] as const,
      },
      ...FLAVOR_REQUIREMENTS,
    ]),
    "planned-economy": Object.freeze<CapabilityRequirement[]>([
      ...BASE_MECHANICAL,
      {
        capabilityId: "plannedEconomyControls",
        kind: "mechanical",
        requiredFor: ["autonomous", "player"] as const,
      },
      {
        capabilityId: "economyModel",
        kind: "mechanical",
        requiredFor: ["autonomous", "player"] as const,
      },
      ...FLAVOR_REQUIREMENTS,
    ]),
  });

// ─── Archetype resolution ────────────────────────────────────────────────────

export interface ArchetypeResolutionInput {
  governmentType: GovernmentType;
  economicArchetype: WorldEconomicArchetype;
  /** Explicit planned-economy signal from country config. */
  disallowPrivateCorporationFounding?: boolean;
}

/**
 * Resolve the set of readiness archetypes that apply to a country. Order is
 * stable for deterministic diagnostics.
 */
export function resolveReadinessArchetypes(input: ArchetypeResolutionInput): ReadinessArchetype[] {
  const archetypes: ReadinessArchetype[] = [];

  if (isPresidentialGovernmentType(input.governmentType)) {
    archetypes.push("presidential");
  } else if (input.governmentType === "onePartyState") {
    archetypes.push("one-party");
  } else if (
    input.governmentType === "parliamentaryMonarchy" ||
    input.governmentType === "parliamentaryRepublic"
  ) {
    archetypes.push("parliamentary");
  }

  const planned =
    input.economicArchetype === "planned" || input.disallowPrivateCorporationFounding === true;
  if (planned) {
    archetypes.push("planned-economy");
  } else if (input.economicArchetype === "market" || input.economicArchetype === "mixed") {
    archetypes.push("market");
  }

  return archetypes;
}

export function resolveReadinessArchetypesForCountry(
  countryId: CountryId,
  presetId: string
): ReadinessArchetype[] {
  const config = COUNTRY_CONFIGS[countryId];
  if (!config) throw new Error(`Invalid country ID: ${countryId}`);
  const entity = getWorldEntityOrThrow(presetId, countryId);
  return resolveReadinessArchetypes({
    governmentType: config.governmentType,
    economicArchetype: entity.economicArchetype,
    disallowPrivateCorporationFounding: config.disallowPrivateCorporationFounding,
  });
}

// ─── Pure evaluation ─────────────────────────────────────────────────────────

function mergeRequirements(
  archetypes: readonly ReadinessArchetype[]
): Map<CapabilityId, CapabilityRequirement> {
  const merged = new Map<CapabilityId, CapabilityRequirement>();
  for (const archetype of archetypes) {
    for (const req of READINESS_PROFILES[archetype]) {
      const existing = merged.get(req.capabilityId);
      if (!existing) {
        merged.set(req.capabilityId, {
          capabilityId: req.capabilityId,
          kind: req.kind,
          requiredFor: [...req.requiredFor],
        });
        continue;
      }
      const scopes = new Set([...existing.requiredFor, ...req.requiredFor]);
      // Mechanical wins over flavor if both somehow declare the same id.
      const kind: CapabilityKind =
        existing.kind === "mechanical" || req.kind === "mechanical" ? "mechanical" : "flavor";
      merged.set(req.capabilityId, {
        capabilityId: req.capabilityId,
        kind,
        requiredFor: [...scopes],
      });
    }
  }
  return merged;
}

function missingEvidence(capabilityId: CapabilityId): CapabilityEvidence {
  return {
    present: false,
    evidence: `No evidence supplied for capability "${capabilityId}".`,
  };
}

/**
 * Pure, deterministic readiness evaluation. Callers supply capability evidence;
 * this never touches Mongo or I/O.
 */
export function evaluateCountryReadiness(input: {
  countryId: CountryId;
  presetId: string;
  archetypes: readonly ReadinessArchetype[];
  evidence: CapabilityEvidenceMap;
}): CountryReadinessReport {
  const requirements = mergeRequirements(input.archetypes);
  const hardBlockers: FailedCapability[] = [];
  const flavorGaps: FailedCapability[] = [];
  const capabilities: CapabilityDiagnostic[] = [];

  const autonomousFailures = new Set<CapabilityId>();
  const playerFailures = new Set<CapabilityId>();

  for (const capabilityId of CAPABILITY_IDS) {
    const req = requirements.get(capabilityId);
    const ev = input.evidence[capabilityId] ?? missingEvidence(capabilityId);
    const label = CAPABILITY_LABELS[capabilityId];

    if (!req) {
      capabilities.push({
        capabilityId,
        label,
        kind: "flavor",
        requiredFor: [],
        present: ev.present,
        evidence: ev.evidence,
        status: "not-required",
      });
      continue;
    }

    const requiredFor = [...req.requiredFor];
    let status: CapabilityDiagnostic["status"] = "pass";

    if (!ev.present) {
      if (req.kind === "flavor") {
        status = "flavor-gap";
        flavorGaps.push({ capabilityId, label, evidence: ev.evidence });
      } else {
        status = "hard-block";
        hardBlockers.push({ capabilityId, label, evidence: ev.evidence });
        if (requiredFor.includes("autonomous")) autonomousFailures.add(capabilityId);
        if (requiredFor.includes("player")) playerFailures.add(capabilityId);
      }
    }

    capabilities.push({
      capabilityId,
      label,
      kind: req.kind,
      requiredFor,
      present: ev.present,
      evidence: ev.evidence,
      status,
    });
  }

  // Player readiness always requires autonomous readiness.
  const autonomous: ReadinessResult = autonomousFailures.size === 0 ? "ready" : "blocked";
  const player: ReadinessResult =
    autonomous === "ready" && playerFailures.size === 0 ? "ready" : "blocked";

  return {
    countryId: input.countryId,
    presetId: input.presetId,
    archetypes: [...input.archetypes],
    autonomous,
    player,
    hardBlockers,
    flavorGaps,
    capabilities,
  };
}

// ─── Static evidence collection ──────────────────────────────────────────────

/**
 * Authored capability overrides for cases probes cannot yet prove (or for
 * known flavor gaps). Keyed by `${presetId}:${countryId}:${capabilityId}`.
 * `undefined` means "use the probe result".
 *
 * Authored party-seed modules for countries whose readiness expectations entry
 * is incomplete or missing are listed below; probes prefer
 * {@link COUNTRY_READINESS_EXPECTATIONS} when present.
 */
const AUTHORED_PARTY_SEED_MODULES: Partial<Record<CountryId, readonly PartySeed[]>> = {
  FR: frParties,
  IT: itParties,
  ES: esParties,
  SE: seParties,
  TR: trParties,
  // Eastern bloc Tier-1 — also have COUNTRY_READINESS_EXPECTATIONS entries;
  // seed modules remain registered so probes see authored material before
  // expectations land (and for presets that filter via validForPresets).
  PL: plParties,
  CS: csParties,
  HU: huParties,
  RO: roParties,
  BG: bgParties,
  YU: yuParties,
  UKR: uaParties,
  BLR: blrParties,
  BAL: balParties,
};

function partySeedsForPreset(countryId: CountryId, presetId: string): PartySeed[] {
  const seeds = AUTHORED_PARTY_SEED_MODULES[countryId];
  if (!seeds) return [];
  return seeds.filter((seed) => !seed.validForPresets || seed.validForPresets.includes(presetId));
}

const CAPABILITY_INVENTORY: Readonly<Record<string, CapabilityEvidence | undefined>> =
  Object.freeze({
    // Japan 1953 is the reference autonomous-ok / player-blocked case: Diet and
    // economy wiring exist for NPP autonomy, but player-parity validation and
    // flavor content are incomplete.
    "1953-default:JP:adminDiagnostics": {
      present: false,
      evidence:
        "Japan 1953 lacks established-player-country parity validation for its Diet/cabinet surface.",
    },
    "1953-default:JP:bespokeEvents": {
      present: false,
      evidence: "No Japan-1953 bespoke event pack authored yet.",
    },
    "1953-default:JP:artAssets": {
      present: false,
      evidence: "Japan 1953 uses shared modern art placeholders.",
    },
    "1953-default:JP:wikiMaterial": {
      present: false,
      evidence: "Japan 1953 wiki material is incomplete.",
    },
    // Established player countries in Cold-War presets: flavor still tracked.
    "1953-default:UK:bespokeEvents": {
      present: false,
      evidence: "UK 1953 bespoke event coverage is partial.",
    },
    "1953-default:UK:wikiMaterial": {
      present: true,
      evidence: "UK wiki pages cover the parliamentary loop.",
    },
    "1953-default:US:bespokeEvents": {
      present: true,
      evidence: "US has era-aware event coverage.",
    },
    "1953-default:US:artAssets": {
      present: true,
      evidence: "US flag/art assets are complete.",
    },
    "1953-default:US:wikiMaterial": {
      present: true,
      evidence: "US wiki material is complete.",
    },
  });

function inventoryKey(presetId: string, countryId: CountryId, capabilityId: CapabilityId): string {
  return `${presetId}:${countryId}:${capabilityId}`;
}

function probeFullAutonomousTier(countryId: CountryId, presetId: string): CapabilityEvidence {
  const entity = getWorldEntityOrThrow(presetId, countryId);
  const present = entity.simulationTier === "full-autonomous";
  return {
    present,
    evidence: present
      ? `Manifest tier is full-autonomous.`
      : `Manifest tier is ${entity.simulationTier}; full-autonomous required.`,
  };
}

function probeInstitutions(countryId: CountryId): CapabilityEvidence {
  const config = COUNTRY_CONFIGS[countryId];
  const offices = config.officeTypes?.length ?? 0;
  const hasLegislature = Boolean(config.legislature?.lowerChamber?.key);
  const present = offices > 0 && hasLegislature;
  return {
    present,
    evidence: present
      ? `${offices} office types; lower chamber "${config.legislature.lowerChamber.key}".`
      : `Missing offices (${offices}) or lower chamber.`,
  };
}

function probeRegions(countryId: CountryId): CapabilityEvidence {
  const expect = COUNTRY_READINESS_EXPECTATIONS[countryId];
  if (expect && expect.regionCount > 0) {
    return {
      present: true,
      evidence: `Readiness expectations require ${expect.regionCount} regions.`,
    };
  }
  // Config-only countries without an expectations entry still need regions
  // declared somehow — treat missing expectations as not proven for player,
  // but institutionsConfigured already covers basic config presence.
  const config = COUNTRY_CONFIGS[countryId];
  const present = Boolean(config);
  return {
    present,
    evidence: present
      ? `Country config present; no region-count expectation registered.`
      : `No country config.`,
  };
}

function probeParties(countryId: CountryId, presetId: string): CapabilityEvidence {
  const expect = COUNTRY_READINESS_EXPECTATIONS[countryId];
  if (expect) {
    const present = expect.partyMin > 0 || expect.partyRoster.length > 0;
    return {
      present,
      evidence: present
        ? `Expected parties: ${expect.partyRoster} (min ${expect.partyMin}).`
        : `Party roster empty in readiness expectations.`,
    };
  }
  // Economy-preview Tier-1 countries (FR/IT/ES/SE/TR) author parties in seed
  // modules without a COUNTRY_READINESS_EXPECTATIONS entry yet.
  const seeded = partySeedsForPreset(countryId, presetId);
  if (seeded.length > 0) {
    const labels = seeded.map((p) => p.abbreviation || p.name).join(", ");
    return {
      present: true,
      evidence: `Authored party seed module for ${presetId}: ${labels} (${seeded.length}).`,
    };
  }
  return {
    present: false,
    evidence: `No party roster in COUNTRY_READINESS_EXPECTATIONS and no authored party seed module.`,
  };
}

function probeEconomyModel(countryId: CountryId, planned: boolean): CapabilityEvidence {
  if (planned) {
    const scheduled = Boolean(MARKETIZATION_SCHEDULE[countryId]);
    const blockedFounding = COUNTRY_CONFIGS[countryId].disallowPrivateCorporationFounding === true;
    const present = scheduled || blockedFounding;
    return {
      present,
      evidence: present
        ? `Planned economy: marketizationSchedule=${scheduled}, disallowPrivateCorporationFounding=${blockedFounding}.`
        : `Planned economy missing marketization schedule and private-corp founding block.`,
    };
  }
  const forex = FOREX_ACTIVE_COUNTRIES.includes(countryId);
  return {
    present: forex,
    evidence: forex
      ? `Listed in FOREX_ACTIVE_COUNTRIES.`
      : `Not listed in FOREX_ACTIVE_COUNTRIES (market economy probe).`,
  };
}

function probeBudgets(countryId: CountryId, presetId: string): CapabilityEvidence {
  const configs = getNationalBudgetSeedConfigsForPreset(presetId);
  const present = configs.some((c) => c.countryId === countryId);
  return {
    present,
    evidence: present
      ? `National budget seed present for ${presetId}.`
      : `No national budget seed for ${countryId} under ${presetId}.`,
  };
}

function probeElectionCycle(countryId: CountryId): CapabilityEvidence {
  // US presidential / congressional cycles live in the core turn pipeline, not
  // the per-country election-phase registry.
  // eslint-disable-next-line local/no-country-literals -- the US election cycle is a core-pipeline path, not a registry entry
  if (countryId === "US") {
    return {
      present: true,
      evidence: "US uses the core presidential/congressional election pipeline.",
    };
  }
  const phases = COUNTRY_ELECTION_PHASES[countryId];
  const present = Boolean(phases && phases.length > 0);
  return {
    present,
    evidence: present
      ? `COUNTRY_ELECTION_PHASES: ${phases!.map((p) => p.name).join(", ")}.`
      : `No COUNTRY_ELECTION_PHASES entry.`,
  };
}

function probeCabinet(countryId: CountryId): CapabilityEvidence {
  const positions = getCabinetPositions(countryId);
  const present = positions.length > 0;
  return {
    present,
    evidence: present
      ? `${positions.length} cabinet positions registered.`
      : `No cabinet positions in POSITIONS_BY_COUNTRY.`,
  };
}

function probeBillLifecycle(countryId: CountryId): CapabilityEvidence {
  // US national bill lifecycle is the default/core path.
  // eslint-disable-next-line local/no-country-literals -- the US bill lifecycle is the core/default path, not a registry entry
  if (countryId === "US") {
    return {
      present: true,
      evidence: "US uses the core national bill lifecycle pipeline.",
    };
  }
  const entry = COUNTRY_BILL_PHASES[countryId];
  const present = Boolean(entry);
  return {
    present,
    evidence: present
      ? `COUNTRY_BILL_PHASES entry "${entry!.phaseName}".`
      : `No COUNTRY_BILL_PHASES entry.`,
  };
}

function probeOnePartyMood(countryId: CountryId): CapabilityEvidence {
  const profile = COUNTRY_CONFIGS[countryId].popularMoodProfile;
  const present = Boolean(profile);
  return {
    present,
    evidence: present
      ? `popularMoodProfile is set on country config.`
      : `popularMoodProfile missing (required for one-party player parity).`,
  };
}

function probePlannedControls(countryId: CountryId): CapabilityEvidence {
  const config = COUNTRY_CONFIGS[countryId];
  const scheduled = Boolean(MARKETIZATION_SCHEDULE[countryId]);
  const blocked = config.disallowPrivateCorporationFounding === true;
  // Either signal is sufficient: some planned countries (e.g. CN) rely on the
  // marketization schedule alone, while Cold-War command states also set the
  // private-corp founding block.
  const present = scheduled || blocked;
  return {
    present,
    evidence: present
      ? `Planned controls present (schedule=${scheduled}, disallowFounding=${blocked}).`
      : `plannedEconomyControls incomplete (schedule=${scheduled}, disallowFounding=${blocked}).`,
  };
}

function probeAdminDiagnostics(countryId: CountryId): CapabilityEvidence {
  const present = Boolean(COUNTRY_READINESS_EXPECTATIONS[countryId]);
  return {
    present,
    evidence: present
      ? `COUNTRY_READINESS_EXPECTATIONS entry present.`
      : `No COUNTRY_READINESS_EXPECTATIONS entry.`,
  };
}

function defaultFlavorEvidence(capabilityId: CapabilityId): CapabilityEvidence {
  // Flavor defaults to absent so gaps stay visible without blocking.
  return {
    present: false,
    evidence: `No authored ${CAPABILITY_LABELS[capabilityId].toLowerCase()} declared for this preset.`,
  };
}

/**
 * Collect capability evidence from static registries and the authored
 * inventory. Deterministic — no DB I/O.
 */
export function collectCapabilityEvidence(
  countryId: CountryId,
  presetId: string
): CapabilityEvidenceMap {
  if (!COUNTRY_CONFIGS[countryId]) throw new Error(`Invalid country ID: ${countryId}`);
  // Validate the entity exists for this preset (loud refusal, no silent fallback).
  getWorldEntityOrThrow(presetId, countryId);

  const archetypes = resolveReadinessArchetypesForCountry(countryId, presetId);
  const planned = archetypes.includes("planned-economy");

  const probes: CapabilityEvidenceMap = {
    fullAutonomousTier: probeFullAutonomousTier(countryId, presetId),
    institutionsConfigured: probeInstitutions(countryId),
    regionsAuthored: probeRegions(countryId),
    partiesAuthored: probeParties(countryId, presetId),
    economyModel: probeEconomyModel(countryId, planned),
    budgetsAuthored: probeBudgets(countryId, presetId),
    electionCycle: probeElectionCycle(countryId),
    cabinet: probeCabinet(countryId),
    billLifecycle: probeBillLifecycle(countryId),
    onePartyMood: probeOnePartyMood(countryId),
    plannedEconomyControls: probePlannedControls(countryId),
    adminDiagnostics: probeAdminDiagnostics(countryId),
    bespokeEvents: defaultFlavorEvidence("bespokeEvents"),
    artAssets: defaultFlavorEvidence("artAssets"),
    wikiMaterial: defaultFlavorEvidence("wikiMaterial"),
  };

  for (const capabilityId of CAPABILITY_IDS) {
    const override = CAPABILITY_INVENTORY[inventoryKey(presetId, countryId, capabilityId)];
    if (override) probes[capabilityId] = override;
  }

  return probes;
}

/** Assess readiness for a country+preset using static evidence. */
export function assessCountryReadiness(
  countryId: CountryId,
  presetId: string
): CountryReadinessReport {
  const archetypes = resolveReadinessArchetypesForCountry(countryId, presetId);
  const evidence = collectCapabilityEvidence(countryId, presetId);
  return evaluateCountryReadiness({ countryId, presetId, archetypes, evidence });
}

/**
 * Gate for player-opening paths. Returns the report when opening is allowed;
 * throws {@link PlayerOpenBlockedError} when any applicable hard blocker remains.
 */
export function assertCanOpenCountryToPlayers(
  countryId: CountryId,
  presetId: string
): CountryReadinessReport {
  const report = assessCountryReadiness(countryId, presetId);
  if (report.player !== "ready" || report.hardBlockers.length > 0) {
    throw new PlayerOpenBlockedError(report);
  }
  return report;
}

export function canOpenCountryToPlayers(
  countryId: CountryId,
  presetId: string
): { ok: true; report: CountryReadinessReport } | { ok: false; report: CountryReadinessReport } {
  const report = assessCountryReadiness(countryId, presetId);
  if (report.player === "ready" && report.hardBlockers.length === 0) {
    return { ok: true, report };
  }
  return { ok: false, report };
}

/** Resolve the active world preset from a gameState-like document. */
export function resolvePresetIdFromGameState(
  gameState: { preset?: string | null } | null | undefined,
  fallback = "2019-default"
): string {
  const preset = gameState?.preset?.trim();
  return preset && preset.length > 0 ? preset : fallback;
}

/** Helper used by callers that already know government shape. */
export function isParliamentaryArchetypeCountry(countryId: CountryId): boolean {
  return isParliamentarySystem(COUNTRY_CONFIGS[countryId]);
}
