/**
 * Caretaker CEO — NPP-autonomy V2.1.
 *
 * A player corp owner (the sitting CEO) may hand day-to-day operation of their
 * own corporation to an autonomous NPP "caretaker". The corp then runs through
 * the existing, fully-clamped NPP corp brain (`processNppCorporationDecisions`
 * → `ceoArchetype`) exactly like a spawned NPP corp — same `SAFE_*` bounds, so
 * no autonomous lever can drive the corp into the ground.
 *
 * The defining property (vs. a spawned NPP corp) is that this is **player-
 * appointed and player-revoked**: `corp.userId` deliberately stays the
 * appointing owner, so they keep `requireCeo` authorization and private-data
 * access and can reclaim the seat at any time. We stash the displaced human CEO
 * in `corp.caretakerCeo` so dismissal restores them exactly.
 *
 * This module is the mechanism only; the feature gate
 * (`nppAutonomyAtLeast(corp.countryId, "v1")` — true for autonomy countries at
 * v1 and player countries at v2) lives at the call site.
 */

import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Corporation, NPP } from "@/lib/db/types";
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";
import { openCeoTenure, closeCeoTenure } from "./ceoHistory";
import {
  buildCeoAffiliations,
  chooseNppCorpCeo,
  type NppCorpCeoAffiliation,
} from "@/lib/admin/nppCorpCeoSelection";

/** Reason a caretaker appointment was rejected (pure, before any I/O). */
export type CaretakerAppointmentError =
  | "corp-not-found"
  | "already-caretaker"
  | "ceo-vacant"
  | "ceo-not-character"
  | "reclaim-cooldown"
  | "no-eligible-npp"
  | "npp-not-eligible";

/**
 * Cooldown, in turns (= real hours), that must elapse after an owner reclaims
 * control before a new caretaker may be installed. 3 days × 24 turns/day = 72.
 * Stops a corp from flipping between owner and caretaker turn-to-turn to game
 * whichever operator is momentarily advantageous.
 */
export const CARETAKER_REAPPOINT_COOLDOWN_TURNS = 3 * TURNS_PER_DAY;

/**
 * Validate (purely) that `corp` is in a state where its human CEO may install a
 * caretaker NPP. Returns the error code, or `null` when the appointment is
 * allowed. Kept side-effect-free so the branching is exhaustively unit-testable.
 * `currentTurn` is needed to enforce the post-reclaim reappointment cooldown.
 */
export function validateCaretakerAppointment(
  corp: Pick<
    Corporation,
    "ceoType" | "ceoVacant" | "caretakerCeo" | "ceoId" | "caretakerCooldownUntilTurn"
  > | null,
  currentTurn: number
): CaretakerAppointmentError | null {
  if (!corp) return "corp-not-found";
  if (corp.caretakerCeo) return "already-caretaker";
  if (corp.ceoVacant) return "ceo-vacant";
  // Only a sitting human CEO can hand operation to a caretaker. An imperial or
  // existing NPP CEO is not the player-owner case this feature serves.
  if (corp.ceoType && corp.ceoType !== "character") return "ceo-not-character";
  // Post-reclaim cooldown: a recently-reclaimed corp must wait before handing off again.
  if (corp.caretakerCooldownUntilTurn != null && currentTurn < corp.caretakerCooldownUntilTurn) {
    return "reclaim-cooldown";
  }
  return null;
}

/**
 * Turns remaining on the post-reclaim caretaker cooldown, or 0 if none. Surfaced
 * to the corp detail so the UI can disable the "hand to caretaker" affordance and
 * explain why. Pure.
 */
export function caretakerReappointCooldownRemaining(
  corp: Pick<Corporation, "caretakerCooldownUntilTurn">,
  currentTurn: number
): number {
  if (corp.caretakerCooldownUntilTurn == null) return 0;
  return Math.max(0, corp.caretakerCooldownUntilTurn - currentTurn);
}

/**
 * Choose which NPP should caretake `corp`. If `forcedNppId` is supplied it must
 * be a free (non-CEO) NPP in the corp's country; otherwise the balanced
 * `chooseNppCorpCeo` picker selects one from the country pool. Returns the NPP
 * id string, or `null` when no eligible NPP exists.
 */
export function pickCaretakerNpp(
  affiliations: NppCorpCeoAffiliation[],
  forcedNppId?: string
): string | null {
  if (forcedNppId) {
    const isFree = affiliations.some((a) => a.freeNpps.some((n) => n.id === forcedNppId));
    return isFree ? forcedNppId : null;
  }
  const choice = chooseNppCorpCeo({ affiliations });
  // A caretaker reuses an EXISTING free NPP only — we never spin up a brand-new
  // NPP just to run a player's corp (that is the spawn path's job).
  return choice.kind === "existing" ? choice.nppId : null;
}

export interface AppointCaretakerCeoResult {
  ok: boolean;
  error?: CaretakerAppointmentError;
  nppId?: string;
  nppName?: string;
}

/**
 * Install an NPP caretaker as operator of `corp`. The corp keeps its owner
 * (`userId`) and shareholders untouched; only operation moves to the NPP.
 *
 * Steps, mirroring the player CEO-accept/admin-appoint writes:
 *  - close the outgoing human CEO's open tenure, open an `npp` tenure;
 *  - set `ceoType:"npp"` + `ceoId` to the NPP, stash the displaced human in
 *    `caretakerCeo`, and zero `ceoSalary` (an absent human draws no pay, and we
 *    do not gift the player's configured salary to the NPP — salary on
 *    `ceoType:"npp"` corps accrues to NPP funds).
 */
export async function appointCaretakerCeo(
  db: Db,
  args: { corp: Corporation; forcedNppId?: string; turn: number; now: Date }
): Promise<AppointCaretakerCeoResult> {
  const { corp, forcedNppId, turn, now } = args;

  const invalid = validateCaretakerAppointment(corp, turn);
  if (invalid) return { ok: false, error: invalid };

  const affiliations = await gatherCaretakerAffiliations(db, corp.countryId);
  const nppId = pickCaretakerNpp(affiliations, forcedNppId);
  if (!nppId) return { ok: false, error: forcedNppId ? "npp-not-eligible" : "no-eligible-npp" };

  const nppOid = new ObjectId(nppId);
  const npp = await db
    .collection<NPP>("npps")
    .findOne({ _id: nppOid }, { projection: { name: 1 } });
  if (!npp) return { ok: false, error: "npp-not-eligible" };

  await db.collection<Corporation>("corporations").updateOne(
    { _id: corp._id },
    {
      $set: {
        ceoId: nppOid,
        ceoType: "npp",
        ceoVacant: false,
        ceoSalary: 0,
        caretakerCeo: {
          underlyingCharacterId: corp.ceoId,
          underlyingUserId: corp.userId,
          appointedTurn: turn,
          appointmentSource: "owner",
        },
        updatedAt: now,
      },
      $unset: { pendingCeoCharacterId: "" },
    }
  );

  // Tenure log: close the human's open tenure, open the NPP's.
  await closeCeoTenure(db, corp._id, { holderId: corp.ceoId, turn });
  await openCeoTenure(db, corp._id, { holderId: nppOid, ceoType: "npp", turn });

  return { ok: true, nppId, nppName: npp.name };
}

export interface DismissCaretakerCeoResult {
  ok: boolean;
  error?: "not-caretaker";
  restoredCharacterId?: string;
}

/**
 * Dismiss the caretaker NPP and restore the human owner as CEO. Idempotent-safe:
 * a corp without `caretakerCeo` is a no-op error. `ceoSalary` is NOT restored —
 * the returning owner re-sets their own pay.
 */
export async function dismissCaretakerCeo(
  db: Db,
  args: { corp: Corporation; turn: number; now: Date }
): Promise<DismissCaretakerCeoResult> {
  const { corp, turn, now } = args;
  if (!corp.caretakerCeo) return { ok: false, error: "not-caretaker" };

  const { underlyingCharacterId, underlyingUserId, appointmentSource } = corp.caretakerCeo;
  // Only an owner-initiated handoff can be cycled for an advantage. An NPP that
  // filled a resignation vacancy must be immediately recoverable and must not
  // leave a blanket reappointment ban behind. Missing provenance predates this
  // field, so it is treated as the safer vacancy recovery case.
  const reappointmentCooldown =
    appointmentSource === "owner"
      ? { caretakerCooldownUntilTurn: turn + CARETAKER_REAPPOINT_COOLDOWN_TURNS }
      : {};

  if (!underlyingCharacterId) {
    // Auto-installed caretaker with no human to restore: return the corp to a
    // plain vacant seat (owner retained) rather than seating a ghost character.
    await db.collection<Corporation>("corporations").updateOne(
      { _id: corp._id },
      {
        $set: {
          ceoType: "character",
          userId: underlyingUserId,
          ceoVacant: true,
          ...reappointmentCooldown,
          updatedAt: now,
        },
        $unset: {
          caretakerCeo: "",
          ceoId: "",
          ...(appointmentSource === "owner" ? {} : { caretakerCooldownUntilTurn: "" }),
        },
      }
    );
    // Close the caretaker NPP's tenure; there is no human tenure to reopen.
    if (corp.ceoId) await closeCeoTenure(db, corp._id, { holderId: corp.ceoId, turn });
    return { ok: true };
  }

  await db.collection<Corporation>("corporations").updateOne(
    { _id: corp._id },
    {
      $set: {
        ceoId: underlyingCharacterId,
        ceoType: "character",
        userId: underlyingUserId,
        ceoVacant: false,
        ...reappointmentCooldown,
        updatedAt: now,
      },
      $unset: {
        caretakerCeo: "",
        ...(appointmentSource === "owner" ? {} : { caretakerCooldownUntilTurn: "" }),
      },
    }
  );

  // Close the caretaker NPP's tenure, reopen the restored human's.
  if (corp.ceoId) await closeCeoTenure(db, corp._id, { holderId: corp.ceoId, turn });
  await openCeoTenure(db, corp._id, {
    holderId: underlyingCharacterId,
    ceoType: "character",
    turn,
  });

  return { ok: true, restoredCharacterId: underlyingCharacterId.toString() };
}

/**
 * Pure builder for the corporations write that installs an NPP caretaker onto a
 * corp whose human CEO has ALREADY departed (a hard-departure vacancy). Unlike
 * `appointCaretakerCeo` (player-initiated on a still-seated CEO), this is used
 * by the turn-loop auto-installer.
 *
 * The `caretakerCeo` stash — which is what gives the owner the dismiss/reclaim
 * affordance — is written only when an owning `userId` survived the departure
 * (e.g. resignation, retirement). When the departure also cleared ownership
 * (relocation, residency loss), the corp becomes a plain NPP-operated corp with
 * no stash. `underlyingCharacterId` is stashed only when a character id survived.
 */
export function buildVacantCaretakerCeoUpdate(
  corp: Pick<Corporation, "ceoId" | "userId">,
  nppOid: ObjectId,
  turn: number,
  now: Date
): { set: Record<string, unknown>; unset: Record<string, ""> } {
  const set: Record<string, unknown> = {
    ceoId: nppOid,
    ceoType: "npp",
    ceoVacant: false,
    ceoSalary: 0,
    updatedAt: now,
  };
  const unset: Record<string, ""> = { pendingCeoCharacterId: "", ceoVacantSinceTurn: "" };
  if (corp.userId != null) {
    set.caretakerCeo = {
      ...(corp.ceoId != null ? { underlyingCharacterId: corp.ceoId } : {}),
      underlyingUserId: corp.userId,
      appointedTurn: turn,
      appointmentSource: "vacancy",
    };
  }
  return { set, unset };
}

/**
 * Install an NPP caretaker onto a single already-vacant corp (turn-loop path).
 * Caller is responsible for the autonomy gate and for choosing `nppId` from a
 * free-NPP pool. Writes the corp update + opens the NPP tenure (closing any
 * lingering human tenure).
 */
export async function installCaretakerForVacantCorp(
  db: Db,
  args: { corp: Corporation; nppId: string; turn: number; now: Date }
): Promise<void> {
  const { corp, nppId, turn, now } = args;
  const nppOid = new ObjectId(nppId);
  const { set, unset } = buildVacantCaretakerCeoUpdate(corp, nppOid, turn, now);
  await db
    .collection<Corporation>("corporations")
    .updateOne({ _id: corp._id }, { $set: set, $unset: unset });
  if (corp.ceoId != null) await closeCeoTenure(db, corp._id, { holderId: corp.ceoId, turn });
  await openCeoTenure(db, corp._id, { holderId: nppOid, ceoType: "npp", turn });
}

/**
 * Gather the per-affiliation free-NPP view for `countryId` that the picker
 * needs. Mirrors the spawn path's gatherer but inlined here to avoid importing
 * the heavyweight spawn module's name-generation surface.
 */
export async function gatherCaretakerAffiliations(
  db: Db,
  countryId: Corporation["countryId"]
): Promise<NppCorpCeoAffiliation[]> {
  const partyDocs = await db
    .collection("politicalParties")
    .find({ countryId, isDefunct: { $ne: true } })
    .project<{ sequentialId: number }>({ sequentialId: 1 })
    .toArray();
  const nonDefunctPartyIds = partyDocs.map((p) => String(p.sequentialId));

  const corps = await db
    .collection<Corporation>("corporations")
    .find({ ceoType: "npp", countryId })
    .project<{ ceoId: ObjectId }>({ ceoId: 1 })
    .toArray();
  const ceoIds = corps.map((c) => c.ceoId).filter(Boolean);
  const ceoNppDocs = ceoIds.length
    ? await db
        .collection<NPP>("npps")
        .find({ _id: { $in: ceoIds } })
        .project<{ _id: ObjectId; party: string }>({ _id: 1, party: 1 })
        .toArray()
    : [];
  const existingCorpCeos = ceoNppDocs.map((n) => ({ nppId: n._id.toString(), party: n.party }));

  const activeNppDocs = await db
    .collection<NPP>("npps")
    .find({ countryId, retiredAt: null })
    .project<{ _id: ObjectId; party: string; politicalInfluence: number; sequentialId?: number }>({
      _id: 1,
      party: 1,
      politicalInfluence: 1,
      sequentialId: 1,
    })
    .toArray();
  const activeNpps = activeNppDocs.map((n) => ({
    id: n._id.toString(),
    party: n.party,
    influence: n.politicalInfluence ?? 0,
    seq: n.sequentialId ?? Number.MAX_SAFE_INTEGER,
  }));

  return buildCeoAffiliations({ nonDefunctPartyIds, existingCorpCeos, activeNpps });
}
