/**
 * GET /api/congress/bills/[id]/votes?chamber=origin|other
 *
 * Returns individual voter details for a bill's origin or other chamber votes.
 * Public endpoint — no auth required.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { getPartyMap } from "@/lib/db/partyMap";
import type { Bill, Character, NPP, ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import { resolveBillCountryId } from "@/lib/congress/resolveBillCountryId";
import { buildScopedVoteInputs, type ScopedVoteOfficial } from "@/lib/congress/billVoting";
import { snapshotWeightMap } from "@/lib/legislature/voteSnapshot";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";

interface IndividualVote {
  id: string;
  name: string;
  party: string;
  partyName: string;
  partyColor: string;
  vote: "for" | "against" | "abstain";
  isNPP: boolean;
  seatsHeld: number;
  sequentialId?: number;
}

function resolveVoteOfficeType(countryId: CountryId, bill: Bill, chamber: "origin" | "other") {
  const config = getCountryConfig(countryId);
  const chamberKey =
    chamber === "origin"
      ? resolvePrimaryVoteChamberKey(bill, config.legislature.lowerChamber.key)
      : bill.currentChamber;
  if (!chamberKey || chamberKey === "cabinet") return null;
  return getOfficeTypeForChamber(
    countryId,
    chamberKey === "joint" ? config.legislature.lowerChamber.key : chamberKey
  );
}

function resolvePrimaryVoteChamberKey(bill: Bill, lowerKey: string): string | undefined {
  if (bill.status === "cabinet_review") return undefined;
  if (bill.status === "override_shugiin") return bill.currentChamber;
  if (bill.originChamber === "cabinet") return lowerKey;
  return bill.originChamber;
}

// GET /api/congress/bills/[id]/votes — Returns individual voter details for a bill's origin or other chamber votes.
// Auth: public
// Errors: 400, 404
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id))
      return NextResponse.json({ error: "Invalid bill ID" }, { status: 400 });

    const { searchParams } = new URL(request.url);
    const chamber = searchParams.get("chamber") ?? "origin";
    if (chamber !== "origin" && chamber !== "other") {
      return NextResponse.json(
        { error: 'Invalid chamber param — must be "origin" or "other"' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const bill = await db.collection<Bill>("bills").findOne({ _id: new ObjectId(id) });
    if (!bill) return NextResponse.json({ error: "Bill not found" }, { status: 404 });

    // Pick the votes map for the requested chamber
    const votesMap: Record<string, "for" | "against" | "abstain"> =
      chamber === "other" ? (bill.otherChamberVotes ?? {}) : (bill.votes ?? {});

    let voteKeys = Object.keys(votesMap);
    if (voteKeys.length === 0) {
      return NextResponse.json({ voters: [] });
    }

    const country = await resolveBillCountryId(db, bill);

    // Separate character IDs and NPP IDs
    const charIds: string[] = [];
    const nppIds: string[] = [];
    for (const key of voteKeys) {
      if (key.startsWith("npp_")) {
        const raw = key.slice(4);
        if (raw && ObjectId.isValid(raw)) nppIds.push(raw);
      } else if (key && ObjectId.isValid(key)) {
        charIds.push(key);
      }
    }
    const uniqueCharIds = [...new Set(charIds)];
    const uniqueNppIds = [...new Set(nppIds)];

    // Batch-fetch characters, NPPs, elected officials, and parties
    const [characters, npps, partyMap] = await Promise.all([
      uniqueCharIds.length > 0
        ? db
            .collection<Character>("characters")
            .find({
              _id: { $in: uniqueCharIds.map((i) => new ObjectId(i)) },
            })
            .project({ _id: 1, name: 1, party: 1, sequentialId: 1 })
            .toArray()
        : Promise.resolve([]),
      uniqueNppIds.length > 0
        ? db
            .collection<NPP>("npps")
            .find({
              _id: { $in: uniqueNppIds.map((i) => new ObjectId(i)) },
            })
            .project({ _id: 1, name: 1, party: 1 })
            .toArray()
        : Promise.resolve([]),
      getPartyMap(db, country),
    ]);

    // Build slug→sequentialId reverse map for NPP party slug resolution
    const allParties = await db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId: country })
      .project({ sequentialId: 1, slug: 1 })
      .toArray();
    const slugToSeqId = new Map<string, string>();
    for (const p of allParties) {
      if (p.slug) slugToSeqId.set(p.slug, String(p.sequentialId));
    }

    // Fetch elected officials for chamber eligibility and seatsHeld lookup
    const orClauses: Record<string, unknown>[] = [];
    if (uniqueCharIds.length > 0) {
      orClauses.push({
        characterId: {
          $in: uniqueCharIds.map((i) => new ObjectId(i)),
        },
        nppId: null,
      });
    }
    if (uniqueNppIds.length > 0) {
      orClauses.push({
        nppId: { $in: uniqueNppIds.map((i) => new ObjectId(i)) },
      });
    }
    const officials =
      orClauses.length > 0
        ? await db
            .collection<ElectedOfficial>("electedOfficials")
            .find({ $or: orClauses })
            .project<ScopedVoteOfficial>({
              characterId: 1,
              countryId: 1,
              nppId: 1,
              officeType: 1,
              seatsHeld: 1,
            })
            .toArray()
        : [];
    const voteOfficeType = resolveVoteOfficeType(country, bill, chamber);
    const scopedVoteInputs = buildScopedVoteInputs(
      votesMap,
      officials,
      voteOfficeType ? { countryId: country, officeType: voteOfficeType } : null
    );
    // A concluded phase has a frozen snapshot — show the roster (and seat weights)
    // as they were at close, so a later election cannot drop the voters who
    // actually voted (#0982). Only an in-progress phase live-scopes.
    const phaseSnapshot = chamber === "other" ? bill.otherChamberVoteSnapshot : bill.voteSnapshot;
    const scopedVotesMap = phaseSnapshot ? phaseSnapshot.votes : (scopedVoteInputs.votes ?? {});
    const weightMap = phaseSnapshot ? snapshotWeightMap(phaseSnapshot) : scopedVoteInputs.weightMap;
    voteKeys = Object.keys(scopedVotesMap);

    // Build lookup maps
    const charMap = new Map(characters.map((c) => [c._id.toString(), c]));
    const nppMap = new Map(npps.map((n) => [n._id.toString(), n]));

    const independentParty = {
      name: "Independent",
      color: "#888888",
      sequentialId: -1,
    };

    // Resolve each vote entry
    const voters: IndividualVote[] = [];
    for (const key of voteKeys) {
      const vote = scopedVotesMap[key];
      const isNPP = key.startsWith("npp_");
      const rawId = isNPP ? key.slice(4) : key;

      let name = "Unknown";
      let partySeqId = "independent";
      let charSequentialId: number | undefined;

      if (isNPP) {
        const npp = nppMap.get(rawId);
        if (npp) {
          name = npp.name;
          const slug = npp.party ?? "independent";
          partySeqId = slugToSeqId.get(slug) ?? slug;
        }
      } else {
        const char = charMap.get(rawId);
        if (char) {
          name = char.name;
          partySeqId = char.party ?? "independent";
          charSequentialId = char.sequentialId;
        }
      }

      const party = partyMap.get(partySeqId);
      const resolved = party ?? independentParty;

      const entry: IndividualVote = {
        id: key,
        name,
        party: partySeqId,
        partyName: resolved.name,
        partyColor: resolved.color ?? "#888888",
        vote,
        isNPP,
        seatsHeld: weightMap.get(key) ?? 1,
      };
      if (charSequentialId != null) {
        entry.sequentialId = charSequentialId;
      }
      voters.push(entry);
    }

    return NextResponse.json({ voters });
  } catch (error) {
    return handleRouteError(error);
  }
}
