import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth, requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import {
  findCaucusBySlug,
  listCaucusPositions,
  countCaucusMembers,
  normaliseCaucusSlug,
  reclaimSlug,
} from "@/lib/db/caucusLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { buildPartyCaucusHealthSnapshot } from "@/lib/caucus/caucusHealth";
import type { Caucus, CaucusMembership } from "@/lib/db/types";
import type { Character } from "@/lib/db/types";
import { normalizeDiscordInviteUrl } from "@/lib/discord/invite";

// GET /api/country/[code]/parties/[id]/caucuses/[slug] — Detail view of a single caucus including policy positions
// Auth: requireAuth
// Errors: 400, 401, 404
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string; id: string; slug: string }> }
) {
  try {
    const { code, id, slug } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const party = await findPartyBySequentialId(db, id, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const character = auth.user.character;
    const isPartyMember =
      !!character &&
      character.party === String(party.sequentialId) &&
      character.countryId === countryId;
    if (!auth.user.isAdmin && !isPartyMember) {
      return NextResponse.json(
        { error: "Only party members may view caucus details." },
        { status: 403 }
      );
    }

    const partyId = String(party.sequentialId);
    const resolved = await findCaucusBySlug(db, countryId, partyId, slug);
    if (!resolved) {
      return NextResponse.json({ error: "Caucus not found" }, { status: 404 });
    }
    const { caucus, isRedirect } = resolved;

    const chairIds = [caucus.chairId, caucus.viceChairId].filter(
      (value): value is NonNullable<typeof value> => !!value
    );

    const [positions, counts, healthSnapshot, chairCharacters] = await Promise.all([
      listCaucusPositions(db, caucus._id),
      countCaucusMembers(db, caucus._id),
      buildPartyCaucusHealthSnapshot(db, countryId, partyId),
      chairIds.length > 0
        ? db
            .collection<Character>("characters")
            .find({ _id: { $in: chairIds } }, { projection: { _id: 1, name: 1 } })
            .toArray()
        : Promise.resolve([] as Character[]),
    ]);
    const health = healthSnapshot.caucuses.find((item) => item.caucusId === caucus._id.toString());
    const chairNameById = new Map(
      chairCharacters.map((character) => [character._id.toString(), character.name])
    );

    return NextResponse.json({
      requestedSlug: slug,
      canonicalSlug: caucus.slug,
      isRedirect,
      caucus: {
        id: caucus._id.toString(),
        slug: caucus.slug,
        partyId,
        countryId,
        name: caucus.name,
        description: caucus.description,
        color: caucus.color,
        discordInviteUrl: caucus.discordInviteUrl ?? null,
        chairId: caucus.chairId?.toString() ?? null,
        chairName: caucus.chairId
          ? (chairNameById.get(caucus.chairId.toString()) ?? "Unknown")
          : null,
        viceChairId: caucus.viceChairId?.toString() ?? null,
        viceChairName: caucus.viceChairId
          ? (chairNameById.get(caucus.viceChairId.toString()) ?? "Unknown")
          : null,
        whipMode: caucus.whipMode,
        treasury: caucus.treasury,
        taxRate: caucus.taxRate,
        motto: caucus.motto ?? null,
        lastElectedTurn: caucus.lastElectedTurn,
        nextElectionTurn: caucus.nextElectionTurn,
        termsServed: caucus.termsServed,
        createdAt: caucus.createdAt.toISOString(),
        updatedAt: caucus.updatedAt.toISOString(),
      },
      positions: positions.map((p) => ({
        id: p._id.toString(),
        topic: p.topic,
        stance: p.stance,
        note: p.note,
        weight: p.weight,
        sortOrder: p.sortOrder,
      })),
      memberCounts: counts,
      health: health ?? null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

const editSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a #RRGGBB hex value")
    .optional(),
  discordInviteUrl: z.union([z.string().trim().max(200), z.null()]).optional(),
  motto: z.string().trim().max(120).optional(),
  whipMode: z.enum(["free", "soft", "hard"]).optional(),
  taxRate: z.number().min(0).max(5).optional(),
});

// PATCH /api/country/[code]/parties/[id]/caucuses/[slug] — Chair-only edit of caucus settings
// Auth: requireAuthWithCharacter (must be the chair)
// Errors: 400, 401, 403, 404, 409
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string; slug: string }> }
) {
  try {
    const { code, id, slug } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, editSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const party = await findPartyBySequentialId(db, id, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }
    const partyId = String(party.sequentialId);

    const resolved = await findCaucusBySlug(db, countryId, partyId, slug);
    if (!resolved) {
      return NextResponse.json({ error: "Caucus not found" }, { status: 404 });
    }
    const { caucus } = resolved;

    if (!caucus.chairId || caucus.chairId.toString() !== auth.user.character._id.toString()) {
      return NextResponse.json(
        { error: "Only the caucus chair can edit caucus settings." },
        { status: 403 }
      );
    }

    const now = new Date();
    const updates: Partial<Caucus> = { updatedAt: now };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name.trim();
    if (parsed.data.description !== undefined) updates.description = parsed.data.description.trim();
    if (parsed.data.color !== undefined) updates.color = parsed.data.color;
    if (parsed.data.discordInviteUrl !== undefined) {
      const submittedDiscordInviteUrl = parsed.data.discordInviteUrl?.trim() ?? "";
      const normalizedDiscordInviteUrl = normalizeDiscordInviteUrl(submittedDiscordInviteUrl);
      if (submittedDiscordInviteUrl && !normalizedDiscordInviteUrl) {
        return NextResponse.json(
          { error: "Discord link must be a valid Discord invite URL." },
          { status: 400 }
        );
      }
      updates.discordInviteUrl = normalizedDiscordInviteUrl;
    }
    if (parsed.data.motto !== undefined) updates.motto = parsed.data.motto.trim() || undefined;
    if (parsed.data.whipMode !== undefined) updates.whipMode = parsed.data.whipMode;
    if (parsed.data.taxRate !== undefined) updates.taxRate = parsed.data.taxRate;

    // Rename ⇒ slug change (with previousSlugs append + reclaim sweep) when the
    // chair edits the name. Slug stays put if the chair only updated other fields.
    const renameOps: Record<string, unknown> = {};
    if (parsed.data.name && parsed.data.name.trim() !== caucus.name) {
      let newSlug: string;
      try {
        newSlug = normaliseCaucusSlug(parsed.data.name);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Invalid name";
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      if (newSlug !== caucus.slug) {
        // Active-slug collision check.
        const collision = await db.collection<Caucus>("caucuses").findOne({
          countryId,
          partyId,
          slug: newSlug,
          disbandedAt: null,
          _id: { $ne: caucus._id },
        });
        if (collision) {
          return NextResponse.json(
            {
              error: `Slug "${newSlug}" is already in use by ${collision.name}. Pick a different name.`,
            },
            { status: 409 }
          );
        }
        // Push the old slug onto previousSlugs and adopt the new one.
        await db.collection<Caucus>("caucuses").updateOne(
          { _id: caucus._id },
          {
            $addToSet: { previousSlugs: caucus.slug },
          }
        );
        renameOps["slug"] = newSlug;
        // Reclaim the new slug from any other caucus's previousSlugs.
        await reclaimSlug(db, countryId, partyId, newSlug, caucus._id);
      }
    }

    await db
      .collection<Caucus>("caucuses")
      .updateOne(
        { _id: caucus._id },
        { $set: { ...updates, ...renameOps } as Record<string, unknown> }
      );

    return NextResponse.json({
      success: true,
      slug: (renameOps.slug as string | undefined) ?? caucus.slug,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// DELETE /api/country/[code]/parties/[id]/caucuses/[slug] — Chair-only soft-disband
// Auth: requireAuthWithCharacter (must be the chair)
// Errors: 400, 401, 403, 404
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ code: string; id: string; slug: string }> }
) {
  try {
    const { code, id, slug } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const party = await findPartyBySequentialId(db, id, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }
    const partyId = String(party.sequentialId);

    const resolved = await findCaucusBySlug(db, countryId, partyId, slug);
    if (!resolved) {
      return NextResponse.json({ error: "Caucus not found" }, { status: 404 });
    }
    const { caucus } = resolved;

    if (!caucus.chairId || caucus.chairId.toString() !== auth.user.character._id.toString()) {
      return NextResponse.json(
        { error: "Only the caucus chair can disband the caucus." },
        { status: 403 }
      );
    }

    const now = new Date();
    // Soft-delete the caucus. The slug becomes immediately reclaimable —
    // findCaucusBySlug only matches docs where disbandedAt is null.
    await db
      .collection<Caucus>("caucuses")
      .updateOne({ _id: caucus._id }, { $set: { disbandedAt: now, updatedAt: now } });

    // Mark all active memberships as removed and clear factionId on player members.
    const activeMemberships = await db
      .collection<CaucusMembership>("caucusMemberships")
      .find({ caucusId: caucus._id, status: "active" })
      .toArray();
    if (activeMemberships.length > 0) {
      await db
        .collection<CaucusMembership>("caucusMemberships")
        .updateMany(
          { caucusId: caucus._id, status: "active" },
          { $set: { status: "removed", leftAt: now, updatedAt: now } }
        );
      const characterIds = activeMemberships
        .filter((m) => m.memberType === "character")
        .map((m) => m.memberId);
      const nppIds = activeMemberships.filter((m) => m.memberType === "npp").map((m) => m.memberId);
      if (characterIds.length > 0) {
        await db
          .collection("characters")
          .updateMany(
            { _id: { $in: characterIds }, factionId: caucus._id },
            { $set: { factionId: null, updatedAt: now } }
          );
      }
      if (nppIds.length > 0) {
        await db
          .collection("npps")
          .updateMany(
            { _id: { $in: nppIds }, factionId: caucus._id },
            { $set: { factionId: null, updatedAt: now } }
          );
      }
    }

    return NextResponse.json({ success: true, disbanded: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
