// Domain types for the Military Commands suite. Model mirrors the design mockup
// (3 command types, 12 postures, 19 strategic regions), typed and data-driven.
// Backend-spec richness (travel time, operations engine) is intentionally omitted;
// see docs/superpowers/specs/2026-07-12-military-commands-foundation-design.md.

export type CommandType = "HOMELAND_DEFENSE" | "REGIONAL" | "LOGISTICS";

export type CommandPosture =
  | "Defensive"
  | "Deterrence"
  | "Expeditionary"
  | "Counterinsurgency"
  | "Invasion Prep"
  | "Occupation"
  | "Sea Control"
  | "Sea Denial"
  | "Air Defense"
  | "Strategic Strike"
  | "Rapid Response"
  | "Training / Reserve";

export type Readiness =
  "Peacetime" | "Alert" | "Deployed" | "Wartime" | "Exhausted" | "Rebuilding" | "Forming";

export type SupplyPriority = "Normal" | "High" | "Emergency";

export type RegionType = "land" | "naval" | "mixed";

/** A region's threat magnitude band (Low is calm, Severe is a hot war). */
export type ThreatLevel = "Low" | "Medium" | "Rising" | "High" | "Severe";

/** Uniform 3-letter strategic-region code (lowercase — distinct from country codes). */
export type RegionCode =
  | "arc"
  | "noa"
  | "nat"
  | "cac"
  | "sam"
  | "sat"
  | "weu"
  | "eeu"
  | "med"
  | "naf"
  | "ssa"
  | "mea"
  | "cas"
  | "sas"
  | "eas"
  | "sea"
  | "ior"
  | "wpa"
  | "spa";

export type CoverageStatus = "ASSIGNED" | "UNASSIGNED" | "OVERLAPPING" | "ACTIVE_CONFLICT";

export interface StrategicRegion {
  id: RegionCode;
  name: string;
  short: string;
  /** Theater grouping label (mockup `macro`). */
  macro: string;
  terrain: string;
  /** 0-100 infrastructure score. */
  infra: number;
  /** 0-10 port capacity. */
  port: number;
  /** 0-10 airbase capacity. */
  air: number;
  value: "Low" | "Medium" | "High" | "Very High";
  threat: ThreatLevel;
  instab: "Low" | "Medium" | "High";
  alliance: "Low" | "Partial" | "Contested" | "Core";
  resource: "Low" | "Medium" | "High" | "Growing" | "Critical";
  /** Logistics difficulty. */
  logi: "Low" | "Medium" | "High" | "Severe";
  type: RegionType;
}

/**
 * A real commissioned general offered as a command commander. `id` is the owning
 * character's id (commands' `commanderIds` reference these). Derived server-side
 * from the country's `characterGenerals`.
 */
export interface CommanderRef {
  id: string;
  name: string;
  spec: string;
  level: number;
  /** Command-fit rating 40..98, derived from the general's progression. */
  fit: number;
}

export interface MilitaryCommand {
  id: string;
  name: string;
  type: CommandType;
  commanderIds: string[];
  /**
   * The general in charge of this Command (characterId). Must be a member of
   * `commanderIds`; null when the Command has no lead. Formalises what the roster
   * previously only implied by rendering `commanderIds[0]` as the primary.
   */
  commandingGeneralId: string | null;
  regionIds: string[];
  spec: string;
  posture: CommandPosture;
  supply: SupplyPriority;
  readiness: Readiness;
  /** Force capacity. */
  cap: number;
  /** Base effectiveness before penalties. */
  base: number;
  political: "Low" | "Medium" | "High" | "Critical";
  branchFocus: string;
  /** Assigned live units (references militaryUnits._id). */
  unitIds: string[];
  role: string;
}

export interface MilitaryOperation {
  id: string;
  name: string;
  /** Command id. */
  cmd: string;
  /** Region id. */
  region: string;
  type: string;
  risk: "Low" | "Medium" | "High";
  /** 0-100. */
  progress: number;
}

export interface MilitaryState {
  commands: MilitaryCommand[];
  selectedId: string | null;
  selectedRegionId: string | null;
  filter: string;
  assignMode: boolean;
}

export interface CalcBreakdown {
  finalValue: number;
  positives: string[];
  negatives: string[];
}
