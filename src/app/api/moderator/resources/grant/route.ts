import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { adminResourcesGrantSchema } from "@/lib/api/schemas/admin";
import { createModAuditLog } from "@/lib/modAuditLog";
import type { Character, ExchangeRate } from "@/lib/db/types";
import { ObjectId } from "mongodb";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  buildHomeCurrencyCashGrantSetStage,
  buildCampaignFundsGrantExpression,
} from "@/lib/currency/grantCashBuilder";

// POST /api/moderator/resources/grant — Grant resources to players.
// Auth: requireModerator
// Errors: 400, 403
export async function POST(request: Request) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;
    const { user: moderator } = auth;

    const parsed = await parseJsonBody(request, adminResourcesGrantSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { characterIds, allPlayers, actions, funds, cashOnHand, currency } = parsed.data;

    const db = await getDb();
    const forexEnabled = await isForexEnabled();

    const setStage: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (actions !== undefined && actions !== 0) {
      setStage.actions = { $add: ["$actions", actions] };
    }
    if (funds !== undefined && funds !== 0) {
      if (forexEnabled) {
        setStage.funds = { $add: [{ $ifNull: ["$funds", 0] }, funds] };
        const rateDocs = await db.collection<ExchangeRate>("exchangeRates").find({}).toArray();
        const rateByCountry = new Map<string, number>(
          rateDocs.map((r) => [r._id as string, r.rate])
        );
        setStage["currencyBalances.campaign"] = buildCampaignFundsGrantExpression(
          funds,
          rateByCountry
        );
      } else {
        setStage.funds = { $add: [{ $ifNull: ["$funds", 0] }, funds] };
      }
    }
    if (cashOnHand !== undefined && cashOnHand !== 0) {
      if (forexEnabled) {
        if (currency) {
          // Grant specific currency literal to all targeted characters.
          // No FX conversion — amount is interpreted as already denominated in `currency`.
          setStage[`currencyBalances.personal.${currency}`] = {
            $add: [{ $ifNull: [`$currencyBalances.personal.${currency}`, 0] }, cashOnHand],
          };
        } else {
          // Route to each character's home currency, converting ₳ → home currency at the
          // live FX rate so every country receives equal real value. `cashOnHand` is
          // interpreted as internal units (USD-equivalent, rate = 1.0). Built per-currency
          // so currencies shared by two countries (EUR: DE + IE) accumulate into one bucket
          // at one rate instead of clobbering each other (which previously zeroed out DE).
          const rateDocs = await db.collection<ExchangeRate>("exchangeRates").find({}).toArray();
          const rateByCountry = new Map<string, number>(
            rateDocs.map((r) => [r._id as string, r.rate])
          );
          Object.assign(setStage, buildHomeCurrencyCashGrantSetStage(cashOnHand, rateByCountry));
        }
      } else {
        setStage.cashOnHand = { $add: [{ $ifNull: ["$cashOnHand", 0] }, cashOnHand] };
      }
    }

    let affectedCount = 0;

    if (allPlayers) {
      const result = await db
        .collection<Character>("characters")
        .updateMany({}, [{ $set: setStage }]);
      affectedCount = result.modifiedCount;
    } else {
      const ids = characterIds ?? [];
      const objectIds = ids.map((id: string) => new ObjectId(id));

      const result = await db
        .collection<Character>("characters")
        .updateMany({ _id: { $in: objectIds } }, [{ $set: setStage }]);
      affectedCount = result.modifiedCount;
    }

    const resourceParts: string[] = [];
    if (actions !== undefined && actions !== 0) {
      resourceParts.push(`${actions > 0 ? "+" : ""}${actions} actions`);
    }
    if (funds !== undefined && funds !== 0) {
      resourceParts.push(
        `${funds > 0 ? "+" : "-"}₳${Math.abs(funds).toLocaleString()} campaign funds (auto-converted → home currency)`
      );
    }
    if (cashOnHand !== undefined && cashOnHand !== 0) {
      const currLabel = currency
        ? `${currency} cash (literal)`
        : "cash on hand (auto-converted ₳ → home currency)";
      resourceParts.push(
        `${cashOnHand > 0 ? "+" : "-"}₳${Math.abs(cashOnHand).toLocaleString()} ${currLabel}`
      );
    }
    const resourceDesc = resourceParts.join(", ");

    await createModAuditLog({
      moderatorId: moderator.userId,
      moderatorName: moderator.username,
      action: "grant_resources",
      details: `Granted ${resourceDesc} to ${allPlayers ? "all players" : `${affectedCount} player(s)`}`,
    });

    return NextResponse.json({
      success: true,
      message: `Successfully granted ${resourceDesc} to ${affectedCount} player(s)`,
      affectedCount,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
