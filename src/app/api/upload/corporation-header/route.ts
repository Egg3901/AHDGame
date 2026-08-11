import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import type { Corporation } from "@/lib/db/types";
import { optimizeImage, IMAGE_PRESETS } from "@/lib/imageOptimize";
import { isR2Enabled, uploadFile, deleteByPrefix } from "@/lib/r2";
import { parseFormData } from "@/lib/api/validate";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_SIZE = 4 * 1024 * 1024; // 4 MB (banner assets)

// POST /api/upload/corporation-header — Uploads a corporation hero banner image; the requester must be the active CEO of the corporation.
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 429
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
    const corpIdRaw = formData.get("corporationId");

    if (!corpIdRaw || typeof corpIdRaw !== "string") {
      return NextResponse.json({ error: "corporationId is required" }, { status: 400 });
    }

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
      return NextResponse.json({ error: "File must be under 4 MB." }, { status: 400 });
    }

    let corpObjectId: ObjectId;
    try {
      corpObjectId = new ObjectId(corpIdRaw);
    } catch {
      return NextResponse.json({ error: "Invalid corporation id" }, { status: 400 });
    }

    const db = await getDb();
    // Use userId (not ceoId via character lookup) so users with multiple characters
    // still pass auth — corporation.userId is authoritative for CEO ownership.
    const corporation = await db.collection<Corporation>("corporations").findOne({
      _id: corpObjectId,
      userId: new ObjectId(auth.user.userId),
      ceoVacant: { $ne: true },
    });
    if (!corporation) {
      return NextResponse.json(
        { error: "You are not the CEO of this corporation" },
        { status: 403 }
      );
    }

    // Optimize: resize and convert to WebP (GIFs preserved as-is)
    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const { buffer: optimized, ext } = await optimizeImage(
      rawBuffer,
      file.type,
      IMAGE_PRESETS.corporationHeader
    );

    const timestamp = Date.now();
    let url: string;

    if (isR2Enabled()) {
      try {
        await deleteByPrefix(`corporation-headers/${corporation._id.toString()}`);
      } catch {
        /* ignore */
      }

      url = await uploadFile(
        `corporation-headers/${corporation._id.toString()}-${timestamp}.${ext}`,
        optimized
      );
    } else {
      const fs = await import("fs/promises");
      const path = await import("path");

      const uploadsDir = path.join(process.cwd(), "uploads", "corporation-headers");
      await fs.mkdir(uploadsDir, { recursive: true });

      try {
        const files = await fs.readdir(uploadsDir);
        const corpPrefix = corporation._id.toString();
        const oldFiles = files.filter((f) => f.startsWith(corpPrefix));
        await Promise.all(oldFiles.map((f) => fs.unlink(path.join(uploadsDir, f)).catch(() => {})));
      } catch {
        /* ignore */
      }

      const filename = `${corporation._id.toString()}-${timestamp}.${ext}`;
      const filePath = path.join(uploadsDir, filename);
      await fs.writeFile(filePath, optimized);

      url = `/api/uploads/corporation-headers/${filename}`;
    }

    await db
      .collection<Corporation>("corporations")
      .updateOne(
        { _id: corporation._id },
        { $set: { headerImageUrl: url, updatedAt: new Date() } }
      );

    return NextResponse.json({ url });
  } catch (error) {
    return handleRouteError(error);
  }
}
