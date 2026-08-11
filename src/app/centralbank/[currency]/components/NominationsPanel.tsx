"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, EmptyState } from "@/components/ui";
import { PlayerSelector } from "@/components/PlayerSelector";
import type { Nomination } from "./centralBankTypes";

export function NominationsPanel({
  nominations,
  nominationWindowOpen,
  isExecutive,
  chairTermExpiresAtTurn,
  currentTurn,
  bankApiBasePath,
  onChanged,
  executiveLabel,
}: {
  nominations: Nomination[];
  nominationWindowOpen: boolean;
  isExecutive: boolean;
  chairTermExpiresAtTurn: number | null;
  currentTurn: number;
  bankApiBasePath: string;
  onChanged: () => void;
  executiveLabel: string;
}) {
  const [showSelector, setShowSelector] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turnsUntilNominationWindow =
    chairTermExpiresAtTurn != null ? Math.max(0, chairTermExpiresAtTurn - 48 - currentTurn) : null;
  const turnsUntilNominationWindowLabel =
    turnsUntilNominationWindow === 1
      ? "1 turn"
      : turnsUntilNominationWindow != null
        ? `${turnsUntilNominationWindow} turns`
        : null;

  const handleNominate = async (characterId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${bankApiBasePath}/nominate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error((json as { error?: string }).error || "Failed to nominate");
      }
      setShowSelector(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
        Executive Nominations
      </h2>
      <p className="mb-3 text-xs text-muted italic">
        The {executiveLabel} may nominate up to three candidates during the final year of the
        chair&apos;s term. Each nomination costs one action point.
      </p>
      <p className="mb-4 text-xs text-muted">
        Candidates from this pool have a <span className="text-primary font-semibold">70%</span>{" "}
        chance of being selected.
      </p>

      {nominations.length > 0 ? (
        <div className="space-y-2">
          {nominations.map((nom) => (
            <div
              key={nom.characterId}
              className="flex items-center gap-3 rounded-lg border border-card-border/50 bg-card-muted p-3"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-card-border bg-card-elevated text-xs font-bold text-muted">
                {nom.characterName.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/character/${nom.characterId}`}
                  className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate block"
                >
                  {nom.characterName}
                </Link>
                <p className="text-xs text-muted">Nominated by {nom.nominatedByName}</p>
              </div>
            </div>
          ))}
        </div>
      ) : nominationWindowOpen ? (
        <EmptyState
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          }
          title="No nominations yet"
          description={`The ${executiveLabel} has not yet put forward any nominations.`}
        />
      ) : (
        <div className="rounded-lg border border-card-border/50 bg-card-muted p-3 text-center">
          <p className="text-xs text-muted italic">
            {turnsUntilNominationWindowLabel
              ? `Nominations open in ${turnsUntilNominationWindowLabel}, during the final year of the chair's term.`
              : "Nominations open when the chair position is vacant."}
          </p>
        </div>
      )}

      {isExecutive && nominationWindowOpen && nominations.length < 3 && (
        <div className="mt-3">
          {showSelector ? (
            <div className="space-y-2">
              <PlayerSelector
                placeholder="Search for a candidate..."
                onSelect={(char) => handleNominate(char.id)}
                excludeIds={nominations.map((n) => n.characterId)}
              />
              {loading && <p className="text-xs text-muted">Submitting nomination...</p>}
              {error && <p className="text-xs text-error">{error}</p>}
              <Button variant="ghost" onClick={() => setShowSelector(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="primary" onClick={() => setShowSelector(true)} disabled={loading}>
              Nominate Candidate
            </Button>
          )}
        </div>
      )}
      {isExecutive && nominationWindowOpen && nominations.length >= 3 && (
        <p className="mt-3 text-xs text-muted italic">Maximum nominations reached (3/3).</p>
      )}
    </div>
  );
}
