import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isR2Enabled, uploadFile, deleteByPrefix } from "@/lib/r2";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { parseFormData } from "@/lib/api/validate";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_SIZE = 4 * 1024 * 1024; // 4 MB

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

// POST /api/country/[code]/executive/cabinet/[positionId]/banner
// Uploads a cabinet office hero banner image. Writes bannerImageUrl on the
// unified cabinetMembers document so the office page (which reads from that
// collection) picks up the new banner.
// Auth: requireAuth — requester must be the cabinet position holder or admin.
// Errors: 400 (invalid country, no file, wrong type, too large), 401, 403, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { code, positionId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }

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
    const membersCol = getCabinetMembersCollection(db);
    const member = await membersCol.findOne({ countryId, positionId });

    // Refuse uploads for vacant positions — the office page reads bannerImageUrl
    // off the member doc, so without one there's nowhere to persist the URL and
    // the uploaded file would be stranded in R2.
    if (!member) {
      return NextResponse.json(
        { error: "No cabinet member holds this position." },
        { status: 404 }
      );
    }

    const isHolder =
      !!auth.user.character &&
      !!member.characterId &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return NextResponse.json(
        { error: "Only the cabinet holder or admin can upload a banner" },
        { status: 403 }
      );
    }

    const ext = file.type.split("/")[1] === "jpeg" ? "jpg" : file.type.split("/")[1];
    const timestamp = Date.now();
    let url: string;

    if (isR2Enabled()) {
      try {
        await deleteByPrefix(`cabinet-banners/${positionId}`);
      } catch {
        /* ignore */
      }

      url = await uploadFile(
        `cabinet-banners/${positionId}-${timestamp}.${ext}`,
        Buffer.from(await file.arrayBuffer())
      );
    } else {
      const fs = await import("fs/promises");
      const path = await import("path");

      const uploadsDir = path.join(process.cwd(), "uploads", "cabinet-banners");
      await fs.mkdir(uploadsDir, { recursive: true });

      try {
        const files = await fs.readdir(uploadsDir);
        const oldFiles = files.filter((f) => f.startsWith(positionId));
        await Promise.all(oldFiles.map((f) => fs.unlink(path.join(uploadsDir, f)).catch(() => {})));
      } catch {
        /* ignore */
      }

      const filename = `${positionId}-${timestamp}.${ext}`;
      const filePath = path.join(uploadsDir, filename);
      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(filePath, buffer);

      url = `/api/uploads/cabinet-banners/${filename}`;
    }

    await membersCol.updateOne(
      { _id: member._id },
      { $set: { bannerImageUrl: url, updatedAt: new Date() } }
    );

    return NextResponse.json({ url });
  } catch (error) {
    return handleRouteError(error);
  }
}
