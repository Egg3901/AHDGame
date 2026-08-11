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
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_SIZE = 2 * 1024 * 1024; // 2 MB

// POST /api/upload/corporation-logo — Uploads a corporation logo image; the requester must be the active CEO of a corporation.
// Auth: requireBasicAuth
// Errors: 400, 401, 429
export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const authUser = auth.user;

    const rateLimit = checkRateLimit(authUser.userId, 10, 60000);
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
        { error: "Only JPEG, PNG, WebP, and GIF images are allowed." },
        { status: 400 }
      );
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File must be under 2 MB." }, { status: 400 });
    }

    const db = await getDb();

    // Prefer the explicit target. A user can hold more than one corporation
    // record (founding again after a dissolution or a cooldown reset leaves the
    // earlier document in place), and an unscoped findOne then picks an
    // arbitrary one — so the logo silently lands on the wrong corporation and
    // the upload looks like it did nothing.
    const corporationId = formData.get("corporationId");
    let corporation: Corporation | null;

    if (typeof corporationId === "string" && corporationId.length > 0) {
      const resolved = await resolveCorporation(db, corporationId);
      if (!resolved.ok) return resolved.response;
      const ceoCheck = requireCeo(resolved.corporation, authUser.userId);
      if (ceoCheck) return ceoCheck;
      corporation = resolved.corporation;
    } else {
      // Legacy callers that send no target. Use userId directly — consistent
      // with requireCeo, avoids wrong-character lookup for users who have
      // multiple characters.
      corporation = await db.collection<Corporation>("corporations").findOne({
        userId: new ObjectId(authUser.userId),
        ceoVacant: { $ne: true },
      });
    }

    if (!corporation) {
      return NextResponse.json({ error: "You don't own a corporation" }, { status: 400 });
    }

    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const { buffer: optimized, ext } = await optimizeImage(
      rawBuffer,
      file.type,
      IMAGE_PRESETS.corporationLogo
    );

    const timestamp = Date.now();
    let url: string;

    if (isR2Enabled()) {
      try {
        await deleteByPrefix(`corporation-logos/${corporation._id.toString()}`);
      } catch {
        /* ignore delete errors */
      }

      url = await uploadFile(
        `corporation-logos/${corporation._id.toString()}-${timestamp}.${ext}`,
        optimized
      );
    } else {
      const fs = await import("fs/promises");
      const path = await import("path");

      const uploadsDir = path.join(process.cwd(), "uploads", "corporation-logos");
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

      url = `/api/uploads/corporation-logos/${filename}`;
    }

    // Update corporation record
    await db
      .collection<Corporation>("corporations")
      .updateOne({ _id: corporation._id }, { $set: { logoUrl: url, updatedAt: new Date() } });

    return NextResponse.json({ url });
  } catch (error) {
    return handleRouteError(error);
  }
}
