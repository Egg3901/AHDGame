import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { adminSuggestionBulkDeleteSchema } from "@/lib/api/schemas/admin";
import { createNotification } from "@/lib/notifications";
import { getSuggestionsCollection } from "@/lib/db/collections/suggestions";
import { getSuggestionCommentsCollection } from "@/lib/db/collections/suggestionComments";

// POST /api/admin/suggestions/bulk-delete — Delete multiple suggestions.
// Auth: requireAdmin
// Errors: 400, 401, 403, 404
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, adminSuggestionBulkDeleteSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { issueNumbers } = parsed.data;

    const db = await getDb();
    const coll = getSuggestionsCollection(db);
    const commentsColl = getSuggestionCommentsCollection(db);
    const readsColl = db.collection("suggestionReads");

    const suggestions = await coll.find({ issueNumber: { $in: issueNumbers } }).toArray();
    if (suggestions.length === 0) {
      return NextResponse.json({ error: "No suggestions found" }, { status: 404 });
    }

    const ids = suggestions.map((s) => s._id);
    let deletedComments = 0;
    let deletedReads = 0;

    for (const s of suggestions) {
      const cDel = await commentsColl.deleteMany({ suggestionId: s._id });
      deletedComments += cDel.deletedCount;
      const rDel = await readsColl.deleteMany({ suggestionId: s._id });
      deletedReads += rDel.deletedCount;

      // Notify the reporter
      if (s.userId) {
        await createNotification({
          userId: s.userId,
          type: "player_suggestion_status_changed",
          title: `Suggestion S#${s.issueNumber} removed`,
          message: `Your suggestion "${s.title}" has been removed by an administrator.`,
          metadata: {
            suggestionIssueNumber: s.issueNumber,
            suggestionId: s._id.toString(),
            previousStatus: s.status,
            newStatus: "deleted",
          },
        });
      }
    }

    await coll.deleteMany({ _id: { $in: ids } });

    const found = suggestions.map((s) => s.issueNumber);
    const missing = issueNumbers.filter((n) => !found.includes(n));

    return NextResponse.json({
      message: "Deleted",
      deleted: found,
      missing: missing.length > 0 ? missing : undefined,
      deletedComments,
      deletedReads,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
