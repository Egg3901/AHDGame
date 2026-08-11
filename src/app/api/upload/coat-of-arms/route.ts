import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import type { User } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { optimizeImage, IMAGE_PRESETS } from "@/lib/imageOptimize";
import { isR2Enabled, uploadFile, deleteByPrefix } from "@/lib/r2";
import { parseFormData } from "@/lib/api/validate";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SIZE = 2 * 1024 * 1024; // 2 MB

/**
 * POST /api/upload/coat-of-arms — Uploads a coat of arms image for an imperial character.
 * Auth: requireBasicAuth + must have an active imperial character.
 * Errors: 400 (no file, invalid type, no imperial char), 401, 429.
 */
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
        { error: "Only JPEG, PNG, and WebP images are allowed." },
        { status: 400 }
      );
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File must be under 2 MB." }, { status: 400 });
    }

    const db = await getDb();
    const user = await db.collection<User>("users").findOne({ _id: new ObjectId(authUser.userId) });

    if (!user?.activeImperialCharacterId) {
      return NextResponse.json(
        { error: "No imperial character found for this account" },
        { status: 400 }
      );
    }

    const imperial = await db
      .collection<ImperialCharacter>("imperialCharacters")
      .findOne({ _id: user.activeImperialCharacterId, userId: new ObjectId(authUser.userId) });

    if (!imperial) {
      return NextResponse.json({ error: "Imperial character not found" }, { status: 400 });
    }

    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const { buffer: optimized, ext } = await optimizeImage(
      rawBuffer,
      file.type,
      IMAGE_PRESETS.coatOfArms
    );

    const timestamp = Date.now();
    let url: string;

    if (isR2Enabled()) {
      try {
        await deleteByPrefix(`coat-of-arms/${imperial._id.toString()}`);
      } catch {
        /* ignore */
      }

      url = await uploadFile(
        `coat-of-arms/${imperial._id.toString()}-${timestamp}.${ext}`,
        optimized
      );
    } else {
      const fs = await import("fs/promises");
      const path = await import("path");

      const uploadsDir = path.join(process.cwd(), "uploads", "coat-of-arms");
      await fs.mkdir(uploadsDir, { recursive: true });

      try {
        const files = await fs.readdir(uploadsDir);
        const charPrefix = imperial._id.toString();
        const oldFiles = files.filter((f) => f.startsWith(charPrefix));
        await Promise.all(oldFiles.map((f) => fs.unlink(path.join(uploadsDir, f)).catch(() => {})));
      } catch {
        /* ignore */
      }

      const filename = `${imperial._id.toString()}-${timestamp}.${ext}`;
      const filePath = path.join(uploadsDir, filename);
      await fs.writeFile(filePath, optimized);

      url = `/api/uploads/coat-of-arms/${filename}`;
    }

    await db
      .collection<ImperialCharacter>("imperialCharacters")
      .updateOne({ _id: imperial._id }, { $set: { coatOfArmsUrl: url, updatedAt: new Date() } });

    return NextResponse.json({ url });
  } catch (error) {
    return handleRouteError(error);
  }
}
