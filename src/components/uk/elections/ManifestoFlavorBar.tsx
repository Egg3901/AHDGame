/**
 * Light manifesto / conference slogan picker during Commons campaign window.
 * Cosmetic-first with a tiny temporary lean note (display only in v1).
 */
"use client";

import { useState } from "react";

const SLOGANS = [
  { id: "nhs", label: "NHS first", hint: "+soft healthcare lean with public-service voters" },
  { id: "growth", label: "Growth & grit", hint: "+soft business lean in suburban seats" },
  { id: "borders", label: "Secure borders", hint: "+soft immigration lean in Leave-heavy regions" },
  { id: "green", label: "Green prosperity", hint: "+soft climate lean with graduates" },
  { id: "union", label: "Defend the Union", hint: "+soft unionist lean in SCO/WAL/NIR contests" },
] as const;

export function ManifestoFlavorBar({
  electionId,
  regionId,
}: {
  electionId: string;
  regionId: string;
}) {
  const storageKey = `uk-manifesto:${electionId}`;
  const [picked, setPicked] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return window.sessionStorage.getItem(storageKey);
    } catch {
      return null;
    }
  });

  return (
    <div className="rounded-lg border border-card-border bg-card/80 px-3 py-2 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          Manifesto line · {regionId}
        </h4>
        <span className="text-[10px] text-muted">campaign window flavor</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SLOGANS.map((s) => {
          const active = picked === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setPicked(s.id);
                try {
                  window.sessionStorage.setItem(storageKey, s.id);
                } catch {
                  /* ignore */
                }
              }}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-card-border text-muted hover:text-foreground"
              }`}
              title={s.hint}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      {picked ? (
        <p className="text-[10px] text-muted">
          {SLOGANS.find((s) => s.id === picked)?.hint ?? "Manifesto line set for this race."}
        </p>
      ) : (
        <p className="text-[10px] text-muted">
          Pick a slogan for this Commons campaign — tiny demographic nudge, mostly theater.
        </p>
      )}
    </div>
  );
}
