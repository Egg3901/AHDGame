import type { Db } from "mongodb";
import type { Corporation, User } from "@/lib/db/types";
import {
  INACTIVE_CEO_TURN_THRESHOLD,
  isInactiveCeoPenaltyCandidate,
} from "@/lib/turn/corporation/inactiveCeoSectorShed";
import { ceoSelfAcquisitionWindow } from "@/lib/corporations/ceoShareAcquisitionCap";
import {
  CEO_SELF_ACQUISITION_CAP_FRACTION,
  CEO_SELF_ACQUISITION_WINDOW_TURNS,
} from "@/lib/constants/corporations";

export interface CeoShareWindow {
  capShares: number;
  acquiredShares: number;
  reservedShares: number;
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
 * `ceoIsInactive` uses the turn's own `isInactiveCeoPenaltyCandidate`, so the
 * banner shows only for corps the inactive-CEO shed can actually act on. NPP
 * caretaker corps keep the owner's `userId` but are AI-run and never flagged.
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
    corporation.isPrivate !== true &&
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
      reservedShares: w.reservedShares,
      remainingShares: w.remainingShares,
      freesUpInTurns: w.freesUpInTurns,
      capPercent: Math.round(CEO_SELF_ACQUISITION_CAP_FRACTION * 100),
      windowTurns: CEO_SELF_ACQUISITION_WINDOW_TURNS,
    };
  }

  // Derive ceoIsInactive from the CEO-owning user's lastActivity (or createdAt fallback).
  const INACTIVE_CEO_THRESHOLD_MS = INACTIVE_CEO_TURN_THRESHOLD * 60 * 60 * 1000;
  let ceoIsInactive = false;
  if (!isImperialCeo && corporation.userId != null && isInactiveCeoPenaltyCandidate(corporation)) {
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
