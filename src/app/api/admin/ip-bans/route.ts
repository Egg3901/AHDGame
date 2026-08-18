import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, badRequest, ApiError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import { getRegistrationIpMatchCandidates, normalizeIp } from "@/lib/utils/ipNormalize";
import type { BannedIp, User } from "@/lib/db/types";

const postSchema = z.union([
  z.object({
    ip: z.string().min(1),
    note: z.string().min(1).max(500),
    allow: z.literal(true),
    maxAccounts: z.number().int().min(1).max(1000),
  }),
  z.object({
    ip: z.string().min(1),
    note: z.string().min(1).max(500),
  }),
]);

// GET /api/admin/ip-bans — list all ban and allowance rows + per-IP user counts
// Auth: requireAdmin
// Errors: 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const rows = await db
      .collection<BannedIp>("bannedIps")
      .find({})
      .sort({ bannedAt: -1 })
      .toArray();

    const ips = rows.map((r) => r.ip);
    const usersColl = db.collection<User>("users");
    const counts: Record<string, number> = {};
    await Promise.all(
      ips.map(async (ip) => {
        counts[ip] = await usersColl.countDocuments({
          registrationIp: { $in: getRegistrationIpMatchCandidates(ip) },
        });
      })
    );

    return NextResponse.json({ rows, counts });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/admin/ip-bans — create a ban or allowance row
// Auth: requireAdmin
// Errors: 400, 403, 409
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, postSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const normalized = normalizeIp(parsed.data.ip);
    if (!normalized) throw badRequest("Invalid IP address.");

    const db = await getDb();
    const now = new Date();
    const adminObjectId = new ObjectId(auth.admin.userId);

    const baseDoc = {
      ip: normalized,
      note: parsed.data.note,
      bannedByAdminId: adminObjectId,
      bannedByAdminUsername: auth.admin.username,
      bannedAt: now,
    };
    const doc: Omit<BannedIp, "_id"> =
      "allow" in parsed.data && parsed.data.allow === true
        ? {
            ...baseDoc,
            allowRegistration: true,
            maxAccounts: parsed.data.maxAccounts,
            allowReason: parsed.data.note,
            allowedByAdminUsername: auth.admin.username,
            allowedAt: now,
          }
        : baseDoc;
    const isAllowance = doc.allowRegistration === true;

    try {
      const result = await db.collection<BannedIp>("bannedIps").insertOne(doc as BannedIp);
      await createAdminLog({
        category: "system",
        action: isAllowance ? "ip_allowance_added" : "ip_ban_added",
        username: auth.admin.username,
        adminUsername: auth.admin.username,
        details: isAllowance
          ? `Allowance for ${normalized} (cap ${doc.maxAccounts}): ${parsed.data.note}`
          : `Ban for ${normalized}: ${parsed.data.note}`,
      });
      return NextResponse.json({ _id: result.insertedId, ...doc }, { status: 201 });
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as { code: number }).code === 11000) {
        throw new ApiError(409, "An entry for this IP already exists.");
      }
      throw err;
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
