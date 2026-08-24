import { requireConflictsEnabled } from "./_coldwar/gate";
import { GlobalConflictsBoard } from "./_coldwar/GlobalConflictsBoard";
import { getGameTime } from "@/lib/time/gameTime";
import { getDb } from "@/lib/mongodb";
import { listActiveConflicts } from "@/lib/db/collections/conflicts";
import { casualtiesByTheater } from "@/lib/db/collections/battleReports";
import { toConflictView } from "./_coldwar/conflictView";
import { VietnamEscalationPanel } from "./_coldwar/VietnamEscalationPanel";
import { getVietnamEscalationSummary, VIETNAM_RUNGS } from "@/lib/crises/vietnamEscalation";
import { TensionHeader, type NuclearPowerView } from "./_coldwar/TensionHeader";
import { getColdWarTension, tensionBand, tensionPressureBreakdown } from "@/lib/coldwar/tension";
import { getColdWarDials } from "@/lib/coldwar/dials";
import { listNuclearPrograms } from "@/lib/db/collections/nuclearPrograms";
import { NUCLEAR_NODES } from "@/lib/military/nuclearProgram";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { Crisis } from "@/lib/db/types/crisis";
import { GlobalResponseCrisisStrip } from "./_coldwar/GlobalResponseCrisisStrip";

// Conflicts hub: every live conflict in the world, on the map and in the list,
// under one headline: the global cold-war tension reading. Gated by
// `conflictsEnabled`; the themed-island shell and fonts come from the layout.
// The Cold War framing around the list still describes the conflicts a bloc actually
// backs; one nobody backs renders neutrally (see conflictView).
export default async function ConflictsPage() {
  await requireConflictsEnabled();
  // Use the pinned display year so the founding phase shows the era start.
  // getGameTime always populates currentYear; startingYear is a defensive floor.
  const { currentTurn, currentYear, startingYear, preIterationTurns } = await getGameTime();

  const db = await getDb();
  const docs = await listActiveConflicts(db);
  const casualties = await casualtiesByTheater(
    db,
    docs.map((d) => d._id)
  );
  const conflicts = docs.map((d) =>
    toConflictView(d, { startingYear, casualties: casualties[d._id] ?? 0, preIterationTurns })
  );

  const [vietnam, tension, dials, programs, responseCrisisDocs] = await Promise.all([
    getVietnamEscalationSummary(db),
    getColdWarTension(db),
    getColdWarDials(db),
    listNuclearPrograms(db),
    db
      .collection<Crisis>("crises")
      .find({ status: "active", globalResponse: { $exists: true } })
      .sort({ startTurn: -1 })
      .toArray(),
  ]);

  // Response scope answers who owns the decision, not how far the crisis reaches.
  // Living-conflict events are stored as country-scoped because every government
  // answers separately; globalResponse is the canonical international marker.
  const responseCrises = responseCrisisDocs.filter((crisis) => crisis.globalResponse != null);
  const activeCrisisCount = responseCrises.length;

  const totalWarheads = programs.reduce((sum, program) => sum + Math.max(0, program.warheads), 0);
  const pressureBreakdown = tensionPressureBreakdown({
    escalationLevel: vietnam.level,
    activeCrises: activeCrisisCount,
    totalWarheads,
  });

  // Who holds the bomb: any programme with a stockpile or an adopted node.
  // A country that never opened one has no document and never appears.
  const powers: NuclearPowerView[] = programs
    .filter((p) => p.warheads > 0 || Object.keys(p.adopted).length > 0)
    .map((p) => {
      // Devices are declared in ascending order, so the last adopted is the best.
      const bestDevice = NUCLEAR_NODES.filter(
        (n) => n.kind === "device" && p.adopted[n.key] != null
      ).at(-1);
      return {
        countryId: p._id,
        flag: COUNTRY_CONFIGS[p._id]?.flagEmoji ?? "",
        name: COUNTRY_CONFIGS[p._id]?.name ?? p._id,
        warheads: p.warheads,
        bestDevice: bestDevice?.name ?? null,
      };
    });

  return (
    <>
      <div style={{ padding: "26px 26px 0" }}>
        <TensionHeader
          tension={tension.value}
          band={tensionBand(tension.value)}
          defcon={dials.defcon}
          events={tension.events.map((e) => ({ turn: e.turn, label: e.label, delta: e.delta }))}
          powers={powers}
          pressures={{
            ...pressureBreakdown,
            escalationLevel: vietnam.level,
            activeCrisisCount,
            totalWarheads,
          }}
          dials={dials}
        />
        {/* Vietnam is one driver among several now, so its ladder folds into a
            secondary strip under the headline rather than leading the page. */}
        {vietnam.level > 0 ? (
          <details style={{ margin: "0 auto 18px", maxWidth: 1340 }}>
            <summary
              style={{
                cursor: "pointer",
                listStyle: "none",
                padding: "9px 16px",
                border: "1px solid rgba(220,38,38,.35)",
                background: "rgba(220,38,38,.06)",
                borderRadius: 10,
                font: "600 9px 'IBM Plex Mono',monospace",
                letterSpacing: ".18em",
                color: "#d98a8a",
              }}
            >
              ◆ VIETNAM · ESCALATION LADDER · RUNG {vietnam.level} OF {VIETNAM_RUNGS.length}
              {vietnam.rungLabel ? ` · ${vietnam.rungLabel.toUpperCase()}` : ""} · EXPAND
            </summary>
            <div style={{ marginTop: 10 }}>
              <VietnamEscalationPanel summary={vietnam} />
            </div>
          </details>
        ) : null}
        <GlobalResponseCrisisStrip
          crises={responseCrises}
          currentTurn={currentTurn}
          startingYear={startingYear}
        />
      </div>
      <GlobalConflictsBoard year={currentYear ?? startingYear} conflicts={conflicts} />
    </>
  );
}
