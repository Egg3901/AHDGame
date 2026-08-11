// POST /api/country/[code]/cabinet/treasury-transfer - Transfer federal surplus to CB FX reserve
// Auth: requireAuth - caller must hold the country's financeMinisterCabinetId seat (admin bypass)
// Errors: 400, 403, 404

import { NextResponse } from "next/server";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, forbidden, notFound, badRequest } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  TREASURY_TRANSFER_MAX_PER_TURN_FRACTION,
  TREASURY_TRANSFER_HISTORY_MAX,
} from "@/lib/constants/currencies";
import type { CentralBank } from "@/lib/db/types";
import type { TreasuryTransferRecord } from "@/lib/db/types/centralBank";
import type { FederalBudget } from "@/lib/db/types/budget";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { getGameState } from "@/lib/gameState";
import { getBankId } from "@/lib/centralBank/helpers";

interface RouteContext {
  params: Promise<{ code: string }>;
}

const schema = z.object({
  amount: z.number().positive(),
  justification: z.string().max(200).optional(),
});

function buildTreasuryTransferClaimFilter(bankId: string, currentTurn: number, isAdmin: boolean) {
  if (isAdmin) {
    return {
      _id: bankId,
      treasuryTransferInProgressAt: { $exists: false },
    };
  }

  return {
    _id: bankId,
    treasuryTransferInProgressAt: { $exists: false },
    $expr: {
      $let: {
        vars: { history: { $ifNull: ["$treasuryTransferHistory", []] } },
        in: {
          $or: [
            { $eq: [{ $size: "$$history" }, 0] },
            {
              $ne: [
                {
                  $let: {
                    vars: { lastTransfer: { $arrayElemAt: ["$$history", -1] } },
                    in: "$$lastTransfer.turn",
                  },
                },
                currentTurn,
              ],
            },
          ],
        },
      },
    },
  };
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;
    const config = COUNTRY_CONFIGS[countryId];
    if (!config) throw notFound("Country not found");
    if (!config.financeMinisterCabinetId) {
      throw badRequest("Treasury transfer is not configured for this country");
    }

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const myChar = auth.user.character;
    if (!myChar) throw forbidden("Character required");

    const isAdmin = auth.user.isAdmin === true;
    if (!isAdmin) {
      const member = await getCabinetMembersCollection(db).findOne({
        countryId,
        positionId: config.financeMinisterCabinetId,
        characterId: myChar._id,
      });
      if (!member) {
        throw forbidden(
          `Only the ${config.financeMinisterCabinetId} for ${countryId} can transfer to FX reserves`
        );
      }
    }

    const budgetId = countryId === COUNTRY_CONFIGS.US.id ? "federal" : countryId;
    const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
    if (!budget) throw notFound("Federal budget not found");

    const annualRevenue = budget.revenue?.total ?? 0;
    const perTurnCap = annualRevenue * TREASURY_TRANSFER_MAX_PER_TURN_FRACTION;
    if (parsed.data.amount > perTurnCap) {
      throw badRequest(
        `Transfer exceeds per-turn cap (${TREASURY_TRANSFER_MAX_PER_TURN_FRACTION * 100}% of annual revenue = ${perTurnCap.toFixed(0)}).`
      );
    }

    const debtCeiling = budget.debt?.ceiling;
    if (typeof debtCeiling === "number" && budget.surplus - parsed.data.amount < -debtCeiling) {
      throw badRequest("Transfer would breach the federal debt ceiling.");
    }

    const bankId = getBankId(countryId);
    const bank = await db.collection<CentralBank>("centralBanks").findOne({ _id: bankId });
    if (!bank) throw notFound("Central bank not found");

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;
    const now = new Date();
    const record: TreasuryTransferRecord = {
      turn: currentTurn,
      transferredBy: myChar._id ?? new ObjectId(auth.user.userId),
      transferredByName: myChar.name ?? auth.user.username ?? "Unknown",
      amount: parsed.data.amount,
      ...(parsed.data.justification ? { justification: parsed.data.justification } : {}),
      createdAt: now,
    };

    const budgetDebtFloor =
      typeof debtCeiling === "number" ? parsed.data.amount - debtCeiling : undefined;
    const claimFilter = buildTreasuryTransferClaimFilter(bankId, currentTurn, isAdmin);
    const budgetUpdate = {
      $inc: {
        surplus: -parsed.data.amount,
        "spending.byCategory.fxReserveTransfer": parsed.data.amount,
        "spending.total": parsed.data.amount,
      },
      $set: { updatedAt: now },
    };

    await runWithOptionalTransaction(
      async (session) => {
        const claimedBank = await db
          .collection<CentralBank>("centralBanks")
          .findOneAndUpdate(
            claimFilter,
            { $set: { treasuryTransferInProgressAt: now, updatedAt: now } },
            { returnDocument: "before", session }
          );
        if (!claimedBank) {
          throw badRequest("Only one treasury transfer per turn is permitted.");
        }

        const budgetResult = await db.collection<FederalBudget>("federalBudget").updateOne(
          {
            _id: budgetId,
            ...(budgetDebtFloor !== undefined ? { surplus: { $gte: budgetDebtFloor } } : {}),
          },
          budgetUpdate,
          { session }
        );
        if (budgetResult.matchedCount === 0) {
          throw badRequest("Transfer would breach the federal debt ceiling.");
        }

        const nextHistory = [...(claimedBank.treasuryTransferHistory ?? []), record].slice(
          -TREASURY_TRANSFER_HISTORY_MAX
        );
        const bankResult = await db.collection<CentralBank>("centralBanks").updateOne(
          { _id: bankId, treasuryTransferInProgressAt: now },
          {
            $inc: { reserveBalance: parsed.data.amount },
            $set: { treasuryTransferHistory: nextHistory, updatedAt: now },
            $unset: { treasuryTransferInProgressAt: "" },
          },
          { session }
        );
        if (bankResult.matchedCount === 0) {
          throw new Error("TREASURY_TRANSFER_CLAIM_LOST");
        }
      },
      async () => {
        const claimedBank = await db
          .collection<CentralBank>("centralBanks")
          .findOneAndUpdate(
            claimFilter,
            { $set: { treasuryTransferInProgressAt: now, updatedAt: now } },
            { returnDocument: "before" }
          );
        if (!claimedBank) {
          throw badRequest("Only one treasury transfer per turn is permitted.");
        }

        let budgetDebited = false;
        try {
          const budgetResult = await db.collection<FederalBudget>("federalBudget").updateOne(
            {
              _id: budgetId,
              ...(budgetDebtFloor !== undefined ? { surplus: { $gte: budgetDebtFloor } } : {}),
            },
            budgetUpdate
          );
          if (budgetResult.matchedCount === 0) {
            throw badRequest("Transfer would breach the federal debt ceiling.");
          }
          budgetDebited = true;

          const nextHistory = [...(claimedBank.treasuryTransferHistory ?? []), record].slice(
            -TREASURY_TRANSFER_HISTORY_MAX
          );
          const bankResult = await db.collection<CentralBank>("centralBanks").updateOne(
            { _id: bankId, treasuryTransferInProgressAt: now },
            {
              $inc: { reserveBalance: parsed.data.amount },
              $set: { treasuryTransferHistory: nextHistory, updatedAt: now },
              $unset: { treasuryTransferInProgressAt: "" },
            }
          );
          if (bankResult.matchedCount === 0) {
            throw new Error("TREASURY_TRANSFER_CLAIM_LOST");
          }
        } catch (error) {
          if (budgetDebited) {
            await db.collection<FederalBudget>("federalBudget").updateOne(
              { _id: budgetId },
              {
                $inc: {
                  surplus: parsed.data.amount,
                  "spending.byCategory.fxReserveTransfer": -parsed.data.amount,
                  "spending.total": -parsed.data.amount,
                },
                $set: { updatedAt: new Date() },
              }
            );
          }

          await db
            .collection<CentralBank>("centralBanks")
            .updateOne(
              { _id: bankId, treasuryTransferInProgressAt: now },
              { $unset: { treasuryTransferInProgressAt: "" }, $set: { updatedAt: new Date() } }
            );
          throw error;
        }
      }
    );

    return NextResponse.json({ success: true, transferred: parsed.data.amount, record });
  } catch (error) {
    return handleRouteError(error);
  }
}
