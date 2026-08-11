/**
 * GET  /api/admin/leadership-elections — list leadership elections by type
 * POST /api/admin/leadership-elections — force pass/fail/cancel on elections
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { markCongressLeadershipHeld } from "@/lib/wiki/markCongressLeadership";
import { z } from "zod";
import type {
  SpeakerElection,
  SpeakerNomination,
  HouseLeadershipElection,
  HouseLeadershipNomination,
  SenateLeadershipElection,
  SenateLeadershipNomination,
  CongressLeader,
  Character,
  ConfidenceVote,
} from "@/lib/db/types";
import type { NoConfidenceVote } from "@/lib/db/types/governmentFormation";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";

const ELECTION_TYPES = [
  "speaker",
  "house_leadership",
  "senate_leadership",
  "confidence_vote",
  "no_confidence_vote",
] as const;

type ElectionType = (typeof ELECTION_TYPES)[number];

const SPEAKER_ROLE_LABEL = "Speaker of the House";

const HOUSE_ROLE_LABELS: Record<string, string> = {
  majority_leader: "Majority Leader",
  minority_leader: "Minority Leader",
};

const SENATE_ROLE_LABELS: Record<string, string> = {
  pro_tempore: "President Pro Tempore",
  majority_leader: "Majority Leader",
  minority_leader: "Minority Leader",
};

/** Map from election type + role to CongressLeader role key */
function getCongressLeaderRole(type: string, role?: string): CongressLeader["role"] | null {
  if (type === "speaker") return "speaker_of_the_house";
  if (type === "house_leadership") {
    if (role === "majority_leader") return "majority_leader_house";
    if (role === "minority_leader") return "minority_leader_house";
  }
  if (type === "senate_leadership") {
    if (role === "pro_tempore") return "president_pro_tempore";
    if (role === "majority_leader") return "majority_leader_senate";
    if (role === "minority_leader") return "minority_leader_senate";
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

async function getSpeakerElections(db: Awaited<ReturnType<typeof getDb>>) {
  const election = await db
    .collection<SpeakerElection>("speakerElections")
    .findOne({ _id: "current" });
  if (!election) return { elections: [] };

  const nominations = await db
    .collection<SpeakerNomination>("speakerNominations")
    .find({})
    .toArray();

  return {
    elections: [
      {
        id: "current",
        role: "speaker",
        roleLabel: SPEAKER_ROLE_LABEL,
        status: election.status,
        startedAt: election.startedAt?.toISOString() ?? null,
        endsAt: election.endsAt?.toISOString() ?? null,
        candidates: nominations.map((n) => ({
          id: n._id.toString(),
          name: n.nomineeName,
          party: n.nomineeParty ?? null,
          status: n.status,
          votesFor: n.votesFor,
          votesAgainst: n.votesAgainst,
        })),
      },
    ],
  };
}

async function getHouseLeadershipElections(db: Awaited<ReturnType<typeof getDb>>) {
  const elections = await db
    .collection<HouseLeadershipElection>("houseLeadershipElections")
    .find({})
    .toArray();

  const nominations = await db
    .collection<HouseLeadershipNomination>("houseLeadershipNominations")
    .find({})
    .toArray();

  const nomsByRole = new Map<string, HouseLeadershipNomination[]>();
  for (const n of nominations) {
    const arr = nomsByRole.get(n.role) ?? [];
    arr.push(n);
    nomsByRole.set(n.role, arr);
  }

  return {
    elections: elections.map((e) => ({
      id: e._id,
      role: e._id,
      roleLabel: HOUSE_ROLE_LABELS[e._id] ?? e._id,
      status: e.status,
      startedAt: e.startedAt?.toISOString() ?? null,
      endsAt: e.endsAt?.toISOString() ?? null,
      candidates: (nomsByRole.get(e._id) ?? []).map((n) => ({
        id: n._id.toString(),
        name: n.nomineeName,
        party: n.nomineeParty ?? null,
        status: n.status,
        votesFor: n.votesFor,
        votesAgainst: n.votesAgainst,
      })),
    })),
  };
}

async function getSenateLeadershipElections(db: Awaited<ReturnType<typeof getDb>>) {
  const elections = await db
    .collection<SenateLeadershipElection>("senateLeadershipElections")
    .find({})
    .toArray();

  const nominations = await db
    .collection<SenateLeadershipNomination>("senateLeadershipNominations")
    .find({})
    .toArray();

  const nomsByRole = new Map<string, SenateLeadershipNomination[]>();
  for (const n of nominations) {
    const arr = nomsByRole.get(n.role) ?? [];
    arr.push(n);
    nomsByRole.set(n.role, arr);
  }

  return {
    elections: elections.map((e) => ({
      id: e._id,
      role: e._id,
      roleLabel: SENATE_ROLE_LABELS[e._id] ?? e._id,
      status: e.status,
      startedAt: e.startedAt?.toISOString() ?? null,
      endsAt: e.endsAt?.toISOString() ?? null,
      candidates: (nomsByRole.get(e._id) ?? []).map((n) => ({
        id: n._id.toString(),
        name: n.nomineeName,
        party: n.nomineeParty ?? null,
        status: n.status,
        votesFor: n.votesFor,
        votesAgainst: n.votesAgainst,
      })),
    })),
  };
}

async function getConfidenceVotes(db: Awaited<ReturnType<typeof getDb>>) {
  const votes = await db
    .collection<ConfidenceVote>("confidenceVotes")
    .find({ countryId: "UK" as const })
    .sort({ openedAt: -1 })
    .toArray();

  // Resolve nominee names
  const charIds = votes.map((v) => v.nominatedCharacterId);
  const characters =
    charIds.length > 0
      ? await db
          .collection<Character>("characters")
          .find({ _id: { $in: charIds } })
          .project({ _id: 1, name: 1 })
          .toArray()
      : [];
  const charMap = new Map(characters.map((c) => [c._id.toString(), c.name]));

  return {
    votes: votes.map((v) => ({
      id: v._id.toString(),
      nominatedCharacterId: v.nominatedCharacterId.toString(),
      nomineeName: charMap.get(v.nominatedCharacterId.toString()) ?? "Unknown",
      party: v.party,
      votesFor: v.votesFor,
      votesAgainst: v.votesAgainst,
      status: v.status,
      openedAt: v.openedAt?.toISOString() ?? null,
      closesAt: v.closesAt?.toISOString() ?? null,
      closedAt: v.closedAt?.toISOString() ?? null,
    })),
  };
}

async function getNoConfidenceVotes(db: Awaited<ReturnType<typeof getDb>>) {
  const votes = await db
    .collection<NoConfidenceVote>("noConfidenceVotes")
    .find({})
    .sort({ openedAt: -1 })
    .toArray();

  return {
    votes: votes.map((v) => ({
      id: v._id.toString(),
      pmCharacterId: v.targetPmCharacterId.toString(),
      pmName: v.targetPmName,
      proposedBy: v.proposedByName,
      votesFor: v.votesFor,
      votesAgainst: v.votesAgainst,
      status: v.status,
      openedAt: v.openedAt?.toISOString() ?? null,
      closesAt: v.closesAt?.toISOString() ?? null,
      closedAt: v.closedAt?.toISOString() ?? null,
    })),
  };
}

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") as ElectionType | null;

    if (!type || !ELECTION_TYPES.includes(type)) {
      return NextResponse.json(
        {
          error: `Missing or invalid "type" param. Must be one of: ${ELECTION_TYPES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const db = await getDb();

    switch (type) {
      case "speaker":
        return NextResponse.json(await getSpeakerElections(db));
      case "house_leadership":
        return NextResponse.json(await getHouseLeadershipElections(db));
      case "senate_leadership":
        return NextResponse.json(await getSenateLeadershipElections(db));
      case "confidence_vote":
        return NextResponse.json(await getConfidenceVotes(db));
      case "no_confidence_vote":
        return NextResponse.json(await getNoConfidenceVotes(db));
    }
  } catch (error) {
    return handleRouteError(error);
  }
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

const actionSchema = z.object({
  type: z.enum([
    "speaker",
    "house_leadership",
    "senate_leadership",
    "confidence_vote",
    "no_confidence_vote",
  ]),
  action: z.enum(["pass", "fail", "cancel"]),
  electionId: z.string(),
  winnerId: z.string().optional(),
  role: z.string().optional(),
});

async function handleUSPass(
  db: Awaited<ReturnType<typeof getDb>>,
  type: ElectionType,
  electionId: string,
  winnerId: string,
  role: string | undefined
) {
  const now = new Date();

  // Determine collections and election query
  let nominationsCollection: string;
  let electionsCollection: string;
  let electionQuery: Record<string, unknown>;
  let nominationRoleFilter: Record<string, unknown> = {};

  if (type === "speaker") {
    nominationsCollection = "speakerNominations";
    electionsCollection = "speakerElections";
    electionQuery = { _id: "current" };
  } else if (type === "house_leadership") {
    if (!role) throw new Error("role is required for house_leadership");
    nominationsCollection = "houseLeadershipNominations";
    electionsCollection = "houseLeadershipElections";
    electionQuery = { _id: role };
    nominationRoleFilter = { role };
  } else {
    if (!role) throw new Error("role is required for senate_leadership");
    nominationsCollection = "senateLeadershipNominations";
    electionsCollection = "senateLeadershipElections";
    electionQuery = { _id: role };
    nominationRoleFilter = { role };
  }

  // Find the winning nomination
  const winner = await db
    .collection(nominationsCollection)
    .findOne({ _id: new ObjectId(winnerId), ...nominationRoleFilter });
  if (!winner) {
    return NextResponse.json({ error: "Winner nomination not found" }, { status: 404 });
  }

  // Set winner to confirmed, others to failed
  await db
    .collection(nominationsCollection)
    .updateOne({ _id: new ObjectId(winnerId) }, { $set: { status: "confirmed", updatedAt: now } });

  await db.collection(nominationsCollection).updateMany(
    {
      _id: { $ne: new ObjectId(winnerId) },
      ...nominationRoleFilter,
      status: { $nin: ["confirmed", "failed", "cancelled"] },
    },
    { $set: { status: "failed", updatedAt: now } }
  );

  // Close the election
  await db
    .collection(electionsCollection)
    .updateOne(electionQuery, { $set: { status: "closed", updatedAt: now } });

  // Upsert congress leader
  const congressRole = getCongressLeaderRole(type, role);
  if (congressRole) {
    await db.collection<CongressLeader>("congressLeaders").updateOne(
      { role: congressRole },
      {
        $set: {
          characterId: winner.nomineeId as ObjectId,
          characterName: winner.nomineeName as string,
          party: (winner.nomineeParty as string | undefined) ?? undefined,
          electedAt: now,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );

    // Mark wiki record (fire-and-forget)
    markCongressLeadershipHeld(db, (winner.nomineeId as ObjectId).toString(), now).catch(() => {});
  }

  return NextResponse.json({
    message: `${winner.nomineeName as string} confirmed as ${type === "speaker" ? SPEAKER_ROLE_LABEL : ((type === "house_leadership" ? HOUSE_ROLE_LABELS[role!] : SENATE_ROLE_LABELS[role!]) ?? role)}`,
  });
}

async function handleUSFail(
  db: Awaited<ReturnType<typeof getDb>>,
  type: ElectionType,
  _electionId: string,
  role: string | undefined
) {
  const now = new Date();

  let nominationsCollection: string;
  let electionsCollection: string;
  let electionQuery: Record<string, unknown>;
  let nominationRoleFilter: Record<string, unknown> = {};

  if (type === "speaker") {
    nominationsCollection = "speakerNominations";
    electionsCollection = "speakerElections";
    electionQuery = { _id: "current" };
  } else if (type === "house_leadership") {
    if (!role) throw new Error("role is required for house_leadership");
    nominationsCollection = "houseLeadershipNominations";
    electionsCollection = "houseLeadershipElections";
    electionQuery = { _id: role };
    nominationRoleFilter = { role };
  } else {
    if (!role) throw new Error("role is required for senate_leadership");
    nominationsCollection = "senateLeadershipNominations";
    electionsCollection = "senateLeadershipElections";
    electionQuery = { _id: role };
    nominationRoleFilter = { role };
  }

  // Fail all open nominations
  await db.collection(nominationsCollection).updateMany(
    {
      ...nominationRoleFilter,
      status: { $nin: ["confirmed", "failed", "cancelled"] },
    },
    { $set: { status: "failed", updatedAt: now } }
  );

  // Close election
  await db
    .collection(electionsCollection)
    .updateOne(electionQuery, { $set: { status: "closed", updatedAt: now } });

  return NextResponse.json({ message: "Election failed and closed." });
}

async function handleUSCancel(
  db: Awaited<ReturnType<typeof getDb>>,
  type: ElectionType,
  _electionId: string,
  role: string | undefined
) {
  const now = new Date();

  let nominationsCollection: string;
  let electionsCollection: string;
  let electionQuery: Record<string, unknown>;
  let nominationRoleFilter: Record<string, unknown> = {};

  if (type === "speaker") {
    nominationsCollection = "speakerNominations";
    electionsCollection = "speakerElections";
    electionQuery = { _id: "current" };
  } else if (type === "house_leadership") {
    if (!role) throw new Error("role is required for house_leadership");
    nominationsCollection = "houseLeadershipNominations";
    electionsCollection = "houseLeadershipElections";
    electionQuery = { _id: role };
    nominationRoleFilter = { role };
  } else {
    if (!role) throw new Error("role is required for senate_leadership");
    nominationsCollection = "senateLeadershipNominations";
    electionsCollection = "senateLeadershipElections";
    electionQuery = { _id: role };
    nominationRoleFilter = { role };
  }

  // Cancel all open nominations
  await db.collection(nominationsCollection).updateMany(
    {
      ...nominationRoleFilter,
      status: { $nin: ["confirmed", "failed", "cancelled"] },
    },
    { $set: { status: "cancelled", updatedAt: now } }
  );

  // Cancel election
  await db.collection(electionsCollection).updateOne(electionQuery, {
    $set: { status: "cancelled", updatedAt: now },
  });

  return NextResponse.json({ message: "Election cancelled." });
}

async function handleUKAction(
  db: Awaited<ReturnType<typeof getDb>>,
  type: ElectionType,
  action: "pass" | "fail" | "cancel",
  electionId: string
) {
  const now = new Date();
  const collection = type === "confidence_vote" ? "confidenceVotes" : "noConfidenceVotes";

  const statusMap = {
    pass: "passed",
    fail: "failed",
    cancel: "cancelled",
  } as const;

  const voteOid = new ObjectId(electionId);
  const result = await db.collection(collection).updateOne(
    { _id: voteOid },
    {
      $set: {
        status: statusMap[action],
        closedAt: now,
        updatedAt: now,
      },
    }
  );

  if (result.matchedCount === 0) {
    return NextResponse.json({ error: "Vote not found" }, { status: 404 });
  }

  // Clear activeVoteId on governmentFormations if this vote was the active one
  await getGovernmentFormationsCollection(db).updateOne(
    { activeVoteId: voteOid },
    { $set: { activeVoteId: null, updatedAt: now } }
  );

  // If no-confidence passed via admin, collapse government to pending
  if (type === "no_confidence_vote" && action === "pass") {
    const { tallyCommonsSeatsByParty, getLargestParty } =
      await import("@/lib/turn/ukGovernmentFormation");
    const seatsByParty = await tallyCommonsSeatsByParty(db);
    const governingPartyId = getLargestParty(seatsByParty);

    await getGovernmentFormationsCollection(db).updateOne(
      { _id: "UK" },
      {
        $set: {
          status: "pending",
          formationType: null,
          lostMajority: false,
          pmCharacterId: null,
          pmName: null,
          governingPartyId,
          seatsByParty,
          collapsedAt: now,
          formedAt: null,
          updatedAt: now,
        },
      }
    );
    // Clear cabinet
    await Promise.all([
      db.collection("cabinetMembers").deleteMany({ countryId: "UK" }),
      db.collection("ukCabinetCooldowns").deleteMany({ countryId: "UK" }),
    ]);
    // Clear PM office from UK characters only — other countries have their own PM
    await db
      .collection("characters")
      .updateMany(
        { "currentOffice.type": "primeMinister", countryId: "UK" },
        { $set: { currentOffice: null, updatedAt: now } }
      );
  }

  const actionLabel = action === "pass" ? "passed" : action === "fail" ? "failed" : "cancelled";
  return NextResponse.json({
    message: `Vote ${actionLabel}.`,
  });
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, actionSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { type, action, electionId, winnerId, role } = parsed.data;
    const db = await getDb();

    const isUSType =
      type === "speaker" || type === "house_leadership" || type === "senate_leadership";

    if (isUSType) {
      if (action === "pass") {
        if (!winnerId) {
          return NextResponse.json(
            { error: "winnerId is required for pass action" },
            { status: 400 }
          );
        }
        return handleUSPass(db, type, electionId, winnerId, role);
      }
      if (action === "fail") {
        return handleUSFail(db, type, electionId, role);
      }
      return handleUSCancel(db, type, electionId, role);
    }

    // UK types
    return handleUKAction(db, type, action, electionId);
  } catch (error) {
    return handleRouteError(error);
  }
}
