import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { handleRouteError } from "@/lib/api/errors";
import { join } from "path";
import type { NPP } from "@/lib/db/types";
import type { Db } from "@/lib/mongodb";

export async function handleBackfillImages(db: Db): Promise<NextResponse> {
  try {
    const filePath = join(process.cwd(), "src", "data", "npp-images.json");
    let fileContent: string;
    try {
      fileContent = await readFile(filePath, "utf-8");
    } catch {
      return NextResponse.json({ error: "Image cache not found." }, { status: 404 });
    }

    const data = JSON.parse(fileContent);
    const images = data.images || [];

    if (images.length === 0) {
      return NextResponse.json({ error: "No images in cache." }, { status: 400 });
    }

    const nppsWithoutAvatar = await db
      .collection<NPP>("npps")
      .find({ retiredAt: null, avatarUrl: { $exists: false } })
      .toArray();

    if (nppsWithoutAvatar.length === 0) {
      return NextResponse.json({ message: "No NPPs need backfilling.", updated: 0 });
    }

    let updatedCount = 0;
    for (const npp of nppsWithoutAvatar) {
      const randomImage = images[Math.floor(Math.random() * images.length)];
      await db
        .collection<NPP>("npps")
        .updateOne(
          { _id: npp._id },
          { $set: { avatarUrl: randomImage.thumbUrl, updatedAt: new Date() } }
        );
      updatedCount++;
    }

    return NextResponse.json({
      message: `Successfully backfilled avatars for ${updatedCount} NPPs.`,
      updated: updatedCount,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
