import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import type { Bill, StatePartyOrg, BillWhip, StateBill, ElectedOfficial } from "@/lib/db/types";
import {
  findPartyBySequentialId,
  getPartyIdString,
  getStatePartyOrgDocumentId,
} from "@/lib/db/partyLookup";
import {
  COUNTRY_CONFIGS,
  getCountryConfig,
  getSubNationalLegislatureKey,
  type CountryId,
} from "@/lib/constants/countries";
import { resolveWhipIssuerRole } from "@/lib/congress/billWhipPanelData";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import { getGameState } from "@/lib/gameState";

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string }>;
}

interface BillWhipItem {
  bill: { id: string; title: string; status: string };
  existingWhips: Array<{
    direction: string;
    attemptNumber: number;
    issuedByRole?: string;
    mode: "soft" | "hard";
  }>;
  canWhip: boolean;
}

// GET /api/country/[code]/region/[id]/party/[partyId]/whippable-bills - Return active federal + local bills where the state party has NPP legislators
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404
/**
 * GET /api/state/[id]/party/[partyId]/whippable-bills
 * Returns whippable bills for the state party's federal delegation and
 * sub-national chamber, grouped by chamber key for the shared whip panels.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code, id, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const stateId = id;

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
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

    const characterId = authData.character._id;
    const isChair = statePartyOrg.chairId?.equals(characterId);
    const isViceChair = statePartyOrg.viceChairId?.equals(characterId);
    const isAdmin = authData.isAdmin;

    if (!isChair && !isViceChair && !isAdmin) {
      return NextResponse.json(
        { error: "Only the State Party Chair or Vice Chair can view whippable bills" },
        { status: 403 }
      );
    }

    const now = new Date();
    const gameStateForBills = await getGameState(db);
    const currentTurnForBills = gameStateForBills?.currentTurn ?? 0;
    const stillOpen = (turnField: string, dateField: string) => ({
      $or: [
        { [turnField]: { $gt: currentTurnForBills } },
        { [turnField]: { $exists: false }, [dateField]: { $gt: now } },
      ],
    });
    const config = getCountryConfig(countryId);
    const upperChamber = config.upperElectionSystem
      ? (config.legislature.upperChamber?.key ?? null)
      : null;
    const lowerChamber = config.legislature.lowerChamber.key;
    const subNationalChamber = getSubNationalLegislatureKey(countryId);
    const federalChamberKeys = upperChamber ? [upperChamber, lowerChamber] : [lowerChamber];
    const chamberKeys = [...federalChamberKeys, subNationalChamber];
    // Resolve chamber keys to the office types members are stored under (CN:
    // "npc" → "npcDelegate"; identity elsewhere). Querying the raw chamber key
    // matched no CN delegates, hiding CN federal bills from the state whip panel.
    const officeTypeByChamberKey = new Map(
      chamberKeys.map((key) => [key, getOfficeTypeForChamber(countryId, key)])
    );

    const federalBillCountryFilter = {
      $or: [
        { countryId },
        { countryId: { $exists: false }, currentChamber: { $in: federalChamberKeys } },
      ],
    };

    const [activeFederalBills, activeLocalBills, partyOfficials] = await Promise.all([
      db
        .collection<Bill>("bills")
        .find({
          $and: [
            federalBillCountryFilter,
            {
              $or: [
                { status: "active", ...stillOpen("votingEndsOnTurn", "votingEndsAt") },
                {
                  status: "active_other",
                  ...stillOpen("otherChamberVotingEndsOnTurn", "otherChamberVotingEndsAt"),
                },
                {
                  // Whippable while EITHER chamber is open. Nested, not spread: stillOpen
                  // returns an $or object on the turn branch and a flat one otherwise.
                  status: "active_both",
                  $or: [
                    stillOpen("votingEndsOnTurn", "votingEndsAt"),
                    stillOpen("otherChamberVotingEndsOnTurn", "otherChamberVotingEndsAt"),
                  ],
                },
                {
                  status: "veto_override",
                  ...stillOpen("overrideVotingEndsOnTurn", "overrideVotingEndsAt"),
                },
                // JP Shūgiin override reuses the main votingEndsAt;
                // currentChamber is set to "shugiin" by the JP lifecycle.
                { status: "override_shugiin", ...stillOpen("votingEndsOnTurn", "votingEndsAt") },
              ],
            },
          ],
        })
        .toArray(),
      db
        .collection<StateBill>("stateBills")
        .find({
          stateId,
          $or: [
            { status: "active", ...stillOpen("votingEndsOnTurn", "votingEndsAt") },
            {
              status: "veto_override",
              ...stillOpen("overrideVotingEndsOnTurn", "overrideVotingEndsAt"),
            },
          ],
        })
        .toArray(),
      db
        .collection<ElectedOfficial>("electedOfficials")
        .find({
          party: partyKey,
          state: stateId,
          officeType: { $in: [...officeTypeByChamberKey.values()] },
          isNPP: true,
        })
        .project({ officeType: 1 })
        .toArray(),
    ]);

    const result: Record<string, BillWhipItem[]> = Object.fromEntries(
      chamberKeys.map((key) => [key, [] as BillWhipItem[]])
    );
    // Map matched office types back to their chamber keys so the per-chamber
    // membership check below (which compares chamber keys) works for CN too.
    const partyNppOfficeTypes = new Set(partyOfficials.map((official) => official.officeType));
    const chambersWithPartyNpps = new Set(
      chamberKeys.filter((key) => partyNppOfficeTypes.has(officeTypeByChamberKey.get(key)!))
    );
    if (chambersWithPartyNpps.size === 0) {
      return NextResponse.json(result);
    }

    const billIds = [
      ...activeFederalBills.map((bill) => bill._id),
      ...activeLocalBills.map((bill) => bill._id),
    ];
    const existingWhips = await db
      .collection<BillWhip>("billWhips")
      .find({
        targetType: "bill",
        targetId: { $in: billIds },
        partyId: partyKey,
        stateId,
      })
      .toArray();

    const whipsByBillChamber = new Map<string, BillWhip[]>();
    for (const whip of existingWhips) {
      const key = `${whip.targetId}_${whip.chamber}`;
      if (!whipsByBillChamber.has(key)) {
        whipsByBillChamber.set(key, []);
      }
      whipsByBillChamber.get(key)!.push(whip);
    }

    const summarizeWhips = (billId: string, chamber: string) => {
      const whips = whipsByBillChamber.get(`${billId}_${chamber}`) ?? [];
      return {
        existingWhips: whips.map((whip) => ({
          direction: whip.direction,
          attemptNumber: whip.attemptNumber,
          issuedByRole: resolveWhipIssuerRole(whip, statePartyOrg),
          mode: whip.mode ?? "hard",
        })),
        canWhip: whips.length < 2,
      };
    };

    for (const bill of activeFederalBills) {
      const activeChambers =
        bill.status === "veto_override"
          ? federalChamberKeys
          : bill.currentChamber && federalChamberKeys.includes(bill.currentChamber)
            ? [bill.currentChamber]
            : [];

      for (const chamber of activeChambers) {
        if (!chambersWithPartyNpps.has(chamber)) continue;
        const summary = summarizeWhips(bill._id.toString(), chamber);
        result[chamber].push({
          bill: {
            id: bill._id.toString(),
            title: bill.title,
            status: bill.status,
          },
          existingWhips: summary.existingWhips,
          canWhip: summary.canWhip,
        });
      }
    }

    if (chambersWithPartyNpps.has(subNationalChamber)) {
      for (const bill of activeLocalBills) {
        const summary = summarizeWhips(bill._id.toString(), subNationalChamber);
        result[subNationalChamber].push({
          bill: {
            id: bill._id.toString(),
            title: bill.title,
            status: bill.status,
          },
          existingWhips: summary.existingWhips,
          canWhip: summary.canWhip,
        });
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
