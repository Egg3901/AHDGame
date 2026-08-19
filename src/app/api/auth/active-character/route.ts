// PATCH — Switches the active character for an admin account
// Auth: requireAdmin
// Errors: 403 (not admin), 404 (character not found or not owned)

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { recordAudit } from "@/lib/audit/recordAudit";
import { getClientIp } from "@/lib/utils/network";
import { createHash } from "crypto";

const schema = z.object({
  characterId: schemas.objectId,
});

/** Partially redact an IP for display in forensic surfaces — never store the
 * raw address in `actionAuditLog.net` (plan §3.1 "net" doc-comment). */
function maskIp(ip: string): string {
  if (!ip || ip === "unknown") return "unknown";
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return `${parts.slice(0, 3).join(":")}::`;
  }
  const parts = ip.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.xxx` : "unknown";
}

/** One-way hash so alt-detection can still match "same IP" across rows
 * without a second copy of the raw address anywhere in the audit spine. */
function hashIp(ip: string): string | undefined {
  if (!ip || ip === "unknown") return undefined;
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

// GET — Switch active character via URL (used by navbar link)
export async function GET(request: Request) {
  try {
    const admin = await requireAdmin();
    if (!admin.ok) return admin.response;

    const url = new URL(request.url);
    const switchId = url.searchParams.get("switch");
    if (!switchId || !ObjectId.isValid(switchId)) {
      return NextResponse.json({ error: "Invalid character ID" }, { status: 400 });
    }

    const db = await getDb();
    const userId = new ObjectId(admin.admin.userId);
    const characterId = new ObjectId(switchId);
    const clientIp = await getClientIp();
    const net = { ipMasked: maskIp(clientIp), ipHash: hashIp(clientIp) };

    const character = await db.collection("characters").findOne({ _id: characterId, userId });
    if (!character) {
      recordAudit({
        source: "api",
        category: "auth",
        action: "auth.switch_character",
        subject: { type: "character", id: characterId },
        actor: { kind: "admin", userId, name: admin.admin.username },
        net,
        outcome: "rejected",
        reason: "character_not_found",
      });
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    await db
      .collection("users")
      .updateOne({ _id: userId }, { $set: { activeCharacterId: characterId } });

    recordAudit({
      source: "api",
      category: "auth",
      action: "auth.switch_character",
      subject: { type: "character", id: characterId, name: character.name },
      actor: { kind: "admin", userId, name: admin.admin.username },
      net,
      outcome: "ok",
    });

    // Redirect back to wherever they were
    const referer = request.headers.get("referer") || "/dashboard";
    return NextResponse.redirect(referer);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();
    if (!admin.ok) return admin.response;

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    const userId = new ObjectId(admin.admin.userId);
    const characterId = new ObjectId(parsed.data.characterId);
    const clientIp = await getClientIp();
    const net = { ipMasked: maskIp(clientIp), ipHash: hashIp(clientIp) };

    // Verify the character belongs to this admin
    const character = await db.collection("characters").findOne({ _id: characterId, userId });
    if (!character) {
      recordAudit({
        source: "api",
        category: "auth",
        action: "auth.switch_character",
        subject: { type: "character", id: characterId },
        actor: { kind: "admin", userId, name: admin.admin.username },
        net,
        outcome: "rejected",
        reason: "character_not_found",
      });
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    await db
      .collection("users")
      .updateOne({ _id: userId }, { $set: { activeCharacterId: characterId } });

    recordAudit({
      source: "api",
      category: "auth",
      action: "auth.switch_character",
      subject: { type: "character", id: characterId, name: character.name },
      actor: { kind: "admin", userId, name: admin.admin.username },
      net,
      outcome: "ok",
    });

    return NextResponse.json({ success: true, characterName: character.name });
  } catch (error) {
    return handleRouteError(error);
  }
}
