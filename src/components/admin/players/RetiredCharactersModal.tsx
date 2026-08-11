"use client";

import { getPartyTextColor, getPartyLabel } from "@/lib/utils/politics";
import { formatDate } from "@/lib/utils/formatters";
import type { RetiredCharacterEntry } from "./types";

interface RetiredCharactersModalProps {
  username: string;
  characters: RetiredCharacterEntry[];
  onClose: () => void;
}

export function RetiredCharactersModal({
  username,
  characters,
  onClose,
}: RetiredCharactersModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 w-full max-w-lg rounded-xl border border-card-border bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Retired Characters — {username}</h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded p-1 text-muted hover:text-foreground"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        {characters.length === 0 ? (
          <p className="text-sm text-muted">No retired characters found.</p>
        ) : (
          <div className="max-h-80 space-y-3 overflow-y-auto">
            {characters.map((rc) => (
              <div key={rc.id} className="rounded-lg border border-card-border bg-background p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{rc.name}</span>
                  <span className="rounded bg-muted/20 px-2 py-0.5 text-xs text-muted">
                    {rc.reason.replace("_", " ")}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span>
                    {rc.countryId} — {rc.homeState}
                  </span>
                  {rc.party && (
                    <span className={getPartyTextColor(rc.party)}>{getPartyLabel(rc.party)}</span>
                  )}
                  {rc.highestOffice && <span>Highest: {rc.highestOffice}</span>}
                  <span>Achievements: {rc.achievementCount}</span>
                  <span>Retired: {formatDate(rc.retiredAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
