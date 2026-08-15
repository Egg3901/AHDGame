import type { Db } from "mongodb";
import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Character, Election, ElectionCandidate, PoliticalParty } from "@/lib/db/types";
import { officeLabelFor } from "@/lib/utils/officeLabel";
import { raceLabel } from "@/components/state/overview/raceLabel";

const NEUTRAL_PARTY_COLOR = "#6b6b7a";

export const STATE_ROSTER_DEFAULT_PAGE_SIZE = 20;
export const STATE_ROSTER_MAX_PAGE_SIZE = 50;

export interface StateRosterRow {
  id: string;
  sequentialId: number | null;
  name: string;
  avatarUrl: string | null;
  borderKey: string | null;
  tintColor: string | null;
  isAdmin: boolean;
  isModerator: boolean;
  party: string;
  partyName: string | null;
  partyAbbr: string | null;
  partyColor: string | null;
  politicalInfluence: number;
  /** Held office label ("Senator"), an active-candidacy label
   *  ("Running: House (7)"), or "Private Citizen" when neither applies. */
  positionLabel: string;
}

export interface StateRosterResult {
  players: StateRosterRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Parse the trailing numeric district label out of a seat id like
 * `"US-house-AZ-7"` -> `"7"`. Mirrors `getStateOverview.ts`'s helper of the
 * same name so race labels read identically across the Overview tab's
 * Race Watchlist and the Player Roster's "currently contesting" column.
 */
function parseDistrictLabel(seatId: string | undefined | null): string | undefined {
  if (!seatId) return undefined;
  const tail = seatId.split("-").pop() ?? "";
  return /^\d+$/.test(tail) ? tail : undefined;
}

function senateClassToNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const upper = value.toUpperCase();
    if (upper === "I") return 1;
    if (upper === "II") return 2;
    if (upper === "III") return 3;
    const n = Number(upper);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

interface RosterFacetRow {
  _id: ObjectId;
  sequentialId?: number;
  name: string;
  avatarUrl?: string;
  party: string;
  politicalInfluence: number;
  currentOffice: Character["currentOffice"];
  userIsAdmin?: boolean;
  userRole?: string;
  borderKey?: string | null;
  tintColor?: string | null;
}

/**
 * Server-side paginated roster of every player whose character calls this
 * state home: influence, party affiliation, and current office / race.
 * Powers the Overview tab's Player Roster table.
 *
 * Banned users are excluded via a `$lookup` into `users` inside the same
 * aggregation that produces the page + total count, so pagination math
 * stays correct (a post-fetch filter would desync `total` from `players`).
 */
export async function getStateRoster(
  db: Db,
  args: { countryId: CountryId; stateId: string; page: number; pageSize: number }
): Promise<StateRosterResult> {
  const { countryId, stateId } = args;
  const pageSize = Math.min(
    STATE_ROSTER_MAX_PAGE_SIZE,
    Math.max(1, Math.floor(args.pageSize) || STATE_ROSTER_DEFAULT_PAGE_SIZE)
  );
  const page = Math.max(1, Math.floor(args.page) || 1);
  const skip = (page - 1) * pageSize;

  const [facet] = await db
    .collection<Character>("characters")
    .aggregate<{ rows: RosterFacetRow[]; total: [{ n: number }] | [] }>([
      { $match: { countryId, homeState: stateId } },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
      { $match: { "user.isBanned": { $ne: true } } },
      { $sort: { politicalInfluence: -1, name: 1 } },
      {
        $facet: {
          rows: [
            { $skip: skip },
            { $limit: pageSize },
            {
              $project: {
                _id: 1,
                sequentialId: 1,
                name: 1,
                avatarUrl: 1,
                party: 1,
                politicalInfluence: 1,
                currentOffice: 1,
                userIsAdmin: "$user.isAdmin",
                userRole: "$user.role",
                borderKey: "$user.patreonProfileBorder",
                tintColor: "$user.patreonHighlightColor",
              },
            },
          ],
          total: [{ $count: "n" }],
        },
      },
    ])
    .toArray();

  const rows = facet?.rows ?? [];
  const total = facet?.total?.[0]?.n ?? 0;

  if (rows.length === 0) {
    return { players: [], total, page, pageSize };
  }

  // Party names/colors: one bounded fetch (a handful of parties per country).
  const parties = await db.collection<PoliticalParty>("politicalParties").find({ countryId }).toArray();
  const partyBySequentialId = new Map(parties.map((p) => [String(p.sequentialId), p]));

  // Active-candidacy lookup, scoped to just this page's characters that
  // don't already hold an office — avoids scanning every candidacy in the
  // state for players who don't need one.
  const needsRaceLookup = rows.filter((r) => !r.currentOffice).map((r) => r._id);
  const raceLabelByCharacterId = new Map<string, string>();
  if (needsRaceLookup.length > 0) {
    const candidates = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ characterId: { $in: needsRaceLookup }, status: "active" })
      .sort({ enteredAt: -1 })
      .toArray();
    if (candidates.length > 0) {
      const electionIds = candidates.map((c) => c.electionId);
      const elections = await db
        .collection<Election>("elections")
        .find({ _id: { $in: electionIds } })
        .toArray();
      const electionById = new Map(elections.map((e) => [e._id.toString(), e]));
      for (const candidate of candidates) {
        const charKey = candidate.characterId.toString();
        if (raceLabelByCharacterId.has(charKey)) continue; // first (most recent) candidacy wins
        const election = electionById.get(candidate.electionId.toString());
        if (!election) continue;
        const label = raceLabel({
          electionType: election.electionType,
          district: parseDistrictLabel(election.seatId),
          senateClass: senateClassToNumber(election.senateClass),
        });
        const scoped = election.state && election.state !== stateId ? `${label} (${election.state})` : label;
        raceLabelByCharacterId.set(charKey, `Running: ${scoped}`);
      }
    }
  }

  const players: StateRosterRow[] = rows.map((r) => {
    const party = partyBySequentialId.get(r.party);
    const isIndependent = r.party === "independent";
    const isAdmin = r.userIsAdmin === true || r.userRole === "admin";
    const isModerator = r.userRole === "moderator" || r.userRole === "admin" || isAdmin;
    const positionLabel = r.currentOffice
      ? officeLabelFor(countryId, r.currentOffice)
      : (raceLabelByCharacterId.get(r._id.toString()) ?? "Private Citizen");
    return {
      id: r._id.toString(),
      sequentialId: r.sequentialId ?? null,
      name: r.name,
      avatarUrl: r.avatarUrl ?? null,
      borderKey: r.borderKey ?? null,
      tintColor: r.tintColor ?? null,
      isAdmin,
      isModerator,
      party: r.party,
      partyName: isIndependent ? "Independent" : (party?.name ?? null),
      partyAbbr: isIndependent ? "IND" : (party?.abbreviation ?? null),
      partyColor: isIndependent ? "#888888" : (party?.color ?? NEUTRAL_PARTY_COLOR),
      politicalInfluence: r.politicalInfluence ?? 0,
      positionLabel,
    };
  });

  return { players, total, page, pageSize };
}
