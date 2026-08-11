import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth, requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import {
  listCaucusesForParty,
  countCaucusMembers,
  normaliseCaucusSlug,
  reclaimSlug,
} from "@/lib/db/caucusLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { buildPartyCaucusHealthSnapshot } from "@/lib/caucus/caucusHealth";
import { cleanupCaucusParticipationForCharacters } from "@/lib/caucus/cleanupCaucusParticipationForCharacters";
import type { Caucus, CaucusMembership } from "@/lib/db/types";
import type { Character } from "@/lib/db/types";

// GET /api/country/[code]/parties/[id]/caucuses — List caucuses for a party with member counts
// Auth: requireAuth
// Errors: 400, 401, 404
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
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
    const [caucuses, healthSnapshot] = await Promise.all([
      listCaucusesForParty(db, countryId, partyId),
      buildPartyCaucusHealthSnapshot(db, countryId, partyId),
    ]);
    const healthByCaucusId = new Map(healthSnapshot.caucuses.map((item) => [item.caucusId, item]));
    const chairIds = caucuses
      .flatMap((caucus) => [caucus.chairId, caucus.viceChairId])
      .filter((value): value is NonNullable<typeof value> => !!value);
    const chairs =
      chairIds.length > 0
        ? await db
            .collection<Character>("characters")
            .find({ _id: { $in: chairIds } }, { projection: { _id: 1, name: 1 } })
            .toArray()
        : [];
    const chairNameById = new Map(
      chairs.map((character) => [character._id.toString(), character.name])
    );

    const items = await Promise.all(
      caucuses.map(async (c) => {
        const counts = await countCaucusMembers(db, c._id);
        const health = healthByCaucusId.get(c._id.toString());
        return {
          id: c._id.toString(),
          slug: c.slug,
          name: c.name,
          description: c.description,
          color: c.color,
          discordInviteUrl: c.discordInviteUrl ?? null,
          chairId: c.chairId?.toString() ?? null,
          chairName: c.chairId ? (chairNameById.get(c.chairId.toString()) ?? "Unknown") : null,
          viceChairId: c.viceChairId?.toString() ?? null,
          viceChairName: c.viceChairId
            ? (chairNameById.get(c.viceChairId.toString()) ?? "Unknown")
            : null,
          whipMode: c.whipMode,
          treasury: c.treasury,
          taxRate: c.taxRate,
          motto: c.motto ?? null,
          lastElectedTurn: c.lastElectedTurn,
          nextElectionTurn: c.nextElectionTurn,
          termsServed: c.termsServed,
          memberCounts: counts,
          createdAt: c.createdAt.toISOString(),
          health: health
            ? {
                statusLabel: health.statusLabel,
                statusReason: health.statusReason,
                activeDefianceCount: health.activeDefianceCount,
                atRiskCount: health.atRiskCount,
                recentJoinCount: health.recentJoinCount,
                recentLeaveCount: health.recentLeaveCount,
                recentForcedExitCount: health.recentForcedExitCount,
                electionStatus: health.election.status,
              }
            : null,
        };
      })
    );

    return NextResponse.json({ items });
  } catch (error) {
    return handleRouteError(error);
  }
}

const foundSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a #RRGGBB hex value")
    .optional(),
  motto: z.string().trim().max(120).optional(),
  whipMode: z.enum(["free", "soft", "hard"]).optional(),
  taxRate: z.number().min(0).max(5).optional(),
});

// POST /api/country/[code]/parties/[id]/caucuses — Found a new caucus inside the party
// Auth: requireAuthWithCharacter (must be a member of the party)
// Errors: 400, 401, 403, 404, 409
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, foundSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const party = await findPartyBySequentialId(db, id, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }
    const partyId = String(party.sequentialId);

    // Caucuses are a national-only structure. The character must already be a
    // member of this party — only party members can found a caucus inside it.
    if (auth.user.character.party !== partyId) {
      return NextResponse.json(
        { error: "Only party members can found a caucus inside their own party." },
        { status: 403 }
      );
    }

    // Founder can't already chair another active caucus in this party (one
    // caucus per chair, mirroring one caucus per member).
    const existingChair = await db.collection<Caucus>("caucuses").findOne({
      countryId,
      partyId,
      chairId: auth.user.character._id,
      disbandedAt: null,
    });
    if (existingChair) {
      return NextResponse.json(
        {
          error: `You already chair ${existingChair.name}. Step down before founding another caucus.`,
        },
        { status: 409 }
      );
    }

    // The character also can't already be a member of any other active caucus
    // in the party — one caucus per Character (Phase 1 invariant).
    //
    // Self-heal stale pointers left behind by older party-switch paths that
    // moved `character.party` without clearing caucus membership / factionId
    // (ticket #1030). If the pointed-at caucus is not an active caucus of
    // *this* party, drop the leftover membership and continue.
    if (auth.user.character.factionId) {
      const pointedCaucus = await db.collection<Caucus>("caucuses").findOne({
        _id: auth.user.character.factionId,
        disbandedAt: null,
      });
      const stillInThisParty =
        !!pointedCaucus &&
        pointedCaucus.countryId === countryId &&
        pointedCaucus.partyId === partyId;
      if (stillInThisParty) {
        return NextResponse.json(
          {
            error: "Leave your current caucus before founding a new one.",
          },
          { status: 409 }
        );
      }

      await cleanupCaucusParticipationForCharacters(db, [auth.user.character._id], {
        removeMembership: true,
        membershipStatus: "left",
        now: new Date(),
      });
      // Defensive: if membership was already closed but factionId lingered,
      // cleanup won't clear it (it only clears when an active membership is
      // found). Force-clear the stale pointer so founding can proceed.
      await db
        .collection<Character>("characters")
        .updateOne(
          { _id: auth.user.character._id, factionId: auth.user.character.factionId },
          { $set: { factionId: null, updatedAt: new Date() } }
        );
    }

    let slug: string;
    try {
      slug = normaliseCaucusSlug(parsed.data.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid name";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    // Active-slug collision check.
    const slugCollision = await db.collection<Caucus>("caucuses").findOne({
      countryId,
      partyId,
      slug,
      disbandedAt: null,
    });
    if (slugCollision) {
      return NextResponse.json(
        {
          error: `Slug "${slug}" is already in use by ${slugCollision.name}. Pick a different name.`,
        },
        { status: 409 }
      );
    }

    const now = new Date();
    const caucusId = new ObjectId();
    const caucus: Caucus = {
      _id: caucusId,
      slug,
      previousSlugs: [],
      countryId,
      partyId,
      name: parsed.data.name.trim(),
      description: parsed.data.description?.trim() ?? "",
      color: parsed.data.color ?? "#3a7bd5",
      chairId: auth.user.character._id,
      viceChairId: null,
      whipMode: parsed.data.whipMode ?? "soft",
      treasury: 0,
      taxRate: parsed.data.taxRate ?? 0,
      lastElectedTurn: null,
      nextElectionTurn: null,
      termsServed: 0,
      motto: parsed.data.motto?.trim() || undefined,
      disbandedAt: null,
      createdBy: auth.user.character._id,
      createdAt: now,
      updatedAt: now,
    };

    await db.collection<Caucus>("caucuses").insertOne(caucus);

    // Reclaim the slug from any prior caucus's previousSlugs in this party so
    // the resolver routes the new owner correctly.
    await reclaimSlug(db, countryId, partyId, slug, caucusId);

    // Add the founder as the chair-role member and stamp factionId on the Character.
    await db.collection<CaucusMembership>("caucusMemberships").insertOne({
      _id: new ObjectId(),
      caucusId,
      countryId,
      partyId,
      memberType: "character",
      memberId: auth.user.character._id,
      role: "chair",
      status: "active",
      invitedAt: null,
      joinedAt: now,
      leftAt: null,
      complianceScore: -1,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .collection("characters")
      .updateOne(
        { _id: auth.user.character._id },
        { $set: { factionId: caucusId, updatedAt: now } }
      );

    return NextResponse.json({
      success: true,
      caucus: {
        id: caucusId.toString(),
        slug,
        name: caucus.name,
        chairId: caucus.chairId?.toString() ?? null,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
