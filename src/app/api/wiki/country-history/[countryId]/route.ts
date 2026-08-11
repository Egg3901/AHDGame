import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { checkWikiDisabled } from "@/lib/api/wikiGuard";
import { getCountryHistoryCollection } from "@/lib/db/collections/countryHistory";
import type { CountryHistoryEvent } from "@/lib/db/types/countryHistoryEvent";
import type { ElectedOfficial } from "@/lib/db/types";
import { COUNTRY_CONFIGS, getExecutiveOfficeKey, type CountryId } from "@/lib/constants/countries";
import { isCountryAccessible } from "@/lib/countryAccess";
import { getAuthUser } from "@/lib/auth";

interface LeaderTimelineEntry {
  title: string;
  officeType: string;
  characterName: string;
  party?: string;
  startTurn: number;
  startDate: string;
  /** End of this tenure; undefined if currently in office. */
  endTurn?: number;
  endDate?: string;
}

interface RecentEvent {
  id: string;
  eventType: string;
  title: string;
  turn: number;
  date: string;
  party?: string;
  characterName?: string;
}

export interface CountryHistoryResponse {
  countryId: CountryId;
  countryName: string;
  headOfGovernmentTitle: string;
  currentLeader: {
    name: string;
    party?: string;
    title: string;
  } | null;
  leaderHistory: LeaderTimelineEntry[];
  recentEvents: RecentEvent[];
}

// GET /api/wiki/country-history/[countryId] — leader timeline + recent events.
// Auth: public; blocked when wiki is disabled for non-mod/admin.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ countryId: string }> }
) {
  try {
    const blocked = await checkWikiDisabled();
    if (blocked) return blocked;

    const { countryId: rawId } = await params;
    const upper = rawId.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[upper]) {
      return NextResponse.json({ error: "Unknown country" }, { status: 400 });
    }
    const db = await getDb();
    const user = await getAuthUser().catch(() => null);
    const isAdmin = user?.isAdmin === true;
    const accessible = await isCountryAccessible(upper, isAdmin);
    if (!accessible) {
      return NextResponse.json({ error: "Country not available" }, { status: 400 });
    }
    const countryId = upper;
    const config = COUNTRY_CONFIGS[countryId];
    const headOfGovernmentOffice = getExecutiveOfficeKey(countryId);
    const headOfGovernmentTitle = config.executiveTitle;

    const col = await getCountryHistoryCollection(db);
    const [leaderChanges, recentAll, currentHeadOfState] = await Promise.all([
      col.find({ countryId, eventType: "leader_change" }).sort({ turn: 1, timestamp: 1 }).toArray(),
      col.find({ countryId }).sort({ turn: -1, timestamp: -1 }).limit(25).toArray(),
      // Fall back to current ElectedOfficial so the widget shows a leader even
      // before any leader_change events have accumulated.
      db.collection<ElectedOfficial>("electedOfficials").findOne({
        officeType: headOfGovernmentOffice,
        countryId,
      }),
    ]);

    // Build the leader timeline: each leader_change for the head-of-government
    // office starts a tenure; the next one ends the previous tenure.
    const hogChanges = leaderChanges.filter(
      (e) => (e.officeType ?? "").toLowerCase() === headOfGovernmentOffice.toLowerCase()
    );
    const leaderHistory: LeaderTimelineEntry[] = hogChanges.map((e, idx) => {
      const next = hogChanges[idx + 1];
      return {
        title: headOfGovernmentTitle,
        officeType: headOfGovernmentOffice,
        characterName: e.characterName ?? "Unknown",
        party: e.party,
        startTurn: e.turn,
        startDate: e.timestamp.toISOString(),
        endTurn: next?.turn,
        endDate: next?.timestamp.toISOString(),
      };
    });

    // Current leader — derived from the most recent leader_change, or from
    // ElectedOfficial if no history yet.
    let currentLeader: CountryHistoryResponse["currentLeader"] = null;
    const latestHog = hogChanges[hogChanges.length - 1];
    if (latestHog) {
      currentLeader = {
        name: latestHog.characterName ?? "Unknown",
        party: latestHog.party,
        title: headOfGovernmentTitle,
      };
    } else if (currentHeadOfState?.characterName) {
      currentLeader = {
        name: currentHeadOfState.characterName,
        party: currentHeadOfState.party ?? undefined,
        title: headOfGovernmentTitle,
      };
    }

    const recentEvents: RecentEvent[] = recentAll.map((e: CountryHistoryEvent) => ({
      id: e._id.toString(),
      eventType: e.eventType,
      title: e.title,
      turn: e.turn,
      date: e.timestamp.toISOString(),
      party: e.party,
      characterName: e.characterName,
    }));

    const response: CountryHistoryResponse = {
      countryId,
      countryName: config.name,
      headOfGovernmentTitle,
      currentLeader,
      leaderHistory: leaderHistory.reverse(), // most recent first for display
      recentEvents,
    };

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300, no-transform",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
