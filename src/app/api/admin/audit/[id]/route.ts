// GET /api/admin/audit/:id — single audit record + pivot context
// (forensics/alt-detection rework plan §3.1/§4.7 "Pivot" + §4.9 frozen
// contract): the record itself plus a short window of the same actor's
// other actions, the same subject's history, and its cross-refs into the
// heavier domain logs — enough for the Explorer to pivot without the user
// re-typing filters.
//
// Auth: requireModerator. Role gating (plan §4.6): a non-admin caller gets a
// 404 for an admin-category record (existence is not revealed) and never
// sees raw `meta`/`net` on the record or any related row.
// Errors: 400, 403, 404
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { getActionAuditLogCollection } from "@/lib/db/collections/actionAuditLog";
import {
  auditProjectionFor,
  categoryGuardFor,
  RELATED_ROWS_LIMIT,
} from "@/lib/audit/queryAuditLog";
import type { ActionAuditRecord } from "@/lib/db/types/actionAuditLog";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!/^[0-9a-f]{24}$/i.test(id)) {
      return NextResponse.json({ error: "Invalid audit record id" }, { status: 400 });
    }

    const isAdmin = auth.user.isAdmin === true;
    const db = await getDb();
    const collection = await getActionAuditLogCollection(db);
    const categoryGuard = categoryGuardFor(isAdmin);
    const projection = auditProjectionFor(isAdmin);

    const record = await collection.findOne(
      { _id: new ObjectId(id), ...categoryGuard },
      { projection }
    );

    if (!record) {
      // Also covers "exists but is an admin-category row a moderator asked
      // for by id" — we do not reveal that it exists.
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const excludeSelf = { _id: { $ne: record._id } };

    const actorRecentQuery: Record<string, unknown> = { ...categoryGuard, ...excludeSelf };
    if (record.actor?.characterId) {
      actorRecentQuery["actor.characterId"] = record.actor.characterId;
    } else if (record.actor?.userId) {
      actorRecentQuery["actor.userId"] = record.actor.userId;
    }

    const subjectHistoryQuery: Record<string, unknown> = {
      ...categoryGuard,
      ...excludeSelf,
      "subject.type": record.subject.type,
      "subject.id": record.subject.id,
    };

    const [actorRecent, subjectHistory] = await Promise.all([
      record.actor?.characterId || record.actor?.userId
        ? collection
            .find(actorRecentQuery, { projection })
            .sort({ _id: -1 })
            .limit(RELATED_ROWS_LIMIT)
            .toArray()
        : Promise.resolve([] as ActionAuditRecord[]),
      record.subject?.id !== undefined
        ? collection
            .find(subjectHistoryQuery, { projection })
            .sort({ _id: -1 })
            .limit(RELATED_ROWS_LIMIT)
            .toArray()
        : Promise.resolve([] as ActionAuditRecord[]),
    ]);

    return NextResponse.json({
      record,
      related: {
        actorRecent,
        subjectHistory,
        refs: record.refs ?? {},
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
