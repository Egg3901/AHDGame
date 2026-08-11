import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { adminResourcesGrantSchema } from "@/lib/api/schemas/admin";
import type { Character, ExchangeRate } from "@/lib/db/types";
import { ObjectId } from "mongodb";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  COUNTRY_CURRENCY_MAP,
  INITIAL_RATES,
  getCountryIdForCurrency,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import {
  buildHomeCurrencyCashGrantSetStage,
  buildCampaignFundsGrantExpression,
} from "@/lib/currency/grantCashBuilder";
import { ENERGY_MAX_ACTION_CAP } from "@/lib/stats/statsConstants";
import { emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { admin } = auth;

    const parsed = await parseJsonBody(request, adminResourcesGrantSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { characterIds, allPlayers, actions, funds, cashOnHand, currency } = parsed.data;

    const db = await getDb();
    const forexEnabled = await isForexEnabled();

    // Build the aggregation pipeline $set stage
    const setStage: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (actions !== undefined && actions !== 0) {
      if (actions > 0) {
        // Bulk updateMany can't compute a per-character Energy cap inline, so this
        // admin override clamps at the maximum possible cap (ENERGY_MAX_ACTION_CAP).
        // It never clamps a high-Energy player below their real cap; any over-grant
        // for a lower-Energy player is re-clamped to their cap by the next turn's
        // actionRefresh (energyActionLimits).
        setStage.actions = {
          $min: [ENERGY_MAX_ACTION_CAP, { $add: [{ $ifNull: ["$actions", 0] }, actions] }],
        };
      } else {
        setStage.actions = {
          $max: [0, { $add: [{ $ifNull: ["$actions", 0] }, actions] }],
        };
      }
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

    // Build description for log
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

    // Log the action
    const logNow = new Date();
    await db.collection("adminLogs").insertOne({
      category: "system",
      action: "resources_granted",
      username: "SYSTEM",
      adminUsername: admin.username,
      details: `Granted ${resourceDesc} to ${allPlayers ? "all players" : `${affectedCount} player(s)`}`,
      createdAt: logNow,
    });

    // Emit admin_transfer for specific character grants (auto-flagged by Tier 1).
    // Skip allPlayers grants — too many events to be useful in the ledger.
    if (
      !allPlayers &&
      characterIds &&
      characterIds.length > 0 &&
      ((funds !== undefined && funds !== 0) || (cashOnHand !== undefined && cashOnHand !== 0))
    ) {
      const objectIds = characterIds.map((id: string) => new ObjectId(id));
      const affectedChars = await db
        .collection<Character>("characters")
        .find({ _id: { $in: objectIds } }, { projection: { _id: 1, name: 1, countryId: 1 } })
        .toArray();
      const transferThresholds = await loadTxThresholds(db);
      const rateDocs = forexEnabled
        ? await db.collection<ExchangeRate>("exchangeRates").find({}).toArray()
        : [];
      const rateByCountry = new Map<string, number>(rateDocs.map((r) => [r._id as string, r.rate]));
      const transferEntries = affectedChars.flatMap((char) => {
        const homeCurrency = (COUNTRY_CURRENCY_MAP[
          char.countryId as keyof typeof COUNTRY_CURRENCY_MAP
        ] ?? "USD") as CurrencyCode;
        // Resolve the rate per-currency (via the currency's anchor country) so the ledger
        // amount matches the credit for countries that share a currency (e.g. IE uses the
        // DE-anchored EUR rate, not its own missing/initial rate).
        const anchorCountry = getCountryIdForCurrency(homeCurrency);
        const homeRate = rateByCountry.get(anchorCountry) ?? INITIAL_RATES[anchorCountry] ?? 1;
        const baseMeta = { adminUsername: admin.username, resourceDesc };
        const entries: Array<{
          type: "admin_transfer";
          turn: number;
          createdAt: Date;
          subjectType: "character";
          subjectId: ObjectId;
          subjectName: string;
          amount: number;
          currencyCode: CurrencyCode;
          meta: Record<string, unknown>;
        }> = [];

        if (funds !== undefined && funds !== 0) {
          entries.push({
            type: "admin_transfer",
            turn: 0,
            createdAt: logNow,
            subjectType: "character",
            subjectId: char._id,
            subjectName: char.name,
            amount: forexEnabled ? funds * homeRate : funds,
            currencyCode: homeCurrency,
            meta: { ...baseMeta, resource: "campaign_funds" },
          });
        }

        if (cashOnHand !== undefined && cashOnHand !== 0) {
          entries.push({
            type: "admin_transfer",
            turn: 0,
            createdAt: logNow,
            subjectType: "character",
            subjectId: char._id,
            subjectName: char.name,
            amount: forexEnabled && !currency ? cashOnHand * homeRate : cashOnHand,
            currencyCode: currency ?? homeCurrency,
            meta: { ...baseMeta, resource: "cash_on_hand" },
          });
        }

        return entries;
      });
      if (transferEntries.length > 0) {
        void emitTxBulk(db, transferEntries, transferThresholds);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Successfully granted ${resourceDesc} to ${affectedCount} player(s)`,
      affectedCount,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
