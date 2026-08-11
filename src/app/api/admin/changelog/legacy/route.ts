import fs from "fs";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { LEGACY_DEV_PATH } from "@/lib/changelog/paths";

// GET /api/admin/changelog/legacy — frozen pre-0.4.0 developer changelog markdown.
// Auth: requireAdmin
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const changelog = fs.readFileSync(LEGACY_DEV_PATH, "utf-8");
    return NextResponse.json({ changelog });
  } catch (error) {
    return handleRouteError(error);
  }
}
