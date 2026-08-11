import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseFormData } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import type { Character } from "@/lib/db/types";
import type { User } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { canUploadGifAvatar } from "@/lib/patreon/avatarUpload";
import { optimizeImage, IMAGE_PRESETS } from "@/lib/imageOptimize";
import { isR2Enabled, uploadFile, deleteByPrefix } from "@/lib/r2";
import { toAbsoluteUploadUrl } from "@/lib/discord";
import { getBaseUrl } from "@/lib/utils/network";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_SIZE = 2 * 1024 * 1024; // 2 MB

// POST /api/upload/avatar — Uploads a character avatar image (JPEG/PNG/WebP/GIF, max 2 MB) and stores it in Cloudflare R2 or local disk.
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

    // Admins bypass GIF restriction; otherwise check Patreon tier
    const isAdmin = user?.role === "admin" || user?.isAdmin;
    if (
      file.type === "image/gif" &&
      !isAdmin &&
      !canUploadGifAvatar(user?.patreonTier ?? null, user?.patreonExpiresAt ?? null)
    ) {
      return NextResponse.json(
        {
          error:
            "Animated GIF profile pictures require an active Supporter or Supporter+ subscription.",
        },
        { status: 403 }
      );
    }

    // Optimize: resize and convert to WebP (GIFs preserved as-is)
    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const { buffer: optimized, ext } = await optimizeImage(
      rawBuffer,
      file.type,
      IMAGE_PRESETS.avatar
    );

    const timestamp = Date.now();
    let url: string;

    if (isR2Enabled()) {
      // ── Cloudflare R2 ────────────────────────────────────────────────────────
      try {
        await deleteByPrefix(`avatars/${targetId.toString()}`);
      } catch {
        /* ignore delete errors */
      }

      url = await uploadFile(`avatars/${targetId.toString()}-${timestamp}.${ext}`, optimized);
    } else {
      // ── Local storage ────────────────────────────────────────────────────────
      const fs = await import("fs/promises");
      const path = await import("path");

      const uploadsDir = path.join(process.cwd(), "uploads", "avatars");
      await fs.mkdir(uploadsDir, { recursive: true });

      // Remove ALL old avatar files for this character (handles format changes)
      try {
        const files = await fs.readdir(uploadsDir);
        const charPrefix = targetId.toString();
        const oldFiles = files.filter((f) => f.startsWith(charPrefix));
        await Promise.all(oldFiles.map((f) => fs.unlink(path.join(uploadsDir, f)).catch(() => {})));
      } catch {
        /* ignore */
      }

      // Use timestamp in filename for cache-busting
      const filename = `${targetId.toString()}-${timestamp}.${ext}`;
      const filePath = path.join(uploadsDir, filename);
      await fs.writeFile(filePath, optimized);

      // Store an absolute URL so external consumers (e.g. the Discord bot's
      // embed thumbnails) can fetch it — relative paths are rejected by
      // Discord's URL validator. Matches the absolute URLs that R2 mode stores.
      const relativePath = `/api/uploads/avatars/${filename}`;
      url = toAbsoluteUploadUrl(relativePath, getBaseUrl(request)) ?? relativePath;
    }

    // Update the correct collection
    await db
      .collection(targetCollection)
      .updateOne({ _id: targetId }, { $set: { avatarUrl: url, updatedAt: new Date() } });

    return NextResponse.json({ url });
  } catch (error) {
    return handleRouteError(error);
  }
}
