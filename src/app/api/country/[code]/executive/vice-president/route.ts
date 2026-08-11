/**
 * GET /api/country/[code]/executive/vice-president — VP office briefing.
 *
 * Returns the seated vice-president, the sitting president (target of the
 * Surrogate Address action), whether the viewer is the seated VP, and the
 * viewer's remaining self-serve action pool (player suggestion #67). Optional
 * auth — anyone can view the office; only the seated VP sees `isVicePresident`.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth"; // Optional auth — intentionally uses getAuthUser()
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { ElectedOfficial, Character } from "@/lib/db/types";
import { resolveExecutiveHolder } from "@/lib/elections/resolveExecutiveHolder";
import {
  VP_ACTIONS,
  VP_ACTION_CAP,
  VP_ACTION_RESET_HINT,
} from "@/lib/constants/vicePresidentActions";

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }

    const db = await getDb();
    const authUser = await getAuthUser().catch(() => null);

    const [presidentOfficial, vicePresidentOfficial] = await Promise.all([
      db
        .collection<ElectedOfficial>("electedOfficials")
        .findOne({ countryId, officeType: "president" }),
      db
        .collection<ElectedOfficial>("electedOfficials")
        .findOne({ countryId, officeType: "vicePresident" }),
    ]);

    const [president, vicePresident] = await Promise.all([
      resolveExecutiveHolder(db, presidentOfficial),
      resolveExecutiveHolder(db, vicePresidentOfficial),
    ]);

    const myCharacter = authUser
      ? await db
          .collection<Character>("characters")
          .findOne({ userId: new ObjectId(authUser.userId) })
      : null;
    const isVicePresident =
      !!vicePresidentOfficial?.characterId &&
      !!myCharacter &&
      vicePresidentOfficial.characterId.equals(myCharacter._id);

    return NextResponse.json({
      countryId,
      president,
      vicePresident,
      isVicePresident,
      vpActionsRemaining: vicePresidentOfficial?.vpActionsRemaining ?? 0,
      actionCap: VP_ACTION_CAP,
      resetHint: VP_ACTION_RESET_HINT,
      actions: VP_ACTIONS,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
