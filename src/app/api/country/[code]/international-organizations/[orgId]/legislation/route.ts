// POST /api/country/[code]/international-organizations/[orgId]/legislation
// Foreign minister of `code` tables an org-level resolution. Supports
// `free_trade_agreement`, `sanctions`, `aid_package`, `set_dues`, `directive`,
// `joint_statement`, `set_posture`, and `fund_agency` (each gated by the org's
// category powers).
import { z } from "zod";
import { NextResponse } from "next/server";
import { clientIpFromRequest } from "@/lib/utils/network";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { requireForeignMinister } from "@/lib/api/requireForeignMinister";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { COUNTRY_CONFIGS, ALL_COUNTRY_IDS, type CountryId } from "@/lib/constants/countries";
import { COMMODITY_TYPES, type CommodityType } from "@/lib/constants/commodities";
import { MAX_ORG_DUES_RATE_ANNUAL } from "@/lib/constants/internationalOrganizations";
import { ALERT_POSTURES, type AlertPosture } from "@/lib/constants/orgPosture";
import { isCountryEnabledForPlayers } from "@/lib/countryAccess";
import { loadOrganizationDef, isMember } from "@/lib/internationalOrganizations/service";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import {
  proposeOrganizationLegislation,
  type ProposeResolutionInput,
} from "@/lib/internationalOrganizations/commands/proposeLegislation";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import {
  getDiplomaticActionsRemaining,
  spendDiplomaticAction,
} from "@/lib/internationalOrganizations/diplomaticActions";

const ftaSchema = z.object({
  type: z.literal("free_trade_agreement"),
  // Parties are validated at runtime against `isCountryEnabledForPlayers` so a
  // newly-activated country (admin-panel flip) is acceptable immediately
  // without a code redeploy. Compile-time enum was the pre-Phase-10 form.
  parties: z.array(z.string()).min(2).max(ALL_COUNTRY_IDS.length),
  title: z.string().min(3).max(120).optional(),
  description: z.string().max(2000).optional(),
});

const sanctionsSchema = z.object({
  type: z.literal("sanctions"),
  targetCountryId: z.string(),
  commodity: z.enum(["all", ...COMMODITY_TYPES] as [string, ...string[]]),
  title: z.string().min(3).max(120).optional(),
  description: z.string().max(2000).optional(),
});

const aidSchema = z.object({
  type: z.literal("aid_package"),
  recipientCountryId: z.string(),
  // Amount is in the org fund's (founding) currency.
  amount: z.number().positive().max(1e15),
  title: z.string().min(3).max(120).optional(),
  description: z.string().max(2000).optional(),
});

const setDuesSchema = z.object({
  type: z.literal("set_dues"),
  duesRateAnnual: z.number().min(0).max(MAX_ORG_DUES_RATE_ANNUAL),
  title: z.string().min(3).max(120).optional(),
  description: z.string().max(2000).optional(),
});

const directiveSchema = z.object({
  type: z.literal("directive"),
  directiveKey: z.string().min(1).max(64),
  title: z.string().min(3).max(120).optional(),
  description: z.string().max(2000).optional(),
});

const jointStatementSchema = z.object({
  type: z.literal("joint_statement"),
  subjectCountryId: z.string(),
  stance: z.enum(["endorse", "condemn"]),
  title: z.string().min(3).max(120).optional(),
  description: z.string().max(2000).optional(),
});

const setPostureSchema = z.object({
  type: z.literal("set_posture"),
  posture: z.enum(ALERT_POSTURES as [string, ...string[]]),
  title: z.string().min(3).max(120).optional(),
  description: z.string().max(2000).optional(),
});

const fundAgencySchema = z.object({
  type: z.literal("fund_agency"),
  agencyKey: z.string().min(1).max(64),
  title: z.string().min(3).max(120).optional(),
  description: z.string().max(2000).optional(),
});

const resolutionSchema = z.discriminatedUnion("type", [
  ftaSchema,
  sanctionsSchema,
  aidSchema,
  setDuesSchema,
  directiveSchema,
  jointStatementSchema,
  setPostureSchema,
  fundAgencySchema,
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; orgId: string }> }
) {
  try {
    const { code, orgId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json(badRequest("Invalid country code").toJson(), { status: 400 });
    }

    const body = await parseJsonBody(request, resolutionSchema);
    if (!body.success) {
      return NextResponse.json(badRequest(body.error).toJson(), { status: body.status });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const ip = clientIpFromRequest(request);
    const rateLimit = checkRateLimit(`org-legislation:${ip}`, 10, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    if (!(await loadOrganizationDef(db, orgId))) {
      return NextResponse.json(badRequest("Unknown organization").toJson(), { status: 400 });
    }

    let validatedInput: ProposeResolutionInput;
    if (body.data.type === "free_trade_agreement") {
      // Validate every `parties` entry is a known + admin-enabled country.
      // Runtime check (vs a compile-time enum) so admins can include
      // newly-activated countries without a code redeploy.
      const validatedParties: CountryId[] = [];
      for (const party of body.data.parties) {
        if (!COUNTRY_CONFIGS[party as CountryId]) {
          return NextResponse.json(badRequest(`Unknown party country: ${party}`).toJson(), {
            status: 400,
          });
        }
        if (!(await isCountryEnabledForPlayers(db, party as CountryId))) {
          return NextResponse.json(
            badRequest(`Party country ${party} is not enabled for players`).toJson(),
            { status: 400 }
          );
        }
        validatedParties.push(party as CountryId);
      }
      validatedInput = {
        type: "free_trade_agreement",
        parties: validatedParties,
        title: body.data.title,
        description: body.data.description,
      };
    } else if (body.data.type === "sanctions") {
      const target = body.data.targetCountryId.toUpperCase() as CountryId;
      if (!COUNTRY_CONFIGS[target]) {
        return NextResponse.json(badRequest(`Unknown target country: ${target}`).toJson(), {
          status: 400,
        });
      }
      validatedInput = {
        type: "sanctions",
        targetCountryId: target,
        commodity: body.data.commodity as CommodityType | "all",
        title: body.data.title,
        description: body.data.description,
      };
    } else if (body.data.type === "aid_package") {
      const recipient = body.data.recipientCountryId.toUpperCase() as CountryId;
      if (!COUNTRY_CONFIGS[recipient]) {
        return NextResponse.json(badRequest(`Unknown recipient country: ${recipient}`).toJson(), {
          status: 400,
        });
      }
      validatedInput = {
        type: "aid_package",
        recipientCountryId: recipient,
        amount: body.data.amount,
        title: body.data.title,
        description: body.data.description,
      };
    } else if (body.data.type === "set_dues") {
      validatedInput = {
        type: "set_dues",
        duesRateAnnual: body.data.duesRateAnnual,
        title: body.data.title,
        description: body.data.description,
      };
    } else if (body.data.type === "directive") {
      validatedInput = {
        type: "directive",
        directiveKey: body.data.directiveKey,
        title: body.data.title,
        description: body.data.description,
      };
    } else if (body.data.type === "set_posture") {
      validatedInput = {
        type: "set_posture",
        posture: body.data.posture as AlertPosture,
        title: body.data.title,
        description: body.data.description,
      };
    } else if (body.data.type === "fund_agency") {
      validatedInput = {
        type: "fund_agency",
        agencyKey: body.data.agencyKey,
        title: body.data.title,
        description: body.data.description,
      };
    } else {
      const subject = body.data.subjectCountryId.toUpperCase() as CountryId;
      if (!COUNTRY_CONFIGS[subject]) {
        return NextResponse.json(badRequest(`Unknown subject country: ${subject}`).toJson(), {
          status: 400,
        });
      }
      validatedInput = {
        type: "joint_statement",
        subjectCountryId: subject,
        stance: body.data.stance,
        title: body.data.title,
        description: body.data.description,
      };
    }

    const foreignMinister = await requireForeignMinister(
      countryId,
      auth.user.character._id,
      auth.user.character.name,
      db
    );
    if (!foreignMinister.ok) return foreignMinister.response;

    if (!(await isMember(db, orgId, countryId))) {
      return NextResponse.json(badRequest(`${countryId} is not a member of ${orgId}.`).toJson(), {
        status: 400,
      });
    }

    const currentTurn = await getCurrentTurn(db);
    if ((await getDiplomaticActionsRemaining(db, countryId, currentTurn)) < 1) {
      return NextResponse.json(badRequest("No diplomatic actions remaining this turn.").toJson(), {
        status: 400,
      });
    }

    const result = await proposeOrganizationLegislation({
      db,
      countryId,
      orgId,
      actor: {
        characterId: foreignMinister.auth.characterId,
        characterName: foreignMinister.auth.characterName,
      },
      input: validatedInput,
    });
    if (!result.ok) {
      return NextResponse.json(badRequest(result.error).toJson(), { status: result.status });
    }

    await spendDiplomaticAction(db, countryId, currentTurn);

    return NextResponse.json({ ok: true, legislationId: result.legislationId });
  } catch (err) {
    return handleRouteError(err);
  }
}
