// Dismiss all active flags for a character for 30 days.
// Auth: requireModerator
// Errors: 400, 403, 404

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { createModAuditLog } from "@/lib/modAuditLog";
import { z } from "zod";
import type { SuspiciousCharacter, SuppressedFlag } from "@/lib/db/types/activityLog";

const schema = z.object({
  note: z.string().max(500).optional(),
  /** When true, move the entry to the resolved pool permanently instead of a 30-day suppression. */
  permanent: z.boolean().optional(),
});

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ characterId: string }> }
) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;
    const { user: moderator } = auth;

    const { characterId } = await params;
    if (!/^[0-9a-f]{24}$/i.test(characterId)) {
      return NextResponse.json({ error: "Invalid characterId" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const isPermanent = parsed.data.permanent === true;

    const db = await getDb();
    const col = db.collection<SuspiciousCharacter>("suspiciousCharacters");
    const charOid = new ObjectId(characterId);

    const existing = await col.findOne({ characterId: charOid });
    if (!existing) throw notFound("No suspicious record for this character");

    const now = new Date();

    if (isPermanent) {
      await col.updateOne(
        { characterId: charOid },
        {
          $set: {
            flags: [],
            flagCount: 0,
            dismissed: true,
            dismissedAt: now,
            dismissedByAdminId: new ObjectId(moderator.userId),
            dismissNote: parsed.data.note,
            pool: "resolved",
            lastUpdated: now,
          },
          $unset: { suppressedFlags: "" },
        }
      );
    } else {
      const suppressUntil = new Date(Date.now() + THIRTY_DAYS_MS);
      const newSuppressed: SuppressedFlag[] = [
        ...(existing.suppressedFlags ?? []).filter((sf) => sf.suppressedUntil > now),
        ...existing.flags.map((f) => ({
          type: f.type,
          suppressedUntil: suppressUntil,
        })),
      ];

      const suppMap = new Map<string, SuppressedFlag>();
      for (const sf of newSuppressed) {
        const prev = suppMap.get(sf.type);
        if (!prev || sf.suppressedUntil > prev.suppressedUntil) {
          suppMap.set(sf.type, sf);
        }
      }

      await col.updateOne(
        { characterId: charOid },
        {
          $set: {
            flags: [],
            flagCount: 0,
            dismissed: true,
            dismissedAt: now,
            dismissedByAdminId: new ObjectId(moderator.userId),
            dismissNote: parsed.data.note,
            suppressedFlags: [...suppMap.values()],
            lastUpdated: now,
          },
        }
      );
    }

    const actionLabel = isPermanent ? "resolved_suspicious" : "dismiss_suspicious";
    await createModAuditLog({
      moderatorId: moderator.userId,
      moderatorName: moderator.username,
      action: actionLabel,
      details: `${isPermanent ? "Permanently resolved" : "Dismissed"} suspicious flags for character ${characterId}${parsed.data.note ? `. Note: ${parsed.data.note}` : ""}`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
