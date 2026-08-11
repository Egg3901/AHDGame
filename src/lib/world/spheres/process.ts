import type { Db } from "mongodb";
import { getMacroCountriesCollection } from "@/lib/db/collections/macroCountries";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";
import { recordSphereSponsorDecisions } from "./ledger";
import { ensureSphereMembership, saveSphereMembership } from "./membershipStore";
import { processSphereSponsorTick, type ProcessSphereSponsorTickResult } from "./sponsor";
import type { SphereSponsorController } from "./types";

export interface SphereSponsorTurnResult extends ProcessSphereSponsorTickResult {
  entitiesConsidered: number;
}

/**
 * Run cadence-gated NPP sphere sponsorship for all seeded macro (member) entities.
 * Player-controlled sponsors are skipped — they share {@link applySponsorIntent}.
 */
export async function processSphereSponsorTurn(
  db: Db,
  turn: number,
  controllerBySponsor: ReadonlyMap<WorldEntityId, SphereSponsorController> = new Map()
): Promise<SphereSponsorTurnResult> {
  const macros = await (
    await getMacroCountriesCollection(db)
  )
    .find({}, { projection: { entityId: 1, presetId: 1 } })
    .toArray();

  const memberships = [];
  for (const macro of macros) {
    if (!macro.entityId || !macro.presetId) continue;
    memberships.push(await ensureSphereMembership(db, macro.presetId, macro.entityId));
  }

  if (memberships.length === 0) {
    return {
      entitiesConsidered: 0,
      memberships: [],
      decisions: [],
      skippedSponsors: [],
    };
  }

  const result = processSphereSponsorTick({
    turn,
    memberships,
    controllerBySponsor,
  });

  for (const membership of result.memberships) {
    const acted = result.decisions.some((d) => d.memberId === membership.entityId);
    if (acted) {
      await saveSphereMembership(db, membership, turn);
    }
  }

  await recordSphereSponsorDecisions(
    db,
    result.decisions,
    "world/spheres/process.ts:processSphereSponsorTurn"
  );

  return {
    entitiesConsidered: memberships.length,
    ...result,
  };
}
