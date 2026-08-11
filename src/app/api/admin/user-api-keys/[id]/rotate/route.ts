import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { generateUserApiToken, type UserApiScope } from "@/lib/api/userApiAuth";
import { getDb } from "@/lib/mongodb";

/** Old key stays valid for this long after rotation, so the integration can swap over. */
const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

// POST /api/admin/user-api-keys/[id]/rotate
// Admin (incident-response) rotation: issues a fresh token for the SAME OWNER,
// same scope/name, and schedules the old key to revoke after a grace window.
// The owner is preserved — the admin does not take ownership. The new secret is
// returned to the admin once and must be delivered to the owner out-of-band.
export const POST = withAdminAuth(
  async (auth, _request: Request, ctx: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await ctx.params;
      if (!ObjectId.isValid(id)) {
        return NextResponse.json({ error: "Invalid key id" }, { status: 400 });
      }

      const db = await getDb();
      const now = new Date();

      const existing = await db.collection("userApiKeys").findOne({
        _id: new ObjectId(id),
        revokedAt: null,
        revokeAt: { $not: { $lte: now } },
      });
      if (!existing) {
        return NextResponse.json({ error: "Key not found or already revoked" }, { status: 404 });
      }

      const scope: UserApiScope = existing.scope;
      const { token, tokenHash, prefix } = generateUserApiToken(scope);
      const revokeAt = new Date(now.getTime() + ROTATION_GRACE_MS);

      const inserted = await db.collection("userApiKeys").insertOne({
        userId: existing.userId, // ownership is preserved
        name: existing.name,
        scope,
        prefix,
        tokenHash,
        requestCount: 0,
        lastUsedAt: null,
        revokedAt: null,
        revokeAt: null,
        rotatedFrom: existing._id,
        rotatedByAdmin: new ObjectId(auth.admin.userId),
        createdAt: now,
        updatedAt: now,
      });

      await db.collection("userApiKeys").updateOne(
        { _id: existing._id },
        {
          $set: {
            revokeAt,
            rotatedAt: now,
            rotatedTo: inserted.insertedId,
            rotatedByAdmin: new ObjectId(auth.admin.userId),
            updatedAt: now,
          },
        }
      );

      return NextResponse.json({
        token,
        scope,
        ownerUserId: String(existing.userId),
        gracePeriodEndsAt: revokeAt.toISOString(),
        warning:
          "Deliver this token to the key owner over a secure channel. It will not be shown again.",
      });
    } catch (error) {
      return handleRouteError(error);
    }
  }
);
