import { NextResponse } from "next/server";
import type { Db } from "mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { buildNationalBillCountryScopeFilter } from "@/lib/legislature/nationalBillScope";
import { NATIONAL_POLICY_STATE_IDS } from "@/lib/policy/nationalStateId";
import { loadCountryLegislationTypes } from "@/lib/policy/nationalPolicyRecords";
import { getLegislationTypeById } from "@/lib/legislationTypeAliases";
import {
  mergeExecutiveActs,
  type ExecutiveActInputs,
  type LedgerBillInput,
} from "@/lib/executive/actsLedger";
import { getExecutiveSurface } from "@/lib/constants/executiveSurface";
import type { Bill, GovernorExecutiveOrder } from "@/lib/db/types";
import type { CabinetMember, CabinetNomination } from "@/lib/db/types/cabinet";

const LEDGER_BILL_STATUSES = [
  "signed",
  "enacted",
  "veto_override",
  "vetoed",
  "override_failed",
  "enrolled",
  "cabinet_review",
];

/** "secretary_of_defense" → "Secretary of Defense" (fallback label for position ids). */
function humanizePositionId(positionId: string): string {
  return positionId
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\bOf\b/g, "of")
    .replace(/\bThe\b/g, "the");
}

async function loadExecutiveActInputs(db: Db, countryId: CountryId): Promise<ExecutiveActInputs> {
  const nationalStateId = NATIONAL_POLICY_STATE_IDS[countryId];
  const [bills, orders, nominations, cabinetMembers, types] = await Promise.all([
    db
      // Untyped: the country-scope filter is a dynamic query shape (same
      // pattern as overview-counts); row typing comes from .project<> below.
      .collection("bills")
      .find({
        ...buildNationalBillCountryScopeFilter(countryId),
        status: { $in: LEDGER_BILL_STATUSES },
      })
      .project<
        Pick<
          Bill,
          | "_id"
          | "title"
          | "status"
          | "enactedAt"
          | "failedAt"
          | "sentToPresidentAt"
          | "presidentActionDeadline"
          | "proposedAt"
        >
      >({
        title: 1,
        status: 1,
        enactedAt: 1,
        failedAt: 1,
        sentToPresidentAt: 1,
        presidentActionDeadline: 1,
        proposedAt: 1,
      })
      .sort({ proposedAt: -1 })
      .limit(40)
      .toArray(),
    db
      .collection<GovernorExecutiveOrder>("governorExecutiveOrders")
      .find({ countryId, stateId: nationalStateId })
      .sort({ createdAt: -1 })
      .limit(14)
      .toArray(),
    db
      .collection<CabinetNomination>("cabinetNominations")
      .find({ countryId })
      .sort({ _id: -1 })
      .limit(14)
      .toArray(),
    db
      .collection<CabinetMember>("cabinetMembers")
      .find({ countryId })
      // By _id rather than confirmedAt: acting holders have no confirmedAt, and
      // a descending sort on a missing field would push every acting
      // appointment past the limit and out of the ledger entirely. Every
      // document has an _id, and its timestamp is the seating order.
      .sort({ _id: -1 })
      .limit(14)
      .toArray(),
    loadCountryLegislationTypes(db, countryId),
  ]);

  return {
    bills: bills.map((bill): LedgerBillInput => ({
      _id: bill._id.toString(),
      title: bill.title,
      status: bill.status,
      enactedAt: bill.enactedAt,
      failedAt: bill.failedAt,
      sentToPresidentAt: bill.sentToPresidentAt,
      presidentActionDeadline: bill.presidentActionDeadline,
      proposedAt: bill.proposedAt,
    })),
    orders: orders.map((order) => ({
      _id: order._id!.toString(),
      title:
        getLegislationTypeById(types.legislationTypeMap, order.legislationTypeId)?.name ??
        "Executive order",
      issuedByName: order.issuedByName,
      issuedAtTurn: order.issuedAtTurn,
      createdAt: order.createdAt,
    })),
    nominations: nominations.map((nomination) => ({
      _id: nomination._id.toString(),
      nomineeCharacterName: nomination.nomineeCharacterName,
      positionLabel: humanizePositionId(nomination.positionId),
      status: nomination.status,
      at: nomination.votingStartedAt ?? nomination._id.getTimestamp(),
    })),
    cabinetMembers: cabinetMembers.map((member) => ({
      _id: member._id.toString(),
      characterName: member.characterName,
      positionLabel: humanizePositionId(member.positionId),
      // Acting holders carry no confirmedAt, and the ledger sorts on this
      // date, so fall back rather than hand it undefined.
      confirmedAt: member.confirmedAt ?? member.appointedAt ?? member.createdAt,
      acting: member.acting === true,
    })),
  };
}

// GET /api/country/[code]/executive/acts - Acts of Government ledger for the
// executive page: read-side aggregation over bills, national executive
// orders, and cabinet nominations/confirmations. No writes.
// Auth: public
// Errors: 400
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const db = await getDb();
    const inputs = await loadExecutiveActInputs(db, countryId);
    const acts = mergeExecutiveActs(inputs);

    // Desk instrument figure: bills awaiting executive action, or — for
    // orders-desk countries — national executive orders currently in force.
    const surface = getExecutiveSurface(countryId);
    const deskCount =
      surface.deskKind === "bills"
        ? inputs.bills.filter(
            (bill) => bill.status === "enrolled" || bill.status === "cabinet_review"
          ).length
        : await db.collection("governorExecutiveOrders").countDocuments({
            countryId,
            stateId: NATIONAL_POLICY_STATE_IDS[countryId],
            status: "active",
          });

    return NextResponse.json(
      { acts, deskCount },
      { headers: { "Cache-Control": "no-store, max-age=0, no-transform" } }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
