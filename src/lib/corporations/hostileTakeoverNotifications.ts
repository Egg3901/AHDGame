import type { Db, ObjectId } from "mongodb";
import * as Sentry from "@sentry/nextjs";
import type { Corporation } from "@/lib/db/types";
import { corporationPathIdFromDoc } from "@/lib/api/corporations/resolveQuery";
import {
  acquirerOwnershipPercent,
  HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT,
} from "@/lib/corporations/corporateOwnership";
import { createNotification } from "@/lib/notifications";

/**
 * When corporate ownership is above 75%, notify that corp’s CEO they may merge.
 * One notification per (issuer, parent) pair — skips if one already exists.
 */
export async function notifyHostileTakeoverThresholdIfEligible(
  db: Db,
  issuerCorpId: ObjectId
): Promise<void> {
  // Invoked fire-and-forget (`void notifyHostileTakeoverThresholdIfEligible`)
  // from the share-trade paths; without this guard a DB failure here is an
  // unhandled rejection AND affected players silently never get the
  // takeover-available notification (a gameplay-critical signal).
  try {
    const corp = await db.collection<Corporation>("corporations").findOne({ _id: issuerCorpId });
    if (!corp?.shareholders?.length || corp.countryOwnerId) return;

    const totalShares = corp.totalShares ?? 0;
    if (totalShares <= 0) return;

    for (const sh of corp.shareholders) {
      if (!sh.corporationId || !sh.shares || sh.shares <= 0) continue;
      const pct = acquirerOwnershipPercent(sh.corporationId, corp);
      if (pct <= HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT) continue;

      const parent = await db
        .collection<Corporation>("corporations")
        .findOne({ _id: sh.corporationId }, { projection: { userId: 1, name: 1 } });
      if (!parent?.userId) continue;

      const dup = await db.collection("notifications").findOne({
        userId: parent.userId,
        type: "corp_hostile_takeover_available",
        "metadata.issuerCorporationId": corp._id.toString(),
        "metadata.parentCorporationId": sh.corporationId.toString(),
      });
      if (dup) continue;

      await createNotification({
        userId: parent.userId,
        type: "corp_hostile_takeover_available",
        title: `Hostile takeover — ${corp.name}`,
        message: `${parent.name ?? "Your corporation"} holds ${pct.toFixed(
          1
        )}% of ${corp.name}. You may merge them from their corporation page (premium squeeze-out).`,
        metadata: {
          issuerCorporationId: corp._id.toString(),
          parentCorporationId: sh.corporationId.toString(),
          issuerPathId: corporationPathIdFromDoc(corp),
          thresholdPercent: HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT,
        },
      });
    }
  } catch (error) {
    Sentry.captureException(error, {
      tags: { module: "hostileTakeoverNotifications" },
      extra: { issuerCorpId: issuerCorpId?.toString() },
    });
  }
}
