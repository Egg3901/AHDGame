import type { CountryEraTier } from "./eraRoster";

/**
 * The completeness contract a country must satisfy in the active world.
 *
 * This is deliberately separate from route access. Registered background
 * countries may still be browsable read-only, but they do not need the same
 * authored feature set as an economy-preview or player-enabled country.
 */
export const COUNTRY_REQUIREMENT_LEVELS = [
  "background",
  "economy-preview",
  "player-enabled",
] as const;

export type CountryRequirementLevel = (typeof COUNTRY_REQUIREMENT_LEVELS)[number];

/**
 * Background countries have different runtime obligations even though they
 * share one user-facing completeness level.
 */
export type CountryBackgroundMode = "npp" | "latent" | "absent";

export type CountryContentStatus = "complete" | "gaps";

export type CountryRequirementReadinessTarget = "autonomous" | "player" | null;

export interface CountryRequirementProfile {
  readonly level: CountryRequirementLevel;
  readonly label: "Background" | "Economy Preview" | "Player Enabled";
  readonly description: string;
  /** The readiness result that must pass, or null when only structural checks apply. */
  readonly readinessTarget: CountryRequirementReadinessTarget;
  readonly requires: {
    /** Every converted country must satisfy CountryFolder. */
    readonly folderContract: true;
    /** Every converted country must explicitly cover every shipping preset. */
    readonly completeEraCoverage: true;
    /** Economy and political systems can run safely without a player. */
    readonly autonomousReadiness: boolean;
    /** The full player-facing mechanical contract is complete. */
    readonly playerReadiness: boolean;
  };
}

export const COUNTRY_REQUIREMENT_PROFILES: Readonly<
  Record<CountryRequirementLevel, CountryRequirementProfile>
> = Object.freeze({
  background: Object.freeze({
    level: "background",
    label: "Background",
    description:
      "Not exposed as an economy preview or player country. The country folder and era declarations must be complete, while the NPP, latent, or absent mode records its runtime obligations.",
    readinessTarget: null,
    requires: Object.freeze({
      folderContract: true,
      completeEraCoverage: true,
      autonomousReadiness: false,
      playerReadiness: false,
    }),
  }),
  "economy-preview": Object.freeze({
    level: "economy-preview",
    label: "Economy Preview",
    description:
      "Runs as an autonomous economy without player control. Autonomous readiness must pass; player-only mechanics and flavor may remain incomplete.",
    readinessTarget: "autonomous",
    requires: Object.freeze({
      folderContract: true,
      completeEraCoverage: true,
      autonomousReadiness: true,
      playerReadiness: false,
    }),
  }),
  "player-enabled": Object.freeze({
    level: "player-enabled",
    label: "Player Enabled",
    description:
      "Open to players. Both autonomous safety and the complete player mechanical contract must pass; flavor gaps remain diagnostic only.",
    readinessTarget: "player",
    requires: Object.freeze({
      folderContract: true,
      completeEraCoverage: true,
      autonomousReadiness: true,
      playerReadiness: true,
    }),
  }),
});

export function countryRequirementLevelForAccess(access: {
  readonly enabledForPlayers: boolean;
  readonly economyPreview: boolean;
}): CountryRequirementLevel {
  if (access.enabledForPlayers) return "player-enabled";
  if (access.economyPreview) return "economy-preview";
  return "background";
}

export function countryRequirementLevelForEraTier(tier: CountryEraTier): CountryRequirementLevel {
  if (tier === "player") return "player-enabled";
  if (tier === "econ") return "economy-preview";
  return "background";
}

export function countryBackgroundModeForEraTier(
  tier: CountryEraTier
): CountryBackgroundMode | null {
  if (tier === "npp" || tier === "latent" || tier === "absent") return tier;
  return null;
}

export function countryRequirementProfile(
  level: CountryRequirementLevel
): CountryRequirementProfile {
  return COUNTRY_REQUIREMENT_PROFILES[level];
}
