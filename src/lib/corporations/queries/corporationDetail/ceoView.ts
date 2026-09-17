import type { Db } from "mongodb";
import type { Corporation, User } from "@/lib/db/types";
import { INACTIVE_CEO_TURN_THRESHOLD } from "@/lib/turn/corporation/inactiveCeoSectorShed";
import { ceoSelfAcquisitionWindow } from "@/lib/corporations/ceoShareAcquisitionCap";
import {
  CEO_SELF_ACQUISITION_CAP_FRACTION,
  CEO_SELF_ACQUISITION_WINDOW_TURNS,
} from "@/lib/constants/corporations";

export interface CeoShareWindow {
  capShares: number;
  acquiredShares: number;
  remainingShares: number;
  freesUpInTurns: number;
  capPercent: number;
  windowTurns: number;
}

export interface CeoViewFlags {
  ceoShareWindow: CeoShareWindow | null;
  ceoIsInactive: boolean;
}

/**
 * CEO-gated view flags for the corporation detail view (#587).
 *
 * The self-acquisition window is surfaced to the CEO's own user so the buy
 * modal can show used/remaining/countdown before a capped buy is attempted.
 * `ceoIsInactive` mirrors the turn's inactive-CEO shed exclusions except it
 * does not skip `ceoType === "npp"`: NPP-run corps can show as inactive here
 * even though the turn shed never acts on them.
 */
export async function loadCeoViewFlags(
  db: Db,
  corporation: Corporation,
  viewerUserId: string | null | undefined,
  isImperialCeo: boolean,
  currentTurn: number
): Promise<CeoViewFlags> {
  let ceoShareWindow: CeoShareWindow | null = null;
  if (
    viewerUserId &&
    corporation.userId?.toString() === viewerUserId &&
    corporation.ceoVacant !== true &&
    corporation.ceoId
  ) {
    const w = await ceoSelfAcquisitionWindow(
      db,
      corporation,
      corporation.ceoId,
      isImperialCeo ? "imperialCharacterId" : "characterId",
      currentTurn
    );
    ceoShareWindow = {
      capShares: w.capShares,
      acquiredShares: w.acquiredShares,
      remainingShares: w.remainingShares,
      freesUpInTurns: w.freesUpInTurns,
      capPercent: Math.round(CEO_SELF_ACQUISITION_CAP_FRACTION * 100),
      windowTurns: CEO_SELF_ACQUISITION_WINDOW_TURNS,
    };
  }

  // Derive ceoIsInactive from the CEO-owning user's lastActivity (or createdAt fallback).
  // Same exclusions as inactiveCeoSectorShed.isInactiveCeoPenaltyCandidate except this
  // query does not skip ceoType === "npp". NPP-run corps can show as inactive here
  // even though the turn shed never acts on them.
  const INACTIVE_CEO_THRESHOLD_MS = INACTIVE_CEO_TURN_THRESHOLD * 60 * 60 * 1000;
  let ceoIsInactive = false;
  if (
    !isImperialCeo &&
    corporation.ceoVacant !== true &&
    corporation.userId != null &&
    corporation.countryOwnerId == null &&
    corporation.isNationalized !== true
  ) {
    const ceoUser = await db
      .collection<User>("users")
      .findOne({ _id: corporation.userId }, { projection: { lastActivity: 1, createdAt: 1 } });
    const reference = ceoUser?.lastActivity ?? ceoUser?.createdAt;
    if (reference && reference.getTime() < Date.now() - INACTIVE_CEO_THRESHOLD_MS) {
      ceoIsInactive = true;
    }
  }

  return { ceoShareWindow, ceoIsInactive };
}
