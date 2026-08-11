import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import type { Character } from "@/lib/db/types";
import type { User } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { optimizeImage, IMAGE_PRESETS } from "@/lib/imageOptimize";
import { isR2Enabled, uploadFile, deleteByPrefix } from "@/lib/r2";
import { parseFormData } from "@/lib/api/validate";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_SIZE = 4 * 1024 * 1024; // 4 MB (wider hero assets)

// POST /api/upload/profile-header — Uploads a character profile banner image (max 4 MB) and stores it in Cloudflare R2 or local disk.
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
      return NextResponse.json({ error: "File must be under 4 MB." }, { status: 400 });
    }

    const db = await getDb();
    const user = await db.collection<User>("users").findOne({ _id: new ObjectId(authUser.userId) });
    const isImperialMode = user?.activeCharacterType === "imperial";

    // Resolve target: imperial character or regular character
    let targetId: ObjectId;
    let targetCollection: "characters" | "imperialCharacters";

    if (isImperialMode && user?.activeImperialCharacterId) {
      const imperial = await db
        .collection<ImperialCharacter>("imperialCharacters")
        .findOne({ _id: user.activeImperialCharacterId, userId: new ObjectId(authUser.userId) });
      if (!imperial) {
        return NextResponse.json({ error: "No imperial character found" }, { status: 400 });
      }
      targetId = imperial._id;
      targetCollection = "imperialCharacters";
    } else {
      // Use activeCharacterId when set (multi-character accounts), fallback to userId lookup
      const characterQuery = user?.activeCharacterId
        ? { _id: user.activeCharacterId, userId: new ObjectId(authUser.userId) }
        : { userId: new ObjectId(authUser.userId) };
      const character = await db.collection<Character>("characters").findOne(characterQuery);
      if (!character) {
        return NextResponse.json({ error: "No character found" }, { status: 400 });
      }
      targetId = character._id;
      targetCollection = "characters";
    }

    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const { buffer: optimized, ext } = await optimizeImage(
      rawBuffer,
      file.type,
      IMAGE_PRESETS.profileHeader
    );

    const timestamp = Date.now();
    let url: string;

    if (isR2Enabled()) {
      try {
        await deleteByPrefix(`profile-headers/${targetId.toString()}`);
      } catch {
        /* ignore */
      }

      url = await uploadFile(
        `profile-headers/${targetId.toString()}-${timestamp}.${ext}`,
        optimized
      );
    } else {
      const fs = await import("fs/promises");
      const path = await import("path");

      const uploadsDir = path.join(process.cwd(), "uploads", "profile-headers");
      await fs.mkdir(uploadsDir, { recursive: true });

      try {
        const files = await fs.readdir(uploadsDir);
        const charPrefix = targetId.toString();
        const oldFiles = files.filter((f) => f.startsWith(charPrefix));
        await Promise.all(oldFiles.map((f) => fs.unlink(path.join(uploadsDir, f)).catch(() => {})));
      } catch {
        /* ignore */
      }

      const filename = `${targetId.toString()}-${timestamp}.${ext}`;
      const filePath = path.join(uploadsDir, filename);
      await fs.writeFile(filePath, optimized);

      url = `/api/uploads/profile-headers/${filename}`;
    }

    await db
      .collection(targetCollection)
      .updateOne(
        { _id: targetId },
        { $set: { profileHeaderImageUrl: url, updatedAt: new Date() } }
      );

    return NextResponse.json({ url });
  } catch (error) {
    return handleRouteError(error);
  }
}
