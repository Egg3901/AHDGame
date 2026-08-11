import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { schemas } from "@/lib/api/validate";
import { buildCharacterHref } from "@/lib/utils/profileUrls";
import type { GameConfig } from "@/lib/db/types";
import type { User } from "@/lib/db/types/user";

/** Minimal character fields for referral list (aligned with referral credit on character creation). */
type ReferralCharacterDoc = {
  userId: ObjectId;
  sequentialId?: number;
  _id?: ObjectId;
  createdAt: Date;
};

const querySchema = z.enum(["allTime", "contest"]).default("allTime");

export type ReferralRefereeRow = {
  userId: string;
  username: string;
  displayName: string;
  profileHref: string;
};

const REFERRALS_MAX = 500;

// GET /api/admin/referrals/by-user/[userId] — Users referred by the given account (completed character setup)
// Auth: requireAdmin
// Errors: 400, 403, 404
export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { userId: userIdParam } = await params;
    const parsedId = schemas.objectId.safeParse(userIdParam);
    if (!parsedId.success) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    const referrerId = new ObjectId(parsedId.data);

    const url = new URL(request.url);
    const modeParsed = querySchema.safeParse(url.searchParams.get("mode") ?? undefined);
    const mode = modeParsed.success ? modeParsed.data : "allTime";

    const db = await getDb();

    const referrer = await db
      .collection<User>("users")
      .findOne({ _id: referrerId }, { projection: { _id: 1 } });
    if (!referrer) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    let contestStartedAt: Date | null = null;
    if (mode === "contest") {
      const config = await db
        .collection<GameConfig>("gameConfig")
        .findOne({ _id: "default" }, { projection: { referralContestStartedAt: 1 } });
      contestStartedAt = config?.referralContestStartedAt ?? null;
      if (!(contestStartedAt instanceof Date) || Number.isNaN(contestStartedAt.getTime())) {
        return NextResponse.json({ referees: [], contestMode: false });
      }
    }

    const refereeFilter: Record<string, unknown> = {
      referredBy: referrerId,
      hasCompletedSetup: true,
    };

    const refereeDocs = await db
      .collection<User>("users")
      .find(refereeFilter)
      .project({ _id: 1, username: 1, displayName: 1 })
      .sort({ username: 1 })
      .limit(REFERRALS_MAX)
      .toArray();

    const refereeIds = refereeDocs.map((u) => u._id);
    const chars: ReferralCharacterDoc[] =
      refereeIds.length > 0
        ? ((await db
            .collection("characters")
            .find({ userId: { $in: refereeIds } })
            .project({ userId: 1, sequentialId: 1, createdAt: 1 })
            .toArray()) as ReferralCharacterDoc[])
        : [];

    const charByUserId = new Map<string, ReferralCharacterDoc>();
    for (const c of chars) {
      charByUserId.set(c.userId.toString(), c);
    }

    const referees: ReferralRefereeRow[] = refereeDocs
      .map((u) => {
        const char = charByUserId.get(u._id.toString());
        if (!char) return null;
        if (mode === "contest" && contestStartedAt && char.createdAt < contestStartedAt) {
          return null;
        }
        return {
          userId: u._id.toString(),
          username: u.username,
          displayName: u.displayName,
          profileHref: buildCharacterHref(char),
        };
      })
      .filter((row): row is ReferralRefereeRow => row !== null);

    referees.sort((a, b) => a.username.localeCompare(b.username));

    return NextResponse.json({
      referees,
      contestMode: mode === "contest" && contestStartedAt != null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
