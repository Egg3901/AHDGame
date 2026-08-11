import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import type { GameConfig } from "@/lib/db/types";
import type { ObjectId } from "mongodb";

const TOP_N = 100;

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start-contest"),
  }),
  z.object({
    action: z.literal("reset-contest"),
  }),
]);

export type ReferralLeaderRow = {
  userId: string;
  username: string;
  displayName: string;
  count: number;
};

type LeaderUserDoc = {
  _id: ObjectId;
  username: string;
  displayName: string;
  referralCount?: number;
  referralContestCount?: number;
};

function toLeaderRow(
  doc: LeaderUserDoc,
  field: "referralCount" | "referralContestCount"
): ReferralLeaderRow {
  return {
    userId: doc._id.toString(),
    username: doc.username,
    displayName: doc.displayName,
    count: doc[field] ?? 0,
  };
}

// GET /api/admin/referrals/leaderboard — All-time and rolling contest referral rankings
// Auth: requireAdmin
// Errors: 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { referralContestStartedAt: 1 } });

    const contestStartedAt = config?.referralContestStartedAt ?? null;
    const contestMode =
      contestStartedAt instanceof Date && !Number.isNaN(contestStartedAt.getTime());

    const usersCol = db.collection<LeaderUserDoc>("users");

    const [allTimeDocs, contestDocs] = (await Promise.all([
      usersCol
        .find({ referralCount: { $gt: 0 } })
        .project({ _id: 1, username: 1, displayName: 1, referralCount: 1 })
        .sort({ referralCount: -1, username: 1 })
        .limit(TOP_N)
        .toArray(),
      contestMode
        ? usersCol
            .find({ referralContestCount: { $gt: 0 } })
            .project({ _id: 1, username: 1, displayName: 1, referralContestCount: 1 })
            .sort({ referralContestCount: -1, username: 1 })
            .limit(TOP_N)
            .toArray()
        : Promise.resolve([] as LeaderUserDoc[]),
    ])) as [LeaderUserDoc[], LeaderUserDoc[]];

    const allTime: ReferralLeaderRow[] = allTimeDocs.map((u) => toLeaderRow(u, "referralCount"));
    const contest: ReferralLeaderRow[] = contestDocs.map((u) =>
      toLeaderRow(u, "referralContestCount")
    );

    return NextResponse.json({
      contestMode,
      contestStartedAt: contestStartedAt?.toISOString() ?? null,
      allTime,
      contest,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// PATCH /api/admin/referrals/leaderboard — Start or reset the rolling referral contest window
// Auth: requireAdmin
// Errors: 400, 403
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const now = new Date();

    if (parsed.data.action === "start-contest") {
      await Promise.all([
        db
          .collection<GameConfig>("gameConfig")
          .updateOne(
            { _id: "default" },
            { $set: { referralContestStartedAt: now } },
            { upsert: true }
          ),
        db.collection("users").updateMany({}, { $set: { referralContestCount: 0 } }),
      ]);

      await createAdminLog({
        category: "system",
        action: "referral_contest_started",
        username: auth.admin.username,
        adminUsername: auth.admin.username,
        details: `Referral contest window started at ${now.toISOString()}. Rolling counts reset to zero.`,
      });

      return NextResponse.json({
        success: true,
        contestMode: true,
        contestStartedAt: now.toISOString(),
      });
    }

    await Promise.all([
      db
        .collection<GameConfig>("gameConfig")
        .updateOne(
          { _id: "default" },
          { $unset: { referralContestStartedAt: "" } },
          { upsert: true }
        ),
      db.collection("users").updateMany({}, { $set: { referralContestCount: 0 } }),
    ]);

    await createAdminLog({
      category: "system",
      action: "referral_contest_reset",
      username: auth.admin.username,
      adminUsername: auth.admin.username,
      details: "Referral contest ended — contest window cleared and rolling counts reset to zero.",
    });

    return NextResponse.json({
      success: true,
      contestMode: false,
      contestStartedAt: null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
