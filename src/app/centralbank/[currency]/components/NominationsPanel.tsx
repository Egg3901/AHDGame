"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { PlayerSelector } from "@/components/PlayerSelector";
import type { Nomination } from "./centralBankTypes";
import { CentralBankSection } from "./CentralBankSection";

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
    <CentralBankSection title="Executive nominations" level="aside">
      <p className="text-body-sm text-muted">
        The {executiveLabel} may nominate up to three candidates during the final year of the
        chair&apos;s term. Each nomination costs one action point. Candidates from this pool have a{" "}
        <span className="font-semibold text-foreground">70%</span> chance of being selected.
      </p>

      {nominations.length > 0 ? (
        <ul className="mt-3 divide-y divide-card-border/60">
          {nominations.map((nom) => (
            <li key={nom.characterId} className="py-2">
              <Link
                href={`/character/${nom.characterId}`}
                className="block truncate text-body font-medium text-foreground underline-offset-4 hover:underline"
              >
                {nom.characterName}
              </Link>
              <p className="text-body-sm text-muted">Nominated by {nom.nominatedByName}</p>
            </li>
          ))}
        </ul>
      ) : nominationWindowOpen ? (
        <p className="mt-3 text-body-sm text-muted">
          <span className="font-medium text-foreground">No nominations yet.</span> The{" "}
          {executiveLabel} has not yet put forward any nominations.
        </p>
      ) : (
        <p className="mt-3 text-body-sm text-muted">
          {turnsUntilNominationWindowLabel
            ? `Nominations open in ${turnsUntilNominationWindowLabel}, during the final year of the chair's term.`
            : "Nominations open when the chair position is vacant."}
        </p>
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
              {loading && <p className="text-body-sm text-muted">Submitting nomination...</p>}
              {error && <p className="text-body-sm text-error">{error}</p>}
              <Button variant="ghost" onClick={() => setShowSelector(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="primary" onClick={() => setShowSelector(true)} disabled={loading}>
              Nominate candidate
            </Button>
          )}
        </div>
      )}
      {isExecutive && nominationWindowOpen && nominations.length >= 3 && (
        <p className="mt-3 text-body-sm text-muted">Maximum nominations reached (3/3).</p>
      )}
    </CentralBankSection>
  );
}
