import type { CountryId } from "@/lib/constants/countries";
import type { RegionCode } from "@/lib/military/types";
import type { WarGoal } from "@/lib/military/warGoals";

/**
 * A conflict — a dynamic, first-class battleground that generalizes the retired
 * static theaters. Created at runtime (player declaration or event); the world starts
 * with none. The whole W1–W10 military system runs on conflicts exactly as it ran on
 * the 4 hardcoded theaters: units deploy to one (`unit.theaterId` = a conflict id),
 * generals command it, battles resolve at it, supply/commitment track per it.
 *
 * Spec: docs/superpowers/specs/2026-07-23-conflict-model-sub-a-design.md
 */

export type ConflictType = "interstate" | "intervention" | "civil_war" | "independence";
export type ConflictStatus = "active" | "escalating" | "winding_down" | "resolved";
export type SideKind = "state" | "coalition" | "generated";
export type ConflictBloc = "west" | "east" | "internal" | "contested";

export interface ConflictSide {
  /** Display label, e.g. "Insurgent Bloc" / "Government" / "United States". */
  label: string;
  /** Real belligerents whose units fight on this side; `[]` = a generated force. */
  countries: CountryId[];
  kind: SideKind;
  /** Cold War patron, if any. */
  backer?: "west" | "east";
}

export interface ConflictDoc {
  /** Dynamic conflict id (a unit's `theaterId` holds this, or "reserve"). */
  _id: string;
  /**
   * Sequential public number, 1-based per iteration — the conflict's address at
   * /world/conflicts/<conflictId>. Distinct from `_id`, which is the internal
   * theater key that units, declarations, reports and assignments all reference
   * and therefore cannot be renumbered.
   */
  conflictId: number;
  name: string;
  /** Where it's fought — the map anchor. May not be a belligerent. */
  hostCountry: CountryId;
  /** Derived from the host country (map / regionThreat). */
  region: RegionCode;
  type: ConflictType;
  sideA: ConflictSide;
  sideB: ConflictSide;
  /** Cold War alignment of the conflict as a whole. */
  bloc: ConflictBloc;

  // Generated at birth (was hardcoded across BOTH old static datasets — the Theater
  // situation flavor AND the combat.ts Front battle-math data):
  terrain: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  /** The generated side's weight (= old Theater.enemyBase). */
  baseStrength: number;
  /** Per-side supply, 0–100 (was Theater wSup/eSup). */
  supplyA: number;
  supplyB: number;
  /** Terrain combat factor — the defender/enemy strength multiplier (was Front.terr). */
  terr: number;
  /** Supply throughput baseline, 0–100 (was Front.infra). */
  infra: number;
  /** Enemy-unit composition for buildEnemy when a side is generated (was ENEMY_MIX). */
  enemyMix: string[];

  // Live state (seeded here; evolved by sub-project C):
  intensity: number;
  /**
   * Share of the HOST country's territory held by side B: 0 = side A holds all of
   * it, 100 = side B holds all of it. Moved by battles; reaching a pole ends the war.
   * See src/lib/military/occupation.ts.
   */
  control: number;
  /** `control` at creation — the front's starting line. Supply is derived from the
   *  displacement from here, so it must not be recomputed from the (growing) rosters. */
  controlStart?: number;
  /** Seeded supply values, preserved so live supply can be derived, not accumulated. */
  supplyBaseA?: number;
  supplyBaseB?: number;
  status: ConflictStatus;
  /** What this war was declared for. Absent on conflicts predating declarations. */
  warGoal?: WarGoal;
  /** The bill that declared it, for the record page. */
  declaredByBillId?: string;
  createdBy: "player" | "event" | "seed";
  startTurn: number;
  endTurn?: number;
  outcome?: { winner: "A" | "B" | "stalemate"; note: string };
}
