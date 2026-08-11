import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import type { Corporation } from "@/lib/db/types/corporation";
import { getImperialTitle } from "@/lib/imperial";
import { fetchBordersByUserIds } from "@/lib/db/patreonBorders";

/**
 * GET /api/imperial-characters/[id] — Fetch imperial character by sequential ID.
 * Auth: none (public profile).
 * Errors: 400 (invalid ID), 404 (not found).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sequentialId = parseInt(id, 10);
    if (isNaN(sequentialId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    const db = await getDb();
    const imperial = await db
      .collection<ImperialCharacter>("imperialCharacters")
      .findOne({ sequentialId });

    if (!imperial) {
      return NextResponse.json({ error: "Imperial character not found" }, { status: 404 });
    }

    const title = getImperialTitle(imperial.countryId, imperial.gender);

    // Fetch corporations owned by this imperial character
    const corporations = await db
      .collection<Corporation>("corporations")
      .find({ ceoId: imperial._id, ceoType: "imperial" })
      .project({ name: 1, type: 1, sequentialId: 1, sharePrice: 1 })
      .toArray();

    // Fetch border info from user's patreon settings
    const borderMap = await fetchBordersByUserIds(db, [imperial.userId]);
    const userBorder = borderMap.get(imperial.userId.toString());

    return NextResponse.json({
      imperial: {
        id: imperial._id.toString(),
        name: imperial.name,
        title,
        fullName: `${title} ${imperial.name}`,
        gender: imperial.gender,
        countryId: imperial.countryId,
        homeState: imperial.homeState,
        sequentialId: imperial.sequentialId,
        royalHouse: imperial.royalHouse,
        coatOfArmsUrl: imperial.coatOfArmsUrl,
        avatarUrl: imperial.avatarUrl,
        profileHeaderImageUrl: imperial.profileHeaderImageUrl,
        borderKey: imperial.borderKey ?? userBorder?.borderKey ?? null,
        tintColor: imperial.tintColor ?? userBorder?.tintColor ?? null,
        bio: imperial.bio,
        campaignSongUrl: imperial.campaignSongUrl,
        campaignSongAutoplay: imperial.campaignSongAutoplay,
        corporations: corporations.map((c) => ({
          id: c._id.toString(),
          name: c.name,
          type: c.type,
          sequentialId: c.sequentialId,
          sharePrice: c.sharePrice,
        })),
        createdAt: imperial.createdAt,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
