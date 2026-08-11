/**
 * Slate precedence for the turn's NPP election-entry pass (tickets #904, #906).
 *
 * The default entry logic re-asserts an NPP's own "natural" race every turn:
 * incumbents auto-defend their seat, and non-incumbents auto-pick their
 * highest-priority open primary. That silently undoes a chair's slate decision
 * — withdrawing an incumbent from the slate (#904) or moving an NPP to a
 * different race (#906) reverts on the next tick.
 *
 * These helpers let a chair's slate take precedence, but ONLY for
 * slate-COMPLIANT NPPs (`isNppSlateCompliant`: loyalty ≥ 40 && stubbornness ≤
 * 70). A disloyal / stubborn NPP keeps today's autonomous behavior — the "if
 * loyalty is high enough" lever. Everything is gated on a chair-managed slate
 * actually existing for the (party, race), so worlds without player chairs (and
 * every NPP that isn't slate-managed) behave byte-identically to before.
 */
import type { ObjectId } from "mongodb";
import type { NPP, Election, ElectionCandidate } from "@/lib/db/types";
import type { RecruitmentSlate, SlateCandidate } from "@/lib/db/types";
import type { NPPContext } from "./context";
import { isNppSlateCompliant } from "@/lib/slateAssignments";
import { removeWithdrawnCandidateFromTally } from "@/lib/electionEngine/tallyCleaner";

export interface SlateOverrideMaps {
  /** `${partyId}:${electionId}` for every race a chair is actively slating. */
  chairManagedByPartyElection: Set<string>;
  /** nppId → set of electionIds the NPP holds an accepted/filed slate row for. */
  slatedElectionIdsByNpp: Map<string, Set<string>>;
}

const EMPTY_MAPS: SlateOverrideMaps = {
  chairManagedByPartyElection: new Set(),
  slatedElectionIdsByNpp: new Map(),
};

const partyElectionKey = (partyId: string, electionId: string) => `${partyId}:${electionId}`;

/**
 * Build the (party,race) chair-managed set and per-NPP slated-race map from the
 * recruitmentSlates / slateCandidates collections. Short-circuits with zero
 * follow-up queries when no chair slate covers any open primary — the common
 * case (the slate system is entirely player-chair-driven).
 */
export async function buildSlateOverrideMaps(
  ctx: NPPContext,
  openPrimaries: Election[]
): Promise<SlateOverrideMaps> {
  const { db } = ctx;
  const openElectionIds = openPrimaries.map((p) => p._id);
  if (openElectionIds.length === 0) return EMPTY_MAPS;

  const slates = await db
    .collection<RecruitmentSlate>("recruitmentSlates")
    .find({ electionId: { $in: openElectionIds } }, { projection: { electionId: 1, partyId: 1 } })
    .toArray();
  if (slates.length === 0) return EMPTY_MAPS;

  const chairManagedByPartyElection = new Set<string>();
  const slateElectionIds: ObjectId[] = [];
  for (const s of slates) {
    chairManagedByPartyElection.add(partyElectionKey(s.partyId, s.electionId.toString()));
    slateElectionIds.push(s.electionId);
  }

  // An NPP "has the chair's blessing" for a race when they hold a slate row that
  // is accepted (will file this turn) or already filed. invited/considering/
  // declined/withdrawn rows do NOT count — the chair hasn't committed them.
  const rows = await db
    .collection<SlateCandidate>("slateCandidates")
    .find(
      {
        electionId: { $in: slateElectionIds },
        candidateType: "npp",
        status: { $in: ["accepted", "filed"] },
      },
      { projection: { electionId: 1, candidateId: 1 } }
    )
    .toArray();

  const slatedElectionIdsByNpp = new Map<string, Set<string>>();
  for (const r of rows) {
    const nppId = r.candidateId.toString();
    const set = slatedElectionIdsByNpp.get(nppId) ?? new Set<string>();
    set.add(r.electionId.toString());
    slatedElectionIdsByNpp.set(nppId, set);
  }

  return { chairManagedByPartyElection, slatedElectionIdsByNpp };
}

/**
 * Should incumbent-defense be suppressed for this NPP + seat primary? True when
 * the NPP is slate-compliant, a chair is managing that (party, race), and the
 * NPP is NOT on that race's slate — i.e. the chair withdrew/benched them (#904)
 * or moved them elsewhere. A non-compliant incumbent still defends.
 */
export function slateSuppressesIncumbentDefense(
  npp: NPP,
  primary: Election,
  maps: SlateOverrideMaps
): boolean {
  if (maps.chairManagedByPartyElection.size === 0) return false;
  if (!isNppSlateCompliant(npp)) return false;
  const key = partyElectionKey(npp.party, primary._id.toString());
  if (!maps.chairManagedByPartyElection.has(key)) return false;
  const slated = maps.slatedElectionIdsByNpp.get(npp._id.toString());
  return !slated?.has(primary._id.toString());
}

/**
 * Should this NPP be held out of Phase-2 generic auto-pick? True when a
 * compliant NPP has an accepted chair-slate assignment — they must only enter
 * where the chair slated them (via fileAcceptedSlateRows), never get auto-picked
 * back into their preferred race (#906).
 */
export function slateSuppressesAutoPick(npp: NPP, maps: SlateOverrideMaps): boolean {
  if (maps.slatedElectionIdsByNpp.size === 0) return false;
  if (!maps.slatedElectionIdsByNpp.has(npp._id.toString())) return false;
  return isNppSlateCompliant(npp);
}

/**
 * Free a compliant NPP's live candidacy in a race the chair moved them AWAY
 * from, so their new slate assignment can file (#906). The chair's move action
 * only rewrites slate rows — it does not withdraw the standing candidacy — so
 * without this the NPP stays blocked in the old race by the one-active-candidacy
 * rule. Tightly scoped: only fires for a compliant NPP that (a) holds an
 * accepted/filed slate row for some race, and (b) has an active candidacy in a
 * DIFFERENT chair-managed (party,race) they are NOT slated to. Mirrors the
 * slate-withdraw cleanup (mark withdrawn → detally → archive campaign).
 *
 * Returns the number of candidacies withdrawn.
 */
export async function reconcileSlateMoves(
  ctx: NPPContext,
  maps: SlateOverrideMaps,
  nppById: Map<string, NPP>
): Promise<number> {
  const { db, now } = ctx;
  if (maps.slatedElectionIdsByNpp.size === 0) return 0;

  // Only compliant NPPs who actually hold a slate row can have a conflict.
  const compliantNppIds: ObjectId[] = [];
  for (const nppId of maps.slatedElectionIdsByNpp.keys()) {
    const npp = nppById.get(nppId);
    if (npp && isNppSlateCompliant(npp)) compliantNppIds.push(npp._id);
  }
  if (compliantNppIds.length === 0) return 0;

  const activeCandidacies = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ nppId: { $in: compliantNppIds }, status: "active" })
    .toArray();

  let withdrawn = 0;
  for (const cand of activeCandidacies) {
    const npp = cand.nppId ? nppById.get(cand.nppId.toString()) : undefined;
    if (!npp) continue;
    const electionId = cand.electionId.toString();
    const slated = maps.slatedElectionIdsByNpp.get(npp._id.toString());
    // Keep the candidacy if this IS a race the chair slated them to.
    if (slated?.has(electionId)) continue;
    // Only touch races the chair is actively managing for this NPP's party —
    // never a race the chair never engaged with (preserves NPP autonomy there).
    if (!maps.chairManagedByPartyElection.has(partyElectionKey(npp.party, electionId))) continue;

    await db
      .collection<ElectionCandidate>("electionCandidates")
      .updateOne({ _id: cand._id }, { $set: { status: "withdrawn", withdrawnAt: now } });
    await removeWithdrawnCandidateFromTally(db, cand.electionId, cand._id.toString());
    await db.collection("campaigns").updateOne(
      { electionId: cand.electionId, candidateId: cand.characterId, status: { $ne: "archived" } },
      {
        $set: {
          status: "archived",
          archivedAt: now,
          archivedReason: "withdrawn",
          updatedAt: now,
        },
      }
    );
    ctx.nppCandidacies.delete(npp._id.toString());
    withdrawn++;
    console.log(
      `[Turn] Slate move: withdrew ${npp.name} from ${cand.electionId.toString()} (chair moved to a slated race)`
    );
  }

  return withdrawn;
}
