import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { checkWikiDisabled } from "@/lib/api/wikiGuard";
import { getDb } from "@/lib/mongodb";
import type { Election, State } from "@/lib/db/types";

export interface WikiElectionSummary {
  id: string;
  electionType: string;
  state: string;
  stateName: string;
  senateClass?: number;
  cycle: number;
  totalSeats?: number;
  endTime: string;
  year: number;
  label: string;
}

const ELECTION_TYPES = [
  "governor",
  "house",
  "senate",
  "stateSenate",
  "president",
  "commons",
  "regionalCouncil",
  "primeMinister",
  "npcDelegate",
  "peoplesCongress",
  "dail",
  "seanad",
  "uachtaran",
  "localCouncil",
] as const;

// GET /api/wiki/elections — Returns completed elections grouped by year and type, with optional filtering by year, state, or election type.
// Auth: public; blocked when wiki is disabled
// Errors: 400, 403
export async function GET(request: Request) {
  try {
    const blocked = await checkWikiDisabled();
    if (blocked) return blocked;
    const { searchParams } = new URL(request.url);
    const yearParam = searchParams.get("year");
    const stateParam = searchParams.get("state");
    const typeParam = searchParams.get("type");

    const db = await getDb();

    let filter: Record<string, unknown> = { status: { $in: ["completed", "resolved"] } };

    if (yearParam && typeParam) {
      const year = parseInt(yearParam, 10);
      if (isNaN(year) || !ELECTION_TYPES.includes(typeParam as (typeof ELECTION_TYPES)[number])) {
        return NextResponse.json({ error: "Invalid year or type" }, { status: 400 });
      }
      const startOfYear = new Date(year, 0, 1);
      const endOfYear = new Date(year + 1, 0, 1);
      filter = {
        ...filter,
        electionType: typeParam,
        endTime: { $gte: startOfYear, $lt: endOfYear },
      };
    } else if (stateParam && typeParam) {
      if (!ELECTION_TYPES.includes(typeParam as (typeof ELECTION_TYPES)[number])) {
        return NextResponse.json({ error: "Invalid type" }, { status: 400 });
      }
      // National-scope elections ignore the state filter (single nationwide
      // constituency). Sub-national types filter by state as normal.
      if (typeParam === "president" || typeParam === "uachtaran") {
        filter = { ...filter, electionType: typeParam };
      } else {
        filter = { ...filter, state: stateParam, electionType: typeParam };
      }
    }

    const [elections, states] = await Promise.all([
      db.collection<Election>("elections").find(filter).sort({ endTime: -1 }).limit(500).toArray(),
      db.collection<State>("states").find({}).project({ _id: 1, name: 1 }).toArray(),
    ]);

    const stateMap = new Map(states.map((s) => [s._id, s.name]));

    const summaries: WikiElectionSummary[] = elections.map((e) => {
      const endTime = e.endTime ? new Date(e.endTime) : new Date();
      // Prefer the LARP year baked at spawn over `endTime.getFullYear()`
      // (which is the real wall-clock year of resolution — wrong for any
      // preset whose LARP calendar is not aligned with reality, e.g.
      // 1991-default elections ending in real-world 2026).
      const year = e.electionYear ?? endTime.getFullYear();
      const stateName =
        e.electionType === "president" ? "United States" : (stateMap.get(e.state) ?? e.state);
      const label =
        e.electionType === "president"
          ? `${year} Presidential Election`
          : e.electionType === "governor"
            ? `${stateName} Governor`
            : e.electionType === "senate"
              ? `${stateName} Senate Class ${e.senateClass ?? "?"}`
              : e.electionType === "house"
                ? `${stateName} House (${e.totalSeats ?? 1} seat${(e.totalSeats ?? 1) > 1 ? "s" : ""})`
                : e.electionType === "commons"
                  ? `${stateName} Parliamentary Election`
                  : e.electionType === "regionalCouncil"
                    ? `${stateName} Regional Council`
                    : e.electionType === "primeMinister"
                      ? `${year} Prime Minister Election`
                      : e.electionType === "npcDelegate"
                        ? `${stateName} NPC Delegates`
                        : e.electionType === "peoplesCongress"
                          ? `${stateName} People's Congress`
                          : e.electionType === "dail"
                            ? `${stateName} Dáil Éireann`
                            : e.electionType === "seanad"
                              ? `${stateName} Seanad Éireann`
                              : e.electionType === "uachtaran"
                                ? `${year} Uachtarán Election`
                                : e.electionType === "localCouncil"
                                  ? `${stateName} Local Council`
                                  : `${stateName} State Senate`;

      return {
        id: e._id.toString(),
        electionType: e.electionType,
        state: e.state,
        stateName,
        senateClass: e.senateClass,
        cycle: e.cycle,
        totalSeats: e.totalSeats,
        endTime: e.endTime?.toISOString() ?? new Date().toISOString(),
        year,
        label,
      };
    });

    // When filtering by year+type or state+type, return flat list
    if ((yearParam && typeParam) || (stateParam && typeParam)) {
      return NextResponse.json({
        elections: summaries,
        groups: [],
      });
    }

    // Group by year and type for display
    const byYearType = new Map<string, WikiElectionSummary[]>();
    for (const s of summaries) {
      const key = `${s.year}-${s.electionType}`;
      if (!byYearType.has(key)) byYearType.set(key, []);
      byYearType.get(key)!.push(s);
    }

    // Also group by state+type for "browse by state" links (exclude national-scope types)
    const byStateType = new Map<string, WikiElectionSummary[]>();
    for (const s of summaries) {
      if (s.electionType === "president" || s.electionType === "uachtaran") continue;
      const key = `${s.state}-${s.electionType}`;
      if (!byStateType.has(key)) byStateType.set(key, []);
      byStateType.get(key)!.push(s);
    }

    return NextResponse.json({
      elections: summaries,
      groups: Array.from(byYearType.entries()).map(([key, items]) => {
        const [year, type] = key.split("-");
        const typeLabel =
          type === "president"
            ? "President"
            : type === "governor"
              ? "Governors"
              : type === "senate"
                ? "Senate"
                : type === "house"
                  ? "House"
                  : type === "commons"
                    ? "Parliamentary"
                    : type === "regionalCouncil"
                      ? "Regional Council"
                      : type === "primeMinister"
                        ? "Prime Minister"
                        : type === "npcDelegate"
                          ? "NPC Delegate"
                          : type === "peoplesCongress"
                            ? "People's Congress"
                            : type === "dail"
                              ? "Dáil"
                              : type === "seanad"
                                ? "Seanad"
                                : type === "uachtaran"
                                  ? "Uachtarán"
                                  : type === "localCouncil"
                                    ? "Local Council"
                                    : "State Senate";
        return {
          key,
          year: parseInt(year, 10),
          type,
          typeLabel: `${year} ${typeLabel} Elections`,
          count: items.length,
          items: items.sort(
            (a, b) =>
              new Date(b.endTime).getTime() - new Date(a.endTime).getTime() ||
              b.cycle - a.cycle ||
              a.stateName.localeCompare(b.stateName)
          ),
        };
      }),
      stateGroups: Array.from(byStateType.entries()).map(([key, items]) => {
        const [stateId, type] = key.split("-");
        const stateName = items[0]?.stateName ?? stateId;
        const typeLabel =
          type === "president"
            ? "President"
            : type === "governor"
              ? "Governor"
              : type === "senate"
                ? "Senate"
                : type === "house"
                  ? "House"
                  : type === "commons"
                    ? "Parliamentary"
                    : type === "regionalCouncil"
                      ? "Regional Council"
                      : type === "primeMinister"
                        ? "Prime Minister"
                        : type === "npcDelegate"
                          ? "NPC Delegate"
                          : type === "peoplesCongress"
                            ? "People's Congress"
                            : "State Senate";
        return {
          key,
          stateId,
          stateName,
          type,
          typeLabel: `${stateName} ${typeLabel}`,
          count: items.length,
          items: items.sort(
            (a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime()
          ),
        };
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
