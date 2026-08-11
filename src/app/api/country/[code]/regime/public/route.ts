/**
 * GET /api/country/[code]/regime/public
 *
 * Public read-only view of the country's regime-escalation state.
 * Returns the popular-legitimacy *band* (not the raw scalar), the
 * current stage, the under-strain flag, and the last few stage
 * transitions for the country-history feed.
 *
 * Returns `{ active: false }` for non-OPS countries so the UI panel
 * can render nothing without needing a separate "is this country
 * OPS?" lookup.
 *
 * No auth — same disclosure level as the country overview page.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCountryState } from "@/lib/countryState";
import { getRegimeEscalationCollection } from "@/lib/db/collections/regimeEscalation";
import { getCountryLeaderStatesCollection } from "@/lib/db/collections/countryLeaderState";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import { classifyPopularBand, INITIAL_POPULAR_LEGITIMACY } from "@/lib/turn/popularLegitimacy";

const MAX_RECENT_TRANSITIONS = 3;

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const db = await getDb();
    const runtime = await getCountryState(db, countryId);

    // Non-OPS short-circuit: client renders nothing.
    if (runtime.governmentType !== "onePartyState") {
      return NextResponse.json({ active: false });
    }

    // Resolve the ruling-party leader's popular legitimacy. Prefer the
    // primary-key lookup by {countryId, leaderCharacterId} via the
    // canonical head-of-government resolver — falls back to the
    // {countryId, governingPartyId} query for compatibility with rows
    // seeded before the self-heal in adjust* started populating
    // governingPartyId. Mirrors the leader API's lookup pattern so
    // both surfaces see the same scalar value.
    let popularLegitimacy = INITIAL_POPULAR_LEGITIMACY;
    const leaderColl = getCountryLeaderStatesCollection(db);
    const hogId = await getHeadOfGovernmentCharacterId(db, countryId);
    const leaderRow =
      (hogId ? await leaderColl.findOne({ countryId, leaderCharacterId: hogId }) : null) ??
      (runtime.rulingPartyId !== null
        ? await leaderColl.findOne({
            countryId,
            governingPartyId: String(runtime.rulingPartyId),
          })
        : null);
    if (leaderRow?.popularLegitimacy !== undefined) {
      popularLegitimacy = leaderRow.popularLegitimacy;
    }

    const band = classifyPopularBand(popularLegitimacy);

    const esc = await getRegimeEscalationCollection(db).findOne({ _id: countryId });
    const stage = esc?.currentStage ?? "stable";
    const underStrain = stage === "internalChallenge" || stage === "collapse";
    // Recent transitions for the public feed. `reason` is intentionally
    // omitted — the per-turn driver formats it as
    // `"discontent → crisis (popular=22.4, partyConf=18.2)"`, which
    // would leak the raw scalar values that this public surface
    // deliberately hides behind the band label.
    const recentTransitions = (esc?.transitionHistory ?? [])
      .slice(0, MAX_RECENT_TRANSITIONS)
      .map((t) => ({
        turn: t.turn,
        from: t.from,
        to: t.to,
        at: t.at,
      }));

    return NextResponse.json({
      active: true,
      band,
      stage,
      underStrain,
      recentTransitions,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
