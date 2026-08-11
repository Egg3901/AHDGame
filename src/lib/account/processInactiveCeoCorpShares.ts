import { ObjectId, type Db } from "mongodb";
import type { Character, Corporation, User } from "@/lib/db/types";
import { cleanupShareMarketActivityForCorporations } from "@/lib/corporations/cleanupShareMarketActivity";
import { releaseCorporationHeldSharesToFloat } from "@/lib/corporations/releaseHeldSharesToFloat";
import { isInactiveCeoPenaltyCandidate } from "@/lib/turn/corporation/inactiveCeoSectorShed";
import {
  isUserActive,
  INACTIVE_SHAREHOLDER_TURN_THRESHOLD,
  INACTIVE_SHAREHOLDER_WARN_TURN_THRESHOLD,
} from "@/lib/players/playerActivity";
import { createNotifications, type NotificationInput } from "@/lib/notifications";

const TURN_MS = 60 * 60 * 1000;

/** Turns between the warning and the actual release (= 24). */
const WARN_LEAD = INACTIVE_SHAREHOLDER_TURN_THRESHOLD - INACTIVE_SHAREHOLDER_WARN_TURN_THRESHOLD;

export interface ProcessInactiveCeoCorpSharesOptions {
  now: Date;
  forexEnabled: boolean;
}

export interface ProcessInactiveCeoCorpSharesResult {
  corpsProcessed: number;
  corpsWarned: number;
  warningsSent: number;
  sharesReleasedToFloat: number;
  sharePositionsReleased: number;
  ordersCancelled: number;
  listingsCancelled: number;
  offersCancelled: number;
}

function emptyResult(): ProcessInactiveCeoCorpSharesResult {
  return {
    corpsProcessed: 0,
    corpsWarned: 0,
    warningsSent: 0,
    sharesReleasedToFloat: 0,
    sharePositionsReleased: 0,
    ordersCancelled: 0,
    listingsCancelled: 0,
    offersCancelled: 0,
  };
}

/**
 * Cross-corp equity held by a player character-CEO corporation whose CEO is
 * inactive is returned to public float once the CEO passes
 * INACTIVE_SHAREHOLDER_TURN_THRESHOLD turns of inactivity. WARN_LEAD turns before
 * that, the corporation's own shareholders (character holders directly, and
 * corporation holders via their CEO) are warned once.
 *
 * Holdings-first: a single scan of issuers that have corporation shareholders
 * gates everything. Release is idempotent (after the sweep the corp holds
 * nothing). The warning is stateless and fires only on the single turn the CEO's
 * inactivity crosses into [WARN, WARN+1).
 */
export async function processInactiveCeoCorpShares(
  db: Db,
  options: ProcessInactiveCeoCorpSharesOptions
): Promise<ProcessInactiveCeoCorpSharesResult> {
  const { now, forexEnabled } = options;

  // 1. Scan issuers that have at least one corporation shareholder; collect
  //    distinct holder corporationIds (positions with shares > 0).
  const issuers = await db
    .collection<Corporation>("corporations")
    .find(
      { "shareholders.corporationId": { $exists: true } },
      { projection: { _id: 1, shareholders: 1 } }
    )
    .toArray();
  if (issuers.length === 0) return emptyResult();

  const holderCorpIdSet = new Set<string>();
  for (const issuer of issuers) {
    for (const sh of issuer.shareholders ?? []) {
      if (sh.corporationId && (sh.shares ?? 0) > 0) {
        holderCorpIdSet.add(sh.corporationId.toString());
      }
    }
  }
  if (holderCorpIdSet.size === 0) return emptyResult();
  const holderCorpIds = [...holderCorpIdSet].map((id) => new ObjectId(id));

  // 2. Load holder corps' eligibility fields (+ name + shareholders for the
  //    warning recipients); keep only penalty candidates.
  const holderCorps = await db
    .collection<Corporation>("corporations")
    .find(
      { _id: { $in: holderCorpIds } },
      {
        projection: {
          _id: 1,
          name: 1,
          userId: 1,
          ceoVacant: 1,
          ceoType: 1,
          countryOwnerId: 1,
          isNationalized: 1,
          shareholders: 1,
        },
      }
    )
    .toArray();
  const candidates = holderCorps.filter(isInactiveCeoPenaltyCandidate);
  if (candidates.length === 0) return emptyResult();

  // 3. Classify candidate CEOs (owning users): release (inactive past 168) vs
  //    warn (crossing the WARN window this turn).
  const ownerIds = Array.from(
    new Set(candidates.map((c) => c.userId?.toString()).filter((s): s is string => !!s))
  ).map((s) => new ObjectId(s));
  const users = await db
    .collection<User>("users")
    .find({ _id: { $in: ownerIds } }, { projection: { _id: 1, lastActivity: 1, createdAt: 1 } })
    .toArray();
  const releaseOwnerIds = new Set<string>();
  const warnOwnerIds = new Set<string>();
  for (const u of users) {
    const reference = u.lastActivity ?? u.createdAt;
    if (!reference) continue; // never penalize a data gap
    if (!isUserActive(u.lastActivity, u.createdAt, now, INACTIVE_SHAREHOLDER_TURN_THRESHOLD)) {
      releaseOwnerIds.add(u._id.toString());
    } else {
      const turnsInactive = (now.getTime() - reference.getTime()) / TURN_MS;
      if (Math.floor(turnsInactive) === INACTIVE_SHAREHOLDER_WARN_TURN_THRESHOLD) {
        warnOwnerIds.add(u._id.toString());
      }
    }
  }
  if (releaseOwnerIds.size === 0 && warnOwnerIds.size === 0) return emptyResult();

  const result = emptyResult();

  // 4. Warn pass: notify shareholders of corps whose CEO just entered the window.
  const warnedCorps = candidates.filter((c) => c.userId && warnOwnerIds.has(c.userId.toString()));
  if (warnedCorps.length > 0) {
    const charHolderIdSet = new Set<string>();
    const corpHolderIdSet = new Set<string>();
    for (const corp of warnedCorps) {
      for (const sh of corp.shareholders ?? []) {
        if ((sh.shares ?? 0) <= 0) continue;
        if (sh.characterId) charHolderIdSet.add(sh.characterId.toString());
        else if (sh.corporationId) corpHolderIdSet.add(sh.corporationId.toString());
      }
    }

    const charUserMap = new Map<string, string>();
    if (charHolderIdSet.size > 0) {
      const holderChars = await db
        .collection<Character>("characters")
        .find(
          { _id: { $in: [...charHolderIdSet].map((id) => new ObjectId(id)) } },
          { projection: { _id: 1, userId: 1 } }
        )
        .toArray();
      for (const c of holderChars) {
        if (c.userId) charUserMap.set(c._id.toString(), c.userId.toString());
      }
    }

    const corpUserMap = new Map<string, string>();
    if (corpHolderIdSet.size > 0) {
      const holderOwnerCorps = await db
        .collection<Corporation>("corporations")
        .find(
          { _id: { $in: [...corpHolderIdSet].map((id) => new ObjectId(id)) } },
          { projection: { _id: 1, userId: 1 } }
        )
        .toArray();
      for (const c of holderOwnerCorps) {
        if (c.userId) corpUserMap.set(c._id.toString(), c.userId.toString());
      }
    }

    const notificationInputs: NotificationInput[] = [];
    for (const corp of warnedCorps) {
      result.corpsWarned += 1;
      const corpName = corp.name ?? "A corporation";
      const seenUsers = new Set<string>();
      for (const sh of corp.shareholders ?? []) {
        if ((sh.shares ?? 0) <= 0) continue;
        let recipientUserId: string | undefined;
        if (sh.characterId) recipientUserId = charUserMap.get(sh.characterId.toString());
        else if (sh.corporationId) recipientUserId = corpUserMap.get(sh.corporationId.toString());
        if (!recipientUserId || seenUsers.has(recipientUserId)) continue;
        seenUsers.add(recipientUserId);
        notificationInputs.push({
          userId: new ObjectId(recipientUserId),
          type: "corp_inactive_ceo_share_release_warning",
          title: "Holdings release pending",
          message: `${corpName} has a CEO who has been inactive, and it will release its shares back to public float in ${WARN_LEAD} turns.`,
          metadata: {
            corporationId: corp._id.toString(),
            corporationName: corpName,
            turnsUntilRelease: WARN_LEAD,
          },
        });
      }
    }

    if (notificationInputs.length > 0) {
      await createNotifications(notificationInputs);
      result.warningsSent += notificationInputs.length;
    }
  }

  // 5. Release pass: cancel market activity + release all cross-corp holdings.
  for (const corp of candidates) {
    if (!corp.userId || !releaseOwnerIds.has(corp.userId.toString())) continue;

    const cleanup = await cleanupShareMarketActivityForCorporations(
      db,
      [corp._id],
      now,
      forexEnabled
    );
    const released = await releaseCorporationHeldSharesToFloat(db, corp._id, now);

    result.corpsProcessed += 1;
    result.sharesReleasedToFloat += released.sharesReleased;
    result.sharePositionsReleased += released.corpsShareholderCleared;
    result.ordersCancelled += cleanup.ordersCancelled;
    result.listingsCancelled += cleanup.listingsCancelled;
    result.offersCancelled += cleanup.offersCancelled;
  }

  return result;
}
