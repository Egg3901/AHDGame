import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import type { Achievement } from "@/lib/db/types";
import { getAllAchievements } from "@/lib/achievements";
import { invalidateDefinitionsCache } from "@/lib/achievements/cache";

const createSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_]+$/, "Slug must be lowercase alphanumeric with underscores"),
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  icon: z.string().max(10),
  category: z.enum(["milestone", "election", "legislation", "social", "action", "special"]),
  order: z.number().int().min(0).optional(),
});

// GET /api/admin/achievements — Lists all achievements with how many characters have earned each one.
// Auth: requireAdmin
// Errors: 403
export const GET = withAdminAuth(async () => {
  try {
    const achievements = await getAllAchievements();
    const db = await getDb();

    const counts = await db
      .collection("characterAchievements")
      .aggregate<{ _id: ObjectId; count: number }>([
        { $group: { _id: "$achievementId", count: { $sum: 1 } } },
      ])
      .toArray();
    const countMap = new Map(counts.map((c) => [c._id.toString(), c.count]));

    const list = achievements.map((a) => ({
      id: a._id.toString(),
      slug: a.slug,
      name: a.name,
      description: a.description,
      icon: a.icon,
      category: a.category,
      triggerType: a.triggerType,
      order: a.order,
      earnedCount: countMap.get(a._id.toString()) ?? 0,
    }));

    return NextResponse.json({ achievements: list });
  } catch (error) {
    return handleRouteError(error);
  }
});

// POST /api/admin/achievements — Creates a new manual-only achievement definition.
// Auth: requireAdmin
// Errors: 400, 403, 409
export const POST = withAdminAuth(async (_auth, request: Request) => {
  try {
    const parsed = await parseJsonBody(request, createSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { slug, name, description, icon, category, order } = parsed.data;
    const db = await getDb();

    const existing = await db.collection<Achievement>("achievements").findOne({ slug });
    if (existing) {
      return NextResponse.json(
        { error: "Achievement with this slug already exists" },
        { status: 409 }
      );
    }

    const now = new Date();
    const achievement: Omit<Achievement, "_id"> = {
      slug,
      name,
      description,
      icon,
      category,
      triggerType: "manual",
      isHidden: false,
      order: order ?? 999,
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.collection<Achievement>("achievements").insertOne({
      ...achievement,
      _id: new ObjectId(),
    } as Achievement);

    invalidateDefinitionsCache();

    return NextResponse.json({
      success: true,
      id: result.insertedId.toString(),
      message: `Achievement "${name}" created.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
});
