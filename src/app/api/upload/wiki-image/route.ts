/**
 * POST /api/upload/wiki-image
 *
 * Multipart field "file" — PNG/JPEG/WebP/GIF, max 8 MB. Resized to fit 1600×1600
 * and converted to WebP (GIFs preserved as-is for animation).
 * Stores on Vercel Blob as wiki-images/{userId}-{timestamp}.{ext} or in local
 * uploads/wiki-images/ during development.
 *
 * Returns { url } — absolute Blob URL or same-origin /api/uploads/wiki-images/...
 * Auth: requireAuthWithCharacter (authenticated user with character can upload for their own wiki pages)
 * Errors: 400, 401, 429
 */
import { NextResponse } from "next/server";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseFormData } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { optimizeImage, IMAGE_PRESETS } from "@/lib/imageOptimize";
import { isR2Enabled, uploadFile } from "@/lib/r2";
import { checkWikiDisabled } from "@/lib/api/wikiGuard";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_SIZE = 8 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const blocked = await checkWikiDisabled();
    if (blocked) return blocked;

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60_000);
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
        { error: "Only PNG, JPEG, WebP, and GIF images are allowed." },
        { status: 400 }
      );
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "Image must be under 8 MB." }, { status: 400 });
    }

    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const { buffer: optimized, ext } = await optimizeImage(
      rawBuffer,
      file.type,
      IMAGE_PRESETS.wikiImage
    );

    const timestamp = Date.now();
    const uid = auth.user.userId;
    let url: string;

    if (isR2Enabled()) {
      url = await uploadFile(`wiki-images/${uid}-${timestamp}.${ext}`, optimized);
    } else {
      const fs = await import("fs/promises");
      const path = await import("path");
      const dir = path.join(process.cwd(), "uploads", "wiki-images");
      await fs.mkdir(dir, { recursive: true });
      const filename = `${uid}-${timestamp}.${ext}`;
      await fs.writeFile(path.join(dir, filename), optimized);
      url = `/api/uploads/wiki-images/${filename}`;
    }

    return NextResponse.json({ url });
  } catch (error) {
    return handleRouteError(error);
  }
}
