// src/app/api/state/[id]/party/[partyId]/whip/route.ts
import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import type {
  StatePartyOrg,
  BillWhip,
  Bill,
  StateBill,
  CabinetNomination,
  ElectedOfficial,
  GameState,
  LegislationType,
  NPP,
  StateDemographics,
} from "@/lib/db/types";
import {
  applyWhipVotesToBill,
  applyWhipVotesToStateBill,
  applyWhipVotesToCabinet,
} from "@/lib/congress/applyWhipVotes";
import { statecraftWhipBonus } from "@/lib/partyWhips/whipSuccess";
import { USE_GROWTH_INCREMENT } from "@/lib/stats/statsConstants";
import {
  findPartyBySequentialId,
  getPartyIdString,
  getStatePartyOrgDocumentId,
} from "@/lib/db/partyLookup";
import {
  COUNTRY_CONFIGS,
  getSubNationalLegislatureKey,
  type CountryId,
} from "@/lib/constants/countries";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import {
  getCabinetWhipChamber,
  isCabinetNominationInCountry,
  isWhippableChamber,
} from "@/lib/partyWhips/constraints";
import { getPartyNppControlStatus } from "@/lib/parties/antiAbuseGuards";
import { inferWhipIssuerRole } from "@/lib/partyWhips/issuerRole";

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string }>;
}

const whipSchema = z.object({
  targetType: z.enum(["bill", "cabinetNomination"]),
  targetId: z.string().regex(/^[a-f\d]{24}$/i, "Invalid target ID"),
  chamber: z.string().min(1, "Chamber required"),
  direction: z.enum(["for", "against"]),
  mode: z.enum(["soft", "hard"]).default("hard"),
});

// POST /api/country/[code]/region/[id]/party/[partyId]/whip — Issue a state party whip directive for a bill or leadership election
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
/**
 * POST /api/state/[id]/party/[partyId]/whip
 * Create a whip directive for bills or leadership elections
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const stateId = id;

    // Get authenticated user with character
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const authData = auth.user;

    const db = await getDb();

    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }
    const partyKey = getPartyIdString(party);
    const statePartyKey = getStatePartyOrgDocumentId(stateId, party);

    const statePartyOrg = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .findOne({ _id: statePartyKey });

    if (!statePartyOrg) {
      return NextResponse.json({ error: "State party organization not found" }, { status: 404 });
    }

    // Check authorization - only Chair and Vice Chair can whip
    const characterId = authData.character._id;
    const isChair = statePartyOrg.chairId?.equals(characterId);
    const isViceChair = statePartyOrg.viceChairId?.equals(characterId);
    const isAdmin = authData.isAdmin;

    if (!isChair && !isViceChair && !isAdmin) {
      return NextResponse.json(
        { error: "Only the State Party Chair or Vice Chair can issue whip directives" },
        { status: 403 }
      );
    }

    const nppControl = await getPartyNppControlStatus({
      db,
      countryId,
      party,
      actor: authData.character,
      isAdmin,
    });
    if (!nppControl.ok) {
      return NextResponse.json({ error: nppControl.error }, { status: 403 });
    }

    const parsed = await parseJsonBody(request, whipSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { targetType, targetId, chamber, direction, mode } = parsed.data;
    if (!isWhippableChamber(countryId, chamber)) {
      return NextResponse.json({ error: "Invalid chamber for this country" }, { status: 400 });
    }
    const cabinetChamber = getCabinetWhipChamber(countryId);
    const subNationalChamber = getSubNationalLegislatureKey(countryId);
    const federalBillCountryFilter = {
      $or: [{ countryId }, { countryId: { $exists: false } }],
    };

    // Validate target exists and is active
    const targetOid = new ObjectId(targetId);
    if (targetType === "bill") {
      const bill =
        chamber === subNationalChamber
          ? await db.collection<StateBill>("stateBills").findOne({
              _id: targetOid,
              stateId,
              status: { $in: ["active", "veto_override"] },
            })
          : await db.collection<Bill>("bills").findOne({
              _id: targetOid,
              status: {
                $in: ["active", "active_other", "active_both", "veto_override", "override_shugiin"],
              },
              ...federalBillCountryFilter,
            });
      if (!bill) {
        return NextResponse.json({ error: "Bill not found or voting not open" }, { status: 404 });
      }
    } else if (targetType === "cabinetNomination") {
      const nomination = await db.collection("cabinetNominations").findOne<CabinetNomination>({
        _id: targetOid,
        status: "active",
      });
      if (!nomination) {
        return NextResponse.json(
          { error: "Cabinet nomination not found or not active" },
          { status: 404 }
        );
      }
      if (!isCabinetNominationInCountry(nomination, countryId)) {
        return NextResponse.json(
          { error: "Cabinet nomination not found or not active" },
          { status: 404 }
        );
      }
      if (chamber !== cabinetChamber) {
        return NextResponse.json(
          { error: `Cabinet nominations can only be whipped in the ${cabinetChamber}` },
          { status: 400 }
        );
      }
    }

    // Check existing whips (max 2 per target/chamber)
    const existingWhips = await db
      .collection<BillWhip>("billWhips")
      .find({
        targetType,
        targetId: targetOid,
        chamber,
        partyId: partyKey,
        stateId,
      })
      .toArray();

    if (existingWhips.length >= 2) {
      return NextResponse.json(
        { error: "Maximum 2 whip attempts per bill/chamber reached" },
        { status: 400 }
      );
    }

    const attemptNumber = (existingWhips.length + 1) as 1 | 2;

    // Create whip
    const now = new Date();
    const whipDoc: Omit<BillWhip, "_id"> = {
      targetType,
      targetId: targetOid,
      chamber,
      direction,
      mode,
      issuedBy: "stateParty",
      countryId,
      stateId,
      partyId: partyKey,
      issuedByCharacterId: characterId,
      issuedByRole: inferWhipIssuerRole(isChair, isViceChair),
      audience: "npp",
      attemptNumber,
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.collection<BillWhip>("billWhips").insertOne(whipDoc as BillWhip);

    // Fetch party NPPs in this state/chamber and cast their votes immediately
    const nppOfficials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({
        isNPP: true,
        // Country-scope the officials. `state` already implies a country, but
        // party sequentialIds collide across countries — keep the filter
        // explicit and uniform with the other whip routes (bug #0699).
        countryId,
        party: partyKey,
        state: stateId,
        // Resolve the chamber key to the office type members are stored under
        // (CN: "npc" → "npcDelegate"); a state chair whipping a federal CN bill
        // would otherwise match no delegates and the whip would fall on nobody.
        officeType: getOfficeTypeForChamber(countryId, chamber),
      })
      .toArray();

    const nppIds = nppOfficials.map((o) => o.nppId).filter((id): id is ObjectId => !!id);

    const npps =
      nppIds.length > 0
        ? await db
            .collection<NPP>("npps")
            .find({ _id: { $in: nppIds } })
            .toArray()
        : [];

    const nppMap = new Map(npps.map((n) => [n._id.toString(), n]));

    let fellInLine = 0;
    let ignored = 0;

    // Statecraft sharpens a chair's whip and trains the stat (use-growth).
    const whipStatecraftBonus = statecraftWhipBonus(authData.character.stats?.statecraft);
    const grantStatecraftXp = async () => {
      await db
        .collection("characters")
        .updateOne({ _id: characterId }, { $inc: { "statXp.statecraft": USE_GROWTH_INCREMENT } });
    };

    if (targetType === "bill") {
      if (chamber === subNationalChamber) {
        const bill = await db
          .collection<StateBill>("stateBills")
          .findOne({ _id: targetOid, stateId });
        if (!bill) {
          return NextResponse.json({ error: "Bill not found or voting not open" }, { status: 404 });
        }
        // Phase 4: whip application resolves NPP votes via cross-pressure
        // (see @/lib/turn/npp/crossPressure.ts). Load the bill's legislation
        // type, all state demographics, and the current turn for the snapshot.
        const [legislationType, stateDemographicsArr, gameStateDoc] = await Promise.all([
          bill.legislationTypeId
            ? db
                .collection<LegislationType>("legislationTypes")
                .findOne({ _id: bill.legislationTypeId })
            : Promise.resolve(null),
          db
            .collection<StateDemographics>("stateDemographics")
            .find({
              _id: {
                $in: [
                  ...new Set(
                    [...nppMap.values()]
                      .map((n) => n.homeState)
                      .filter((s): s is string => typeof s === "string")
                  ),
                ],
              },
            })
            .toArray(),
          db
            .collection<GameState>("gameState")
            .findOne({ _id: "current" }, { projection: { currentTurn: 1 } }),
        ]);
        const stateDemographicsByState = new Map(stateDemographicsArr.map((s) => [s._id, s]));
        const r = await applyWhipVotesToStateBill(
          db,
          bill,
          direction,
          nppOfficials,
          nppMap,
          {
            legislationType,
            stateDemographicsByState,
            currentTurn: gameStateDoc?.currentTurn ?? 0,
          },
          mode,
          whipStatecraftBonus
        );
        fellInLine = r.fellInLine;
        ignored = r.ignored;
        if (authData.character.stats) await grantStatecraftXp();
      } else {
        const bill = await db.collection<Bill>("bills").findOne({ _id: targetOid });
        if (!bill || (bill.countryId && bill.countryId !== countryId)) {
          return NextResponse.json({ error: "Bill not found or voting not open" }, { status: 404 });
        }
        const [legislationType, stateDemographicsArr, gameStateDoc] = await Promise.all([
          bill.legislationTypeId
            ? db
                .collection<LegislationType>("legislationTypes")
                .findOne({ _id: bill.legislationTypeId })
            : Promise.resolve(null),
          db
            .collection<StateDemographics>("stateDemographics")
            .find({
              _id: {
                $in: [
                  ...new Set(
                    [...nppMap.values()]
                      .map((n) => n.homeState)
                      .filter((s): s is string => typeof s === "string")
                  ),
                ],
              },
            })
            .toArray(),
          db
            .collection<GameState>("gameState")
            .findOne({ _id: "current" }, { projection: { currentTurn: 1 } }),
        ]);
        const stateDemographicsByState = new Map(stateDemographicsArr.map((s) => [s._id, s]));
        const r = await applyWhipVotesToBill(
          db,
          bill,
          direction,
          nppOfficials,
          nppMap,
          {
            legislationType,
            stateDemographicsByState,
            currentTurn: gameStateDoc?.currentTurn ?? 0,
          },
          mode,
          whipStatecraftBonus
        );
        fellInLine = r.fellInLine;
        ignored = r.ignored;
        if (authData.character.stats) await grantStatecraftXp();
      }
    } else if (targetType === "cabinetNomination") {
      const r = await applyWhipVotesToCabinet(
        db,
        targetOid,
        direction,
        nppOfficials,
        nppMap,
        mode,
        whipStatecraftBonus
      );
      fellInLine = r.fellInLine;
      ignored = r.ignored;
      if (authData.character.stats) await grantStatecraftXp();
    }

    const ignoredFlavor = ["defied the whip", "remained unconvinced", "stood their ground"][
      Math.floor(Math.random() * 3)
    ];
    const message =
      targetType === "bill" && mode === "soft"
        ? `Soft whip directive issued (attempt ${attemptNumber}/2). This advisory pressure will feed into future NPP bill votes in ${stateId}.`
        : `Whip directive issued (attempt ${attemptNumber}/2). ${fellInLine} NPPs fell in line. ${ignored} NPPs ${ignoredFlavor}.`;

    return NextResponse.json({
      success: true,
      whipId: result.insertedId.toString(),
      attemptNumber,
      fellInLine,
      ignored,
      ignoredFlavor,
      message,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
