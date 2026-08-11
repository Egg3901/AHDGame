import { NextResponse } from "next/server";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { optimizeImage, IMAGE_PRESETS } from "@/lib/imageOptimize";
import { isR2Enabled, uploadFile } from "@/lib/r2";
import { parseFormData } from "@/lib/api/validate";

// Raster only — SVGs are stored as-is by optimizeImage and served same-origin,
// which would be a stored-XSS vector if a user visits the file URL directly.
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_SIZE = 2 * 1024 * 1024; // 2 MB

/** URL-safe fragment derived from the org's short name, for the stored filename. */
function safeSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "")
      .slice(0, 32) || "org"
  );
}

// POST /api/upload/org-logo — Uploads a custom international-organization logo during
// creation (multipart "file", optional "orgId" slug). Validates JPEG/PNG/WebP/GIF
// ≤ 2 MB, downscales to a 256² square, stores in R2 or local disk, and returns { url }.
// The URL is persisted on the org by the create route; this endpoint mutates nothing.
// Auth: requireBasicAuth. Errors: 400, 401, 429.
export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseFormData(request);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const formData = parsed.data;
    const file = formData.get("file");
    const orgIdRaw = formData.get("orgId");
    const slug = safeSlug(typeof orgIdRaw === "string" ? orgIdRaw : "");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Only JPEG, PNG, WebP, and GIF images are allowed." },
        { status: 400 }
      );
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File must be under 2 MB." }, { status: 400 });
    }

    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const { buffer: optimized, ext } = await optimizeImage(
      rawBuffer,
      file.type,
      IMAGE_PRESETS.partyLogo
    );

    const timestamp = Date.now();
    const filename = `org-logos/${slug}-${timestamp}.${ext}`;

    let url: string;
    if (isR2Enabled()) {
      url = await uploadFile(filename, optimized);
    } else {
      const fs = await import("fs/promises");
      const path = await import("path");
      const uploadsDir = path.join(process.cwd(), "uploads", "org-logos");
      await fs.mkdir(uploadsDir, { recursive: true });
      const local = `${slug}-${timestamp}.${ext}`;
      await fs.writeFile(path.join(uploadsDir, local), optimized);
      url = `/api/uploads/org-logos/${local}`;
    }

    return NextResponse.json({ url });
  } catch (error) {
    return handleRouteError(error);
  }
}
