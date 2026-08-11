import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { requireHumanSessionWithCharacter, requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import {
  COUNTRY_CONFIGS,
  getSubNationalLegislatureKey,
  type CountryId,
} from "@/lib/constants/countries";
import { canManageOffice, resolveOfficeAccess } from "@/lib/governorOffice/access";
import { queueBill } from "@/lib/governorOffice/legislation/queueBill";
import { STATE_TERMINAL_STATUSES } from "@/lib/congress/billProposalLimits";
import {
  moderatedBillTitle,
  moderatedBillText,
  stateBillProvisionSchema,
} from "@/lib/api/schemas/congress";
import { MAX_PROVISIONS } from "@shared/constants/legislation";
import type {
  GovernorQueuedBill,
  NPP,
  ElectedOfficial,
  StateBill,
  StateBillProvision,
} from "@/lib/db/types";

// POST /api/country/[code]/region/[id]/office/legislation/queue — Queue a state bill.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const stateId = id.toUpperCase();
    const db = await getDb();
    const canManage = await canManageOffice(db, countryId, stateId, auth.user.character._id);
    if (!canManage)
      return NextResponse.json({ error: "Not authorized for this office" }, { status: 403 });

    const parsed = await parseJsonBody(
      request,
      z.object({
        targetNppId: z.string().refine((v) => ObjectId.isValid(v), "Invalid targetNppId"),
        title: moderatedBillTitle(z.string().min(1).max(200)),
        summary: moderatedBillText(z.string().min(1).max(2000)),
        category: z.string().optional(),
        legislationTypeId: z.string().optional(),
        effectDirection: z.number().optional(),
        // Strict provision validation (audit S6): only sub-national provision
        // types are accepted; anything else is rejected at queue time.
        provisions: z.array(stateBillProvisionSchema).max(MAX_PROVISIONS).optional(),
      })
    );
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const result = await queueBill(db, {
      countryId,
      stateId,
      character: auth.user.character,
      targetNppId: new ObjectId(parsed.data.targetNppId),
      title: parsed.data.title,
      summary: parsed.data.summary,
      category: parsed.data.category,
      legislationTypeId: parsed.data.legislationTypeId,
      effectDirection: parsed.data.effectDirection,
      provisions: parsed.data.provisions as StateBillProvision[] | undefined,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}

// GET — Return pending queue (if any) + list of eligible party NPPs for the modal.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const stateId = id.toUpperCase();
    const db = await getDb();
    const access = await resolveOfficeAccess(
      db,
      countryId,
      stateId,
      auth.user.character?._id ?? null
    );
    const isAdmin = auth.user.isAdmin === true;
    if (!access.canManage && !isAdmin) {
      return NextResponse.json({ error: "Not authorized for this office" }, { status: 403 });
    }

    const pending = await db.collection<GovernorQueuedBill>("governorLegislationQueue").findOne({
      countryId,
      stateId,
      status: "pending",
    });

    // Eligible NPPs: the office's party (holder's party — so a party officer
    // acting for an NPP-held office resolves the right same-party legislators),
    // retiredAt null, holds a state-legislature seat in this state, no active
    // bill in flight.
    const officeParty = access.officeParty;
    let eligibleNpps: Array<{ _id: string; name: string; partyAbbreviation?: string }> = [];
    if (officeParty) {
      const seats = await db
        .collection<ElectedOfficial>("electedOfficials")
        .find({
          officeType: getSubNationalLegislatureKey(countryId),
          state: stateId,
          isNPP: true,
        })
        .toArray();
      const nppIds = seats.map((s) => s.nppId).filter((x): x is ObjectId => !!x);
      const npps = nppIds.length
        ? await db
            .collection<NPP>("npps")
            .find({ _id: { $in: nppIds }, party: officeParty, retiredAt: null })
            .toArray()
        : [];
      const blocking = npps.length
        ? await db
            .collection<StateBill>("stateBills")
            .find({
              sponsorNppId: { $in: npps.map((n) => n._id) },
              status: { $nin: STATE_TERMINAL_STATUSES },
            })
            .project<{ sponsorNppId: ObjectId }>({ sponsorNppId: 1 })
            .toArray()
        : [];
      const blockedSet = new Set(blocking.map((b) => b.sponsorNppId.toString()));
      eligibleNpps = npps
        .filter((n) => !blockedSet.has(n._id.toString()))
        .map((n) => ({ _id: n._id.toString(), name: n.name }));
    }

    return NextResponse.json({ pending, eligibleNpps });
  } catch (error) {
    return handleRouteError(error);
  }
}
