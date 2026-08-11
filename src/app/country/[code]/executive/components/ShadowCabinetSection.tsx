"use client";

import { useState } from "react";
import Link from "next/link";
import { SectionLabel } from "@/components/ui";

interface ShadowCabinetPosition {
  id: string;
  name: string;
}

interface ShadowAppointeeView {
  characterId: string;
  characterName: string;
}

interface EligibleCharacterView {
  _id: string;
  name: string;
  partyName?: string;
}

interface ShadowCabinetSectionProps {
  countryCode: string;
  positions: ShadowCabinetPosition[];
  /** positionId -> current shadow appointee. */
  appointees: Record<string, ShadowAppointeeView>;
  oppositionLeaderName: string | null;
  oppositionPartyName: string | null;
  /** Only the resolved Leader of the Opposition sees appoint / clear controls. */
  viewerIsOppositionLeader: boolean;
  /** Candidate pool — supplied only when the viewer is the Opposition Leader. */
  eligibleCharacters: EligibleCharacterView[];
}

/**
 * Shadow Cabinet (player suggestion #52) — the Leader of the Opposition names
 * characters to shadow versions of the country's cabinet posts. Display and
 * roleplay only; no mechanical effect. Appoint / clear controls render only for
 * the resolved Opposition Leader; everyone else sees the read-only roster.
 */
export function ShadowCabinetSection({
  countryCode,
  positions,
  appointees,
  oppositionLeaderName,
  oppositionPartyName,
  viewerIsOppositionLeader,
  eligibleCharacters,
}: ShadowCabinetSectionProps) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [busyPositionId, setBusyPositionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filledCount = Object.keys(appointees).length;

  // Characters already holding a shadow post cannot be picked for another.
  const takenCharacterIds = new Set(Object.values(appointees).map((a) => a.characterId));

  async function submit(
    method: "POST" | "DELETE",
    positionId: string,
    body: Record<string, string>
  ) {
    setBusyPositionId(positionId);
    setError(null);
    try {
      const res = await fetch(`/api/country/${countryCode}/executive/shadow-cabinet`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setBusyPositionId(null);
        return;
      }
      window.location.reload();
    } catch {
      setError("Network error. Please try again.");
      setBusyPositionId(null);
    }
  }

  return (
    <section className="rounded-2xl border border-card-border bg-card p-6 shadow-card">
      <SectionLabel as="h3">Shadow Cabinet</SectionLabel>
      <p className="-mt-2 mb-4 text-body-sm text-muted">
        {oppositionLeaderName ? (
          <>
            Named by {oppositionLeaderName}
            {oppositionPartyName
              ? `, Leader of the Opposition (${oppositionPartyName})`
              : ", Leader of the Opposition"}
            .{" "}
          </>
        ) : null}
        {filledCount} of {positions.length} posts shadowed · a ceremonial roster with no mechanical
        effect.
      </p>

      {error && <p className="mb-3 text-body-sm text-error">{error}</p>}

      <ul className="space-y-2">
        {positions.map((position) => {
          const appointee = appointees[position.id];
          const isBusy = busyPositionId === position.id;
          const selectableCharacters = eligibleCharacters.filter(
            (c) => !takenCharacterIds.has(c._id)
          );

          return (
            <li
              key={position.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card-elevated px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-body-sm font-medium text-foreground">Shadow {position.name}</p>
                {appointee ? (
                  <Link
                    href={`/character/${appointee.characterId}`}
                    className="text-body-sm text-primary hover:underline"
                  >
                    {appointee.characterName}
                  </Link>
                ) : (
                  <p className="text-body-sm italic text-muted">Vacant</p>
                )}
              </div>

              {viewerIsOppositionLeader && (
                <div className="flex shrink-0 items-center gap-2">
                  {appointee ? (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => submit("DELETE", position.id, { positionId: position.id })}
                      className="rounded-lg border border-card-border px-3 py-1.5 text-body-sm text-muted transition-colors hover:text-foreground disabled:opacity-50"
                    >
                      {isBusy ? "Clearing…" : "Clear"}
                    </button>
                  ) : (
                    <>
                      <select
                        value={selected[position.id] ?? ""}
                        disabled={isBusy || selectableCharacters.length === 0}
                        onChange={(e) =>
                          setSelected((prev) => ({ ...prev, [position.id]: e.target.value }))
                        }
                        className="max-w-[14rem] rounded-lg border border-card-border bg-background px-3 py-1.5 text-body-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                      >
                        <option value="">
                          {selectableCharacters.length === 0
                            ? "No eligible members"
                            : "Select member…"}
                        </option>
                        {selectableCharacters.map((c) => (
                          <option key={c._id} value={c._id}>
                            {c.name}
                            {c.partyName ? ` — ${c.partyName}` : ""}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={isBusy || !selected[position.id]}
                        onClick={() =>
                          submit("POST", position.id, {
                            positionId: position.id,
                            characterId: selected[position.id]!,
                          })
                        }
                        className="rounded-lg bg-primary px-3 py-1.5 text-body-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                      >
                        {isBusy ? "Appointing…" : "Appoint"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
