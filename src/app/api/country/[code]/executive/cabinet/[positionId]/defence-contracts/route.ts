// POST   /api/country/[code]/executive/cabinet/[positionId]/defence-contracts  — award
// DELETE /api/country/[code]/executive/cabinet/[positionId]/defence-contracts?contractId=  — cancel
//
// Auth: defence cabinet holder or admin, on the country's own defence seat.
//
// Deliberately NOT gated on `conflictsEnabled`. Procurement is base military/economy — the
// recruit and upgrade routes are ungated for the same reason — and an arsenal that only
// filled while the conflicts subsystem was on would leave every unit hollow on worlds that
// have it off.
//
// Errors: 400, 401, 403, 404, 409
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { requireConfirmedSecretary } from "@/lib/api/requireConfirmedSecretary";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import type { Corporation } from "@/lib/db/types/corporation";
import {
  terminationBasis,
  terminationFee,
  terminationFavorabilityPenalty,
  terminationDisclosure,
  terminationNoticeToSupplier,
} from "@/lib/military/defenceTermination";
import { findCompetingSupplierInterest } from "@/lib/military/defenceMinisterInterests";
import { applyMoneyMove } from "@/lib/banking/moneyMove";
import type { DefenceContract } from "@/lib/db/types/defenceContract";
import { cancelContract } from "@/lib/db/collections/defenceContracts";
import { getDefenseAppropriation } from "@/lib/db/collections/defenseAppropriation";
import { createSystemNewsPost } from "@/lib/news";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { createNotifications } from "@/lib/notifications";
import { COUNTRY_CONFIGS as COUNTRIES } from "@/lib/constants/countries";
import { ensureFederalBudget } from "@/lib/turn/ensureFederalBudget";
import { getGameState } from "@/lib/gameState";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { resolveDefenseLineFrom } from "@/lib/turn/defenseEnvelope";
import { getDefenceContractAvailability } from "@/lib/db/collections/defenceProcurementAllocations";

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

/** Shared guard: valid country, real defence seat, caller holds it (or is admin). */
async function requireDefenceHolder(code: string, positionId: string) {
  const auth = await requireAuth();
  if (!auth.ok) return { error: auth.response } as const;

  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) {
    return { error: errorResponse(400, "Invalid country") } as const;
  }
  if (DEFENSE_POSITION_BY_COUNTRY[countryId] !== positionId) {
    return {
      error: errorResponse(404, "Not a defense cabinet position"),
    } as const;
  }

  const db = await getDb();
  const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
  const isHolder =
    member?.characterId &&
    auth.user.character &&
    member.characterId.toString() === auth.user.character._id.toString();
  if (!isHolder && !auth.user.isAdmin) {
    return {
      error: errorResponse(403, "Only the defence minister may manage procurement contracts."),
    } as const;
  }
  // Procurement is the clearest case of a lever that outlives its holder: an awarded
  // contract obligates money across a 12-turn window, and a cancellation exposes the
  // country to damages the confirmed successor has to pay. Guarding the shared helper
  // covers both the award and the cancel.
  const actingDenied = requireConfirmedSecretary(member, "procurement", !!auth.user.isAdmin);
  if (actingDenied) return { error: actingDenied } as const;

  // The holder's identity rides along: self-dealing disclosure needs to know who signed, and
  // resolving it a second time from the route would be a second chance to resolve it wrongly.
  return { db, countryId, member, user: auth.user } as const;
}

export async function POST() {
  return errorResponse(
    410,
    "Direct awards have been replaced by government contract bidding. Publish a country tender instead."
  );
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { code, positionId } = await params;
    const guard = await requireDefenceHolder(code, positionId);
    if ("error" in guard) return guard.error;
    const { db, countryId } = guard;

    const contractId = new URL(request.url).searchParams.get("contractId");
    if (!contractId) {
      return errorResponse(400, "contractId is required");
    }
    let objectId: ObjectId;
    try {
      objectId = new ObjectId(contractId);
    } catch {
      return errorResponse(400, "Invalid contract id");
    }

    // Scoped to the caller's own country: without this a defence minister could cancel
    // another nation's contracts by id.
    const contract = await db
      .collection<DefenceContract>("defenceContracts")
      .findOne({ _id: objectId, countryId });
    if (!contract) {
      return errorResponse(404, "No such contract");
    }

    const basis = terminationBasis(contract);
    const fee = terminationFee({ ...contract, basis });

    // Refused BEFORE anything is cancelled. The contract's own commitment covers the fee by
    // construction, so this only bites a country already spending into arrears - and a
    // minister who cannot pay the break fee does not get to tear the contract up and leave
    // the supplier holding the bill.
    if (fee > 0) {
      const appropriation = await getDefenseAppropriation(db, countryId);
      if (appropriation.balance < fee) {
        return errorResponse(
          409,
          `Terminating this contract owes the supplier ` +
            `${fee.toLocaleString("en-US")} in break fees and the defence appropriation ` +
            `holds ${Math.round(appropriation.balance).toLocaleString("en-US")}. Let the ` +
            `order run, or wait for the appropriation to accrue.`,
          { extra: { terminationFee: fee } }
        );
      }
    }

    const corp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: contract.corporationId });

    // Only a convenience termination is a conflict question. Withdrawing an unanswered offer
    // and dropping a plant that has not built anything for three turns are things a minister
    // is supposed to do, and putting either on the wire would teach players to read the wire
    // as noise.
    const competing =
      basis === "convenience"
        ? await findCompetingSupplierInterest(db, {
            countryId,
            ministerUserId: guard.user.userId ? new ObjectId(guard.user.userId.toString()) : null,
            ministerCharacterId: guard.user.character?._id ?? null,
            excludeCorporationId: contract.corporationId,
          })
        : null;

    const lotsCancelled = Math.max(0, contract.lotsOrdered - contract.lotsDelivered);
    const cancelledValue = lotsCancelled * contract.pricePerLot;
    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 1;
    const tranche =
      basis === "convenience"
        ? (
            await getDefenceContractAvailability(db, {
              countryId,
              corporationId: contract.corporationId.toString(),
              currentTurn,
              defenseLine: resolveDefenseLineFrom(
                await ensureFederalBudget(db, countryId, gameState?.preset ?? DEFAULT_SEED_PRESET)
              ),
              pricePerLot: contract.pricePerLot,
              stateOwned: corp ? isStateOwned(corp) : false,
            })
          ).procurementNotional
        : 0;
    const favorabilityPenalty =
      basis === "convenience"
        ? terminationFavorabilityPenalty({
            cancelledValue,
            tranche,
            conflicted: competing != null,
          })
        : 0;

    const cancelled = await cancelContract(db, objectId, {
      // A convenience termination keeps the tranche spent. Cancel a rival and the room does
      // not come back to you this window; that is the loop this closes.
      releaseQuota: basis !== "convenience",
      termination: {
        basis,
        fee,
        lotsCancelled,
        ministerCharacterId: guard.user.character?._id,
        ministerName: guard.user.character?.name,
        favorabilityPenalty,
        ...(competing ? { competingSupplierName: competing.name } : {}),
        turn: currentTurn,
      },
    });
    if (!cancelled) {
      return errorResponse(
        409,
        "That contract is no longer open, or it changed while you were looking at it."
      );
    }

    // The break fee. Paid AFTER the order is closed so a supplier cannot bank a delivery
    // against money already earmarked as compensation, and through the shared primitive so a
    // leg that throws lands in the repair queue rather than vanishing.
    //
    // Whether it landed is WRITTEN DOWN. A termination that says a fee was owed while the
    // money never moved is exactly the silent gap the money primitive exists to make visible,
    // and the supplier is about to be told they were paid. The key is derived from the
    // contract, so a repair replays it without paying twice.
    let feePaid = fee <= 0;
    if (fee > 0 && corp) {
      const move = await applyMoneyMove(db, {
        key: `defence_contract_termination:${objectId.toString()}`,
        kind: "defence_contract_termination",
        turn: currentTurn,
        legs: [
          {
            kind: "debit",
            amount: fee,
            collection: "federalBudget",
            filter: { countryId },
            path: "defenseAppropriation.balance",
            note: `${countryId} pays break fees on a terminated defence contract`,
          },
          {
            kind: "credit",
            amount: fee,
            collection: "corporations",
            filter: { _id: corp._id },
            path: "liquidCapital",
            note: "supplier is compensated for lots it was ordered to build and will not",
          },
        ],
      }).catch(() => null);
      feePaid = move?.status === "applied" || move?.status === "replayed";
      await db
        .collection("defenceContracts")
        .updateOne({ _id: objectId }, { $set: { "termination.feePaid": feePaid } });
    }

    // Disclosure and its price, the same answer the game gives to a self-dealt award: not a
    // refusal, because withdrawing from a contract is a legitimate thing a government does,
    // but the voters find out and the minister wears it.
    if (basis === "convenience" && guard.user.character) {
      if (favorabilityPenalty > 0) {
        await db
          .collection("characters")
          .updateOne(
            { _id: guard.user.character._id },
            { $inc: { favorability: -favorabilityPenalty } }
          );
      }
      await createSystemNewsPost(
        terminationDisclosure({
          ministerName: guard.user.character.name ?? "The defence minister",
          supplierName: corp?.name ?? "the supplier",
          countryName: COUNTRIES[countryId]?.name ?? countryId,
          lots: lotsCancelled,
          fee,
          ...(competing ? { competingSupplierName: competing.name } : {}),
        }),
        "executive",
        {
          title: competing
            ? "Minister cancels a rival's defence contract"
            : "Defence contract terminated",
        }
      );
    }

    // The supplier learns it from a notification either way. Before this, a CEO whose order
    // was torn up mid-build found out by noticing it had stopped.
    if (corp?.userId) {
      await createNotifications([
        {
          userId: corp.userId,
          type: "defence_contract_cancelled",
          title: basis === "withdrawal" ? "Defence Offer Withdrawn" : "Defence Contract Terminated",
          message: terminationNoticeToSupplier({
            basis,
            countryName: COUNTRIES[countryId]?.name ?? countryId,
            lots: lotsCancelled,
            fee,
            feePaid,
          }),
          metadata: {
            contractId: objectId.toString(),
            corporationId: contract.corporationId.toString(),
            countryId,
            basis,
            lotsCancelled,
            fee,
            feePaid,
          },
        },
      ]);
    }

    return NextResponse.json({
      success: true,
      cancelled: true,
      basis,
      terminationFee: fee,
      terminationFeePaid: feePaid,
      favorabilityPenalty,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
