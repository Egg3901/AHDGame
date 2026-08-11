import { requireConflictsEnabled } from "../_coldwar/gate";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { getTheaterState } from "@/lib/db/collections/theaterState";
import { theaterPool } from "@/lib/military/theaterPool";
import { loadMilitaryBlocs } from "@/lib/military/blocLookup";
import { blocOf } from "@/lib/military/bloc";
import { listActiveConflicts } from "@/lib/db/collections/conflicts";
import { SituationBoardClient } from "./SituationBoardClient";

// Conflicts — World Situation Board. Commit the country's combat power to proxy
// theaters. Gated by `conflictsEnabled`. Reads the viewer's country's live-unit pool
// (the committable CP) and its persisted situation state (war-footing cohesion +
// per-theater commitments), and passes both to the client.
export default async function SituationBoardPage() {
  await requireConflictsEnabled();

  const authUser = await getAuthUserWithCharacter();
  const country = authUser?.character?.countryId ?? "US";

  const db = await getDb();
  const units = await getMilitaryUnitsCollection(db).find({ countryId: country }).toArray();
  const pool = theaterPool(units);
  const [{ cohesion, committed }, blocs, conflicts] = await Promise.all([
    getTheaterState(db, country),
    loadMilitaryBlocs(db),
    listActiveConflicts(db),
  ]);
  const activeIds = new Set(conflicts.map((conflict) => conflict._id));
  const activeCommitted = Object.fromEntries(
    Object.entries(committed).filter(([conflictId]) => activeIds.has(conflictId))
  );

  return (
    <SituationBoardClient
      country={country}
      bloc={blocOf(blocs, country)}
      pool={pool}
      cohesion={cohesion}
      committed={activeCommitted}
      conflicts={conflicts
        .sort((a, b) => a.conflictId - b.conflictId)
        .map((conflict) => ({
          id: conflict._id,
          conflictId: conflict.conflictId,
          name: conflict.name,
          status: conflict.status,
          sideA: conflict.sideA.label,
          sideB: conflict.sideB.label,
          control: conflict.control,
        }))}
    />
  );
}
