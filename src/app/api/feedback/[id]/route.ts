import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import type { Feedback, User } from "@/lib/db/types";

// GET /api/feedback/[id] — Get a feedback entry by issue number; users can only view their own.
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 404
/**
 * GET /api/feedback/[id]
 * Get feedback by numeric issueNumber (#1, #2, ...).
 * Users can only view their own; admins can view any.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const issueNum = parseInt(id, 10);
    if (isNaN(issueNum) || issueNum < 1) {
      return NextResponse.json({ error: "Invalid issue number" }, { status: 400 });
    }

    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const db = await getDb();
    const feedback = await db.collection<Feedback>("feedback").findOne({ issueNumber: issueNum });

    if (!feedback) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    const isAdmin = user.isAdmin === true;
    const isOwner = feedback.userId && feedback.userId.toString() === user.userId;

    if (!isAdmin && !isOwner) {
      return NextResponse.json({ error: "You can only view your own issues" }, { status: 403 });
    }

    // Fetch reporter username if available
    let reporterUsername: string | null = null;
    if (feedback.userId) {
      const u = await db
        .collection<User>("users")
        .findOne({ _id: feedback.userId }, { projection: { username: 1 } });
      reporterUsername = u?.username ?? null;
    }

    return NextResponse.json({
      id: feedback._id.toString(),
      issueNumber: feedback.issueNumber,
      type: feedback.type,
      category: feedback.category,
      title: feedback.title,
      description: feedback.description,
      stepsToReproduce: feedback.stepsToReproduce,
      severity: feedback.severity,
      impact: feedback.impact,
      priority: feedback.priority,
      status: feedback.status,
      adminNotes: isAdmin ? feedback.adminNotes : undefined,
      screenshotUrl: feedback.screenshotUrl,
      context: feedback.context,
      reporterUsername: isAdmin ? reporterUsername : undefined,
      githubIssueUrl: feedback.githubIssueUrl,
      githubIssueNumber: feedback.githubIssueNumber,
      createdAt: feedback.createdAt.toISOString(),
      updatedAt: feedback.updatedAt.toISOString(),
      statusChangedAt: feedback.statusChangedAt?.toISOString(),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
