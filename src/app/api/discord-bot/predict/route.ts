import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getPartyHex } from "@/lib/utils/politics";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_READ_LIMITS } from "@/lib/api/rateLimit";
import { getGameTime } from "@/lib/time/gameTime";
import { isPrimaryEnded } from "@/lib/elections/phases";
import { ALL_COUNTRY_IDS, COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getChamberName, raceToElectionTypes, raceToOfficeType, validRaces } from "./races";
import type {
  Election,
  ElectedOfficial,
  ElectionCandidate,
  ElectionVoteTally,
  PoliticalParty,
} from "@/lib/db/types";

interface PredictPartySeats {
  party: string;
  partyName: string;
  partyColor: string;
  seats: number;
}

const VALID_COUNTRIES = new Set<string>(ALL_COUNTRY_IDS);
const VACANT_KEY = "__vacant__";

// GET /api/discord-bot/predict — Returns current and projected party seat breakdowns for a given country and legislative race type.
// Auth: requireAdminOrApiKey
// Errors: 400, 401
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:predict",
      BOT_READ_LIMITS.maxRequests,
      BOT_READ_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const url = new URL(request.url);
    const country = url.searchParams.get("country")?.toUpperCase() ?? "";
    const rawRace = url.searchParams.get("race") ?? "";

    if (!country || !VALID_COUNTRIES.has(country)) {
      return NextResponse.json(
        { error: `Invalid country. Must be one of: ${[...VALID_COUNTRIES].join(", ")}` },
        { status: 400 }
      );
    }

    const allowed = validRaces(country);

    // Canonicalize the race to its exact office key (case-insensitive) so
    // camelCase values like `npcDelegate` resolve regardless of input casing,
    // then auto-default when the country has a single valid race.
    let race = allowed.find((r) => r.toLowerCase() === rawRace.toLowerCase()) ?? "";
    if (!race && !rawRace && allowed.length === 1) {
      race = allowed[0];
    }

    if (!race || !allowed.includes(race)) {
      return NextResponse.json(
        { error: `Invalid race for ${country}. Must be one of: ${allowed.join(", ")}` },
        { status: 400 }
      );
    }

    const officeType = raceToOfficeType(country, race)!;
    const electionTypes = raceToElectionTypes(country, race)!;
    const countryConfig = COUNTRY_CONFIGS[country as CountryId];

    const db = await getDb();

    const [officials, parties, activeElections] = await Promise.all([
      db
        .collection<ElectedOfficial>("electedOfficials")
        .find({
          officeType,
          // { countryId: null } matches both missing field and explicit null — catches all untagged officials
          $or: [{ countryId: country as CountryId }, { countryId: null as unknown as CountryId }],
        })
        .toArray(),
      db
        .collection<PoliticalParty>("politicalParties")
        .find({ countryId: country as CountryId })
        .toArray(),
      db
        .collection<Election>("elections")
        .find({
          countryId: country as CountryId,
          electionType: electionTypes.length === 1 ? electionTypes[0] : { $in: electionTypes },
          status: { $in: ["active", "upcoming"] },
        })
        .toArray(),
    ]);

    // Party metadata lookup
    const partyMeta = new Map<string, { name: string; color: string }>(
      parties.map((p: PoliticalParty) => [
        String(p.sequentialId),
        { name: p.name, color: getPartyHex(String(p.sequentialId), p.color) },
      ])
    );

    function partyColor(slug: string): string {
      return partyMeta.get(slug)?.color ?? getPartyHex(slug);
    }
    function partyName(slug: string): string {
      return partyMeta.get(slug)?.name ?? slug;
    }

    // ── Current composition ─────────────────────────────────────────────────
    const currentTally = new Map<string, number>();

    for (const o of officials) {
      const slug = o.characterId == null && !o.party ? VACANT_KEY : (o.party ?? VACANT_KEY);
      const seats = o.seatsHeld ?? 1;
      currentTally.set(slug, (currentTally.get(slug) ?? 0) + seats);
    }

    // ── Filter to general-phase elections ────────────────────────────────────
    // Use the game-clock effective-now so bot output agrees with the game's
    // turn-based resolution even when real time has drifted ahead of the
    // last successful turn.
    const gameTime = await getGameTime();
    const generalElections = activeElections.filter((e: Election) =>
      isPrimaryEnded(e, gameTime.currentTurn, gameTime)
    );

    const inGeneral = generalElections.length > 0;
    const activeSenateClass = race === "senate" ? (generalElections[0]?.senateClass ?? null) : null;
    const activeCycle = generalElections[0]?.cycle ?? null;

    // ── Projected composition ───────────────────────────────────────────────
    let projectedTally: Map<string, number>;

    if (generalElections.length === 0) {
      projectedTally = new Map(currentTally);
    } else {
      projectedTally = new Map(currentTally);
      const electionIds = generalElections.map((e: Election) => e._id);

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

      const tallyByElection = new Map<string, ElectionVoteTally>(
        tallies.map((t: ElectionVoteTally) => [t.electionId.toString(), t])
      );
      const candidatesByElection = new Map<string, ElectionCandidate[]>();
      for (const c of candidates) {
        const key = c.electionId.toString();
        if (!candidatesByElection.has(key)) candidatesByElection.set(key, []);
        candidatesByElection.get(key)!.push(c);
      }

      for (const election of generalElections) {
        const eid = election._id.toString();
        const state = election.state;

        // Subtract current seats for this state/class
        for (const o of officials) {
          if (o.state !== state) continue;
          if (race === "senate" && election.senateClass && o.senateClass !== election.senateClass)
            continue;
          const slug = o.characterId == null && !o.party ? VACANT_KEY : (o.party ?? VACANT_KEY);
          const seats = o.seatsHeld ?? 1;
          projectedTally.set(slug, Math.max(0, (projectedTally.get(slug) ?? 0) - seats));
        }

        const tally = tallyByElection.get(eid);
        const elCandidates = candidatesByElection.get(eid) ?? [];

        if (tally && Object.keys(tally.totalVotes).length > 0) {
          if (tally.seatsEstimate) {
            for (const [candidateId, seats] of Object.entries(tally.seatsEstimate)) {
              if (seats <= 0) continue;
              const cand = elCandidates.find((c) => c._id.toString() === candidateId);
              const slug = cand?.party ?? tally.candidateParties[candidateId] ?? VACANT_KEY;
              projectedTally.set(slug, (projectedTally.get(slug) ?? 0) + seats);
            }
          } else {
            // Single-winner: leader gets the seat
            const leaderId = Object.entries(tally.totalVotes).sort((a, b) => b[1] - a[1])[0]?.[0];
            if (leaderId) {
              const slug = tally.candidateParties[leaderId] ?? VACANT_KEY;
              projectedTally.set(slug, (projectedTally.get(slug) ?? 0) + 1);
            } else {
              restoreSeats(officials, state, election, projectedTally);
            }
          }
        } else {
          restoreSeats(officials, state, election, projectedTally);
        }
      }
    }

    // ── Serialize ───────────────────────────────────────────────────────────
    function toPartySeats(tally: Map<string, number>): PredictPartySeats[] {
      return [...tally.entries()]
        .filter(([, seats]) => seats > 0)
        .map(([slug, seats]) => {
          if (slug === VACANT_KEY) {
            return { party: VACANT_KEY, partyName: "Vacant", partyColor: "#374151", seats };
          }
          return {
            party: slug,
            partyName: partyName(slug),
            partyColor: partyColor(slug),
            seats,
          };
        })
        .sort((a, b) => b.seats - a.seats);
    }

    const current = toPartySeats(currentTally);
    const projected = toPartySeats(projectedTally);
    const totalSeats = current.reduce((s, p) => s + p.seats, 0);

    // Chamber display name
    const chamberName = getChamberName(country, race, countryConfig);

    return NextResponse.json({
      found: true,
      country,
      countryName: countryConfig.name,
      race,
      chamberName,
      totalSeats,
      inGeneral,
      ...(race === "senate" ? { activeSenateClass, cycle: activeCycle } : {}),
      current,
      projected,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

function restoreSeats(
  officials: ElectedOfficial[],
  state: string,
  election: Election,
  projected: Map<string, number>
) {
  for (const o of officials) {
    if (o.state !== state) continue;
    if (
      election.electionType === "senate" &&
      election.senateClass &&
      o.senateClass !== election.senateClass
    )
      continue;
    const slug = o.characterId == null && !o.party ? VACANT_KEY : (o.party ?? VACANT_KEY);
    const seats = o.seatsHeld ?? 1;
    projected.set(slug, (projected.get(slug) ?? 0) + seats);
  }
}
