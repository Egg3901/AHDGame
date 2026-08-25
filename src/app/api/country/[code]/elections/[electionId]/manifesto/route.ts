/**
 * UK manifesto authoring (epic #856, ticket #857).
 *
 * GET  /api/country/[code]/elections/[electionId]/manifesto
 *   → { catalog, manifesto } for the caller's chaired party.
 * POST /api/country/[code]/elections/[electionId]/manifesto
 *   body { pledges: string[], action?: "save" | "lock" }
 *   → saves (or locks) the party leader's draft manifesto.
 *
 * Only the party CHAIR (leader) may author. UK only. The vote-share effect
 * stays gated by UK_MANIFESTO_VOTE_EFFECT regardless of this route.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { PoliticalParty } from "@/lib/db/types";
import type { Election } from "@/lib/db/types/election";
import { pledgeCatalogFor } from "@/lib/uk/manifesto/pledgeCatalog";
import {
  getManifesto,
  upsertManifestoDraft,
  lockManifesto,
  validateManifestoPledges,
} from "@/lib/db/collections/manifestos";
import { MANIFESTO_PLEDGE_COUNT, type Pledge } from "@/lib/db/types/manifesto";

const bodySchema = z.object({
  pledges: z.array(z.string().min(1)).max(MANIFESTO_PLEDGE_COUNT),
  action: z.enum(["save", "lock"]).optional().default("save"),
});

function catalogView(countryId: CountryId) {
  return pledgeCatalogFor(countryId).map((e) => ({
    id: e.id,
    label: e.label,
    blurb: e.blurb,
    policyDomain: e.policyDomain,
  }));
}

async function resolveContext(request: Request, code: string, electionId: string) {
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) {
    return { error: NextResponse.json({ error: "Invalid country" }, { status: 400 }) };
  }
  if (countryId !== "UK") {
    return { error: NextResponse.json({ error: "Manifestos are UK-only" }, { status: 400 }) };
  }
  if (!ObjectId.isValid(electionId)) {
    return { error: NextResponse.json({ error: "Invalid electionId" }, { status: 400 }) };
  }
  const auth = await requireHumanSessionWithCharacter(request);
  if (!auth.ok) return { error: auth.response };

  const db = await getDb();
  const election = await db
    .collection<Election>("elections")
    .findOne({ _id: new ObjectId(electionId), countryId });
  if (!election) {
    return { error: NextResponse.json({ error: "Election not found" }, { status: 404 }) };
  }
  // The caller's chaired party (leaders author manifestos).
  const party = await db
    .collection<PoliticalParty>("politicalParties")
    .findOne({ countryId, chairId: auth.user.character._id });

  return {
    db,
    countryId,
    election,
    party,
    characterId: auth.user.character._id,
    userId: auth.user.character.userId,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; electionId: string }> }
) {
  try {
    const { code, electionId } = await params;
    const ctx = await resolveContext(request, code, electionId);
    if ("error" in ctx) return ctx.error;

    const catalog = catalogView(ctx.countryId);
    const manifesto = ctx.party
      ? await getManifesto(ctx.db, ctx.countryId, ctx.election._id, String(ctx.party.sequentialId))
      : null;

    return NextResponse.json({
      catalog,
      pledgeCount: MANIFESTO_PLEDGE_COUNT,
      isPartyLeader: Boolean(ctx.party),
      party: ctx.party ? { id: String(ctx.party.sequentialId), name: ctx.party.name } : null,
      manifesto: manifesto
        ? {
            pledges: manifesto.pledges.map((p) => p.catalogEntryId),
            locked: Boolean(manifesto.lockedAt),
            lockedAt: manifesto.lockedAt,
          }
        : null,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; electionId: string }> }
) {
  try {
    const { code, electionId } = await params;
    const ctx = await resolveContext(request, code, electionId);
    if ("error" in ctx) return ctx.error;

    const rl = checkRateLimit(String(ctx.userId), 20, 60000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfter);

    if (!ctx.party) {
      return NextResponse.json(
        { error: "Only a party leader can author a manifesto" },
        { status: 403 }
      );
    }

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { pledges: pledgeIds, action } = parsed.data;

    const validIds = new Set(pledgeCatalogFor(ctx.countryId).map((e) => e.id));
    const pledges: Pledge[] = pledgeIds.map((id) => ({ catalogEntryId: id }));

    // For a save we allow a partial draft only up to the count; a lock requires
    // exactly the full, valid set (validated inside lockManifesto too).
    if (action === "lock") {
      const v = validateManifestoPledges(pledges, validIds);
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    } else {
      for (const id of pledgeIds) {
        if (!validIds.has(id)) {
          return NextResponse.json({ error: `unknown pledge: ${id}` }, { status: 400 });
        }
      }
    }

    const partyKey = String(ctx.party.sequentialId);
    const now = new Date();
    const wrote = await upsertManifestoDraft(ctx.db, {
      countryId: ctx.countryId,
      electionId: ctx.election._id,
      party: partyKey,
      pledges,
      authorCharacterId: ctx.characterId,
      isNPP: false,
      now,
    });
    if (!wrote) {
      return NextResponse.json(
        { error: "Manifesto is locked and cannot be edited" },
        { status: 409 }
      );
    }

    if (action === "lock") {
      const locked = await lockManifesto(ctx.db, {
        countryId: ctx.countryId,
        electionId: ctx.election._id,
        party: partyKey,
        validCatalogIds: validIds,
        now,
      });
      if (!locked.ok) return NextResponse.json({ error: locked.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, locked: action === "lock" });
  } catch (err) {
    return handleRouteError(err);
  }
}
