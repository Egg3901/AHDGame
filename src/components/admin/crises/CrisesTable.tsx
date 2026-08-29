"use client";

import type { Crisis } from "@/lib/db/types/crisis";
import { rawTurnToLarpDate } from "@/lib/utils/formatters";
import type { CalendarClock } from "@/lib/utils/gameDate";

interface CrisesTableProps {
  crises: Crisis[];
  loading: boolean;
  startingYear: number | undefined;
  /**
   * Founding-phase clock; crisis turns are stored RAW (#1208). REQUIRED on
   * purpose: an optional one let a call site be missed silently.
   */
  clock: CalendarClock;
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
}

export function CrisesTable({
  crises,
  loading,
  startingYear,
  clock,
  onResolve,
  onDelete,
}: CrisesTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-muted border-b border-border">
            <th className="py-2 pr-4">Name</th>
            <th className="py-2 pr-4">Scope</th>
            <th className="py-2 pr-4">Start</th>
            <th className="py-2 pr-4">Duration</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {crises.map((c) => (
            <tr key={c._id.toString()} className="border-b border-border/50">
              <td className="py-2 pr-4 font-medium">{c.name}</td>
              <td className="py-2 pr-4">
                {c.scope === "country" ? "National" : c.scope === "region" ? "Regional" : "Global"}
              </td>
              <td className="py-2 pr-4">{rawTurnToLarpDate(c.startTurn, startingYear, clock)}</td>
              <td className="py-2 pr-4">{c.durationTurns ?? "Indefinite"}</td>
              <td className="py-2 pr-4">
                <span className={c.status === "active" ? "text-green-400" : "text-muted"}>
                  {c.status}
                </span>
              </td>
              <td className="py-2 space-x-3">
                {c.status === "active" && (
                  <button
                    className="text-amber-400 hover:underline"
                    onClick={() => onResolve(c._id.toString())}
                  >
                    Resolve
                  </button>
                )}
                <button
                  className="text-red-400 hover:underline"
                  onClick={() => onDelete(c._id.toString())}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {!loading && crises.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-muted text-center">
                No crises found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
