"use client";

import { COMMAND_TYPES } from "@/lib/military/config";
import { forceLoad, overBy, effectiveness, effIntent } from "@/lib/military/calc";
import type { MilitaryCommand, CommanderRef } from "@/lib/military/types";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { Badge, Meter } from "../../dossier";

const EFF_TONE = { success: "up", warn: "warning", error: "down" } as const;
const EFF_METER = {
  success: "var(--success)",
  warn: "var(--warning)",
  error: "var(--error)",
} as const;

/** Cabinet-styled command roster — one selectable card per theater command. */
export function CommandRoster({
  commands,
  selectedId,
  unitsById,
  commandersById,
  onSelect,
}: {
  commands: MilitaryCommand[];
  selectedId: string | null;
  unitsById: Record<string, MilitaryUnit>;
  commandersById: Record<string, CommanderRef>;
  onSelect: (id: string) => void;
}) {
  if (commands.length === 0) {
    return (
      <p className="text-[12px] text-muted">
        No commands established yet. Create one to build the national command structure.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {commands.map((c) => {
        const load = forceLoad(c, unitsById);
        const over = overBy(c, unitsById) > 0;
        const noCommander = c.commanderIds.length === 0;
        const eff = effIntent(effectiveness(c, unitsById));
        // The real lead. Falls back to the first commander so commands stored
        // before commandingGeneralId existed still name someone.
        const leadId = c.commandingGeneralId ?? c.commanderIds[0] ?? null;
        const primary = leadId ? (commandersById[leadId]?.name ?? "—") : "No commander";
        const selected = c.id === selectedId;

        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            aria-pressed={selected}
            className={`w-full rounded-lg border p-3 text-left transition-colors ${
              selected
                ? "border-[var(--gov)] bg-card-elevated"
                : "border-card-border bg-card hover:border-[color-mix(in_srgb,var(--gov)_45%,transparent)]"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                {c.name}
              </span>
              {(over || noCommander) && (
                <Badge tone="warning">{noCommander ? "No commander" : "Over capacity"}</Badge>
              )}
              <Badge tone={selected ? "gov" : "muted"}>{COMMAND_TYPES[c.type].short}</Badge>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted">
              <span className="truncate">{primary}</span>
              <span className="tabular shrink-0">
                {load}/{c.cap} load
              </span>
            </div>
            <div className="mt-2">
              <Meter
                value={c.cap > 0 ? (load / c.cap) * 100 : 0}
                color={EFF_METER[eff]}
                height={6}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}

export { EFF_TONE };
