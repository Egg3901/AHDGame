/**
 * POST /api/admin/reapply-tax-rates
 * Retroactively applies tax rate changes from signed tax bills.
 * Use after deploying tax rate fix for bills signed before the fix.
 *
 * **Currency (v0.2.6):** Operates on a single federal budget ("federal" = US).
 * Tax rates are percentages; revenue = rate × taxBase stays in country currency
 * (same currency as the budget it writes to). Intra-country — no FX needed.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import type { Bill, LegislationType } from "@/lib/db/types";
import { isPolicyProvision } from "@/lib/db/types/legislation";
import type { FederalBudget, FederalTaxRates } from "@/lib/db/types/budget";
import { calculateFederalRevenue, normalizeFederalTaxRates } from "@/lib/budget/revenue";

export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Find all signed federal tax bills
    const signedBills = await db.collection<Bill>("bills").find({ status: "signed" }).toArray();

    // Get all legislation types with taxRateChange
    const taxLegTypes = await db
      .collection<LegislationType>("legislationTypes")
      .find({ taxRateChange: { $exists: true } })
      .toArray();
    const taxLegTypeMap = new Map(taxLegTypes.map((lt) => [lt._id, lt]));

    // Get current federal budget
    const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: "federal" });
    if (!budget) {
      return NextResponse.json({ error: "Federal budget not found" }, { status: 404 });
    }

    const normalizedTaxRates = normalizeFederalTaxRates(budget.taxRates);
    if (!normalizedTaxRates) {
      return NextResponse.json({ error: "Federal budget tax rates are missing" }, { status: 409 });
    }

    const newTaxRates: FederalTaxRates = { ...normalizedTaxRates };
    const appliedChanges: string[] = [];

    // Process each signed bill
    for (const bill of signedBills) {
      if (!bill.provisions?.length) continue;

      for (const provision of bill.provisions) {
        if (!isPolicyProvision(provision)) continue;
        const lt = taxLegTypeMap.get(provision.legislationTypeId);
        if (!lt?.taxRateChange || lt.taxRateChange.scope !== "federal") continue;

        // Find the selected option
        const prov = provision;

        let selectedOption = prov.policyOptionId
          ? lt.policyOptions?.find((opt) => opt.id === prov.policyOptionId)
          : undefined;

        if (!selectedOption) {
          selectedOption = lt.policyOptions?.find(
            (opt) => opt.economic === prov.economic && opt.social === prov.social
          );
        }

        if (selectedOption?.rate !== undefined) {
          const { taxType } = lt.taxRateChange;
          const oldRate = newTaxRates[taxType as keyof FederalTaxRates];
          newTaxRates[taxType as keyof FederalTaxRates] = selectedOption.rate;
          appliedChanges.push(
            `${lt.name}: ${oldRate}% → ${selectedOption.rate}% (Bill: ${bill.title})`
          );
        }
      }
    }

    if (appliedChanges.length === 0) {
      return NextResponse.json({
        message: "No tax rate changes found in signed bills",
        changes: [],
      });
    }

    // Calculate new revenue with updated rates
    const newRevenue = await calculateFederalRevenue(db, newTaxRates);
    const newSurplus = newRevenue.total - budget.spending.total;

    // Update the budget
    await db.collection<FederalBudget>("federalBudget").updateOne(
      { _id: "federal" },
      {
        $set: {
          taxRates: newTaxRates,
          revenue: newRevenue,
          surplus: newSurplus,
          updatedAt: new Date(),
        },
      }
    );

    return NextResponse.json({
      message: `Applied ${appliedChanges.length} tax rate changes`,
      changes: appliedChanges,
      newRates: newTaxRates,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
