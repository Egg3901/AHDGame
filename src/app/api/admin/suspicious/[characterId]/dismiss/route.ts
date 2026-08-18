// Dismiss all active flags for a character for 30 days.
// Auth: requireAdmin
// Errors: 400, 403, 404

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, notFound } from "@/lib/api/errors";
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
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

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
      // Move to resolved pool — permanently archived, never re-evaluated
      await col.updateOne(
        { characterId: charOid },
        {
          $set: {
            flags: [],
            flagCount: 0,
            dismissed: true,
            dismissedAt: now,
            dismissedByAdminId: new ObjectId(auth.admin.userId),
            dismissNote: parsed.data.note,
            pool: "resolved",
            lastUpdated: now,
          },
          $unset: { suppressedFlags: "" },
        }
      );
    } else {
      // Standard 30-day suppress
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
        const existing = suppMap.get(sf.type);
        if (!existing || sf.suppressedUntil > existing.suppressedUntil) {
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
            dismissedByAdminId: new ObjectId(auth.admin.userId),
            dismissNote: parsed.data.note,
            suppressedFlags: [...suppMap.values()],
            lastUpdated: now,
          },
        }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
