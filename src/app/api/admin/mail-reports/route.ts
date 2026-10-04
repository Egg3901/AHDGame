import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { parseBoundedIntParam } from "@/lib/api/validate";
import type { PlayerMailReport } from "@/lib/db/types";

// GET /api/admin/mail-reports — List reports (paginated, filterable by status)
// Auth: requireModerator (admins and moderators)
export async function GET(request: Request) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const offset = Math.max(0, parseInt(searchParams.get("offset") || "0"));
    const limit = parseBoundedIntParam(searchParams, "limit", 20, 1, 50);
    const status = searchParams.get("status");

    const db = await getDb();

    const matchStage: Record<string, unknown> = {};
    if (status && ["pending", "dismissed", "actioned"].includes(status)) {
      matchStage.status = status;
    }

    interface ReportFacet {
      reports: (PlayerMailReport & { mail?: Record<string, unknown> })[];
      totalCount: { count: number }[];
    }

    const [result] = await db
      .collection<PlayerMailReport>("playerMailReports")
      .aggregate<ReportFacet>([
        { $match: matchStage },
        { $sort: { createdAt: -1 } },
        {
          $facet: {
            reports: [
              { $skip: offset },
              { $limit: limit },
              {
                $lookup: {
                  from: "playerMail",
                  localField: "mailId",
                  foreignField: "_id",
                  as: "mailArr",
                },
              },
              // Fall back to the report's snapshot once the live message is
              // gone (world reset, or deleted by both sides).
              {
                $addFields: {
                  mail: { $ifNull: [{ $arrayElemAt: ["$mailArr", 0] }, "$mailSnapshot"] },
                },
              },
              { $unset: ["mailArr", "mailSnapshot"] },
            ],
            totalCount: [{ $count: "count" }],
          },
        },
      ])
      .toArray();

    const reports = result?.reports ?? [];
    const total = result?.totalCount[0]?.count ?? 0;

    return NextResponse.json({
      reports: reports.map((r) => ({
        ...r,
        _id: r._id.toString(),
        mailId: r.mailId.toString(),
        reportedByUserId: r.reportedByUserId.toString(),
        reviewedByAdminId: r.reviewedByAdminId?.toString(),
      })),
      total,
      hasMore: offset + reports.length < total,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
