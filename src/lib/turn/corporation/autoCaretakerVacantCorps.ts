/**
 * Auto-install NPP caretakers on corporations left CEO-less by a HARD DEPARTURE.
 *
 * When a human CEO retires, relocates, resigns, loses residency, is deleted, or
 * is evicted as a banned shareholder, those paths set `ceoVacant: true`. Nothing
 * previously installed a replacement, so the corp bled 10%/turn of its sectors to
 * the unowned pool (`vacantCeoSectorShed`) until it was hollowed out — the
 * "placeholder CEO doesn't work" players reported.
 *
 * This pass runs each turn BEFORE the vacant/inactive sheds and installs a free
 * in-country NPP as operating CEO (`ceoType:"npp"`), so the corp runs through the
 * already-clamped NPP corp brain instead of dying. It is gated per country at
 * `nppAutonomyAtLeast(countryId, "v2")` — the same comingle tier that enables the
 * manual caretaker for player countries.
 *
 * IMPORTANT — scope: only `ceoVacant` corps are covered. Mere CEO *inactivity*
 * never sets `ceoVacant` (it is handled separately by `inactiveCeoSectorShed`),
 * so a still-seated but idle CEO is deliberately NOT auto-caretaken here.
 */

import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { CorporationLookups } from "./types";
import { nppAutonomyAtLeast } from "@/lib/nppAutonomy/featureFlag";
import {
  gatherCaretakerAffiliations,
  pickCaretakerNpp,
  installCaretakerForVacantCorp,
} from "@/lib/corporations/caretakerCeo";

/**
 * Pure eligibility predicate: a player-owned corp with no seated CEO that is not
 * already NPP-run or caretaken, and is not a state/nationalized/suspended shell.
 * Mirrors the exclusions in `vacantCeoSectorShed.shouldShedSectors` so exactly
 * the corps that would otherwise shed become caretaker candidates.
 */
export function isEligibleForAutoCaretaker(
  corp: Pick<
    Corporation,
    | "ceoVacant"
    | "ceoId"
    | "ceoType"
    | "caretakerCeo"
    | "countryOwnerId"
    | "isNationalized"
    | "suspended"
  >
): boolean {
  if (corp.countryOwnerId != null) return false;
  if (corp.isNationalized) return false;
  if (corp.suspended) return false;
  if (corp.ceoType === "npp") return false;
  if (corp.caretakerCeo) return false;
  return corp.ceoVacant === true || corp.ceoId == null;
}

/**
 * Install caretakers on every eligible vacant corp whose country is at autonomy
 * v2+. Mutates the in-memory `lookups` corp docs so the same-turn vacant/inactive
 * sheds and `processSectors` see the corp as CEO'd (not shedding), and the
 * DB-querying `processNppCorporationDecisions` picks it up this same turn.
 */
export async function installCaretakersForVacantCorps(
  db: Db,
  lookups: CorporationLookups,
  args: { turn: number; now: Date }
): Promise<{ installed: number }> {
  const { turn, now } = args;
  const candidates = lookups.corporations.filter(isEligibleForAutoCaretaker);
  if (candidates.length === 0) return { installed: 0 };

  const byCountry = new Map<Corporation["countryId"], Corporation[]>();
  for (const corp of candidates) {
    const arr = byCountry.get(corp.countryId) ?? [];
    arr.push(corp);
    byCountry.set(corp.countryId, arr);
  }

  let installed = 0;
  for (const [countryId, corps] of byCountry) {
    if (!(await nppAutonomyAtLeast(db, countryId, "v2"))) continue;

    // One free-NPP pool per country; each assignment removes its NPP so we never
    // seat the same NPP twice. When the pool is dry, the rest stay vacant.
    let affiliations = await gatherCaretakerAffiliations(db, countryId);
    for (const corp of corps) {
      const nppId = pickCaretakerNpp(affiliations);
      if (!nppId) break;

      const prevCeoId = corp.ceoId;
      const prevUserId = corp.userId;
      await installCaretakerForVacantCorp(db, { corp, nppId, turn, now });

      // Reflect the install in the snapshot the rest of this turn reads from.
      corp.ceoId = new ObjectId(nppId);
      corp.ceoType = "npp";
      corp.ceoVacant = false;
      corp.ceoSalary = 0;
      if (prevUserId != null) {
        corp.caretakerCeo = {
          ...(prevCeoId != null ? { underlyingCharacterId: prevCeoId } : {}),
          underlyingUserId: prevUserId,
          appointedTurn: turn,
        };
      }

      affiliations = affiliations.map((a) => ({
        ...a,
        freeNpps: a.freeNpps.filter((n) => n.id !== nppId),
      }));
      installed++;
    }
  }

  return { installed };
}
