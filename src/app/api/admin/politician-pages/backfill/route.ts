import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import type {
  Character,
  State,
  PoliticalParty,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  CongressLeader,
} from "@/lib/db/types";
import { getOfficeLabel } from "@/lib/utils/politics";
import { generatePoliticianFlavor } from "@/lib/wiki/politicianFlavor";
import type { PoliticianOverride, PoliticianElectionEntry } from "@/lib/db/types";
import { formatElectionTypeLabel, MULTI_SEAT_TYPES } from "@/lib/utils/electionLabels";

export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const now = new Date();

    const [characters, states, parties] = await Promise.all([
      db.collection<Character>("characters").find({}).toArray(),
      db.collection<State>("states").find({}).toArray(),
      db.collection<PoliticalParty>("politicalParties").find({}).toArray(),
    ]);

    const stateMap = new Map(states.map((s) => [String(s._id), s]));
    const partyMap = new Map(parties.map((p) => [String(p._id), p]));

    const congressLeaders = await db
      .collection<CongressLeader>("congressLeaders")
      .find({})
      .toArray();
    const characterIdsInLeadership = new Set(
      congressLeaders.filter((l) => l.characterId).map((l) => l.characterId!.toString())
    );

    let generated = 0;
    let electionUpdates = 0;

    const processPolitician = async (
      id: string,
      name: string,
      homeStateId: string,
      partyId: string,
      currentOffice: Character["currentOffice"] | null
    ) => {
      const state = stateMap.get(String(homeStateId));
      const party = partyMap.get(String(partyId));
      const stateName = state?.name ?? homeStateId;
      const partyName = party?.name ?? (partyId === "independent" ? "Independent" : "Unknown");
      const officeLabel = getOfficeLabel(currentOffice);

      const flavor = generatePoliticianFlavor(id, {
        name,
        stateName,
        partyName,
        isIndependent: partyId === "independent",
        hasOffice: !!currentOffice,
        officeLabel,
        isNPP: false,
      });

      const candidates = await db
        .collection<ElectionCandidate>("electionCandidates")
        .find({ characterId: new ObjectId(id), status: "withdrawn" })
        .toArray();

      const electionIds = [...new Set(candidates.map((c) => c.electionId.toString()))];
      const elections = electionIds.length
        ? await db
            .collection<Election>("elections")
            .find({
              _id: { $in: candidates.map((c) => c.electionId) },
              status: { $in: ["completed", "resolved"] },
            })
            .toArray()
        : [];

      const electionMap = new Map(elections.map((e) => [e._id.toString(), e]));
      const tallies = await db
        .collection<ElectionVoteTally>("electionVoteTallies")
        .find({ electionId: { $in: elections.map((e) => e._id) }, finalized: true })
        .toArray();
      const tallyMap = new Map(tallies.map((t) => [t.electionId.toString(), t]));

      const history: PoliticianElectionEntry[] = [];

      for (const cand of candidates) {
        const election = electionMap.get(cand.electionId.toString());
        if (!election || election.status !== "completed") continue;

        const tally = tallyMap.get(election._id.toString());
        const totalVotes = tally ? Object.values(tally.totalVotes).reduce((s, v) => s + v, 0) : 0;
        const votes = tally?.totalVotes[cand._id.toString()] ?? 0;
        const votesPct = totalVotes > 0 ? (votes / totalVotes) * 100 : 0;

        const ranked = tally
          ? Object.entries(tally.totalVotes)
              .sort(([, a], [, b]) => b - a)
              .map(([cid]) => cid)
          : [];
        const rank = ranked.indexOf(cand._id.toString());

        const isMultiSeat = MULTI_SEAT_TYPES.has(election.electionType);
        const seatsEst = tally?.seatsEstimate?.[cand._id.toString()] ?? 0;
        const won = isMultiSeat ? seatsEst > 0 : rank === 0;

        const year = election.endTime
          ? new Date(election.endTime).getFullYear()
          : new Date().getFullYear();
        const officeLabel = formatElectionTypeLabel(election.electionType, election.countryId);
        const electionStateName = stateMap.get(String(election.state))?.name ?? election.state;

        history.push({
          electionId: election._id.toString(),
          electionType: election.electionType,
          state: election.state,
          stateName: electionStateName,
          year,
          result: won ? "won" : "lost",
          votes,
          votesPct,
          party: partyMap.get(String(cand.party))?.name ?? cand.party,
          officeLabel: `${officeLabel} (${electionStateName})`,
          completedAt: election.endTime ?? now,
        });
      }

      history.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());

      const hasHeldCongressLeadership = characterIdsInLeadership.has(id);

      const existing = await db
        .collection<PoliticianOverride>("politicianOverrides")
        .findOne({ politicianId: id });

      const doc: Omit<PoliticianOverride, "_id"> = {
        politicianId: id,
        customBio: existing?.customBio,
        customSections: existing?.customSections,
        sectionOrder: existing?.sectionOrder,
        autoGeneratedBio: flavor,
        electionHistory: history,
        hasHeldCongressLeadership: hasHeldCongressLeadership || existing?.hasHeldCongressLeadership,
        updatedAt: now,
      };

      if (existing) {
        await db.collection<PoliticianOverride>("politicianOverrides").updateOne(
          { politicianId: id },
          {
            $set: {
              autoGeneratedBio: flavor,
              electionHistory: history,
              hasHeldCongressLeadership:
                hasHeldCongressLeadership || existing.hasHeldCongressLeadership,
              updatedAt: now,
            },
          }
        );
      } else {
        await db
          .collection<PoliticianOverride>("politicianOverrides")
          .insertOne(doc as PoliticianOverride);
      }

      generated++;
      if (history.length > 0) electionUpdates++;

      return { generated, electionUpdates };
    };

    for (const char of characters) {
      await processPolitician(
        char._id.toString(),
        char.name,
        String(char.homeState),
        char.party?.toString() ?? "independent",
        char.currentOffice
      );
    }

    return NextResponse.json({
      ok: true,
      generated,
      characters: characters.length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
