"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import type { CountryId } from "@/lib/constants/countries";

export interface AdminSeatRow {
  id: string;
  name: string;
  isHeadOfGovernment?: boolean;
  memberName: string | null;
  /** ISO timestamp of an active appointment cooldown, when one exists. */
  cooldownUntil: string | null;
}

interface AdminCharacter {
  _id: string;
  name: string;
  party?: string;
  homeState?: string;
}

/**
 * Admin tab body shared by every cabinet page (US Senate-confirmation flow
 * and the parliamentary direct-appointment flow). Posts to
 * /api/admin/country/[code]/cabinet — appoint bypasses the normal flow,
 * remove carries no cooldown, resetCooldown clears the 24-turn appointment cooldown.
 */
export function CabinetAdminTab({
  countryId,
  seats,
  onChanged,
}: {
  countryId: CountryId;
  seats: AdminSeatRow[];
  /** Refetch callback so the Overview tab reflects admin changes. */
  onChanged: () => void | Promise<void>;
}) {
  const { showToast } = useToast();
  const [characters, setCharacters] = useState<AdminCharacter[]>([]);
  const [charactersError, setCharactersError] = useState(false);
  const [selectedPositionId, setSelectedPositionId] = useState("");
  const [selectedCharId, setSelectedCharId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const loadCharacters = useCallback(async () => {
    setCharactersError(false);
    try {
      const res = await fetch(`/api/admin/officials/appoint?countryId=${countryId}`);
      if (!res.ok) {
        setCharacters([]);
        setCharactersError(true);
        return;
      }
      const json = (await res.json()) as { characters?: AdminCharacter[] };
      setCharacters(json.characters ?? []);
    } catch {
      setCharacters([]);
      setCharactersError(true);
    }
  }, [countryId]);

  useEffect(() => {
    loadCharacters();
  }, [loadCharacters]);

  // The head-of-government seat is auto-assigned via the Appoint-Premier flow.
  const appointableSeats = seats.filter((seat) => !seat.isHeadOfGovernment);

  async function postAction(
    body: { action: string; positionId: string; characterId?: string },
    busyKey: string
  ) {
    setBusy(busyKey);
    try {
      const res = await fetch(`/api/admin/country/${countryId.toLowerCase()}/cabinet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        showToast(json.error ?? "Action failed", "error");
        return;
      }
      showToast(json.message ?? "Done", "success");
      await onChanged();
    } catch {
      showToast("Network error — please try again", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div data-testid="cabinet-admin-tab" className="space-y-6">
      <section className="rounded-xl border border-card-border bg-card p-4 shadow-card">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">
          Direct Appointment (Admin)
        </h2>
        <p className="mt-1 text-sm text-muted">
          Seats the character immediately, bypassing the normal appointment flow. Replaces the
          current holder if the seat is filled.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            value={selectedPositionId}
            onChange={(e) => setSelectedPositionId(e.target.value)}
            className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground"
            aria-label="Position"
          >
            <option value="">Select position…</option>
            {appointableSeats.map((seat) => (
              <option key={seat.id} value={seat.id}>
                {seat.name}
                {seat.memberName ? ` — ${seat.memberName}` : ""}
              </option>
            ))}
          </select>
          <select
            value={selectedCharId}
            onChange={(e) => setSelectedCharId(e.target.value)}
            className="min-w-0 rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground"
            aria-label="Character"
          >
            <option value="">Select character…</option>
            {characters.map((character) => (
              <option key={character._id} value={character._id}>
                {character.name}
                {character.homeState ? ` (${character.homeState})` : ""}
              </option>
            ))}
          </select>
          <Button
            variant="primary"
            disabled={!selectedPositionId || !selectedCharId || busy !== null}
            onClick={() =>
              postAction(
                {
                  action: "appoint",
                  positionId: selectedPositionId,
                  characterId: selectedCharId,
                },
                "appoint"
              )
            }
          >
            {busy === "appoint" ? "Appointing…" : "Appoint"}
          </Button>
        </div>
        {charactersError && (
          <div className="mt-3 flex items-center gap-3 rounded-lg border border-error/30 bg-error/5 px-3 py-2">
            <p className="text-sm text-error">Failed to load the character list.</p>
            <Button variant="secondary" onClick={loadCharacters}>
              Retry
            </Button>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-card-border bg-card p-4 shadow-card">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">
          Seats (Admin)
        </h2>
        <p className="mt-1 text-sm text-muted">
          Admin removal carries no cooldown. Reset Cooldown clears the 24-turn appointment cooldown
          on a seat so it can be filled again immediately.
        </p>
        <ul className="mt-3 divide-y divide-card-border">
          {appointableSeats.map((seat) => {
            const onCooldown = !!seat.cooldownUntil && new Date(seat.cooldownUntil) > new Date();
            return (
              <li
                key={seat.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{seat.name}</p>
                  <p className="text-xs text-muted">
                    {seat.memberName ?? (onCooldown ? "Vacant · on cooldown" : "Vacant")}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {seat.memberName && (
                    <Button
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() => {
                        if (!confirm(`Remove ${seat.memberName} from ${seat.name}?`)) return;
                        postAction({ action: "remove", positionId: seat.id }, `remove:${seat.id}`);
                      }}
                      className="border-error/30 text-error hover:bg-error/10 hover:text-error"
                    >
                      {busy === `remove:${seat.id}` ? "…" : "Remove"}
                    </Button>
                  )}
                  {onCooldown && (
                    <Button
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() =>
                        postAction(
                          { action: "resetCooldown", positionId: seat.id },
                          `cooldown:${seat.id}`
                        )
                      }
                    >
                      {busy === `cooldown:${seat.id}` ? "…" : "Reset Cooldown"}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
