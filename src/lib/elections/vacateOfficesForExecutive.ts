import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { ElectedOfficial } from "@/lib/db/types";
import { getExecutiveOfficeKeys } from "@/lib/elections/executiveOffice";
import { notifyGovernorOfSenateVacancy } from "@/lib/governors/senateVacancy";
import { updatePartyPresence } from "@/lib/turn/partyOrg/presence";

export interface ExecutiveHolderRef {
  characterId?: ObjectId | null;
  nppId?: ObjectId | null;
}

export interface VacatedOfficeSummary {
  officeType: string;
  state?: string;
  senateClass?: 1 | 2 | 3;
  party?: string;
  countryId?: string;
}

/**
 * Vacate every non-executive elected office held by a newly-seated national
 * executive (president / vice president and their per-country equivalents).
 *
 * A holder seated into the executive keeps no legislative, gubernatorial, or
 * other non-executive office: each row naming them is reduced to an unheld
 * vacancy record (the same tombstone `resignOfficial` leaves with
 * `preserveSeatRecord`, so the governor/house vacancy listings and the
 * by-election watcher keep working), the governor is notified of freed Senate
 * seats so the appointment succession can run, chamber leadership is
 * re-triggered where the composition changed, and party presence is
 * recounted for the affected states.
 *
 * Which offices count as executive comes from {@link getExecutiveOfficeKeys},
 * the country-config derived set, so no office names are hardcoded here.
 * Idempotent: a holder with no non-executive rows performs zero writes.
 */
export async function vacateNonExecutiveOfficesForExecutive(
  db: Db,
  holder: ExecutiveHolderRef,
  now: Date
): Promise<{ vacated: VacatedOfficeSummary[] }> {
  const holderFilter: Record<string, unknown> = {};
  if (holder.characterId) holderFilter.characterId = holder.characterId;
  else if (holder.nppId) holderFilter.nppId = holder.nppId;
  else return { vacated: [] };

  const rows = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(
      {
        ...holderFilter,
        officeType: { $nin: [...getExecutiveOfficeKeys()] },
      },
      {
        projection: {
          officeType: 1,
          state: 1,
          senateClass: 1,
          party: 1,
          seatsHeld: 1,
          countryId: 1,
        },
      }
    )
    .toArray();

  if (rows.length === 0) return { vacated: [] };

  // Snapshot before the write below: drivers hand back copies, but never read
  // post-write state to describe what was vacated.
  const vacated: VacatedOfficeSummary[] = rows.map((row) => ({
    officeType: row.officeType,
    ...(row.state ? { state: row.state } : {}),
    ...(row.senateClass ? { senateClass: row.senateClass } : {}),
    ...(row.party ? { party: row.party } : {}),
    ...((row as { countryId?: string }).countryId
      ? { countryId: (row as { countryId?: string }).countryId }
      : {}),
  }));

  const nullHolderUpdate: Record<string, unknown> = {
    characterName: null,
    party: null,
    isNPP: false,
    updatedAt: now,
  };
  if (holder.characterId) nullHolderUpdate.characterId = null;
  else nullHolderUpdate.nppId = null;

  await db.collection<ElectedOfficial>("electedOfficials").updateMany(
    {
      ...holderFilter,
      officeType: { $nin: [...getExecutiveOfficeKeys()] },
    },
    {
      $set: nullHolderUpdate,
      // A vacated multi-seat bloc must not linger as a `party: null,
      // seatsHeld > 0` orphan that the seat tallies skip. Clear it so
      // vacancy reads as absence (generalResolution precedent).
      $unset: { seatsHeld: "" },
    }
  );

  const chambers = new Set<string>();
  for (const row of vacated) {
    if (
      row.officeType === "senate" &&
      row.state &&
      (row.senateClass === 1 || row.senateClass === 2 || row.senateClass === 3)
    ) {
      await notifyGovernorOfSenateVacancy(db, row.state, row.senateClass);
    }
    const rowCountry = row.countryId ?? "US";
    if ((row.officeType === "senate" || row.officeType === "house") && rowCountry === "US") {
      chambers.add(row.officeType);
    }
  }

  if (chambers.size > 0) {
    // Lazy import: congress/leadershipElections pulls the Discord webhook and
    // composition modules; keep them out of every seating call that vacates
    // nothing (and out of unit-test module graphs that never trigger this).
    const { triggerLeadershipElectionsAfterChamberVote } =
      await import("@/lib/congress/leadershipElections");
    for (const chamber of chambers) {
      await triggerLeadershipElectionsAfterChamberVote(db, chamber as "house" | "senate", now);
    }
  }

  const presenceKeys = new Set<string>();
  for (const row of vacated) {
    if (row.state && row.party && !presenceKeys.has(`${row.state}_${row.party}`)) {
      presenceKeys.add(`${row.state}_${row.party}`);
      await updatePartyPresence(db, row.state, row.party);
    }
  }

  return { vacated };
}
