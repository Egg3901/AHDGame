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
import { getReadinessExpectations } from "@/lib/constants/readinessExpectations";
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
import { partyRosterLabel, partySeedsForPreset } from "@/lib/seeds/partySeedRegistry";

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

/**
 * An authored override for a capability a probe cannot prove.
 *
 * Absence must justify itself. A bare `present: false` with a free-text string
 * cannot distinguish "this will never apply here" from "nobody has written it
 * yet" — the same conflation the era roster exists to remove, one level down.
 *
 * `not-applicable` is permanent and needs only a reason. `deferred` is work
 * nobody has done, and carries an issue once one is filed. `issue: null` is
 * deliberate rather than lazy: issues are filed by hand on a public repository,
 * and a waiver that could not be recorded until a number existed would be
 * recorded nowhere at all. Every deferred waiver is reported as debt whether or
 * not it has a number; what must never happen is a deferred gap dressed up as
 * `not-applicable`.
 */
export type CapabilityOverride =
  | { present: true; evidence: string }
  | { present: false; kind: "not-applicable"; reason: string }
  | { present: false; kind: "deferred"; reason: string; issue: string | null };

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
  /** True when this country has a marketization trajectory (i.e. is modelled as planned). */
  hasMarketizationSchedule?: boolean;
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

  const planned = input.economicArchetype === "planned" || input.hasMarketizationSchedule === true;
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
    hasMarketizationSchedule: Boolean(MARKETIZATION_SCHEDULE[countryId]),
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
 * Party seeds come from `@/lib/seeds/partySeedRegistry`, which covers every
 * registered country. The partial copy that used to live here covered 14 of
 * them, which is why the probes needed a country-keyed fallback.
 */
export const CAPABILITY_INVENTORY: Readonly<Record<string, CapabilityOverride | undefined>> =
  Object.freeze({
    // Japan 1953 is the reference autonomous-ok / player-blocked case: Diet and
    // economy wiring exist for NPP autonomy, but player-parity validation and
    // flavor content are incomplete.
    "1953-default:JP:adminDiagnostics": {
      present: false,
      kind: "deferred",
      reason:
        "Japan 1953 lacks established-player-country parity validation for its Diet and cabinet surface.",
      issue: null,
    },
    "1953-default:JP:bespokeEvents": {
      present: false,
      kind: "deferred",
      reason: "No Japan-1953 bespoke event pack authored yet.",
      issue: null,
    },
    "1953-default:JP:artAssets": {
      present: false,
      kind: "deferred",
      reason: "Japan 1953 uses shared modern art placeholders rather than era art.",
      issue: null,
    },
    "1953-default:JP:wikiMaterial": {
      present: false,
      kind: "deferred",
      reason: "Japan 1953 wiki material is incomplete; the Diet loop is undocumented.",
      issue: null,
    },
    // Established player countries in Cold-War presets: flavor still tracked.
    "1953-default:UK:bespokeEvents": {
      present: false,
      kind: "deferred",
      reason: "UK 1953 bespoke event coverage is partial; the Suez arc is unwritten.",
      issue: null,
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

function probeRegions(countryId: CountryId, presetId: string): CapabilityEvidence {
  const expect = getReadinessExpectations(countryId, presetId);
  if (expect && expect.regionCount > 0) {
    return {
      present: true,
      evidence: `Readiness expectations require ${expect.regionCount} regions in ${presetId}.`,
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
      ? `Country config present; no region-count expectation registered for ${presetId}.`
      : `No country config.`,
  };
}

/**
 * Parties authored for THIS preset.
 *
 * The previous implementation short-circuited on
 * `COUNTRY_READINESS_EXPECTATIONS[countryId]` and never read `presetId` on that
 * branch, so the 19 countries holding an entry passed on any preset by
 * asserting a roster from another era: `probeParties("RU", "2019-default")`
 * returned present with evidence "Expected parties: CPSU", while
 * `partySeedsForPreset` returned nothing because `ruParties` is gated to 1953
 * and 1979. It reads the seed modules directly now. The registry covers every
 * registered country, so there is nothing left for the short-circuit to cover.
 */
function probeParties(countryId: CountryId, presetId: string): CapabilityEvidence {
  const seeded = partySeedsForPreset(countryId, presetId);
  if (seeded.length > 0) {
    return {
      present: true,
      evidence: `Authored party seeds for ${presetId}: ${partyRosterLabel(seeded)} (${seeded.length}).`,
    };
  }
  return {
    present: false,
    evidence: `No party seed valid for ${presetId} in the party seed registry.`,
  };
}

function probeEconomyModel(countryId: CountryId, planned: boolean): CapabilityEvidence {
  if (planned) {
    // The marketization schedule is now the ONLY planned-economy signal: the
    // former `disallowPrivateCorporationFounding` config flag was redundant with
    // it and has been retired.
    const present = Boolean(MARKETIZATION_SCHEDULE[countryId]);
    return {
      present,
      evidence: present
        ? `Planned economy: marketizationSchedule=true.`
        : `Planned economy missing a marketization schedule.`,
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
  // One signal: every planned country carries a marketization schedule. CN always
  // relied on it alone; the Cold-War command states duplicated it in a config
  // flag that has been retired.
  const present = Boolean(MARKETIZATION_SCHEDULE[countryId]);
  return {
    present,
    evidence: present
      ? `Planned controls present (marketizationSchedule=true).`
      : `plannedEconomyControls incomplete: no marketization schedule.`,
  };
}

/**
 * Whether an admin readiness diagnostic exists for this country.
 *
 * Still effectively country-keyed, and deliberately so: `getReadinessExpectations`
 * returns null only when nothing is authored for the country at all, which is
 * the right question for a capability that asks "is there a diagnostic", not "do
 * its numbers pass". What the preset buys here is that the derived expectations
 * the admin panel then reads are the era's, and that the evidence string says
 * which era answered.
 */
function probeAdminDiagnostics(countryId: CountryId, presetId: string): CapabilityEvidence {
  const present = getReadinessExpectations(countryId, presetId) !== null;
  return {
    present,
    evidence: present
      ? `Readiness expectations resolve for ${presetId}.`
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
 * Render an absence waiver for the readiness report, so the reason a capability
 * is waived travels with it instead of being swallowed.
 */
function describeWaiver(override: Extract<CapabilityOverride, { present: false }>): string {
  if (override.kind === "not-applicable") return override.reason;
  return override.issue
    ? `${override.reason} (deferred, ${override.issue})`
    : `${override.reason} (deferred, no issue filed)`;
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
    regionsAuthored: probeRegions(countryId, presetId),
    partiesAuthored: probeParties(countryId, presetId),
    economyModel: probeEconomyModel(countryId, planned),
    budgetsAuthored: probeBudgets(countryId, presetId),
    electionCycle: probeElectionCycle(countryId),
    cabinet: probeCabinet(countryId),
    billLifecycle: probeBillLifecycle(countryId),
    onePartyMood: probeOnePartyMood(countryId),
    plannedEconomyControls: probePlannedControls(countryId),
    adminDiagnostics: probeAdminDiagnostics(countryId, presetId),
    bespokeEvents: defaultFlavorEvidence("bespokeEvents"),
    artAssets: defaultFlavorEvidence("artAssets"),
    wikiMaterial: defaultFlavorEvidence("wikiMaterial"),
  };

  // Overrides must be MAPPED, not spread. The absence branches name the field
  // `reason`, while `CapabilityEvidence` (and `FailedCapability.evidence`
  // downstream) reads `evidence`; assigning straight through type-checks at the
  // inventory and then surfaces as undefined evidence in every report.
  for (const capabilityId of CAPABILITY_IDS) {
    const override = CAPABILITY_INVENTORY[inventoryKey(presetId, countryId, capabilityId)];
    if (!override) continue;
    probes[capabilityId] = override.present
      ? { present: true, evidence: override.evidence }
      : { present: false, evidence: describeWaiver(override) };
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
