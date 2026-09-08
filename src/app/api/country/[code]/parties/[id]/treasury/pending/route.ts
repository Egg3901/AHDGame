import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import {
  getApproverSlotForRow,
  isPendingTransactionComplete,
  listOpenPendingTransactions,
} from "@/lib/parties/pendingTreasuryTransactions";
import type { Character, State } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

// GET /api/country/[code]/parties/[id]/treasury/pending
// Returns the party's open pending treasury transactions. Used by the
// Treasury tab's "Pending Transactions" section.
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(authResult.user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) return NextResponse.json({ error: "Party not found" }, { status: 404 });

    const rows = await listOpenPendingTransactions(db, party._id, countryId);

    // Gather character + state names referenced across the rows in two
    // round-trips total (one per kind).
    const characterIds = new Set<string>();
    const stateIds = new Set<string>();
    for (const r of rows) {
      characterIds.add(r.proposedBy.toString());
      if (r.targetCharacterId) characterIds.add(r.targetCharacterId.toString());
      if (r.treasurerApproval) characterIds.add(r.treasurerApproval.characterId.toString());
      if (r.leadershipApproval) characterIds.add(r.leadershipApproval.characterId.toString());
      if (r.targetStateId) stateIds.add(r.targetStateId);
    }

    const [characterDocs, stateDocs] = await Promise.all([
      characterIds.size === 0
        ? Promise.resolve([] as Array<{ _id: ObjectId; name: string }>)
        : db
            .collection<Character>("characters")
            .find({ _id: { $in: Array.from(characterIds).map((id) => new ObjectId(id)) } })
            .project<{ _id: ObjectId; name: string }>({ name: 1 })
            .toArray(),
      stateIds.size === 0
        ? Promise.resolve([] as Array<{ _id: string; name: string }>)
        : db
            .collection<State>("states")
            .find({ _id: { $in: Array.from(stateIds) }, countryId })
            .project<{ _id: string; name: string }>({ name: 1 })
            .toArray(),
    ]);

    const charNameById = new Map<string, string>(
      characterDocs.map((c) => [c._id.toString(), c.name])
    );
    const stateNameById = new Map<string, string>(stateDocs.map((s) => [s._id, s.name]));

    const myCharOid = authResult.user.character._id;
    const myChar = myCharOid.toString();

    const items = rows.map((r) => {
      // The viewer's slot for THIS row — null if they can't approve at
      // all (not an officer, or a Request Funds row they themselves
      // requested). Helper bakes in self-exclusion for request type.
      const viewerSlot = getApproverSlotForRow(party, r, myCharOid);
      const slotAlreadyFilled =
        viewerSlot === "treasurer"
          ? !!r.treasurerApproval
          : viewerSlot === "leadership"
            ? !!r.leadershipApproval
            : true;
      const rowComplete = isPendingTransactionComplete(r);
      const canApprove = viewerSlot != null && !slotAlreadyFilled && !rowComplete;
      const canCancel = r.proposedBy.toString() === myChar;

      const mode = r.approvalModeAtPropose ?? "double";

      return {
        id: r._id.toString(),
        type: r.type,
        amount: r.amount,
        approvalMode: mode,
        proposedBy: r.proposedBy.toString(),
        proposedByName: charNameById.get(r.proposedBy.toString()) ?? "Unknown",
        proposedAtTurn: r.proposedAtTurn,
        proposedAt: r.proposedAt.toISOString(),
        expiresAtTurn: r.expiresAtTurn,
        note: r.note ?? null,
        recipient: r.targetCharacterId
          ? {
              kind: "character" as const,
              id: r.targetCharacterId.toString(),
              name: charNameById.get(r.targetCharacterId.toString()) ?? "Unknown",
            }
          : r.targetStateId
            ? {
                kind: "state" as const,
                id: r.targetStateId,
                name: stateNameById.get(r.targetStateId) ?? r.targetStateId,
              }
            : null,
        treasurerApproval: r.treasurerApproval
          ? {
              characterId: r.treasurerApproval.characterId.toString(),
              characterName:
                charNameById.get(r.treasurerApproval.characterId.toString()) ?? "Unknown",
              approvedAt: r.treasurerApproval.approvedAt.toISOString(),
            }
          : null,
        leadershipApproval: r.leadershipApproval
          ? {
              characterId: r.leadershipApproval.characterId.toString(),
              characterName:
                charNameById.get(r.leadershipApproval.characterId.toString()) ?? "Unknown",
              approvedAt: r.leadershipApproval.approvedAt.toISOString(),
            }
          : null,
        canApprove,
        canCancel,
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    return handleRouteError(error);
  }
}
