/**
 * POST /api/upload/news-image
 *
 * Multipart field "file" — JPEG/PNG/WebP, max 8 MB. Optimized to a wide hero (newsHero preset).
 * Stores on Vercel Blob as news-images/{characterId}-{timestamp}.webp or local uploads in dev.
 *
 * Returns { url } — absolute Blob URL or same-origin path /api/uploads/news-images/...
 * Auth: requireBasicAuth + character
 * Errors: 400, 401, 403, 429
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseFormData } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import type { Character } from "@/lib/db/types";
import { optimizeImage, IMAGE_PRESETS } from "@/lib/imageOptimize";
import { isR2Enabled, uploadFile } from "@/lib/r2";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_SIZE = 8 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 15, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseFormData(request);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const formData = parsed.data;

    const file = formData.get("file");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Only PNG, JPEG, and WebP images are allowed for news images." },
        { status: 400 }
      );
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "Image must be under 8 MB." }, { status: 400 });
    }

    const db = await getDb();
    const character = await db.collection<Character>("characters").findOne({
      userId: new ObjectId(auth.user.userId),
    });
    if (!character) {
      return NextResponse.json({ error: "Character required" }, { status: 403 });
    }

    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const { buffer: optimized, ext } = await optimizeImage(
      rawBuffer,
      file.type,
      IMAGE_PRESETS.newsHero
    );

    const timestamp = Date.now();
    const cid = character._id.toString();
    let url: string;

    if (isR2Enabled()) {
      url = await uploadFile(`news-images/${cid}-${timestamp}.${ext}`, optimized);
    } else {
      const fs = await import("fs/promises");
      const path = await import("path");
      const dir = path.join(process.cwd(), "uploads", "news-images");
      await fs.mkdir(dir, { recursive: true });
      const filename = `${cid}-${timestamp}.${ext}`;
      await fs.writeFile(path.join(dir, filename), optimized);
      url = `/api/uploads/news-images/${filename}`;
    }

    return NextResponse.json({ url });
  } catch (error) {
    return handleRouteError(error);
  }
}
