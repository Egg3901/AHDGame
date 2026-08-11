import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { loadDevPosts } from "@/lib/changelog/posts";

// GET /api/admin/changelog — returns structured dev posts (v0.4.0+).
// Auth: requireAdmin
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const posts = loadDevPosts();
    return NextResponse.json({ posts });
  } catch (error) {
    return handleRouteError(error);
  }
}
