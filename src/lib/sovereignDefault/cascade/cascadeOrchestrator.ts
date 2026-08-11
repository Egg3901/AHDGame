/**
 * Sovereign-default cascade orchestrator — runs at crisis-fire time.
 *
 * Per-level pipeline:
 *   1. apply write-downs to the level's bond batch
 *   2. reload affected corps; detect insolvency
 *   3. for each insolvent corp: flag its still-active corp bonds defaulted
 *   4. recurse with next-level batch (reason "corp-default") if any insolvent
 *
 * Bound at CASCADE_MAX_LEVELS = 3 to prevent runaway cascades. The downstream
 * corporate bond-default lifecycle (CEO decisions, dissolution) is handled by
 * the existing turn engine — Phase 7 only flips the flag.
 */

import { type AnyBulkWriteOperation, type Db, type ObjectId } from "mongodb";
import type { Bond } from "@/lib/db/types/bond";
import type { Corporation } from "@/lib/db/types";
import { CASCADE_MAX_LEVELS } from "../constants";
import { applyBondHolderWriteDowns, type WriteDownReport } from "./bondHolderWriteDown";
import { isCorporationInsolvent } from "./insolvency";
import { computeBondWriteDownSeverity, type CascadeReason } from "./writeDownSeverity";
import { emitPerCorpCascadeNews } from "./perCorpCascadeNews";

export interface CascadeInput {
  initialBonds: Bond[];
  reason: CascadeReason;
  currentTurn: number;
  /** Defaulting country code, threaded into per-corp news context (phase 9a). */
  countryCode: string;
  maxDepth?: number;
  forexEnabled?: boolean;
}

export interface CascadeResult {
  levels: number;
  totalBondsCascaded: number;
  totalCorpsInsolvent: number;
  perLevelReports: WriteDownReport[];
  insolventCorpIdsByLevel: ObjectId[][];
}

export async function runCascade(db: Db, input: CascadeInput): Promise<CascadeResult> {
  const maxDepth = input.maxDepth ?? CASCADE_MAX_LEVELS;
  const forexEnabled = input.forexEnabled ?? false;

  const result: CascadeResult = {
    levels: 0,
    totalBondsCascaded: 0,
    totalCorpsInsolvent: 0,
    perLevelReports: [],
    insolventCorpIdsByLevel: [],
  };

  let levelBonds = input.initialBonds;
  let levelReason = input.reason;

  while (levelBonds.length > 0 && result.levels < maxDepth) {
    const severity = computeBondWriteDownSeverity(levelReason);
    const report = await applyBondHolderWriteDowns(db, levelBonds, severity, forexEnabled);
    result.perLevelReports.push(report);
    result.totalBondsCascaded += levelBonds.length;
    result.levels += 1;

    if (report.affectedCorpIds.length === 0) {
      result.insolventCorpIdsByLevel.push([]);
      break;
    }

    const corpRows = await db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: report.affectedCorpIds } })
      .project<{
        _id: ObjectId;
        liquidCapital: number;
        name: string;
        type: string;
        countryId?: string;
      }>({ liquidCapital: 1, name: 1, type: 1, countryId: 1 })
      .toArray();

    const insolventIds: ObjectId[] = [];
    for (const corp of corpRows) {
      if (isCorporationInsolvent({ liquidCapital: corp.liquidCapital ?? 0 })) {
        insolventIds.push(corp._id);
        await emitPerCorpCascadeNews({
          countryCode: input.countryCode,
          level: result.levels,
          corpId: corp._id,
          corpName: corp.name,
          corpType: corp.type,
          corpCountryId: corp.countryId ?? "??",
        });
      }
    }
    result.insolventCorpIdsByLevel.push(insolventIds);
    result.totalCorpsInsolvent += insolventIds.length;

    if (insolventIds.length === 0 || result.levels >= maxDepth) break;

    // Flag insolvent corps' still-active corporate bonds as defaulted; collect
    // them as the next cascade level.
    const nextLevelBonds: Bond[] = [];
    const flagOps: AnyBulkWriteOperation<Bond>[] = [];
    for (const insolventId of insolventIds) {
      const activeCorpBonds = await db
        .collection<Bond>("bonds")
        .find({
          corporationId: insolventId,
          issuerType: { $ne: "sovereign" },
          defaulted: false,
          matured: false,
        })
        .toArray();
      for (const b of activeCorpBonds) {
        flagOps.push({
          updateOne: {
            filter: { _id: b._id },
            update: {
              $set: {
                defaulted: true,
                defaultedAtTurn: input.currentTurn,
                marketPrice: 0,
                updatedAt: new Date(),
              },
            },
          },
        });
        // Pass the bond doc forward with updated flags so the next level write-down
        // has accurate data without re-reading.
        nextLevelBonds.push({
          ...b,
          defaulted: true,
          defaultedAtTurn: input.currentTurn,
          marketPrice: 0,
        });
      }
    }
    if (flagOps.length > 0) {
      await db.collection<Bond>("bonds").bulkWrite(flagOps);
    }

    levelBonds = nextLevelBonds;
    levelReason = "corp-default";
  }

  return result;
}
