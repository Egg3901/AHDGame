import type { Db, ObjectId } from "mongodb";
import type { Bill, Corporation, CorporateSector, PendingNationalization } from "@/lib/db/types";
import type { BillStatus, NationalizeProvision } from "@/lib/db/types/legislation";
import { inferCountryIdFromStateId } from "@/lib/congress/resolveBillCountryId";

/**
 * Bill statuses that count as "still in process" — a nationalization bill in one
 * of these is in voting / not yet finalized. The terminal states
 * (signed/vetoed/failed/override_failed/withdrawn) are excluded.
 */
const ACTIVE_BILL_STATUSES: ReadonlySet<BillStatus> = new Set([
  "proposed",
  "active",
  "passed_origin",
  "active_other",
  "active_both",
  "enrolled",
  "cabinet_review",
  "override_shugiin",
  "veto_override",
  "filibustered",
]);

/** One active (in-voting) nationalization bill matched against a corp. */
export interface MatchedNationalizationBill {
  billId: string;
  title: string;
  /** Targets the whole corporation. */
  whole: boolean;
  /** This corp's sector ids the bill targets (direct or via sector-type sweep). */
  sectorIds: string[];
}

/**
 * Active-status nationalization bills targeting `corp` — the whole corp
 * (`targetCorporationId`), a specific sector (`targetSectorId`), or a sector type
 * the corp operates (`targetSectorType`, scoped to the corp's country). Shared by
 * the threat summary (hero chip) and the status card so the two never disagree.
 */
export async function matchActiveNationalizationBills(
  db: Db,
  corp: Corporation,
  sectorIdStr: ReadonlySet<string>,
  typeToSectorIds: ReadonlyMap<string, ObjectId[]>
): Promise<MatchedNationalizationBill[]> {
  const bills = await db
    .collection<Bill>("bills")
    .find({
      status: { $in: Array.from(ACTIVE_BILL_STATUSES) },
      provisions: { $elemMatch: { type: "nationalize" } },
    })
    .toArray();

  const matched: MatchedNationalizationBill[] = [];
  for (const bill of bills) {
    if (!ACTIVE_BILL_STATUSES.has(bill.status)) continue; // defensive (query already filters)
    const billCountry = bill.countryId ?? inferCountryIdFromStateId(bill.stateId ?? "");
    let whole = false;
    const billSectors = new Set<string>();
    for (const prov of bill.provisions ?? []) {
      if (prov.type !== "nationalize") continue;
      const np = prov as NationalizeProvision;
      if (np.targetCorporationId && String(np.targetCorporationId) === String(corp._id)) {
        whole = true;
      } else if (np.targetSectorId && sectorIdStr.has(String(np.targetSectorId))) {
        billSectors.add(String(np.targetSectorId));
      } else if (np.targetSectorType && corp.countryId && billCountry === corp.countryId) {
        const ids = typeToSectorIds.get(np.targetSectorType);
        if (ids) for (const id of ids) billSectors.add(String(id));
      }
    }
    if (whole || billSectors.size > 0) {
      matched.push({
        billId: String(bill._id),
        title: bill.title ?? "Nationalization bill",
        whole,
        sectorIds: Array.from(billSectors),
      });
    }
  }
  return matched;
}

export interface CorpNationalizationThreat {
  /** The whole corporation is a nationalization target (pending or in voting). */
  whole: boolean;
  /** Count of this corp's distinct sectors targeted (pending or in voting). */
  sectorCount: number;
  stage: "voting" | "pending" | "both";
  /** Soonest pending-taking notice deadline; null when only bills-in-voting exist. */
  soonestTakingDeadlineTurn: number | null;
  turnsUntilTaking: number | null;
}

/**
 * Aggregate the legislative-nationalization threat against one corporation from
 * both sources: post-passage pending takings (notice window counting down) and
 * nationalization bills still in voting. Returns null when the corp faces
 * neither. Public information — callers may surface it to any viewer.
 */
export async function buildCorpNationalizationThreat(
  db: Db,
  corp: Corporation,
  currentTurn: number
): Promise<CorpNationalizationThreat | null> {
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({ corporationId: corp._id }, { projection: { _id: 1, sectorType: 1 } })
    .toArray();
  const sectorIds = sectors.map((s) => s._id);
  const sectorIdStr = new Set(sectorIds.map((id) => String(id)));
  const typeToSectorIds = new Map<string, ObjectId[]>();
  for (const s of sectors) {
    const list = typeToSectorIds.get(s.sectorType) ?? [];
    list.push(s._id);
    typeToSectorIds.set(s.sectorType, list);
  }

  const affected = new Set<string>();
  let whole = false;
  let hasPending = false;
  let hasVoting = false;
  let soonestDeadline: number | null = null;

  // ── Pending takings (post-passage notice window) ──
  const pending = await db
    .collection<PendingNationalization>("pendingNationalizations")
    .find({
      status: "pending",
      $or: [
        { targetCorporationId: corp._id },
        ...(sectorIds.length > 0 ? [{ targetSectorId: { $in: sectorIds } }] : []),
      ],
    })
    .toArray();
  for (const p of pending) {
    hasPending = true;
    if (p.targetCorporationId) whole = true;
    else if (p.targetSectorId) affected.add(String(p.targetSectorId));
    if (soonestDeadline == null || p.noticeDeadlineTurn < soonestDeadline) {
      soonestDeadline = p.noticeDeadlineTurn;
    }
  }

  // ── Bills still in voting (pre-passage) ──
  const matchedBills = await matchActiveNationalizationBills(
    db,
    corp,
    sectorIdStr,
    typeToSectorIds
  );
  for (const m of matchedBills) {
    hasVoting = true;
    if (m.whole) whole = true;
    for (const sid of m.sectorIds) affected.add(sid);
  }

  const sectorCount = affected.size;
  if (!whole && sectorCount === 0) return null;

  const stage = hasPending && hasVoting ? "both" : hasPending ? "pending" : "voting";
  return {
    whole,
    sectorCount,
    stage,
    soonestTakingDeadlineTurn: soonestDeadline,
    turnsUntilTaking: soonestDeadline == null ? null : Math.max(0, soonestDeadline - currentTurn),
  };
}
