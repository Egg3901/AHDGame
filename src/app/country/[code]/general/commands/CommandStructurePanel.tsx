"use client";

import type { MilitaryCommand, CommanderRef } from "@/lib/military/types";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { COMMAND_TYPES } from "@/lib/military/config";
import { PostureEffects, TypeBonuses } from "@/components/CommandEffects";
import { getRegion } from "@/lib/military/regions";
import {
  forceLoad,
  overBy,
  effectiveness,
  effIntent,
  overCapacityPenalties,
  unitLoad,
} from "@/lib/military/calc";

const INTENT_TEXT = { success: "text-success", warn: "text-warning", error: "text-error" } as const;

/**
 * The Commanding General's read-only view of their own command.
 *
 * A Command is built in the defence seat's office and employed here, and for a
 * while the only route to its makeup was a link into that office — which the
 * cabinet fog-of-war gate closes to everyone but the seat holder, their head of
 * government and their head of state. A Commanding General is none of those, so
 * their own order of battle became unreachable to them.
 *
 * The answer is not to open the department: its budget, arsenal and standing
 * orders are still none of a field commander's business. It is to publish the
 * one slice that is theirs — the command they command — where they already work.
 *
 * Read-only by construction. Every lever over this structure (posture, regions,
 * commanders, which units are in it) belongs to the defence seat; the CG's own
 * levers are postings, which live below this panel.
 */
export function CommandStructurePanel({
  command,
  generals,
  units,
}: {
  command: MilitaryCommand;
  /**
   * Generals to name unit leaders from. The country's whole roster, not this
   * command's: a unit in this command's establishment can be assigned to a general
   * in another one, and reading that as unled would be wrong.
   */
  generals: CommanderRef[];
  /** The units to resolve ids against. Ids with no unit are skipped, not blanked. */
  units: MilitaryUnit[];
}) {
  const unitsById: Record<string, MilitaryUnit> = Object.fromEntries(
    units.map((u) => [String(u._id), u])
  );
  const generalName = (id: string | null) =>
    (id && generals.find((g) => g.id === id)?.name) || "General Staff";

  // Resolved FIRST, so the headings count what is actually on screen. A count over
  // rows that could not be drawn is exactly what made a command with a departed
  // commander unreadable: "COMMANDERS - 1" above an empty list.
  const regions = command.regionIds.map(getRegion).filter((r) => r !== undefined);
  const assignedUnits = command.unitIds.map((id) => unitsById[id]).filter((u) => u !== undefined);

  const load = forceLoad(command, unitsById);
  const over = overBy(command, unitsById) > 0;
  const eff = effectiveness(command, unitsById);
  const type = COMMAND_TYPES[command.type];

  const overview: { label: string; value: string; cls?: string }[] = [
    { label: "Posture", value: command.posture },
    {
      label: "Supply",
      value: command.supply,
      cls: command.supply === "Emergency" ? "text-error" : undefined,
    },
    { label: "Readiness", value: command.readiness },
    { label: "Political", value: command.political },
    { label: "Specialty", value: command.spec },
    { label: "Branch focus", value: command.branchFocus },
    { label: "Effectiveness", value: `${eff}%`, cls: INTENT_TEXT[effIntent(eff)] },
    {
      label: "Force load",
      value: `${load} / ${command.cap}`,
      cls: over ? "text-warning" : undefined,
    },
  ];

  return (
    // A named region so the roster below can be told apart from the postings
    // surface, which lists some of the same generals and units for a different
    // reason.
    <section
      aria-label="Command structure and units"
      className="rounded-xl border border-card-border bg-card p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* The command is already named in the page heading above, so this says
            what the section IS rather than repeating the name. */}
        <h2 className="dossier-label min-w-0 flex-1 text-muted">Command structure and units</h2>
        {type && (
          <span className="shrink-0 rounded-full border border-[var(--gov)] px-2 py-0.5 text-[10px] font-semibold text-gov-soft">
            {type.short}
          </span>
        )}
      </div>
      {type && <p className="mt-1 text-[13px] font-semibold text-foreground">{type.label}</p>}
      <TypeBonuses type={command.type} className="mt-1" />
      {command.role && (
        <p className="mt-2 text-[12px] italic leading-relaxed text-muted">{command.role}</p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {overview.map((o) => (
          <div key={o.label}>
            <div className="dossier-label text-muted">{o.label}</div>
            <div className={`text-[13px] font-semibold ${o.cls ?? "text-foreground"}`}>
              {o.value}
            </div>
          </div>
        ))}
      </div>
      {/* What the posture the defence seat chose means for this command. The CG
          cannot change it, but they should not have to ask what it costs them. */}
      <PostureEffects posture={command.posture} className="mt-2" />

      {over && (
        <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-2.5">
          <div className="dossier-label mb-1 text-warning">⚠ Over-capacity penalties</div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-warning">
            {overCapacityPenalties(command, unitsById).map((p) => (
              <span key={p}>{p}</span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4">
        <div className="dossier-label mb-1.5 text-muted">Assigned regions · {regions.length}</div>
        {regions.length === 0 ? (
          <div className="rounded-md border border-dashed border-card-border px-2.5 py-2 text-center text-[11px] text-muted">
            Global scope · no map regions
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {regions.map((region) => {
              return (
                <div
                  key={region.id}
                  className="flex items-center gap-2 rounded-md border border-card-border bg-card-elevated px-2.5 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                    {region.name}
                  </span>
                  <span className="dossier-label hidden shrink-0 text-muted sm:inline">
                    {region.macro}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-4">
        <div className="dossier-label mb-1.5 text-muted">
          Assigned units · {assignedUnits.length}
        </div>
        {assignedUnits.length === 0 ? (
          <p className="text-[11px] text-muted">
            No units assigned to this command yet. The Secretary of Defense assigns units to a
            command.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {assignedUnits.map((unit) => {
              return (
                <div
                  key={String(unit._id)}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-card-border bg-card-elevated px-2.5 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                    {unit.name}
                  </span>
                  {/* Who leads the unit is what decides where it fights: a unit is
                      wherever its general is posted, so this is the CG's own lever
                      seen from the other end. */}
                  <span className="dossier-label shrink-0 text-muted">
                    {generalName(unit.assignedGeneralId)}
                  </span>
                  <span className="dossier-label shrink-0 text-muted">load {unitLoad(unit)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
