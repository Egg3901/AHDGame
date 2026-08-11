/**
 * A general's posting to a Conflict, and the units they lead there.
 *
 * This is the single binding between a general, the forces they command, and the
 * front they command them on. It replaces the retired `Formation.general`, which
 * never worked: every writer of `MilitaryUnit.formationId` set it to null, so a
 * formation's general could never reach battle math.
 *
 * Set by the Commanding General of the Command the general belongs to.
 */
export interface ConflictAssignment {
  /** The Conflict (theater) this general is posted to. */
  theaterId: string;
  /** The general (characterId). Stats are resolved server-side from characterGenerals. */
  generalCharacterId: string;
  /** True for the one Theater Commander in charge of this Conflict. */
  inCharge: boolean;
}

/**
 * Returns an error string, or null when the set is valid. Pure.
 *
 * Invariants: real commissioned general of the country; one posting per (general,
 * theater); at most one Theater Commander per theater. Theater validity (the
 * theaterId names a live conflict) is checked at the route layer against the DB —
 * conflicts are created during play, so it is not a purely-decidable invariant here.
 * A general's force is derived from `MilitaryUnit.assignedGeneralId`, not listed
 * here, so there is no per-unit validation at this layer.
 */
export function validateAssignments(
  assignments: ConflictAssignment[],
  opts: { validGenerals: Set<string> }
): string | null {
  const leadByTheater = new Set<string>();
  const seenPosting = new Set<string>();

  for (const a of assignments) {
    if (!opts.validGenerals.has(a.generalCharacterId)) return "General not in this country";

    const posting = `${a.theaterId}:${a.generalCharacterId}`;
    if (seenPosting.has(posting)) return "General assigned twice to the same conflict";
    seenPosting.add(posting);

    if (a.inCharge) {
      if (leadByTheater.has(a.theaterId)) {
        return `Only one theater commander per conflict (${a.theaterId})`;
      }
      leadByTheater.add(a.theaterId);
    }
  }
  return null;
}

/** Whether a general is posted to a given Conflict. */
export function isAssignedTo(
  assignments: ConflictAssignment[],
  generalCharacterId: string,
  theaterId: string
): boolean {
  return assignments.some(
    (a) => a.generalCharacterId === generalCharacterId && a.theaterId === theaterId
  );
}

/**
 * The theater a unit sits in, derived from its assigned general's posting.
 *
 * A unit follows its general: it is wherever that general is posted, and falls back
 * to "reserve" (homeland garrison) when it has no general or its general is not
 * posted to a Conflict. This is the single source of truth for `unit.theaterId`,
 * which is a reconciled cache of this value — never set independently.
 */
export function theaterOfUnit(
  assignedGeneralId: string | null,
  assignments: ConflictAssignment[]
): string {
  if (!assignedGeneralId) return "reserve";
  const posting = assignments.find((a) => a.generalCharacterId === assignedGeneralId);
  return posting?.theaterId ?? "reserve";
}

/** The Theater Commander of a Conflict (characterId), or null when none is designated. */
export function theaterCommanderOf(
  assignments: ConflictAssignment[],
  theaterId: string
): string | null {
  return (
    assignments.find((a) => a.theaterId === theaterId && a.inCharge)?.generalCharacterId ?? null
  );
}

/**
 * The general (characterId) commanding a unit at the front it sits on, or null.
 *
 * A unit is led by its `assignedGeneralId`, but only counts as led at the theater
 * that general is actually posted to. Since `unit.theaterId` is reconciled to the
 * general's posting, these normally agree; the posting check is defence-in-depth so
 * an unreconciled unit never inherits a general who isn't there.
 */
export function generalLeadingUnit(
  assignments: ConflictAssignment[],
  assignedGeneralId: string | null,
  unitTheaterId: string
): string | null {
  if (!assignedGeneralId) return null;
  const posted = assignments.some(
    (a) => a.generalCharacterId === assignedGeneralId && a.theaterId === unitTheaterId
  );
  return posted ? assignedGeneralId : null;
}
