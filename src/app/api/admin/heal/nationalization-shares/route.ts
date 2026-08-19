import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  loadFxRatesByCurrency,
} from "@/lib/currency/corporationCapital";
import type { Corporation } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";

const schema = z.object({
  dryRun: z.boolean().default(true),
});

/**
 * POST /api/admin/heal/nationalization-shares
 * Heals Bug #0803: shares owned by dissolved corporations that were orphaned
 * during nationalization. Transfers orphaned corporate shareholdings to the
 * appropriate National Corporation and credits the value.
 *
 * Auth: requireAdmin
 * Errors: 400, 403
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { dryRun } = parsed.data;
    const db = await getDb();
    const corps = db.collection<Corporation>("corporations");
    const now = new Date();

    // National corporations are the destination for orphaned shares.
    const nationalCorps = await corps
      .find({
        $or: [{ countryOwnerId: { $exists: true } }, { ownershipState: "stateOwned" }],
      })
      .toArray();

    // Find every corporation that has at least one corporate shareholder.
    const corpsWithCorpShareholders = await corps
      .find({ "shareholders.corporationId": { $exists: true } })
      .toArray();

    // Collect all referenced corporate shareholder IDs and see which still exist.
    const referencedIds = new Set<string>();
    for (const corp of corpsWithCorpShareholders) {
      for (const sh of corp.shareholders ?? []) {
        if (sh.corporationId) {
          referencedIds.add(sh.corporationId.toString());
        }
      }
    }

    const existingIds = new Set<string>();
    if (referencedIds.size > 0) {
      const existing = await corps
        .find({ _id: { $in: Array.from(referencedIds).map((id) => new ObjectId(id)) } })
        .project({ _id: 1 })
        .toArray();
      for (const c of existing) {
        existingIds.add(c._id.toString());
      }
    }

    const fxByCurrency = await loadFxRatesByCurrency(db);

    let totalSharesHealed = 0;
    let totalValueHealed = 0;
    const operations: Array<{
      type: "info" | "success" | "warning" | "dry-run";
      message: string;
      details?: Record<string, unknown>;
    }> = [];

    for (const targetCorp of corpsWithCorpShareholders) {
      const orphanedShareholders =
        targetCorp.shareholders?.filter(
          (sh) => sh.corporationId && !existingIds.has(sh.corporationId.toString())
        ) ?? [];

      if (orphanedShareholders.length === 0) continue;

      const countryId = targetCorp.countryId;
      if (!countryId) {
        operations.push({
          type: "warning",
          message: `Corporation ${targetCorp.name} (${targetCorp._id}) has no countryId, skipping ${orphanedShareholders.length} orphaned shareholder(s)`,
        });
        continue;
      }

      const nationalCorp = nationalCorps.find((nc) => nc.countryId === countryId);
      if (!nationalCorp) {
        operations.push({
          type: "warning",
          message: `No national corporation found for country ${countryId}, skipping ${targetCorp.name}`,
        });
        continue;
      }

      const dissolvedIds = orphanedShareholders
        .map((sh) => sh.corporationId)
        .filter((id): id is NonNullable<typeof id> => id !== undefined);

      const totalShares = orphanedShareholders.reduce((sum, sh) => sum + sh.shares, 0);
      const totalCostBasis = orphanedShareholders.reduce(
        (sum, sh) => sum + sh.shares * (sh.avgCostPerShare ?? 0),
        0
      );
      const avgCostPerShare = totalShares > 0 ? totalCostBasis / totalShares : 0;
      const sharePrice = targetCorp.sharePrice ?? 0;
      const shareValue = totalShares * sharePrice;
      const shareValueAnchor = corpLiquidCapitalToAnchor(
        shareValue,
        targetCorp,
        fxByCurrency.get(targetCorp.liquidCurrencyCode as CurrencyCode) ?? 1
      );

      operations.push({
        type: "info",
        message: `Found ${totalShares} orphaned shares in ${targetCorp.name} (ID: ${targetCorp._id}) across ${orphanedShareholders.length} dissolved holder(s)`,
        details: {
          targetCorpId: targetCorp._id.toString(),
          targetCorpName: targetCorp.name,
          dissolvedHolderIds: dissolvedIds.map((id) => id.toString()),
          shares: totalShares,
          sharePrice,
          avgCostPerShare,
          shareValue,
          nationalCorpId: nationalCorp._id.toString(),
          nationalCorpName: nationalCorp.name,
        },
      });

      if (dryRun) {
        operations.push({
          type: "dry-run",
          message: `[DRY RUN] Would transfer ${totalShares} shares to ${nationalCorp.name}`,
        });
        continue;
      }

      // Remove the dissolved corporations' shareholder entries.
      await corps.updateOne(
        { _id: targetCorp._id },
        {
          $pull: { shareholders: { corporationId: { $in: dissolvedIds } } },
          $set: { updatedAt: now },
        }
      );

      // Add or merge the National Corporation's shareholder entry.
      const freshTarget = await corps.findOne({ _id: targetCorp._id });
      const existingEntry = freshTarget?.shareholders?.find((sh) =>
        sh.corporationId?.equals(nationalCorp._id)
      );

      if (existingEntry) {
        const combinedShares = existingEntry.shares + totalShares;
        const combinedAvgCost =
          combinedShares > 0
            ? (existingEntry.shares * (existingEntry.avgCostPerShare ?? 0) + totalCostBasis) /
              combinedShares
            : 0;
        await corps.updateOne(
          { _id: targetCorp._id },
          {
            $set: {
              "shareholders.$[elem].shares": combinedShares,
              "shareholders.$[elem].avgCostPerShare": combinedAvgCost,
              updatedAt: now,
            },
          },
          { arrayFilters: [{ "elem.corporationId": nationalCorp._id }] }
        );
      } else {
        await corps.updateOne(
          { _id: targetCorp._id },
          {
            $push: {
              shareholders: {
                corporationId: nationalCorp._id,
                shares: totalShares,
                avgCostPerShare: avgCostPerShare,
              },
            },
            $set: { updatedAt: now },
          }
        );
      }

      // Credit the National Corporation with the value of the shares.
      const nationalCorpFxRate =
        fxByCurrency.get(nationalCorp.liquidCurrencyCode as CurrencyCode) ?? 1;
      const valueInNatCorpCurrency = Math.round(
        anchorToCorpLiquidCapital(shareValueAnchor, nationalCorp, nationalCorpFxRate)
      );

      await corps.updateOne(
        { _id: nationalCorp._id },
        {
          $inc: { liquidCapital: valueInNatCorpCurrency },
          $set: { updatedAt: now },
        }
      );

      totalSharesHealed += totalShares;
      totalValueHealed += valueInNatCorpCurrency;

      operations.push({
        type: "success",
        message: `✓ Transferred ${totalShares} shares to ${nationalCorp.name}, credited ${valueInNatCorpCurrency} ${nationalCorp.liquidCurrencyCode}`,
      });
    }

    const message = dryRun
      ? `Dry run completed. ${operations.filter((op) => op.type === "dry-run").length} operation(s) would be performed.`
      : `Healing completed successfully. ${totalSharesHealed} shares healed, ${totalValueHealed} credited.`;

    return NextResponse.json({
      success: true,
      message,
      dryRun,
      stats: {
        corporationsChecked: corpsWithCorpShareholders.length,
        sharesHealed: totalSharesHealed,
        valueCredited: totalValueHealed,
      },
      operations,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
