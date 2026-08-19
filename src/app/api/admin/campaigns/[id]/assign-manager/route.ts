import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { schemas } from "@/lib/api/validate";
import type { Campaign, Character } from "@/lib/db/types";

const assignManagerSchema = z.object({
  characterId: schemas.objectId,
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id: campaignId } = await params;

    if (!ObjectId.isValid(campaignId)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, assignManagerSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { characterId } = parsed.data;

    const db = await getDb();
    const campaignOid = new ObjectId(campaignId);
    const characterOid = new ObjectId(characterId);

    // Verify campaign exists
    const campaign = await db.collection<Campaign>("campaigns").findOne({ _id: campaignOid });

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    // Verify character exists
    const character = await db.collection<Character>("characters").findOne({ _id: characterOid });

    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    // Assign manager. Admin assignment REPLACES the roster with a single
    // manager rather than appending — it is an override tool, and leaving a
    // partially-overridden list would be more confusing than a clean reset.
    // Legacy pair stays mirrored to managers[0] (see campaigns/access.ts).
    const now = new Date();
    await db.collection<Campaign>("campaigns").updateOne(
      { _id: campaignOid },
      {
        $set: {
          managers: [{ userId: character.userId, characterId: character._id, appointedAt: now }],
          managerId: character.userId,
          managerCharacterId: character._id,
          updatedAt: now,
        },
      }
    );

    return NextResponse.json({
      success: true,
      campaign: {
        id: campaignOid.toString(),
        managerId: character.userId.toString(),
        managerCharacterId: character._id.toString(),
        managerName: character.name,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { id: campaignId } = await params;

    if (!ObjectId.isValid(campaignId)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const campaignOid = new ObjectId(campaignId);

    await db.collection<Campaign>("campaigns").updateOne(
      { _id: campaignOid },
      {
        $set: {
          managers: [],
          managerId: null,
          managerCharacterId: null,
          updatedAt: new Date(),
        },
      }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
