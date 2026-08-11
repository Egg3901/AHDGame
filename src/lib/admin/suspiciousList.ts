import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { SuspiciousCharacter } from "@/lib/db/types/activityLog";
import { AUTOMATION_FLAG_TYPE } from "@/lib/turn/automationDetection";

export type RawSuspicious = SuspiciousCharacter;
export type SuspiciousEntryOut = SuspiciousCharacter & { accountDeleted: boolean };

export interface SuspiciousCounts {
  high: number;
  medium: number;
  low: number;
  deleted: number;
  resolved: number;
  /** Active (non-deleted, non-resolved, non-dismissed) entries carrying an automation flag. */
  automation: number;
}

export interface SuspiciousPage {
  entries: SuspiciousEntryOut[];
  nextCursor: string | null;
  hasMore: boolean;
  counts: SuspiciousCounts;
}

const SEVERITY_ORDER: Record<SuspiciousCharacter["highestSeverity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

interface BuildArgs {
  /** Full filtered (severity/country/dismissed) set already fetched from Mongo. */
  entries: RawSuspicious[];
  existingCharIds: Set<string>;
  existingUserIds: Set<string>;
  severity?: SuspiciousCharacter["highestSeverity"];
  deleted: boolean;
  showResolved: boolean;
  /** Restrict to entries carrying a flag of this `type` (e.g. automation_timing). */
  flagType?: string;
  cursor: string | null;
  limit: number;
}

/**
 * Pure pagination/derivation core for the suspicious list. Marks each entry's
 * `accountDeleted` from the supplied existence sets, filters by the `deleted`
 * dimension, severity-orders, and paginates by `_id` cursor. Counts are derived
 * over the full input set: high/medium/low/deleted count only non-resolved
 * entries, and `resolved` counts everything in the resolved pool — so the header
 * always matches what each filter surface shows. No DB access.
 */
export function buildSuspiciousPage(args: BuildArgs): SuspiciousPage {
  const {
    entries,
    existingCharIds,
    existingUserIds,
    severity,
    deleted,
    showResolved,
    flagType,
    cursor,
    limit,
  } = args;

  const marked: SuspiciousEntryOut[] = entries.map((e) => ({
    ...e,
    accountDeleted:
      !existingCharIds.has(e.characterId.toHexString()) ||
      !existingUserIds.has(e.userId.toHexString()),
  }));

  // Counts over the non-dismissed, non-resolved set for active alert workload.
  // Resolved counts are separate.
  const counts: SuspiciousCounts = {
    high: 0,
    medium: 0,
    low: 0,
    deleted: 0,
    resolved: 0,
    automation: 0,
  };
  for (const e of marked) {
    if (e.pool === "resolved") {
      counts.resolved += 1;
      continue;
    }
    if (e.dismissed) continue;
    if (e.accountDeleted) counts.deleted += 1;
    else {
      counts[e.highestSeverity] += 1;
      if (e.flags.some((f) => f.type === AUTOMATION_FLAG_TYPE)) counts.automation += 1;
    }
  }

  // Apply the resolved filter dimension, then deleted, then optional severity, then order.
  const ordered = marked
    .filter((e) => (showResolved ? e.pool === "resolved" : e.pool !== "resolved"))
    .filter((e) => e.accountDeleted === deleted)
    .filter((e) => (severity ? e.highestSeverity === severity : true))
    .filter((e) => (flagType ? e.flags.some((f) => f.type === flagType) : true))
    .sort((a, b) => {
      const sev = SEVERITY_ORDER[a.highestSeverity] - SEVERITY_ORDER[b.highestSeverity];
      if (sev !== 0) return sev;
      if (b.flagCount !== a.flagCount) return b.flagCount - a.flagCount;
      return a._id.toHexString().localeCompare(b._id.toHexString());
    });

  // Cursor = last _id of the previous page; slice the window after it.
  let startIndex = 0;
  if (cursor) {
    const idx = ordered.findIndex((e) => e._id.toHexString() === cursor);
    startIndex = idx >= 0 ? idx + 1 : 0;
  }

  const window = ordered.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < ordered.length;
  const nextCursor =
    hasMore && window.length > 0 ? window[window.length - 1]._id.toHexString() : null;

  return { entries: window, nextCursor, hasMore, counts };
}

export interface FetchSuspiciousParams {
  severity?: SuspiciousCharacter["highestSeverity"];
  countryId?: SuspiciousCharacter["countryId"];
  showDismissed: boolean;
  deleted: boolean;
  showResolved: boolean;
  flagType?: string;
  cursor: string | null;
  limit: number;
}

/**
 * Fetches the filtered suspicious set, resolves which referenced characters/users
 * still exist, then delegates to `buildSuspiciousPage` for derivation. The
 * collection is a small curated set, so we read the whole filtered set and
 * paginate in memory rather than join in-DB.
 *
 * When `showResolved` is false (default), only active entries are fetched.
 * When true, only resolved entries are fetched.
 */
export async function fetchSuspiciousList(
  db: Db,
  params: FetchSuspiciousParams
): Promise<SuspiciousPage> {
  const baseFilter: Record<string, unknown> = {};
  if (params.countryId) baseFilter.countryId = params.countryId;
  if (!params.showDismissed) baseFilter.dismissed = false;
  baseFilter.pool = params.showResolved ? "resolved" : { $ne: "resolved" };

  const entries = (await db
    .collection<SuspiciousCharacter>("suspiciousCharacters")
    .find(baseFilter)
    .toArray()) as RawSuspicious[];

  const charIds = [...new Set(entries.map((e) => e.characterId.toHexString()))].map(
    (h) => new ObjectId(h)
  );
  const userIds = [...new Set(entries.map((e) => e.userId.toHexString()))].map(
    (h) => new ObjectId(h)
  );

  const [liveChars, liveUsers] = await Promise.all([
    db
      .collection("characters")
      .find({ _id: { $in: charIds } }, { projection: { _id: 1 } })
      .toArray(),
    db
      .collection("users")
      .find({ _id: { $in: userIds } }, { projection: { _id: 1 } })
      .toArray(),
  ]);

  const existingCharIds = new Set(liveChars.map((d) => (d._id as ObjectId).toHexString()));
  const existingUserIds = new Set(liveUsers.map((d) => (d._id as ObjectId).toHexString()));

  return buildSuspiciousPage({
    entries,
    existingCharIds,
    existingUserIds,
    severity: params.severity,
    deleted: params.deleted,
    showResolved: params.showResolved,
    flagType: params.flagType,
    cursor: params.cursor,
    limit: params.limit,
  });
}
