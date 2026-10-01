/**
 * Deterministic simulation-only actor/controller seeding contract (issue #1993).
 *
 * Pure rules module: no database, no wall clock, no randomness, no env, no
 * network. The deterministic plan built here is what the sim shell
 * materializes into sandbox `users`/`characters` docs (marked simulation-only
 * via `isSynthetic`/`syntheticRunId`); until that materialization step runs,
 * worlds contain zero synthetic characters and the coverage manifest honestly
 * reports actor-gated paths unreachable (see SYNTHETIC_UNSEEDED_REASON).
 *
 * Pure NPP autonomy remains the default: an omitted `--actors` flag parses to
 * `pure-npp`, which is byte-identical to every harness run before this mode
 * existed. This module never touches a live database — it only computes the
 * plan; insertion belongs to the sandbox-only shell in scripts/sim/runWorld.ts.
 */

import {
  SYNTHETIC_ACTOR_ROLES,
  syntheticObjectIdHex,
  type ActorPopulationSnapshot,
  type SimActorMode,
  type SyntheticActorRole,
} from "./actorCoverage";

/** Plan version stamped wherever the plan is recorded; bump on role changes. */
export const SYNTHETIC_ACTOR_PLAN_VERSION = 1;

/** Accepted `--actors` values. */
export const SIM_ACTOR_MODES: readonly SimActorMode[] = ["pure-npp", "synthetic"];

/** Username prefix the sandbox seeder uses for simulation-only users, so the
 * population snapshot can count them back without a schema change. */
export const SIM_ACTOR_USERNAME_PREFIX = "sim.actor.";

/**
 * Parse the explicit run-mode selection. Omitted means pure NPP autonomy —
 * the behavior-compatible default. Throws on anything else so a typo can
 * never silently run the wrong mode.
 */
export function parseSimActorMode(raw: string | undefined): SimActorMode {
  if (raw === undefined) return "pure-npp";
  if (raw === "pure-npp" || raw === "synthetic") return raw;
  throw new Error(`--actors must be one of ${SIM_ACTOR_MODES.join(", ")} (got "${raw}")`);
}

/** One deterministic simulation-only actor: identity plus its coverage job. */
export interface SyntheticActorDescriptor {
  role: SyntheticActorRole;
  /** Deterministic 24-hex character id for this seed + role. */
  characterIdHex: string;
  /** Deterministic 24-hex user id for this seed + role. */
  userIdHex: string;
  /** Sandbox-only username (`sim.actor.<seed>.<role>`). */
  username: string;
  displayName: string;
  countryId: string;
  /** Which actor-gated mechanic(s) this actor exists to exercise. */
  purpose: string;
}

export interface SyntheticActorPlan {
  planVersion: number;
  seed: string;
  actors: SyntheticActorDescriptor[];
}

const ROLE_COUNTRY: Record<SyntheticActorRole, string> = {
  "us-president": "US",
  "us-fed-nominee": "US",
  "us-state-party-member": "US",
  "us-founder-private": "US",
  "us-founder-ipo": "US",
  "crisis-decider": "US",
  "dd-finance-minister": "DD",
};

const ROLE_PURPOSE: Record<SyntheticActorRole, string> = {
  "us-president": "presidential-nomination, central-bank-chair-us, player-country-offices",
  "us-fed-nominee": "central-bank-chair-us",
  "us-state-party-member": "state-party-leadership, campaigns-player-actions",
  "us-founder-private": "corp-founding-private, character-wealth, household-wealth",
  "us-founder-ipo": "corp-founding-ipo, character-wealth, household-wealth",
  "crisis-decider": "crisis-decisions",
  "dd-finance-minister": "dd-finance-minister-survey, player-country-offices",
};

/** Build the deterministic actor plan for a seed. Same seed always yields the
 * same identities, so re-seeding is idempotent and runs are reproducible. */
export function buildSyntheticActorPlan(seed: string): SyntheticActorPlan {
  const actors = SYNTHETIC_ACTOR_ROLES.map((role) => ({
    role,
    characterIdHex: syntheticObjectIdHex(seed, `character:${role}`),
    userIdHex: syntheticObjectIdHex(seed, `user:${role}`),
    username: `${SIM_ACTOR_USERNAME_PREFIX}${seed}.${role}`,
    displayName: `Sim ${role} (${seed})`,
    countryId: ROLE_COUNTRY[role],
    purpose: ROLE_PURPOSE[role],
  }));
  return { planVersion: SYNTHETIC_ACTOR_PLAN_VERSION, seed, actors };
}

/** Number of planned synthetic characters/users for a plan. */
export function syntheticActorCounts(plan: SyntheticActorPlan): {
  characters: number;
  users: number;
} {
  return { characters: plan.actors.length, users: plan.actors.length };
}

export interface ActorPopulationCounts {
  mode: SimActorMode;
  preset: string;
  characters: number;
  users: number;
  syntheticCharacters: number;
  syntheticUsers: number;
  statePartyCandidates?: number;
  crisisDecidedInteractions?: number;
  wealthListRows?: number;
  playerFoundedCorps?: number;
  /** Retained full opposition-research command sequence (flow driver). */
  oppoFlowSucceeded?: boolean;
}

/**
 * Build the manifest snapshot from live sandbox counts supplied by the
 * caller (this module has no database). Turn-derived evidence counters
 * default to zero — the shell passes real counts when it has them.
 */
export function snapshotActorPopulation(counts: ActorPopulationCounts): ActorPopulationSnapshot {
  return {
    mode: counts.mode,
    characters: counts.characters,
    users: counts.users,
    syntheticCharacters: counts.syntheticCharacters,
    syntheticUsers: counts.syntheticUsers,
    statePartyCandidates: counts.statePartyCandidates ?? 0,
    crisisDecidedInteractions: counts.crisisDecidedInteractions ?? 0,
    wealthListRows: counts.wealthListRows ?? 0,
    playerFoundedCorps: counts.playerFoundedCorps ?? 0,
    preset: counts.preset,
    oppoFlowSucceeded: counts.oppoFlowSucceeded ?? false,
  };
}
