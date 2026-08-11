/**
 * POST /api/feedback/screenshot
 *
 * Accepts a multipart form upload with field "file" (PNG/JPEG image).
 * - On R2 (CLOUDFLARE_R2_ACCESS_KEY_ID set): uploads to Cloudflare R2 under feedback-screenshots/
 * - Locally: writes to /uploads/feedback-screenshots/<timestamp>.png
 *
 * Returns { url } of the stored screenshot.
 * Auth: requires a logged-in user (rate limiting inherited from feedback flow).
 */
import { NextResponse } from "next/server";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseFormData } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isR2Enabled, uploadFile } from "@/lib/r2";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_SIZE = 8 * 1024 * 1024; // 8 MB

// POST /api/feedback/screenshot — Upload a screenshot image for a feedback submission.
// Auth: requireBasicAuth
// Errors: 400, 401, 429
export async function POST(request: Request) {
  const auth = await requireBasicAuth();
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const rateLimit = checkRateLimit(user.userId, 10, 60000);
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
      { error: "Only PNG, JPEG, and WebP images are allowed." },
      { status: 400 }
    );
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Screenshot must be under 8 MB." }, { status: 400 });
  }

  const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : "png";
  const timestamp = Date.now();
  const userId = user.userId.toString().slice(-8);

  try {
    let url: string;

    if (isR2Enabled()) {
      url = await uploadFile(
        `feedback-screenshots/${timestamp}-${userId}.${ext}`,
        Buffer.from(await file.arrayBuffer())
      );
    } else {
      const fs = await import("fs/promises");
      const path = await import("path");

      const dir = path.join(process.cwd(), "uploads", "feedback-screenshots");
      await fs.mkdir(dir, { recursive: true });

      const filename = `${timestamp}-${userId}.${ext}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(path.join(dir, filename), buffer);

      url = `/api/uploads/feedback-screenshots/${filename}`;
    }

    return NextResponse.json({ url });
  } catch (err) {
    return handleRouteError(err);
  }
}
