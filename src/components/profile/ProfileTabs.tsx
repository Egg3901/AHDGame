"use client";

import { useState, type ReactNode } from "react";
import { GeneralProfileClient } from "@/app/world/conflicts/generals/GeneralProfileClient";
import type { CharacterSubject } from "@/app/world/conflicts/generals/useCharacterGeneral";
import type { ProfileGeneral } from "@/lib/military/generalsTree";
import type { GeneralPosting } from "@/lib/military/generalPosting";

/**
 * Political / Military tab shell for character profile pages. The Political tab
 * renders the existing profile content (passed as children). The Military tab —
 * gated behind the Conflicts subsystem (`conflictsEnabled`) — renders the
 * per-character General Profile (a self-contained Cold-War-themed dark panel).
 * When Conflicts is disabled, the tabs are omitted entirely and the profile is
 * unchanged.
 */
export function ProfileTabs({
  conflictsEnabled,
  subject,
  adopted,
  general,
  editable,
  curEra,
  posting,
  isCommandingGeneral = false,
  children,
}: {
  conflictsEnabled: boolean;
  subject: CharacterSubject;
  adopted: Record<string, number>;
  general: ProfileGeneral | null;
  editable: boolean;
  curEra: number;
  /** The subject's live order of battle and conflict posting. */
  posting?: GeneralPosting;
  /** True when the subject leads a command — gates the CG-page link on the Military tab. */
  isCommandingGeneral?: boolean;
  children: ReactNode;
}) {
  const [tab, setTab] = useState<"political" | "military">("political");

  if (!conflictsEnabled) return <>{children}</>;

  const tabs: { id: "political" | "military"; label: string }[] = [
    { id: "political", label: "Political" },
    { id: "military", label: "Military" },
  ];

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Profile sections"
        className="inline-flex rounded-lg border border-card-border bg-card p-0.5"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
              tab === t.id ? "bg-primary/10 text-primary" : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "political" ? (
        <div className="space-y-8">{children}</div>
      ) : (
        <GeneralProfileClient
          subject={subject}
          adopted={adopted}
          general={general}
          editable={editable}
          curEra={curEra}
          posting={posting}
          isCommandingGeneral={isCommandingGeneral}
        />
      )}
    </div>
  );
}
