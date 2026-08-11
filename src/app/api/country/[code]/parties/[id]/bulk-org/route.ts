import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, forbidden } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { crossCountryActionGuard } from "@/lib/api/crossCountryGuard";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { canActAsChair } from "@/lib/parties/actingChair";
import { findPartyBySequentialId, getPartyIdString } from "@/lib/db/partyLookup";
import { getPartyBudgetCollection } from "@/lib/db/collections";
import { savePartyBudgetForScope } from "@/lib/partyBudgetGuards";
import {
  taxRateSchema,
  orgBuildingBudgetSchema,
  suppressionBudgetSchema,
} from "@/lib/api/schemas/settings";
import type { StatePartyOrg } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

type ValueParse = { ok: true; value: number } | { ok: false; error: string };

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid value";
}

/**
 * Bulk-applicable state-party org settings.
 *
 * Each entry re-parses the incoming scalar through the SAME zod schema the
 * per-state route uses, so the accepted range can never diverge from the
 * per-state contract (tax 0–33, org building 0–75, suppression 0–25 — all
 * integer percents). Only settings that are a single persisted scalar are
 * bulk-applicable; NPP recruitment and NPP management ("influence") are
 * per-invocation actions (spend AP + treasury, cooldowns, per-NPP targeting),
 * not values, so they are intentionally not in this allow-list.
 */
const SETTINGS = {
  tax: {
    label: "state tax rate",
    // Written directly onto each statePartyOrg row (mirrors the per-state tax route).
    storage: "statePartyOrg" as const,
    field: "stateTaxRate" as const,
    parse: (value: unknown): ValueParse => {
      const r = taxRateSchema.safeParse({ taxRate: value });
      return r.success
        ? { ok: true, value: r.data.taxRate }
        : { ok: false, error: firstIssue(r.error) };
    },
  },
  orgBuilding: {
    label: "org building budget",
    // Written to the partyBudget collection via savePartyBudgetForScope (mirrors org-building route).
    storage: "partyBudget" as const,
    field: "orgBuildingPercent" as const,
    parse: (value: unknown): ValueParse => {
      const r = orgBuildingBudgetSchema.safeParse({ orgBuildingPercent: value });
      return r.success
        ? { ok: true, value: r.data.orgBuildingPercent }
        : { ok: false, error: firstIssue(r.error) };
    },
  },
  suppression: {
    label: "suppression budget",
    storage: "partyBudget" as const,
    field: "suppressionBudgetPercent" as const,
    parse: (value: unknown): ValueParse => {
      const r = suppressionBudgetSchema.safeParse({ suppressionBudgetPercent: value });
      return r.success
        ? { ok: true, value: r.data.suppressionBudgetPercent }
        : { ok: false, error: firstIssue(r.error) };
    },
  },
} as const;

type BulkSetting = keyof typeof SETTINGS;

const bulkOrgBodySchema = z.object({
  setting: z.enum(["tax", "orgBuilding", "suppression"]),
  value: z.coerce.number(),
});

// POST /api/country/[code]/parties/[id]/bulk-org — National chair bulk-applies one
// state-party org setting to the same value across every state chapter of the party.
// Auth: requireAuthWithCharacter + national-chair authority (canActAsChair)
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const authUser = auth.user;

    const rateLimit = checkRateLimit(authUser.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    // Party sequentialId is unique per country, so a foreign character's party
    // id collides onto the same-id party in this country. Block cross-country
    // actors (admins included) — Bug #0668.
    const crossCountry = crossCountryActionGuard(authUser.character, countryId);
    if (crossCountry) return crossCountry;

    const parsed = await parseJsonBody(request, bulkOrgBodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const setting = parsed.data.setting as BulkSetting;
    const config = SETTINGS[setting];

    // Validate the value against the SAME bounds the per-state route enforces.
    const valueParse = config.parse(parsed.data.value);
    if (!valueParse.ok) {
      return NextResponse.json({ error: valueParse.error }, { status: 400 });
    }
    const value = valueParse.value;

    const db = await getDb();

    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    // AUTHORIZATION: only the seated national chair — or the vice-chair acting in
    // a vacant chair seat — may bulk-apply. This is the exact authority check the
    // game uses for national-chair-only actions (party settings PATCH, member
    // purge) and the one that gates the Chair Office panel this control lives in.
    if (!canActAsChair(party, authUser.character._id)) {
      return NextResponse.json(
        forbidden(
          "Only the party Chair (or acting Vice-Chair when the chair seat is vacant) can bulk-apply state settings"
        ).toJson(),
        { status: 403 }
      );
    }

    const partyKey = getPartyIdString(party);
    const now = new Date();

    let statesUpdated = 0;

    if (config.storage === "statePartyOrg") {
      // tax → a scalar field on every state-party org row for this party+country.
      const result = await db
        .collection<StatePartyOrg>("statePartyOrg")
        .updateMany(
          { countryId, partyId: partyKey },
          { $set: { [config.field]: value, updatedAt: now } }
        );
      statesUpdated = result.matchedCount;
    } else {
      // org building / suppression → the partyBudget collection. Reuse the exact
      // per-state writer (savePartyBudgetForScope) for every existing chapter so
      // the merge / legacy-countryId semantics match the per-state route exactly.
      const chapters = await db
        .collection<StatePartyOrg>("statePartyOrg")
        .find({ countryId, partyId: partyKey }, { projection: { stateId: 1 } })
        .toArray();
      const budgetCollection = await getPartyBudgetCollection();
      for (const chapter of chapters) {
        const fields =
          setting === "orgBuilding"
            ? { orgBuildingPercent: value }
            : { suppressionBudgetPercent: value };
        await savePartyBudgetForScope(
          budgetCollection,
          { countryId, partyId: partyKey, scope: "state", stateId: chapter.stateId },
          fields,
          now
        );
      }
      statesUpdated = chapters.length;
    }

    await db.collection("adminLogs").insertOne({
      category: "system",
      action: "bulk_state_org_changed",
      username: authUser.username,
      characterName: authUser.character.name,
      details: `National chair bulk-set ${config.label} to ${value}% across ${statesUpdated} ${party.name} state chapter${statesUpdated === 1 ? "" : "s"}`,
      createdAt: now,
    });

    return NextResponse.json({
      success: true,
      setting,
      value,
      statesUpdated,
      message: `${config.label} set to ${value}% across ${statesUpdated} state chapter${statesUpdated === 1 ? "" : "s"}`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
