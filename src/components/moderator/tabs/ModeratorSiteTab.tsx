"use client";

import { RegistrationControlsPanel } from "@/components/admin/players/RegistrationControlsPanel";
import { TurnPausePanel } from "@/components/moderator/TurnPausePanel";

export function ModeratorSiteTab() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
        <h2 className="text-base font-semibold">Site controls</h2>
        <p className="mt-1 text-sm text-muted">
          High-blast-radius operational toggles. All actions here are recorded in the admin log.
        </p>
      </div>

      <TurnPausePanel />
      <RegistrationControlsPanel />
    </div>
  );
}
