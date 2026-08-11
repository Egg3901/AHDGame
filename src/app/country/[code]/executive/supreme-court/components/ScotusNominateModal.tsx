"use client";

import { Modal } from "@/components/ui";

export interface VacantSeatOption {
  seatNumber: number;
  hasPendingNomination: boolean;
}

export interface NominateCharacterOption {
  _id: string;
  name: string;
  party: string;
  homeState: string;
}

export interface NominatePartyOption {
  id: string;
  name: string;
}

export type NomineeMode = "character" | "npp";

/**
 * President-side SCOTUS nomination modal (#3605). Mirrors
 * `CabinetNominateModal` (src/app/whitehouse/cabinet/components) — same modal
 * shell, same "position → nominee" shape — extended with the seat-vacancy
 * scoping SCOTUS needs (9 numbered seats, not named positions) and the NPP
 * "legal scholar" path #3598 added on top of cabinet's player-only nomination.
 */
export function ScotusNominateModal({
  open,
  vacantSeats,
  characters,
  parties,
  selectedSeatNumber,
  mode,
  selectedCharId,
  selectedPartyId,
  message,
  submitting,
  onSeatChange,
  onModeChange,
  onCharChange,
  onPartyChange,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  vacantSeats: VacantSeatOption[];
  characters: NominateCharacterOption[];
  parties: NominatePartyOption[];
  selectedSeatNumber: number | null;
  mode: NomineeMode;
  selectedCharId: string;
  selectedPartyId: string;
  message: string;
  submitting: boolean;
  onSeatChange: (seatNumber: number) => void;
  onModeChange: (mode: NomineeMode) => void;
  onCharChange: (id: string) => void;
  onPartyChange: (id: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const canSubmit =
    selectedSeatNumber != null && (mode === "character" ? !!selectedCharId : !!selectedPartyId);

  return (
    <Modal open={open} title="Nominate a Justice" onClose={onCancel}>
      <p className="text-sm text-muted mb-4">
        Nominees require Senate confirmation. Nominate an existing player character, or request a
        generated NPP &quot;legal scholar&quot; of a party you choose.
      </p>

      <label htmlFor="scotus-seat" className="block text-sm font-medium mb-2">
        Seat
      </label>
      <select
        id="scotus-seat"
        value={selectedSeatNumber ?? ""}
        onChange={(e) => onSeatChange(Number(e.target.value))}
        className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm mb-4"
      >
        <option value="">Select vacant seat</option>
        {vacantSeats.map((s) => (
          <option key={s.seatNumber} value={s.seatNumber}>
            Seat #{s.seatNumber}
            {s.hasPendingNomination ? " (replace pending)" : ""}
          </option>
        ))}
        {vacantSeats.length === 0 && (
          <option value="" disabled>
            No vacant seats
          </option>
        )}
      </select>

      <fieldset className="mb-4">
        <legend className="block text-sm font-medium mb-2">Nominee</legend>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onModeChange("character")}
            aria-pressed={mode === "character"}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              mode === "character"
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-card-border bg-card text-muted hover:bg-card-elevated"
            }`}
          >
            Player Character
          </button>
          <button
            type="button"
            onClick={() => onModeChange("npp")}
            aria-pressed={mode === "npp"}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              mode === "npp"
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-card-border bg-card text-muted hover:bg-card-elevated"
            }`}
          >
            Generate NPP Legal Scholar
          </button>
        </div>
      </fieldset>

      {mode === "character" ? (
        <>
          <label htmlFor="scotus-nominee-char" className="block text-sm font-medium mb-2">
            Character
          </label>
          <select
            id="scotus-nominee-char"
            value={selectedCharId}
            onChange={(e) => onCharChange(e.target.value)}
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm mb-4"
          >
            <option value="">Select character</option>
            {characters.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name} ({c.party}) - {c.homeState}
              </option>
            ))}
          </select>
        </>
      ) : (
        <>
          <label htmlFor="scotus-nominee-party" className="block text-sm font-medium mb-2">
            Party affiliation
          </label>
          <select
            id="scotus-nominee-party"
            value={selectedPartyId}
            onChange={(e) => onPartyChange(e.target.value)}
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm mb-4"
          >
            <option value="">Select party</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted mb-4">
            The generated candidate&apos;s personal positions come from this party&apos;s platform
            plus normal random variance, the same NPP-generation machinery used elsewhere. Their
            ideology is computed from their own generated positions, not yours.
          </p>
        </>
      )}

      {message && (
        <p
          role="alert"
          className={`text-sm mb-4 ${message.startsWith("✓") ? "text-success" : "text-error"}`}
        >
          {message}
        </p>
      )}
      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          className="rounded-lg border border-card-border px-4 py-2 text-sm hover:bg-card-elevated"
        >
          Cancel
        </button>
        <button
          onClick={onSubmit}
          disabled={submitting || !canSubmit}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? "Nominating…" : "Nominate"}
        </button>
      </div>
    </Modal>
  );
}
