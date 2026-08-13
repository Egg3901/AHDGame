/**
 * GET /api/elections/composition?country=XX
 *
 * Current and projected party seat breakdown for a country's elected chambers,
 * sourced from ElectedOfficial records and live vote tallies.
 *
 * This used to hardcode `countryId: "US"`, and the frontend divided by a
 * hardcoded 435/100, so every non-US country was shown US House and Senate
 * numbers as if they were its own. Chambers, office types and seat totals now
 * all come from the country's own config.
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getPartyHex } from "@/lib/utils/politics";
import { handleRouteError } from "@/lib/api/errors";
import { getGameTime } from "@/lib/time/gameTime";
import { isPrimaryEnded } from "@/lib/elections/phases";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import { resolveOfficeKeyForElectionType } from "@/lib/elections/officeResolution";
import { COUNTRY_CONFIGS, type ChamberConfig, type CountryId } from "@/lib/constants/countries";
import { getLiveLowerChamberSeats, getLiveUpperChamberSeats } from "@/lib/turn/lowerChamberSeats";
import type {
  Election,
  ElectedOfficial,
  ElectionCandidate,
  ElectionVoteTally,
  PoliticalParty,
} from "@/lib/db/types";

import type {
  ChamberCompositionData,
  CompositionResponse,
  PartySeats,
} from "@/lib/elections/electionResponseTypes";

export type { PartySeats, CompositionResponse } from "@/lib/elections/electionResponseTypes";

const VACANT_KEY = "__vacant__";
const DEFAULT_COUNTRY: CountryId = "US";

/** Elected chambers only: an appointed upper house has no election to project. */
function electedChambers(countryId: CountryId): {
  lower: ChamberConfig | null;
  upper: ChamberConfig | null;
} {
  const legislature = COUNTRY_CONFIGS[countryId]?.legislature;
  const upper = legislature?.upperChamber;
  return {
    lower: legislature?.lowerChamber ?? null,
    // UK Lords, DE Bundesrat and the appointed Eastern bloc upper bodies are
    // never contested, so they get no panel.
    upper: upper && upper.elected === true ? upper : null,
  };
}

// GET /api/elections/composition — current and projected seat breakdown per elected chamber.
// Auth: public
// Errors: 400 on an unknown country code
export async function GET(request: Request) {
  try {
    const requested = new URL(request.url).searchParams.get("country");
    const countryId = (requested?.toUpperCase() as CountryId) || DEFAULT_COUNTRY;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const db = await getDb();
    const { lower, upper } = electedChambers(countryId);

    // Legacy US officials predate the countryId field, so tolerate its absence
    // for the US only. Every other country is filtered strictly.
    const countryScope: Record<string, unknown> =
      // eslint-disable-next-line local/no-country-literals -- back-compat for legacy US rows without countryId
      countryId === "US"
        ? { $or: [{ countryId: "US" }, { countryId: { $exists: false } }] }
        : { countryId };

    const [officials, parties, activeElections, gameTime] = await Promise.all([
      db.collection<ElectedOfficial>("electedOfficials").find(countryScope).toArray(),
      db.collection<PoliticalParty>("politicalParties").find({ countryId }).toArray(),
      db
        .collection<Election>("elections")
        .find({ status: { $in: ["active", "upcoming"] }, ...countryScope })
        .toArray(),
      getGameTime(),
    ]);

    const partyMeta = new Map(
      parties.map((p) => [
        String(p.sequentialId),
        {
          name: p.name,
          color: getPartyHex(String(p.sequentialId), p.color),
          economicPosition: p.economicPosition ?? 0,
        },
      ])
    );

    const partyColor = (slug: string) => partyMeta.get(slug)?.color ?? getPartyHex(slug);
    const partyName = (slug: string) => partyMeta.get(slug)?.name ?? slug;
    const partyEcon = (slug: string) =>
      slug === VACANT_KEY ? null : (partyMeta.get(slug)?.economicPosition ?? 0);

    const slugOf = (o: ElectedOfficial) =>
      o.characterId == null && !o.party ? VACANT_KEY : (o.party ?? VACANT_KEY);

    /** Multi-seat chambers store a seat count per official; single-seat ones do not. */
    const seatsOf = (o: ElectedOfficial, multiSeat: boolean) =>
      multiSeat ? (o.seatsHeld ?? 1) : 1;

    function toPartySeats(tally: Map<string, number>): PartySeats[] {
      return [...tally.entries()]
        .filter(([, seats]) => seats > 0)
        .map(([slug, seats]) =>
          slug === VACANT_KEY
            ? {
                party: VACANT_KEY,
                partyName: "Vacant",
                partyColor: "#374151",
                seats,
                economicPosition: null,
                countryId,
              }
            : {
                party: slug,
                partyName: partyName(slug),
                partyColor: partyColor(slug),
                seats,
                economicPosition: partyEcon(slug),
                countryId,
              }
        )
        .sort((a, b) => {
          // Left to right by economic position; vacant always last.
          if (a.party === VACANT_KEY) return 1;
          if (b.party === VACANT_KEY) return -1;
          return (a.economicPosition ?? 0) - (b.economicPosition ?? 0);
        });
    }

    async function buildChamber(
      chamber: ChamberConfig,
      isLower: boolean
    ): Promise<ChamberCompositionData> {
      // Seated members are stored under the office type, which is not always the
      // chamber key (CN: chamber "npc" -> office "npcDelegate").
      const officeType = getOfficeTypeForChamber(countryId, chamber.key);
      const multiSeat = chamber.seats > 1;
      // Live size (era overlay + region sum) so a 1953 Commons is 625, not the
      // modern-config 650 (ticket #1078).
      const totalSeats = isLower
        ? await getLiveLowerChamberSeats(db, countryId)
        : await getLiveUpperChamberSeats(db, countryId);

      const chamberOfficials = officials.filter((o) => o.officeType === officeType);
      const current = new Map<string, number>();
      for (const o of chamberOfficials) {
        const slug = slugOf(o);
        current.set(slug, (current.get(slug) ?? 0) + seatsOf(o, multiSeat));
      }

      // An election belongs to this chamber when its type resolves to the same
      // office. That covers both shapes: FR seeds `assembleeNationale` (a chamber
      // key) while the US seeds `senate` (an office key).
      const generalElections = activeElections.filter(
        (e) =>
          resolveOfficeKeyForElectionType(countryId, e.electionType) === officeType &&
          isPrimaryEnded(e, gameTime.currentTurn, gameTime)
      );

      const projected = new Map(current);

      if (generalElections.length > 0) {
        const electionIds = generalElections.map((e) => e._id);
        const [tallies, candidates] = await Promise.all([
          db
            .collection<ElectionVoteTally>("electionVoteTallies")
            .find({ electionId: { $in: electionIds } })
            .toArray(),
          db
            .collection<ElectionCandidate>("electionCandidates")
            .find({ electionId: { $in: electionIds }, status: "active" })
            .toArray(),
        ]);

        const tallyByElection = new Map(tallies.map((t) => [t.electionId.toString(), t]));
        const candidatesByElection = new Map<string, ElectionCandidate[]>();
        for (const c of candidates) {
          const key = c.electionId.toString();
          const list = candidatesByElection.get(key);
          if (list) list.push(c);
          else candidatesByElection.set(key, [c]);
        }

        // Index once by state: the per-election scan over the full chamber was
        // O(elections × officials).
        const chamberOfficialsByState = new Map<string, typeof chamberOfficials>();
        for (const o of chamberOfficials) {
          if (!o.state) continue;
          const list = chamberOfficialsByState.get(o.state) ?? [];
          list.push(o);
          chamberOfficialsByState.set(o.state, list);
        }
        for (const election of generalElections) {
          const contested = (chamberOfficialsByState.get(election.state) ?? []).filter(
            (o) =>
              // A classed upper chamber only turns over the contested class.
              !(
                chamber.regionElectedClasses &&
                election.senateClass &&
                o.senateClass !== election.senateClass
              )
          );

          // Take the contested seats off the board...
          for (const o of contested) {
            const slug = slugOf(o);
            projected.set(slug, Math.max(0, (projected.get(slug) ?? 0) - seatsOf(o, multiSeat)));
          }

          const tally = tallyByElection.get(election._id.toString());

          if (!tally || Object.keys(tally.totalVotes).length === 0) {
            // No votes yet, so there is nothing to project: put them back.
            for (const o of contested) {
              const slug = slugOf(o);
              projected.set(slug, (projected.get(slug) ?? 0) + seatsOf(o, multiSeat));
            }
            continue;
          }

          const elCandidates = candidatesByElection.get(election._id.toString()) ?? [];

          if (tally.seatsEstimate) {
            for (const [candidateId, seats] of Object.entries(tally.seatsEstimate)) {
              if (seats <= 0) continue;
              const cand = elCandidates.find((c) => c._id.toString() === candidateId);
              const slug = cand?.party ?? tally.candidateParties[candidateId] ?? VACANT_KEY;
              projected.set(slug, (projected.get(slug) ?? 0) + seats);
            }
          } else {
            // Single winner: the leader takes the seat.
            const leaderId = Object.entries(tally.totalVotes).sort((a, b) => b[1] - a[1])[0]?.[0];
            if (leaderId) {
              const slug = tally.candidateParties[leaderId] ?? VACANT_KEY;
              projected.set(slug, (projected.get(slug) ?? 0) + 1);
            } else {
              for (const o of contested) {
                const slug = slugOf(o);
                projected.set(slug, (projected.get(slug) ?? 0) + seatsOf(o, multiSeat));
              }
            }
          }
        }
      }

      return {
        key: chamber.key,
        name: chamber.name,
        totalSeats,
        current: toPartySeats(current),
        projected: toPartySeats(projected),
        inGeneral: generalElections.length > 0,
      };
    }

    const [lowerData, upperData] = await Promise.all([
      lower ? buildChamber(lower, true) : Promise.resolve(null),
      upper ? buildChamber(upper, false) : Promise.resolve(null),
    ]);

    const upperOfficeType = upper ? getOfficeTypeForChamber(countryId, upper.key) : null;
    const activeUpperClass =
      upper?.regionElectedClasses && upperOfficeType
        ? (activeElections.find(
            (e) =>
              resolveOfficeKeyForElectionType(countryId, e.electionType) === upperOfficeType &&
              isPrimaryEnded(e, gameTime.currentTurn, gameTime)
          )?.senateClass ?? null)
        : null;

    return NextResponse.json({
      countryId,
      lower: lowerData,
      upper: upperData,
      activeUpperClass,
    } satisfies CompositionResponse);
  } catch (error) {
    return handleRouteError(error);
  }
}
