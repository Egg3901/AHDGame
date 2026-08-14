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
import { componentsForStrategy } from "@/lib/military/arsenalComponents";
import { canSupply } from "@/lib/turn/defenceDeliveryTurn";
import { lotPrice } from "@/lib/military/arsenal";
import { militaryPriceAnchor } from "@/lib/military/procurement";
import { awardContract, cancelContract } from "@/lib/db/collections/defenceContracts";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { createNotifications } from "@/lib/notifications";
import { COUNTRY_CONFIGS as COUNTRIES } from "@/lib/constants/countries";
import { ensureFederalBudget } from "@/lib/turn/ensureFederalBudget";
import { getGameState } from "@/lib/gameState";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

const awardSchema = z.object({
  sectorId: z.string().min(1),
  lotsOrdered: z.number().int().positive().max(1_000_000),
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
  return { db, countryId } as const;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, positionId } = await params;
    const guard = await requireDefenceHolder(code, positionId);
    if ("error" in guard) return guard.error;
    const { db, countryId } = guard;

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

    // What this plant is certified to supply comes from the production strategy its CEO
    // already chose. `cyber` maps to nothing — it makes electronics and software, not
    // materiel — so it is refused here rather than awarded a contract it can never fill.
    const components = componentsForStrategy(sector.strategyId);
    if (components.length === 0) {
      return NextResponse.json(
        {
          error:
            "This plant's production line does not build materiel. Change its strategy to a " +
            "line that supplies an arsenal component first.",
        },
        { status: 400 }
      );
    }

    const corp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: sector.corporationId });
    if (!corp) {
      return NextResponse.json({ error: "No such corporation" }, { status: 404 });
    }
    // Domestic-only, plus a currency check. Missing `liquidCurrencyCode` is inferred from
    // the corp's country (same as the rest of the corp economy), not treated as USD.
    if (!canSupply(corp, countryId)) {
      return NextResponse.json(
        {
          error:
            "Contracts may only be awarded to domestic suppliers paid in this country's currency.",
        },
        { status: 400 }
      );
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

    const anchor = militaryPriceAnchor(budget.gdp, budget.militaryPriceBaselineGdp);
    const pricePerLot = lotPrice(countryId, anchor);
    if (pricePerLot == null) {
      return NextResponse.json(
        { error: "This country has no usable GDP figure — procurement is unavailable" },
        { status: 409 }
      );
    }

    const stateOwned = isStateOwned(corp);
    const contract = await awardContract(db, {
      countryId,
      corporationId: corp._id,
      sectorId: sector._id,
      // A plant serving two domains supplies the first; the CEO picks the other by
      // re-tooling. Splitting one contract across components would make "lots delivered"
      // ambiguous against a single ordered figure.
      component: components[0],
      lotsOrdered: parsed.data.lotsOrdered,
      pricePerLot,
      awardedTurn: gameState?.currentTurn ?? 1,
      activateImmediately: stateOwned,
    });

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
