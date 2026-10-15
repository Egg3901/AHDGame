import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { loadPublicSubsidiaryGroups } from "@/lib/corporations/groups/publicListing";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const db = await getDb();
    const { id } = await params;
    const resolved = await resolveCorporation(db, id, {
      userId: 1,
      ceoId: 1,
      ceoType: 1,
      ceoVacant: 1,
      countryOwnerId: 1,
      suspended: 1,
    });
    if (!resolved.ok) return resolved.response;
    const corporationId = resolved.corporation._id.toString();
    const groups = await loadPublicSubsidiaryGroups(db, corporationId);
    const group =
      groups.find((g) => g.id === corporationId) ??
      groups.find((g) => !g.parentGroupId && g.members.some((m) => m.id === corporationId));
    if (!group) return errorResponse(404, "Subsidiary group not found.");
    // Preserve member CEOs' existing access to their own participation and finances.
    // A nested listing stays public: management still belongs to the existing top-level group.
    const members =
      group.parentGroupId || !group.managementAvailable
        ? []
        : await db
            .collection<Corporation>("corporations")
            .find(
              { _id: { $in: group.members.map((m) => new ObjectId(m.id)) } },
              {
                projection: {
                  userId: 1,
                  ceoId: 1,
                  ceoType: 1,
                  ceoVacant: 1,
                  countryOwnerId: 1,
                  suspended: 1,
                },
              }
            )
            .toArray();
    const canViewManagement = members.some(
      (c) => !requireCeo(c, auth.user.userId) && c.ceoType !== "npp" && !c.countryOwnerId
    );
    return NextResponse.json({ group, canViewManagement });
  } catch (error) {
    return handleRouteError(error);
  }
}
