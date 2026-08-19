// GET diagnoses / POST backfills missing turn timing fields and countryId on state, national, and committee party elections.
// Auth: requireAdmin
// Errors: 403
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import type {
  StatePartyElection,
  NationalPartyElection,
  NationalCommitteeElection,
  GameState,
} from "@/lib/db/types";

interface StateElectionIssue {
  _id: string;
  type: "state";
  stateId: string;
  partyId: string;
  position: string;
  status: string;
  hasStartTurn: boolean;
  hasEndTurn: boolean;
  hasDurationTurns: boolean;
}

interface NationalElectionIssue {
  _id: string;
  type: "national";
  partyId: string;
  countryId: string;
  position: string;
  status: string;
  hasStartTurn: boolean;
  hasEndTurn: boolean;
  hasDurationTurns: boolean;
  hasCountryId: boolean;
}

interface CommitteeElectionIssue {
  _id: string;
  type: "committee";
  partyId: string;
  countryId: string;
  status: string;
  hasStartTurn: boolean;
  hasEndTurn: boolean;
  hasDurationTurns: boolean;
  hasCountryId: boolean;
}

type ElectionIssue = StateElectionIssue | NationalElectionIssue | CommitteeElectionIssue;

/**
 * GET /api/admin/heal/party-elections
 * Diagnose both state and national party elections with missing turn fields
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Find state elections missing fields
    const stateElectionsWithIssues = (await db
      .collection("statePartyElections")
      .find({
        $or: [
          { startTurn: { $exists: false } },
          { endTurn: { $exists: false } },
          { durationTurns: { $exists: false } },
          { startTurn: null },
          { endTurn: null },
          { durationTurns: null },
        ],
      })
      .toArray()) as unknown as StatePartyElection[];

    // Find national elections missing fields (including countryId)
    const nationalElectionsWithIssues = (await db
      .collection("nationalPartyElections")
      .find({
        $or: [
          { startTurn: { $exists: false } },
          { endTurn: { $exists: false } },
          { durationTurns: { $exists: false } },
          { countryId: { $exists: false } },
          { startTurn: null },
          { endTurn: null },
          { durationTurns: null },
          { countryId: null },
        ],
      })
      .toArray()) as unknown as NationalPartyElection[];

    const stateIssues: StateElectionIssue[] = stateElectionsWithIssues.map((e) => ({
      _id: e._id.toString(),
      type: "state",
      stateId: e.stateId,
      partyId: e.partyId,
      position: e.position,
      status: e.status,
      hasStartTurn: e.startTurn !== undefined && e.startTurn !== null,
      hasEndTurn: e.endTurn !== undefined && e.endTurn !== null,
      hasDurationTurns: e.durationTurns !== undefined && e.durationTurns !== null,
    }));

    const nationalIssues: NationalElectionIssue[] = nationalElectionsWithIssues.map((e) => ({
      _id: e._id.toString(),
      type: "national",
      partyId: e.partyId,
      countryId: e.countryId ?? "unknown",
      position: e.position,
      status: e.status,
      hasStartTurn: e.startTurn !== undefined && e.startTurn !== null,
      hasEndTurn: e.endTurn !== undefined && e.endTurn !== null,
      hasDurationTurns: e.durationTurns !== undefined && e.durationTurns !== null,
      hasCountryId: e.countryId !== undefined && e.countryId !== null,
    }));

    // Find committee elections missing fields (including countryId)
    const committeeElectionsWithIssues = (await db
      .collection("nationalCommitteeElections")
      .find({
        $or: [
          { startTurn: { $exists: false } },
          { endTurn: { $exists: false } },
          { durationTurns: { $exists: false } },
          { countryId: { $exists: false } },
          { startTurn: null },
          { endTurn: null },
          { durationTurns: null },
          { countryId: null },
        ],
      })
      .toArray()) as unknown as NationalCommitteeElection[];

    const committeeIssues: CommitteeElectionIssue[] = committeeElectionsWithIssues.map((e) => ({
      _id: e._id.toString(),
      type: "committee",
      partyId: e.partyId,
      countryId: e.countryId ?? "unknown",
      status: e.status,
      hasStartTurn: e.startTurn !== undefined && e.startTurn !== null,
      hasEndTurn: e.endTurn !== undefined && e.endTurn !== null,
      hasDurationTurns: e.durationTurns !== undefined && e.durationTurns !== null,
      hasCountryId: e.countryId !== undefined && e.countryId !== null,
    }));

    const allIssues: ElectionIssue[] = [...stateIssues, ...nationalIssues, ...committeeIssues];

    const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });

    return NextResponse.json({
      status: allIssues.length === 0 ? "ok" : "needs_fix",
      stateIssueCount: stateIssues.length,
      nationalIssueCount: nationalIssues.length,
      committeeIssueCount: committeeIssues.length,
      totalIssueCount: allIssues.length,
      currentTurn: gameState?.currentTurn ?? 0,
      elections: allIssues.slice(0, 30), // Limit to first 30 for display
      message:
        allIssues.length === 0
          ? "All party elections have valid fields"
          : `Found ${stateIssues.length} state + ${nationalIssues.length} national + ${committeeIssues.length} committee election(s) with missing fields`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/heal/party-elections
 * Fix both state and national party elections with missing fields
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const currentTurn = gameState?.currentTurn ?? 0;

    const defaultDuration = 96;
    let stateFixed = 0;
    let nationalFixed = 0;

    // Fix state elections
    const stateElectionsToFix = (await db
      .collection("statePartyElections")
      .find({
        $or: [
          { startTurn: { $exists: false } },
          { endTurn: { $exists: false } },
          { durationTurns: { $exists: false } },
          { startTurn: null },
          { endTurn: null },
          { durationTurns: null },
        ],
      })
      .toArray()) as unknown as StatePartyElection[];

    for (const election of stateElectionsToFix) {
      let startTurn: number | null = null;
      let endTurn: number | null = null;
      let durationTurns: number = defaultDuration;

      // Try to find a sibling election with valid turn fields
      const siblingElection = (await db.collection("statePartyElections").findOne({
        stateId: election.stateId,
        partyId: election.partyId,
        position: { $ne: election.position },
        startTurn: { $exists: true, $ne: null },
        endTurn: { $exists: true, $ne: null },
      })) as StatePartyElection | null;

      if (siblingElection && siblingElection.startTurn != null && siblingElection.endTurn != null) {
        startTurn = siblingElection.startTurn;
        endTurn = siblingElection.endTurn;
        durationTurns = siblingElection.durationTurns ?? defaultDuration;
      } else {
        if (election.status === "completed" || election.status === "cancelled") {
          endTurn = currentTurn - 1;
          startTurn = endTurn - defaultDuration;
        } else {
          startTurn = currentTurn;
          endTurn = currentTurn + defaultDuration;
        }
      }

      await db.collection<StatePartyElection>("statePartyElections").updateOne(
        { _id: election._id },
        {
          $set: {
            startTurn: election.startTurn ?? startTurn,
            endTurn: election.endTurn ?? endTurn,
            durationTurns: election.durationTurns ?? durationTurns,
            updatedAt: new Date(),
          },
        }
      );
      stateFixed++;
    }

    // Fix national elections
    const nationalElectionsToFix = (await db
      .collection("nationalPartyElections")
      .find({
        $or: [
          { startTurn: { $exists: false } },
          { endTurn: { $exists: false } },
          { durationTurns: { $exists: false } },
          { countryId: { $exists: false } },
          { startTurn: null },
          { endTurn: null },
          { durationTurns: null },
          { countryId: null },
        ],
      })
      .toArray()) as unknown as NationalPartyElection[];

    for (const election of nationalElectionsToFix) {
      let startTurn: number | null = null;
      let endTurn: number | null = null;
      let durationTurns: number = defaultDuration;
      let countryId = election.countryId;

      // Try to find a sibling election with valid fields
      // Include countryId if available to avoid cross-country sequential ID collisions
      const siblingQuery: Record<string, unknown> = {
        partyId: election.partyId,
        position: { $ne: election.position },
        startTurn: { $exists: true, $ne: null },
        endTurn: { $exists: true, $ne: null },
      };
      if (election.countryId) siblingQuery.countryId = election.countryId;
      const siblingElection = (await db
        .collection("nationalPartyElections")
        .findOne(siblingQuery)) as NationalPartyElection | null;

      if (siblingElection && siblingElection.startTurn != null && siblingElection.endTurn != null) {
        startTurn = siblingElection.startTurn;
        endTurn = siblingElection.endTurn;
        durationTurns = siblingElection.durationTurns ?? defaultDuration;
        // Also use sibling's countryId if this one is missing
        if (!countryId && siblingElection.countryId) {
          countryId = siblingElection.countryId;
        }
      } else {
        if (election.status === "completed" || election.status === "cancelled") {
          endTurn = currentTurn - 1;
          startTurn = endTurn - defaultDuration;
        } else {
          startTurn = currentTurn;
          endTurn = currentTurn + defaultDuration;
        }
      }

      // If still no countryId, try to derive from party
      if (!countryId) {
        const partySeqId = Number.parseInt(election.partyId, 10);
        if (!Number.isNaN(partySeqId)) {
          // Find all parties with this sequentialId to handle cross-country cases
          const parties = await db
            .collection("politicalParties")
            .find({ sequentialId: partySeqId })
            .toArray();
          if (parties.length === 1 && parties[0].countryId) {
            // Unambiguous - only one party has this sequentialId
            countryId = parties[0].countryId;
          } else if (parties.length > 1) {
            // Multiple parties with same sequentialId - default to US
            console.warn(
              `[HealPartyElections] Ambiguous: ${parties.length} parties with sequentialId ${partySeqId}, defaulting to US`
            );
            countryId = "US";
          }
        }
        // Default to US if still unknown
        if (!countryId) {
          countryId = "US";
        }
      }

      await db.collection<NationalPartyElection>("nationalPartyElections").updateOne(
        { _id: election._id },
        {
          $set: {
            startTurn: election.startTurn ?? startTurn,
            endTurn: election.endTurn ?? endTurn,
            durationTurns: election.durationTurns ?? durationTurns,
            countryId,
            updatedAt: new Date(),
          },
        }
      );
      nationalFixed++;
    }

    // Fix committee elections
    const committeeElectionsToFix = (await db
      .collection("nationalCommitteeElections")
      .find({
        $or: [
          { startTurn: { $exists: false } },
          { endTurn: { $exists: false } },
          { durationTurns: { $exists: false } },
          { countryId: { $exists: false } },
          { startTurn: null },
          { endTurn: null },
          { durationTurns: null },
          { countryId: null },
        ],
      })
      .toArray()) as unknown as NationalCommitteeElection[];

    let committeeFixed = 0;
    const committeeDuration = 168; // Committee elections are 168 turns (1 week)

    for (const election of committeeElectionsToFix) {
      let startTurn: number | null = null;
      let endTurn: number | null = null;
      const durationTurns: number = committeeDuration;
      let countryId = election.countryId;

      if (election.status === "completed" || election.status === "cancelled") {
        endTurn = currentTurn - 1;
        startTurn = endTurn - committeeDuration;
      } else {
        startTurn = currentTurn;
        endTurn = currentTurn + committeeDuration;
      }

      // If no countryId, try to derive from party
      if (!countryId) {
        const partySeqId = Number.parseInt(election.partyId, 10);
        if (!Number.isNaN(partySeqId)) {
          // Find all parties with this sequentialId to handle cross-country cases
          const parties = await db
            .collection("politicalParties")
            .find({ sequentialId: partySeqId })
            .toArray();
          if (parties.length === 1 && parties[0].countryId) {
            // Unambiguous - only one party has this sequentialId
            countryId = parties[0].countryId;
          } else if (parties.length > 1) {
            // Multiple parties with same sequentialId - default to US
            console.warn(
              `[HealPartyElections] Committee: Ambiguous: ${parties.length} parties with sequentialId ${partySeqId}, defaulting to US`
            );
            countryId = "US";
          }
        }
        // Default to US if still unknown
        if (!countryId) {
          countryId = "US";
        }
      }

      await db.collection<NationalCommitteeElection>("nationalCommitteeElections").updateOne(
        { _id: election._id },
        {
          $set: {
            startTurn: election.startTurn ?? startTurn,
            endTurn: election.endTurn ?? endTurn,
            durationTurns: election.durationTurns ?? durationTurns,
            countryId,
            updatedAt: new Date(),
          },
        }
      );
      committeeFixed++;
    }

    const totalFixed = stateFixed + nationalFixed + committeeFixed;
    if (totalFixed === 0) {
      return NextResponse.json({
        success: true,
        message: "No elections needed fixing",
        stateFixed: 0,
        nationalFixed: 0,
        committeeFixed: 0,
        totalFixed: 0,
      });
    }

    return NextResponse.json({
      success: true,
      message: `Fixed ${stateFixed} state + ${nationalFixed} national + ${committeeFixed} committee party election(s)`,
      stateFixed,
      nationalFixed,
      committeeFixed,
      totalFixed,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
