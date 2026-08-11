import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { hideBillDiscussion } from "@/lib/legislature/discussions/discussionCommands";

// DELETE /api/congress/bills/[id]/discussions/[postId] — Soft-hide a discussion (admin).
// Auth: requireAdmin
// Errors: 400, 403, 404
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; postId: string }> }
) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { postId } = await params;
    const db = await getDb();
    return NextResponse.json(
      await hideBillDiscussion(db, { discussionId: postId, adminUserId: auth.admin.userId })
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
