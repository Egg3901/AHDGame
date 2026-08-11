import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { findCaucusBySlug } from "@/lib/db/caucusLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  CAUCUS_NPP_RECRUIT_COOLDOWN_MS,
  CAUCUS_NPP_RECRUIT_COOLDOWN_TURNS,
  CAUCUS_NPP_RECRUIT_MIN_RELATIONSHIP,
} from "@/lib/constants/partyOrg";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import type { CaucusMembership, Character, NPP, NPPRelationship } from "@/lib/db/types";
import { isSameCountry } from "@/lib/api/sameCountry";

const joinSchema = z.discriminatedUnion("memberType", [
  z.object({
    memberType: z.literal("character"),
    /** Required when chair is inviting; optional self-join (defaults to caller). */
    memberId: z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .optional(),
  }),
  z.object({
    memberType: z.literal("npp"),
    memberId: z.string().regex(/^[a-f\d]{24}$/i),
  }),
]);

type RecruitableNppStatus =
  "eligible" | "already_member" | "other_caucus" | "retired" | "cooldown" | "needs_relationship";

interface RecruitableNppOption {
  id: string;
  name: string;
  homeState: string;
  currentOfficeLabel: string | null;
  relationshipScore: number;
  eligible: boolean;
  status: RecruitableNppStatus;
  statusLabel: string;
  cooldownUntil: string | null;
}

function titleCaseLabel(value: string): string {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function getNppOfficeLabel(npp: NPP): string | null {
  if (!npp.currentOffice) return null;
  if (typeof npp.currentOffice === "string") return titleCaseLabel(npp.currentOffice);
  return titleCaseLabel(npp.currentOffice.type);
}

function buildRecruitability(args: {
  relationshipScore: number;
  activeCaucusId: ObjectId | null;
  targetCaucusId: ObjectId;
  retiredAt: Date | null;
  latestCaucusRecruitAt: Date | null;
  latestCaucusRecruitTurn: number | null;
  currentTurn: number | null;
  now: Date;
}): {
  eligible: boolean;
  status: RecruitableNppStatus;
  statusLabel: string;
  cooldownUntil: Date | null;
  error: string | null;
  statusCode: number;
} {
  const {
    relationshipScore,
    activeCaucusId,
    targetCaucusId,
    retiredAt,
    latestCaucusRecruitAt,
    latestCaucusRecruitTurn,
    currentTurn,
    now,
  } = args;

  if (activeCaucusId?.toString() === targetCaucusId.toString()) {
    return {
      eligible: false,
      status: "already_member",
      statusLabel: "Already in this caucus",
      cooldownUntil: null,
      error: "NPP is already a member of this caucus.",
      statusCode: 409,
    };
  }

  if (activeCaucusId) {
    return {
      eligible: false,
      status: "other_caucus",
      statusLabel: "Already in another caucus",
      cooldownUntil: null,
      error: "NPP is already a member of another caucus.",
      statusCode: 409,
    };
  }

  if (retiredAt) {
    return {
      eligible: false,
      status: "retired",
      statusLabel: "Retired",
      cooldownUntil: null,
      error: "Retired NPPs cannot join caucuses.",
      statusCode: 400,
    };
  }

  if (relationshipScore < CAUCUS_NPP_RECRUIT_MIN_RELATIONSHIP) {
    return {
      eligible: false,
      status: "needs_relationship",
      statusLabel: `Needs ${CAUCUS_NPP_RECRUIT_MIN_RELATIONSHIP} Relationship`,
      cooldownUntil: null,
      error: `Caucus recruitment requires at least ${CAUCUS_NPP_RECRUIT_MIN_RELATIONSHIP} relationship with this NPP.`,
      statusCode: 400,
    };
  }

  // Turn-first cooldown gate (freezes on pause); falls back to the wall-clock
  // window for memberships that pre-date `joinedAtTurn`. The displayed
  // `cooldownUntil` Date is derived from the recruit timestamp when available.
  const onCooldown =
    typeof latestCaucusRecruitTurn === "number" && typeof currentTurn === "number"
      ? currentTurn < latestCaucusRecruitTurn + CAUCUS_NPP_RECRUIT_COOLDOWN_TURNS
      : !!latestCaucusRecruitAt &&
        latestCaucusRecruitAt.getTime() + CAUCUS_NPP_RECRUIT_COOLDOWN_MS > now.getTime();
  if (onCooldown) {
    return {
      eligible: false,
      status: "cooldown",
      statusLabel: "Caucus on 12-turn cooldown",
      cooldownUntil: latestCaucusRecruitAt
        ? new Date(latestCaucusRecruitAt.getTime() + CAUCUS_NPP_RECRUIT_COOLDOWN_MS)
        : null,
      error: "This caucus is on a 12-turn NPP recruitment cooldown.",
      statusCode: 409,
    };
  }

  return {
    eligible: true,
    status: "eligible",
    statusLabel: "Eligible",
    cooldownUntil: null,
    error: null,
    statusCode: 200,
  };
}

// GET /api/country/[code]/parties/[id]/caucuses/[slug]/members?memberType=npp — List same-party NPPs the chair can recruit into the caucus
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string; slug: string }> }
) {
  try {
    const { code, id, slug } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const memberType = new URL(request.url).searchParams.get("memberType");
    if (memberType !== "npp") {
      return NextResponse.json({ error: "Unsupported memberType filter." }, { status: 400 });
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

    const callerId = auth.user.character._id;
    const isChair = caucus.chairId?.toString() === callerId.toString();
    if (!isChair) {
      return NextResponse.json(
        { error: "Only the Caucus Chair can review recruitable NPPs." },
        { status: 403 }
      );
    }

    const npps = await db.collection<NPP>("npps").find({ party: partyId }).toArray();
    const nppIds = npps.map((npp) => npp._id);
    const relationshipKeys = nppIds.map((nppId) => `${callerId.toString()}_${nppId.toString()}`);
    const now = new Date();
    const currentTurn = await getCurrentTurn(db);

    const [relationshipDocs, membershipDocs, latestCaucusRecruitment] = await Promise.all([
      relationshipKeys.length > 0
        ? db
            .collection<NPPRelationship>("nppRelationships")
            .find({ _id: { $in: relationshipKeys } })
            .toArray()
        : Promise.resolve([] as NPPRelationship[]),
      nppIds.length > 0
        ? db
            .collection<CaucusMembership>("caucusMemberships")
            .find({ memberType: "npp", memberId: { $in: nppIds } })
            .sort({ joinedAt: -1, updatedAt: -1 })
            .toArray()
        : Promise.resolve([] as CaucusMembership[]),
      db
        .collection<CaucusMembership>("caucusMemberships")
        .find({ caucusId: caucus._id, memberType: "npp", joinedAt: { $ne: null } })
        .sort({ joinedAt: -1, updatedAt: -1 })
        .limit(1)
        .toArray()
        .then((items) => items[0] ?? null),
    ]);

    const relationshipMap = new Map(relationshipDocs.map((doc) => [doc._id, doc]));
    const membershipsByNpp = new Map<string, CaucusMembership[]>();
    for (const membership of membershipDocs) {
      const key = membership.memberId.toString();
      const bucket = membershipsByNpp.get(key);
      if (bucket) bucket.push(membership);
      else membershipsByNpp.set(key, [membership]);
    }

    const latestCaucusRecruitAt = latestCaucusRecruitment?.joinedAt ?? null;
    const caucusCooldownUntil =
      latestCaucusRecruitAt &&
      latestCaucusRecruitAt.getTime() + CAUCUS_NPP_RECRUIT_COOLDOWN_MS > now.getTime()
        ? new Date(latestCaucusRecruitAt.getTime() + CAUCUS_NPP_RECRUIT_COOLDOWN_MS)
        : null;

    const items = npps
      .map((npp): RecruitableNppOption | null => {
        const relationshipScore =
          relationshipMap.get(`${callerId.toString()}_${npp._id.toString()}`)?.relationshipScore ??
          0;
        const memberships = membershipsByNpp.get(npp._id.toString()) ?? [];
        const activeMembership =
          memberships.find((membership) => membership.status === "active") ?? null;
        if (activeMembership || npp.factionId) {
          return null;
        }
        const recruitability = buildRecruitability({
          relationshipScore,
          activeCaucusId: null,
          targetCaucusId: caucus._id,
          retiredAt: npp.retiredAt,
          latestCaucusRecruitAt,
          latestCaucusRecruitTurn: latestCaucusRecruitment?.joinedAtTurn ?? null,
          currentTurn,
          now,
        });

        const option: RecruitableNppOption = {
          id: npp._id.toString(),
          name: npp.name,
          homeState: npp.homeState,
          currentOfficeLabel: getNppOfficeLabel(npp),
          relationshipScore,
          eligible: recruitability.eligible,
          status: recruitability.status,
          statusLabel: recruitability.statusLabel,
          cooldownUntil: recruitability.cooldownUntil?.toISOString() ?? null,
        };
        if (option.status === "needs_relationship") {
          return null;
        }
        return option;
      })
      .filter((item): item is RecruitableNppOption => item !== null)
      .sort((left, right) => {
        if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
        if (left.relationshipScore !== right.relationshipScore) {
          return right.relationshipScore - left.relationshipScore;
        }
        return left.name.localeCompare(right.name);
      });

    return NextResponse.json({
      items,
      minimumRelationship: CAUCUS_NPP_RECRUIT_MIN_RELATIONSHIP,
      cooldownHours: CAUCUS_NPP_RECRUIT_COOLDOWN_MS / (60 * 60 * 1000),
      cooldownUntil: caucusCooldownUntil?.toISOString() ?? null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/country/[code]/parties/[id]/caucuses/[slug]/members — Add a member to the caucus
// Auth: requireAuthWithCharacter (chair invites NPP/player; players may self-join)
// Errors: 400, 401, 403, 404, 409
export async function POST(
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

    const parsed = await parseJsonBody(request, joinSchema);
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

    const callerId = auth.user.character._id;
    const isChair = caucus.chairId?.toString() === callerId.toString();

    let memberType: "character" | "npp";
    let memberOid: ObjectId;

    if (parsed.data.memberType === "npp") {
      // Only the chair can add NPPs.
      if (!isChair) {
        return NextResponse.json(
          { error: "Only the chair can recruit NPPs into the caucus." },
          { status: 403 }
        );
      }
      memberType = "npp";
      memberOid = new ObjectId(parsed.data.memberId);
    } else {
      // Adding a Character — either chair invite or self-join.
      const targetId = parsed.data.memberId ? new ObjectId(parsed.data.memberId) : callerId;
      if (!targetId.equals(callerId) && !isChair) {
        return NextResponse.json(
          { error: "Only the chair can add another player to the caucus." },
          { status: 403 }
        );
      }
      memberType = "character";
      memberOid = targetId;
    }

    // Validate the target exists, is in the same party, and isn't already in
    // any other caucus (one caucus per member, Phase 1 invariant).
    if (memberType === "character") {
      const target = await db.collection<Character>("characters").findOne({ _id: memberOid });
      if (!target) {
        return NextResponse.json({ error: "Character not found" }, { status: 404 });
      }
      if (target.party !== partyId || !isSameCountry(target, { countryId })) {
        return NextResponse.json(
          { error: "Character must be a member of this party to join its caucus." },
          { status: 400 }
        );
      }
      if (target.factionId && !target.factionId.equals(caucus._id)) {
        return NextResponse.json(
          { error: "Character is already a member of another caucus." },
          { status: 409 }
        );
      }
    } else {
      const target = await db.collection<NPP>("npps").findOne({ _id: memberOid });
      if (!target) {
        return NextResponse.json({ error: "NPP not found" }, { status: 404 });
      }
      if (target.party !== partyId || !isSameCountry(target, { countryId })) {
        return NextResponse.json(
          { error: "NPP must be a member of this party to join its caucus." },
          { status: 400 }
        );
      }
      if (target.retiredAt) {
        return NextResponse.json({ error: "Retired NPPs cannot join caucuses." }, { status: 400 });
      }
      if (target.factionId && !target.factionId.equals(caucus._id)) {
        return NextResponse.json(
          { error: "NPP is already a member of another caucus." },
          { status: 409 }
        );
      }

      const now = new Date();
      const currentTurn = await getCurrentTurn(db);
      const [relationshipDoc, membershipDocs, latestCaucusRecruitment] = await Promise.all([
        db
          .collection<NPPRelationship>("nppRelationships")
          .findOne({ _id: `${callerId.toString()}_${memberOid.toString()}` }),
        db
          .collection<CaucusMembership>("caucusMemberships")
          .find({ memberType: "npp", memberId: memberOid })
          .sort({ joinedAt: -1, updatedAt: -1 })
          .toArray(),
        db
          .collection<CaucusMembership>("caucusMemberships")
          .find({ caucusId: caucus._id, memberType: "npp", joinedAt: { $ne: null } })
          .sort({ joinedAt: -1, updatedAt: -1 })
          .limit(1)
          .toArray()
          .then((items) => items[0] ?? null),
      ]);

      const activeMembership =
        membershipDocs.find((membership) => membership.status === "active") ?? null;
      const relationshipScore = relationshipDoc?.relationshipScore ?? 0;
      const recruitability = buildRecruitability({
        relationshipScore,
        activeCaucusId: activeMembership?.caucusId ?? target.factionId ?? null,
        targetCaucusId: caucus._id,
        retiredAt: target.retiredAt,
        latestCaucusRecruitAt: latestCaucusRecruitment?.joinedAt ?? null,
        latestCaucusRecruitTurn: latestCaucusRecruitment?.joinedAtTurn ?? null,
        currentTurn,
        now,
      });
      if (!recruitability.eligible) {
        return NextResponse.json(
          {
            error: recruitability.error,
            relationshipScore,
            requiredRelationship: CAUCUS_NPP_RECRUIT_MIN_RELATIONSHIP,
            cooldownUntil: recruitability.cooldownUntil?.toISOString() ?? null,
          },
          { status: recruitability.statusCode }
        );
      }
    }

    // Reactivate or insert the membership row.
    const now = new Date();
    const currentTurn = await getCurrentTurn(db);
    const existing = await db
      .collection<CaucusMembership>("caucusMemberships")
      .findOne({ caucusId: caucus._id, memberId: memberOid });
    if (existing && existing.status === "active") {
      return NextResponse.json(
        { error: "Already a member of this caucus.", membershipId: existing._id.toString() },
        { status: 409 }
      );
    }
    if (existing) {
      await db.collection<CaucusMembership>("caucusMemberships").updateOne(
        { _id: existing._id },
        {
          $set: {
            status: "active",
            joinedAt: now,
            joinedAtTurn: currentTurn,
            leftAt: null,
            role: "member",
            updatedAt: now,
          },
        }
      );
    } else {
      await db.collection<CaucusMembership>("caucusMemberships").insertOne({
        _id: new ObjectId(),
        caucusId: caucus._id,
        countryId,
        partyId,
        memberType,
        memberId: memberOid,
        role: "member",
        status: "active",
        invitedAt: isChair && !memberOid.equals(callerId) ? now : null,
        joinedAt: now,
        joinedAtTurn: currentTurn,
        leftAt: null,
        complianceScore: -1,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Stamp factionId on the appropriate collection so roster filters and the
    // by-faction prediction view can index without a join.
    const collectionName = memberType === "character" ? "characters" : "npps";
    await db
      .collection(collectionName)
      .updateOne({ _id: memberOid }, { $set: { factionId: caucus._id, updatedAt: now } });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
