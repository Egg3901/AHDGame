import type { Db } from "mongodb";
import type { ConflictDoc, ConflictSide } from "@/lib/db/types/conflict";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import { createConflict } from "@/lib/military/createConflict";
import {
  VIETNAM_MAX_LEVEL,
  VIETNAM_WAR_LEVEL,
  type VietnamEscalationState,
} from "./vietnamEscalation";

/**
 * The bridge between the Vietnam escalation ladder and the combat system.
 *
 * The ladder decides how deep the two superpowers are in. This module decides
 * whether that adds up to a shooting war, and if it does it creates and drives a
 * real `conflicts` document so the front, the battle math, the map pin and the
 * conflict record page are all the actual war rather than a description of one.
 *
 * The war is modelled as a `cold_war` proxy conflict between two faction sides,
 * which is exactly what that conflict type is for: "a proxy war fought on
 * third-party soil; the sides are internal factions." The superpowers stay off
 * the belligerent rosters on purpose. Putting `US` and `RU` into
 * `sideA.countries` / `sideB.countries` would formally place both at war with
 * each other, which drags in truces, separate peaces and unit stand-downs, and
 * would mean a crisis decision silently declared a world war. Their involvement
 * is already modelled where it belongs: on the ladder, as committed support.
 */

/** Fixed conflict `_id`, so the front is a singleton and re-entrant to look up. */
export const VIETNAM_FRONT_ID = "vietnam";

/**
 * The rung at which the front opens: the air campaign.
 *
 * Not the ground commitment. The air campaign IS combat, flown continuously and
 * costed in aircrew, and it is already the rung the rest of the system treats as
 * the war becoming a war (`VIETNAM_WAR_LEVEL` gates war weariness). Waiting for
 * ground troops would mean a sustained bombing campaign produced no front, no
 * battles and no casualties anywhere in the game.
 */
export const VIETNAM_FRONT_OPENS_AT = VIETNAM_WAR_LEVEL;

export const VIETNAM_FRONT_NAME = "Vietnam War";

/** South Vietnam is the map anchor: the war is fought on and over its soil. */
export const VIETNAM_FRONT_HOST = "SVN";
export const VIETNAM_FRONT_HOST_ENTITIES = ["NVN", "SVN"];

/**
 * What the front should be doing at a given rung.
 *
 * - At or above the opening rung the war is being fought.
 * - Below it, but with the ladder still up, the shooting is winding down: the
 *   superpowers have stepped back but the war they started is still there.
 * - At level 0 the ladder has been talked all the way down and the war ends.
 */
export type VietnamFrontState = "active" | "winding_down" | "resolved";

export function vietnamFrontStateForLevel(level: number): VietnamFrontState {
  if (level >= VIETNAM_FRONT_OPENS_AT) return "active";
  if (level <= 0) return "resolved";
  return "winding_down";
}

/**
 * Front intensity, 0-100, from the rung. A live field the conflicts hub sizes
 * its map pins from, so this is a real readout and not a stored constant.
 */
export function vietnamFrontIntensity(level: number): number {
  if (level <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((level / VIETNAM_MAX_LEVEL) * 100)));
}

/** Severity band the hub renders from. Tracks intensity, same as a seeded war. */
export function vietnamFrontSeverity(level: number): ConflictDoc["severity"] {
  const intensity = vietnamFrontIntensity(level);
  return intensity >= 70 ? "HIGH" : intensity >= 45 ? "MEDIUM" : "LOW";
}

function southSide(): ConflictSide {
  return {
    label: "Republic of Vietnam",
    // Empty roster is the generated-faction contract. It stays empty for the
    // life of the conflict even as patrons pour materiel in, which is what keeps
    // the superpowers out of peace offers and truces.
    countries: [],
    kind: "generated",
    backer: "west",
    factionEntity: "SVN",
    tokenStrength: 120,
  };
}

function northSide(): ConflictSide {
  return {
    label: "Democratic Republic of Vietnam",
    countries: [],
    kind: "generated",
    backer: "east",
    factionEntity: "NVN",
    tokenStrength: 120,
  };
}

export async function getVietnamFront(db: Db): Promise<ConflictDoc | null> {
  return getConflictsCollection(db).findOne({ _id: VIETNAM_FRONT_ID });
}

export type VietnamFrontAction = "opened" | "reopened" | "wound_down" | "ended" | null;

/**
 * Bring the front into line with the ladder. Idempotent: called every turn, does
 * nothing when the front already matches the rung.
 *
 * A resolved front is never reopened. Once the ladder has been talked down to
 * nothing the war is over, and a later crisis that climbs the ladder again would
 * be a new war needing its own document rather than a resurrection of this one.
 */
export async function syncVietnamFront(
  db: Db,
  state: VietnamEscalationState,
  currentTurn: number
): Promise<VietnamFrontAction> {
  const desired = vietnamFrontStateForLevel(state.level);
  const existing = await getVietnamFront(db);

  if (!existing) {
    // The front opens only by crossing the threshold. A ladder that has never
    // reached the air campaign has no war to wind down or end.
    if (desired !== "active") return null;
    await createConflict(db, {
      id: VIETNAM_FRONT_ID,
      name: VIETNAM_FRONT_NAME,
      hostCountry: VIETNAM_FRONT_HOST,
      hostEntities: VIETNAM_FRONT_HOST_ENTITIES,
      type: "cold_war",
      sideA: southSide(),
      sideB: northSide(),
      startTurn: currentTurn,
      createdBy: "event",
    });
    await getConflictsCollection(db).updateOne(
      { _id: VIETNAM_FRONT_ID },
      {
        $set: {
          intensity: vietnamFrontIntensity(state.level),
          severity: vietnamFrontSeverity(state.level),
        },
      }
    );
    return "opened";
  }

  if (existing.status === "resolved") return null;

  const intensity = vietnamFrontIntensity(state.level);
  const severity = vietnamFrontSeverity(state.level);

  if (desired === "resolved") {
    await getConflictsCollection(db).updateOne(
      { _id: VIETNAM_FRONT_ID },
      {
        $set: {
          status: "resolved" as const,
          endTurn: currentTurn,
          intensity,
          severity,
          // No winner. Both patrons walked away and the front stopped where it
          // stood, which is a stalemate and not a victory for either faction.
          outcome: {
            winner: "stalemate" as const,
            note: "Both superpowers withdrew their support and the fighting stopped.",
          },
        },
      }
    );
    return "ended";
  }

  const nextStatus = desired === "active" ? ("active" as const) : ("winding_down" as const);
  if (existing.status === nextStatus && existing.intensity === intensity) return null;

  await getConflictsCollection(db).updateOne(
    { _id: VIETNAM_FRONT_ID },
    { $set: { status: nextStatus, intensity, severity } }
  );

  if (existing.status === nextStatus) return null;
  return nextStatus === "active" ? "reopened" : "wound_down";
}
