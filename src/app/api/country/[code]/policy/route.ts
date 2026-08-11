import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import type { StatePolicyRecord, GovernorExecutiveOrder, Subsidy } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getLegislationTypeById } from "@/lib/legislationTypeAliases";
import {
  buildPolicyResponse,
  loadCountryLegislationTypes,
  mergePolicyRecordsByCanonicalId,
  type ActiveOrderInfo,
} from "@/lib/policy/nationalPolicyRecords";
import type { PolicyRecordResponse } from "@/lib/policy/types";
import {
  loadNationalPolicyRecords,
  buildSubsidyResponse,
} from "@/lib/policy/nationalPolicyRecordsList";

// Re-export for any consumer that still imports types from the route file.
// New consumers should import from "@/lib/policy/types".
export type { PolicyMetricEffect, PolicyRecordResponse } from "@/lib/policy/types";

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get("scope");
    const stateId = searchParams.get("stateId")?.trim();
    const db = await getDb();

    if (scope === "national") {
      return NextResponse.json(await loadNationalPolicyRecords(countryId), {
        headers: { "Cache-Control": "no-store, max-age=0, no-transform" },
      });
    }

    if (scope === "state" && stateId) {
      const { legislationTypeMap } = await loadCountryLegislationTypes(db, countryId);
      const policies = await db
        .collection<StatePolicyRecord>("statePolicies")
        .find({ scope: "state", stateId })
        .toArray();
      const subsidies = await db
        .collection<Subsidy>("subsidies")
        .find({ countryId, active: true, scope: "state", stateId })
        .sort({ scopeType: 1, targetSectorType: 1, targetStrategyId: 1, createdAt: 1 })
        .toArray();
      const activeOrders = await db
        .collection<GovernorExecutiveOrder>("governorExecutiveOrders")
        .find({ countryId, stateId, status: "active" })
        .toArray();
      const activeOrderById = new Map(activeOrders.map((o) => [o._id!.toString(), o]));
      const recordsByCanonicalId = mergePolicyRecordsByCanonicalId(policies);
      const out: PolicyRecordResponse[] = [...recordsByCanonicalId.values()]
        .map((record) => {
          const legislationType = getLegislationTypeById(
            legislationTypeMap,
            record.legislationTypeId
          );
          if (!legislationType) return null;
          let activeOrder: ActiveOrderInfo | null = null;
          if (record.enactedBy?.kind === "order") {
            const order = activeOrderById.get(record.enactedBy.id.toString());
            if (order) {
              activeOrder = {
                orderId: order._id!.toString(),
                issuedByName: order.issuedByName,
                issuedAtTurn: order.issuedAtTurn,
                expiresAtTurn: order.expiresAtTurn,
              };
            }
          }
          return buildPolicyResponse(record, legislationType, activeOrder);
        })
        .filter((record): record is PolicyRecordResponse => record !== null);
      const subsidyOut = subsidies.map((subsidy) => buildSubsidyResponse(subsidy));
      return NextResponse.json([...out, ...subsidyOut], {
        headers: { "Cache-Control": "no-store, max-age=0, no-transform" },
      });
    }

    return NextResponse.json({ error: "Missing or invalid scope or stateId" }, { status: 400 });
  } catch (error) {
    return handleRouteError(error);
  }
}
