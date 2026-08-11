"use client";

import type { ManpowerView, MilitaryUnitView } from "../../useCabinetOffice";
import { ManpowerPanel } from "./ManpowerPanel";
import { POSTURES } from "@/lib/constants/military";
import { RESERVE_THEATER_ID } from "@/lib/military/theaters";
import { Badge } from "../dossier";

/** A unit's location label. Conflicts are dynamic now, so a non-reserve location is
 *  the conflict id itself (its display name is threaded in by the conflict board). */
function theaterLabel(id: string): string {
  return id === RESERVE_THEATER_ID ? "Homeland" : id;
}

export function MilitaryOperationsTab({
  units,
  manpower,
  countryCode,
  positionId,
  canWrite,
}: {
  units: MilitaryUnitView[];
  manpower?: ManpowerView;
  countryCode?: string;
  positionId?: string;
  canWrite?: boolean;
}) {
  const forward = units.filter((u) => u.posture === "forward" || u.posture === "alert");

  return (
    <div className="space-y-4">
      {manpower && countryCode && positionId && (
        <ManpowerPanel
          manpower={manpower}
          countryCode={countryCode}
          positionId={positionId}
          canWrite={!!canWrite}
        />
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {POSTURES.map((p) => {
          const n = units.filter((u) => u.posture === p.id).length;
          return (
            <div key={p.id} className="rounded-xl border border-card-border bg-card p-3.5">
              <div className="dossier-label text-muted">{p.label}</div>
              <div className="tabular mt-1 text-2xl font-bold text-foreground">{n}</div>
              <div className="text-[11px] text-muted">units</div>
            </div>
          );
        })}
      </div>

      {forward.length > 0 && (
        <div className="gov-panel rounded-xl p-4">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning/60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-warning" />
            </span>
            <span className="text-[13px] font-semibold text-gov-soft">
              {forward.length} unit{forward.length === 1 ? "" : "s"} forward-deployed or on high
              alert
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {forward.map((u) => (
              <Badge key={u._id} tone="warning" className="!text-[10px]">
                {u.name.split(" ").slice(0, 2).join(" ")} · {theaterLabel(u.theaterId)}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <p className="text-[12px] text-muted">
        Theater deployment is directed from the Conflicts &rsaquo; Combat Command board. This tab
        reflects force posture and readiness; the roster manages recruitment, modernization, and
        upkeep.
      </p>
    </div>
  );
}
