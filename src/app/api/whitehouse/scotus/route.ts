/**
 * GET /api/whitehouse/scotus — Court composition, pending nominations, viewer status.
 *
 * Presentation-layer read for the SCOTUS UI (#3605) — mirrors the shape of
 * GET /api/whitehouse/cabinet (positions + nominations + isPresident/isSenator)
 * so the nomination/confirmation UI can reuse the same page conventions.
 * Reuses `getScotusComposition` (#3598, src/lib/scotus/queries.ts) for the
 * per-seat summary; adds a lightweight raw-seat lookup only to resolve
 * `isJustice`/`mySeatNumber` for the viewer, since that summary intentionally
 * omits `justiceCharacterId`.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth"; // Optional auth — anyone can view; only players see president/senator/justice status.
import { handleRouteError } from "@/lib/api/errors";
import { resolvePresidentialCountry } from "@/lib/executive/presidentialCountry";
import { getScotusComposition } from "@/lib/scotus/queries";
import type { ScotusNomination, SupremeCourtSeat } from "@/lib/db/types/scotus";
import type { ElectedOfficial, Character } from "@/lib/db/types";

// GET /api/whitehouse/scotus — Returns the Court's 9-seat composition, active nominations, and the caller's president/senator/justice status. Country-scoped via ?country= (default US); SCOTUS is US-only per #3581, so any other country returns an empty shell.
// Auth: public
// Errors: 400
export async function GET(request: Request) {
  try {
    const countryId = resolvePresidentialCountry(request);
    if (!countryId) {
      return NextResponse.json({ error: "Unknown country" }, { status: 400 });
    }
    if (countryId !== "US") {
      return NextResponse.json({
        seats: [],
        nominations: [],
        isPresident: false,
        isSenator: false,
        isJustice: false,
        mySeatNumber: null,
      });
    }

    const db = await getDb();
    const authUser = await getAuthUser().catch(() => null);

    const [seats, rawSeats, nominations, presidentOfficial, myCharacter] = await Promise.all([
      getScotusComposition(db, countryId),
      db
        .collection<SupremeCourtSeat>("supremeCourtSeats")
        .find({ countryId }, { projection: { seatNumber: 1, justiceCharacterId: 1 } })
        .toArray(),
      db
        .collection<ScotusNomination>("scotusNominations")
        .find({ countryId, status: "active" })
        .sort({ proposedAt: -1 })
        .toArray(),
      db
        .collection<ElectedOfficial>("electedOfficials")
        .findOne({ countryId, officeType: "president", characterId: { $ne: null } }),
      authUser
        ? db.collection<Character>("characters").findOne({ userId: new ObjectId(authUser.userId) })
        : Promise.resolve(null),
    ]);

    const senatorOfficial = myCharacter
      ? await db.collection<ElectedOfficial>("electedOfficials").findOne({
          characterId: myCharacter._id,
          countryId,
          officeType: "senate",
        })
      : null;

    const isPresident =
      !!presidentOfficial?.characterId &&
      !!myCharacter &&
      presidentOfficial.characterId.equals(myCharacter._id);
    const isSenator = !!senatorOfficial;

    const mySeat = myCharacter
      ? rawSeats.find((s) => s.justiceCharacterId && s.justiceCharacterId.equals(myCharacter._id))
      : undefined;

    const myCharId = myCharacter?._id.toString();
    const nominationRows = nominations.map((n) => ({
      id: n._id.toString(),
      seatNumber: n.seatNumber,
      nomineeMode: n.nomineeMode,
      nomineeName: n.nomineeName,
      nomineeParty: n.nomineeParty ?? null,
      status: n.status,
      votesFor: n.votesFor,
      votesAgainst: n.votesAgainst,
      votesAbstain: n.votesAbstain,
      votingEndsAt: n.votingEndsAt?.toISOString() ?? null,
      myVote: myCharId ? (n.votes?.[myCharId] ?? null) : null,
    }));

    return NextResponse.json({
      seats,
      nominations: nominationRows,
      isPresident,
      isSenator,
      isJustice: !!mySeat,
      mySeatNumber: mySeat?.seatNumber ?? null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
