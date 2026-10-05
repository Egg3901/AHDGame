import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { errorResponse, handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { GameState } from "@/lib/db/types/gameState";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { RESET_V2_READY } from "@/lib/resetVersions/availability";
import { resetSystemVersionsForCountry } from "@/lib/resetVersions/rules";
import { resetCabinetActions } from "@/lib/resetCabinet/catalog";
import { useCabinetAction as activateCabinetAction } from "@/lib/resetCabinet/rules/actions";
import type { ResetCabinetActionState } from "@/lib/resetCabinet/rules/actionState";
import type { ResetDepartmentAccountSnapshot } from "@/lib/resetFinance/rules/liveDepartmentAccount";
import type { ResetCountry } from "@/lib/resetLegislation/fundingOwner";
import type { CountryId } from "@/lib/constants/countries";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";

const bodySchema = z.object({ actionId: z.string().min(1).max(120) }).strict();
const supported = new Set(["US", "UK", "JP"]);

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const { code, positionId } = await params;
    const countryId = code.toUpperCase();
    if (!supported.has(countryId)) {
      return errorResponse(404, "Cabinet v2 is not available for this country");
    }
    const action = resetCabinetActions.find(
      (candidate) =>
        candidate.id === parsed.data.actionId &&
        candidate.country === countryId &&
        candidate.seatId === positionId
    );
    if (!action) return errorResponse(400, "Unknown Cabinet action");

    const db = await getDb();
    const member = await getCabinetMembersCollection(db).findOne({
      countryId: countryId as CountryId,
      positionId,
    });
    const isHolder =
      member?.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if ((!isHolder && !auth.user.isAdmin) || !member?.characterId) {
      return errorResponse(403, "Only the seated Cabinet member or an admin can use this action");
    }
    const actorId = member.characterId.toString();
    const result = await runRequiredTransaction(async (session) => {
      const gameState = await db.collection<GameState>("gameState").findOne(
        { _id: "current" },
        {
          session,
          projection: {
            currentTurn: 1,
            resetWorldId: 1,
            metricsSystemVersion: 1,
            cabinetSystemVersion: 1,
            resetVersionSeeds: 1,
          },
        }
      );
      if (
        !gameState?.resetWorldId ||
        resetSystemVersionsForCountry(gameState, RESET_V2_READY, countryId).cabinet !== "v2"
      ) {
        return { status: 409, body: { error: "Cabinet v2 is not enabled in this world" } };
      }
      const country = countryId as ResetCountry;
      const [state, budget, accounts] = await Promise.all([
        db
          .collection<ResetCabinetActionState>("resetCabinetActionStates")
          .findOne({ _id: country, worldId: gameState.resetWorldId }, { session }),
        db
          .collection<FederalBudget>("federalBudget")
          .findOne({ countryId }, { session, projection: { gdp: 1, defenseAppropriation: 1 } }),
        db
          .collection<ResetDepartmentAccountSnapshot>("resetDepartmentAccounts")
          .find(
            {
              worldId: gameState.resetWorldId,
              countryId: country,
              controllingSeatId: positionId,
            },
            {
              session,
              projection: {
                _id: 1,
                worldId: 1,
                countryId: 1,
                controllingSeatId: 1,
                balance: 1,
                encumbered: 1,
                annualAuthority: 1,
                externallySettled: 1,
              },
            }
          )
          .sort({ _id: 1 })
          .toArray(),
      ]);
      if (!state || !budget || accounts.length === 0) {
        return { status: 503, body: { error: "Cabinet v2 accounts are unavailable" } };
      }
      const usesExternalAccount = accounts.every((account) => account.externallySettled);
      const usesDefenseAppropriation =
        usesExternalAccount && DEFENSE_POSITION_BY_COUNTRY[countryId as CountryId] === positionId;
      if (usesExternalAccount && !usesDefenseAppropriation) {
        return {
          status: 503,
          body: { error: "This specialized Cabinet account is not connected to v2 actions" },
        };
      }
      const flexibleFunds = usesDefenseAppropriation
        ? Math.max(
            0,
            (budget.defenseAppropriation?.balance ?? 0) -
              (budget.defenseAppropriation?.encumbered ?? 0)
          )
        : accounts.reduce(
            (sum, account) => sum + Math.max(0, account.balance - account.encumbered),
            0
          );
      const used = activateCabinetAction({
        action,
        turn: gameState.currentTurn,
        actor: state.actorStates[actorId] ?? {
          charges: 4,
          lastRechargeTurn: state.sourceTurn,
        },
        seatActive: true,
        legalAuthority: true,
        capacityAvailable: accounts.some((account) => account.annualAuthority > 0),
        annualNationalGdp: budget.gdp,
        flexibleOperatingFunds: flexibleFunds,
        active: state.active,
        history: state.history,
      });
      if (!used.allowed) {
        return { status: 409, body: { error: used.reason } };
      }
      let remainingDebit = used.operatingDebit;
      if (usesDefenseAppropriation && remainingDebit > 0) {
        const debit = Math.round(remainingDebit);
        const written = await db.collection<FederalBudget>("federalBudget").updateOne(
          {
            countryId,
            $expr: {
              $gte: [
                {
                  $subtract: [
                    { $ifNull: ["$defenseAppropriation.balance", 0] },
                    { $ifNull: ["$defenseAppropriation.encumbered", 0] },
                  ],
                },
                debit,
              ],
            },
          } as never,
          { $inc: { "defenseAppropriation.balance": -debit } },
          { session }
        );
        if (written.matchedCount !== 1)
          throw new Error("Defense appropriation changed concurrently");
        remainingDebit -= debit;
      } else {
        for (const account of accounts) {
          if (remainingDebit <= 0) break;
          const available = Math.max(0, account.balance - account.encumbered);
          const debit = Math.min(available, remainingDebit);
          if (debit > 0) {
            const written = await db
              .collection<ResetDepartmentAccountSnapshot>("resetDepartmentAccounts")
              .updateOne(
                {
                  _id: account._id,
                  worldId: gameState.resetWorldId,
                  balance: account.balance,
                  encumbered: account.encumbered,
                },
                { $inc: { balance: -debit } },
                { session }
              );
            if (written.matchedCount !== 1)
              throw new Error("Cabinet action account changed concurrently");
            remainingDebit -= debit;
          }
        }
      }
      if (remainingDebit > 0.01) throw new Error("Cabinet action debit did not reconcile");
      const written = await db
        .collection<ResetCabinetActionState>("resetCabinetActionStates")
        .updateOne(
          { _id: country, worldId: gameState.resetWorldId, updatedTurn: state.updatedTurn },
          {
            $set: {
              actorStates: { ...state.actorStates, [actorId]: used.actor },
              active: [...used.active],
              history: [...used.history],
              updatedTurn: gameState.currentTurn,
            },
          },
          { session }
        );
      if (written.matchedCount !== 1) throw new Error("Cabinet action state changed concurrently");
      return {
        status: 200,
        body: {
          success: true,
          chargesRemaining: used.actor.charges,
          operatingDebit: used.operatingDebit,
          active: used.active.find((entry) => entry.actionId === action.id),
        },
      };
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}
