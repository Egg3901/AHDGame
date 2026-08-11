import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getAllAchievements } from "@/lib/achievements";

// GET /api/achievements — Returns all achievement definitions available in the game.
// Auth: public
// Errors: (none)
export async function GET() {
  try {
    const achievements = await getAllAchievements();
    return NextResponse.json(
      achievements.map((a) => ({
        id: a._id.toString(),
        slug: a.slug,
        name: a.name,
        description: a.description,
        icon: a.icon,
        category: a.category,
        order: a.order,
      }))
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
