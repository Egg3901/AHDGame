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
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import type { Corporation, CorporateSector } from "@/lib/db/types/corporation";
import { lotPrice } from "@/lib/military/arsenal";
import { militaryPriceAnchor } from "@/lib/military/procurement";
import { resolveFillEligibility, FILL_REASON_TEXT } from "@/lib/military/defenceFillEligibility";
import {
  lotPriceBand,
  lotProductionCost,
  defaultFactoryAllocation,
  DEFENCE_FACTORY_SLOTS_PER_PLANT,
} from "@/lib/military/defenceLotEconomics";
import { loadDefencePriceRatios } from "@/lib/military/defencePriceRatios";
import {
  resolveSelfDealing,
  selfDealingFavorabilityPenalty,
  selfDealingDisclosure,
} from "@/lib/military/defenceSelfDealing";
import {
  awardContract,
  cancelContract,
  assignedFactoriesForSector,
} from "@/lib/db/collections/defenceContracts";
import {
  encumberAppropriation,
  releaseEncumbrance,
  getDefenseAppropriation,
  uncommittedFrom,
} from "@/lib/db/collections/defenseAppropriation";
import { createSystemNewsPost } from "@/lib/news";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { createNotifications } from "@/lib/notifications";
import { COUNTRY_CONFIGS as COUNTRIES } from "@/lib/constants/countries";
import { ensureFederalBudget } from "@/lib/turn/ensureFederalBudget";
import { getGameState } from "@/lib/gameState";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import {
  isDefenceProcurementPaused,
  DEFENCE_PROCUREMENT_PAUSED_MESSAGE,
} from "@/lib/military/procurementGate";
import { resolveDefenseLineFrom } from "@/lib/turn/defenseEnvelope";
import {
  getDefenceContractAvailability,
  releaseDefenceContractLots,
  reserveDefenceContractLots,
} from "@/lib/db/collections/defenceProcurementAllocations";

const awardSchema = z.object({
  sectorId: z.string().min(1),
  lotsOrdered: z.number().int().positive(),
  /**
   * Suggestion #291. Optional: omitted means "quote me a fair price", which is what every
   * contract got before ministers could set one. Bounded server-side against the price band -
   * the client's own bounds are a convenience, never the enforcement.
   */
  pricePerLot: z.number().positive().optional(),
  /** Suggestion #292. The grade the minister is buying, 0 (cheap mass) to 3 (premium). */
  gradeCeiling: z.number().int().min(0).max(3).optional(),
});

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

/** Shared guard: valid country, real defence seat, caller holds it (or is admin). */
async function requireDefenceHolder(code: string, positionId: string) {
  const auth = await requireAuth();
  if (!auth.ok) return { error: auth.response } as const;

  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) {
    return { error: NextResponse.json({ error: "Invalid country" }, { status: 400 }) } as const;
  }
  if (DEFENSE_POSITION_BY_COUNTRY[countryId] !== positionId) {
    return {
      error: NextResponse.json({ error: "Not a defense cabinet position" }, { status: 404 }),
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
      error: NextResponse.json(
        { error: "Only the defence minister may manage procurement contracts." },
        { status: 403 }
      ),
    } as const;
  }
  // The holder's identity rides along: self-dealing disclosure needs to know who signed, and
  // resolving it a second time from the route would be a second chance to resolve it wrongly.
  return { db, countryId, member, user: auth.user } as const;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, positionId } = await params;
    const guard = await requireDefenceHolder(code, positionId);
    if ("error" in guard) return guard.error;
    const { db, countryId } = guard;

    // Kill switch: no NEW contracts while procurement is frozen. Cancel (DELETE) stays open so
    // a minister can still wind down open orders, and active contracts keep delivering.
    if (await isDefenceProcurementPaused(db)) {
      return NextResponse.json({ error: DEFENCE_PROCUREMENT_PAUSED_MESSAGE }, { status: 409 });
    }

    const parsed = await parseJsonBody(request, awardSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    let sectorObjectId: ObjectId;
    try {
      sectorObjectId = new ObjectId(parsed.data.sectorId);
    } catch {
      return NextResponse.json({ error: "Invalid sector id" }, { status: 400 });
    }

    const sector = await db
      .collection<CorporateSector>("corporateSectors")
      .findOne({ _id: sectorObjectId });
    if (!sector) {
      return NextResponse.json({ error: "No such plant" }, { status: 404 });
    }
    if (sector.sectorType !== "defense") {
      return NextResponse.json(
        { error: "Only a defence plant can hold a procurement contract" },
        { status: 400 }
      );
    }

    const corp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: sector.corporationId });
    if (!corp) {
      return NextResponse.json({ error: "No such corporation" }, { status: 404 });
    }

    const gameState = await getGameState();
    const budget = await ensureFederalBudget(
      db,
      countryId,
      gameState?.preset ?? DEFAULT_SEED_PRESET
    );
    if (!budget || budget.countryId !== countryId) {
      return NextResponse.json(
        { error: "This country has no usable national budget — procurement is unavailable" },
        { status: 409 }
      );
    }

    const currentTurn = gameState?.currentTurn ?? 1;
    const currentYear = STARTING_YEAR + Math.floor((currentTurn - 1) / TURNS_PER_YEAR);

    // ONE eligibility question, the same one the delivery sweep will ask. Awardable must mean
    // deliverable: every divergence between these two checks has shipped as a ticket where a
    // minister successfully awarded a contract that then never delivered a single lot.
    const fill = resolveFillEligibility({ corp, sector, countryId, currentYear });
    if (!fill.eligible) {
      return NextResponse.json(
        { error: FILL_REASON_TEXT[fill.reason ?? "no_materiel_line"] },
        { status: 400 }
      );
    }
    const components = fill.components;

    const anchor = militaryPriceAnchor(budget.gdp, budget.militaryPriceBaselineGdp);
    const anchorPrice = lotPrice(countryId, anchor);
    if (anchorPrice == null) {
      return NextResponse.json(
        { error: "This country has no usable GDP figure — procurement is unavailable" },
        { status: 409 }
      );
    }

    // Grade the minister is buying (suggestion #292), capped at what this supplier can build.
    // Asking for grade 3 from a corporation whose research tops out at 1 would price the
    // contract as premium and deliver legacy kit.
    const gradeCeiling = Math.min(
      parsed.data.gradeCeiling ?? Math.round(fill.gradeCeiling),
      Math.round(fill.gradeCeiling)
    );

    // LIVE input prices, not the recipe's nominal share. The band a minister negotiates inside
    // has to track the commodity market, or the floor is a constant dressed up as a cost and a
    // supplier can be held to a price struck in a market that no longer exists.
    const priceRatios = await loadDefencePriceRatios(db);
    const productionCost = lotProductionCost(sector.strategyId, priceRatios);
    if (productionCost == null) {
      return NextResponse.json({ error: FILL_REASON_TEXT.no_materiel_line }, { status: 400 });
    }
    const band = lotPriceBand({ anchorPrice, productionCost, grade: gradeCeiling });
    if (band == null) {
      return NextResponse.json(
        { error: "This plant cannot be priced right now - procurement is unavailable" },
        { status: 409 }
      );
    }
    // Suggestion #291. A minister may negotiate inside the band and nowhere else: below the
    // floor the supplier builds at a loss it never agreed to, above the ceiling the
    // appropriation is a private cash tap again.
    const requested = parsed.data.pricePerLot;
    if (requested != null && (requested < band.floor || requested > band.ceiling)) {
      return NextResponse.json(
        {
          error:
            `A grade-${gradeCeiling} lot from this plant must be priced between ` +
            `${band.floor.toLocaleString("en-US")} and ${band.ceiling.toLocaleString("en-US")}.`,
          priceBand: band,
        },
        { status: 400 }
      );
    }
    const pricePerLot = Math.round(requested ?? band.suggested);
    const defenseLine = resolveDefenseLineFrom(budget);
    const availability = await getDefenceContractAvailability(db, {
      countryId,
      corporationId: corp._id.toString(),
      currentTurn,
      defenseLine,
      pricePerLot,
    });
    if (parsed.data.lotsOrdered > availability.maxLots) {
      return NextResponse.json(
        {
          error:
            availability.maxLots > 0
              ? `This supplier may receive at most ${availability.maxLots.toLocaleString("en-US")} more lots in the current contracting window.`
              : "This supplier has no contracting allowance left in the current window.",
          maximumLots: availability.maxLots,
          windowEndTurn: availability.window.endTurn,
        },
        { status: 409 }
      );
    }

    const reservation = await reserveDefenceContractLots(db, {
      countryId,
      corporationId: corp._id.toString(),
      currentTurn,
      defenseLine,
      pricePerLot,
      lots: parsed.data.lotsOrdered,
    });
    if (!reservation.reserved) {
      return NextResponse.json(
        {
          error: "The contracting allowance changed. Refresh and try a smaller order.",
          maximumLots: reservation.maxLots,
          windowEndTurn: reservation.window.endTurn,
        },
        { status: 409 }
      );
    }

    // THE OBLIGATION. The full cost of the order is committed against the appropriation right
    // now, before the contract exists, and total live obligations can never exceed the
    // uncommitted appropriation. This is the guard that closes the drain: an order for a
    // million lots is not "expensive later", it is refused here, because the money for it is
    // not there. Everything downstream - delivery, cancellation, completion - only ever draws
    // this commitment down or hands it back.
    const contractValue = parsed.data.lotsOrdered * pricePerLot;
    const releaseWindow = () =>
      releaseDefenceContractLots(
        db,
        reservation.window.id,
        corp._id.toString(),
        parsed.data.lotsOrdered * pricePerLot
      );
    if (!(await encumberAppropriation(db, countryId, contractValue))) {
      await releaseWindow();
      const appropriation = await getDefenseAppropriation(db, countryId);
      const uncommitted = Math.max(0, uncommittedFrom(appropriation));
      return NextResponse.json(
        {
          error:
            `This order would commit ${Math.round(contractValue).toLocaleString("en-US")} but ` +
            `only ${Math.round(uncommitted).toLocaleString("en-US")} of the defence ` +
            `appropriation is uncommitted. Cancel an open contract or order fewer lots.`,
          uncommittedAppropriation: uncommitted,
          maximumLots: pricePerLot > 0 ? Math.floor(uncommitted / pricePerLot) : 0,
        },
        { status: 409 }
      );
    }

    // Suggestion #281: the order opens on the share of the plant's lines that reproduces the
    // old even split, minus whatever its other live orders already hold. The contractor can
    // re-allocate afterwards; the minister does not get to book lines they do not own.
    const usedSlots = await assignedFactoriesForSector(
      db,
      sector._id,
      defaultFactoryAllocation(components.length, DEFENCE_FACTORY_SLOTS_PER_PLANT)
    );
    const assignedFactories = defaultFactoryAllocation(
      components.length,
      Math.max(0, DEFENCE_FACTORY_SLOTS_PER_PLANT - usedSlots)
    );

    const selfDealing = resolveSelfDealing({
      corp,
      ministerUserId: guard.user.userId ? new ObjectId(guard.user.userId.toString()) : null,
      ministerCharacterId: guard.user.character?._id ?? null,
    });
    const favorabilityPenalty = selfDealing.basis
      ? selfDealingFavorabilityPenalty({
          contractValue,
          tranche: reservation.procurementNotional,
        })
      : 0;

    const stateOwned = isStateOwned(corp);
    let contract;
    try {
      contract = await awardContract(db, {
        countryId,
        corporationId: corp._id,
        sectorId: sector._id,
        // A plant serving two domains supplies the first; the CEO picks the other by
        // re-tooling. Splitting one contract across components would make "lots delivered"
        // ambiguous against a single ordered figure.
        component: components[0],
        lotsOrdered: parsed.data.lotsOrdered,
        pricePerLot,
        awardedTurn: currentTurn,
        allocationWindowId: reservation.window.id,
        allocatedLots: parsed.data.lotsOrdered,
        encumberedAmount: contractValue,
        gradeCeiling,
        assignedFactories,
        ...(selfDealing.basis
          ? {
              selfDealing: {
                basis: selfDealing.basis,
                stakeShare: selfDealing.stakeShare,
                ministerCharacterId: guard.user.character?._id,
                ministerName: guard.user.character?.name,
                favorabilityPenalty,
              },
            }
          : {}),
        activateImmediately: stateOwned,
      });
    } catch (error) {
      await releaseEncumbrance(db, countryId, contractValue);
      await releaseWindow();
      throw error;
    }

    // Disclosure and its price. Marked on the contract (both order books read it), stated on
    // the public wire, and charged to the minister's own standing. Deliberately not a refusal:
    // contracting your own industry is a legitimate thing a government does, and the game's
    // answer to corruption everywhere else is that the voters find out.
    if (selfDealing.basis && guard.user.character) {
      await db
        .collection("characters")
        .updateOne(
          { _id: guard.user.character._id },
          { $inc: { favorability: -favorabilityPenalty } }
        );
      await createSystemNewsPost(
        selfDealingDisclosure({
          basis: selfDealing.basis,
          ministerName: guard.user.character.name ?? "The defence minister",
          corporationName: corp.name ?? "the supplier",
          countryName: COUNTRIES[countryId]?.name ?? countryId,
          lots: parsed.data.lotsOrdered,
          value: contractValue,
          stakeShare: selfDealing.stakeShare,
        }),
        "executive",
        { title: "Defence contract awarded to minister's own company" }
      );
    }

    // A private CEO must learn of the offer or it sits pending forever. A National
    // Corporation has no one to accept; the order is already active.
    if (corp.userId) {
      const buyer = COUNTRIES[countryId]?.name ?? countryId;
      await createNotifications([
        {
          userId: corp.userId,
          type: "defence_contract_offered",
          title: stateOwned ? "Defence Contract Awarded" : "Defence Contract Offered",
          message: stateOwned
            ? `${buyer} has placed an order with ${corp.name ?? "your corporation"} for ` +
              `${parsed.data.lotsOrdered.toLocaleString("en-US")} lots of ${components[0]} ` +
              `materiel at ${Math.round(pricePerLot).toLocaleString("en-US")} per lot, paid on ` +
              `delivery. Deliveries begin next turn.`
            : `${buyer} has offered ${corp.name ?? "your corporation"} a contract for ` +
              `${parsed.data.lotsOrdered.toLocaleString("en-US")} lots of ${components[0]} ` +
              `materiel at ${Math.round(pricePerLot).toLocaleString("en-US")} per lot, paid on ` +
              `delivery. Accept or decline it on your corporation's Defence tab.`,
          metadata: {
            contractId: contract._id.toString(),
            corporationId: corp._id.toString(),
            countryId,
            component: components[0],
            lotsOrdered: parsed.data.lotsOrdered,
            pricePerLot,
          },
        },
      ]);
    }

    return NextResponse.json({
      success: true,
      contract: { ...contract, _id: contract._id.toString() },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { code, positionId } = await params;
    const guard = await requireDefenceHolder(code, positionId);
    if ("error" in guard) return guard.error;
    const { db, countryId } = guard;

    const contractId = new URL(request.url).searchParams.get("contractId");
    if (!contractId) {
      return NextResponse.json({ error: "contractId is required" }, { status: 400 });
    }
    let objectId: ObjectId;
    try {
      objectId = new ObjectId(contractId);
    } catch {
      return NextResponse.json({ error: "Invalid contract id" }, { status: 400 });
    }

    // Scoped to the caller's own country: without this a defence minister could cancel
    // another nation's contracts by id.
    const contract = await db.collection("defenceContracts").findOne({ _id: objectId, countryId });
    if (!contract) {
      return NextResponse.json({ error: "No such contract" }, { status: 404 });
    }

    const cancelled = await cancelContract(db, objectId);
    return NextResponse.json({ success: true, cancelled });
  } catch (error) {
    return handleRouteError(error);
  }
}
