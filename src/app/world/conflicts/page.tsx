import { requireConflictsEnabled } from "./_coldwar/gate";
import { GlobalConflictsBoard } from "./_coldwar/GlobalConflictsBoard";
import { getGameTime } from "@/lib/time/gameTime";
import { getDb } from "@/lib/mongodb";
import { listActiveConflicts } from "@/lib/db/collections/conflicts";
import { casualtiesByTheater } from "@/lib/db/collections/battleReports";
import { toConflictView } from "./_coldwar/conflictView";
import { VietnamEscalationPanel } from "./_coldwar/VietnamEscalationPanel";
import { getVietnamEscalationSummary } from "@/lib/crises/vietnamEscalation";

// Conflicts hub — every live conflict in the world, on the map and in the list.
// Gated by `conflictsEnabled`; the themed-island shell and fonts come from the layout.
// The Cold War framing around the list still describes the conflicts a bloc actually
// backs; one nobody backs renders neutrally (see conflictView).
export default async function ConflictsPage() {
  await requireConflictsEnabled();
  // Use the pinned display year so the founding phase shows the era start.
  // getGameTime always populates currentYear; startingYear is a defensive floor.
  const { currentYear, startingYear, preIterationTurns } = await getGameTime();

  const db = await getDb();
  const docs = await listActiveConflicts(db);
  const casualties = await casualtiesByTheater(
    db,
    docs.map((d) => d._id)
  );
  const conflicts = docs.map((d) =>
    toConflictView(d, { startingYear, casualties: casualties[d._id] ?? 0, preIterationTurns })
  );

  const vietnam = await getVietnamEscalationSummary(db);

  return (
    <>
      {vietnam.level > 0 ? (
        <div style={{ padding: "26px 26px 0" }}>
          <VietnamEscalationPanel summary={vietnam} />
        </div>
      ) : null}
      <GlobalConflictsBoard year={currentYear ?? startingYear} conflicts={conflicts} />
    </>
  );
}
