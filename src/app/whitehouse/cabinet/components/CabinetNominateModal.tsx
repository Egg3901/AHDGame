"use client";

import { Modal } from "@/components/ui";

interface Position {
  id: string;
  name: string;
  member: { acting?: boolean } | null;
  nomination: unknown;
}

interface Character {
  _id: string;
  name: string;
  party: string;
  homeState: string;
}

export function CabinetNominateModal({
  open,
  positions,
  characters,
  selectedPositionId,
  selectedCharId,
  message,
  submitting,
  onPositionChange,
  onCharChange,
  onSubmit,
  onCancel,
  title = "Propose Cabinet Nomination",
  description = "Nominees require Senate confirmation. Only player characters can be nominated.",
  submitLabel = "Propose",
  nomineeLabel = "Nominee",
  pendingNominationLabel = " (replace pending)",
  actingHeldLabel = " (acting)",
  includeActingHeld = false,
}: {
  open: boolean;
  positions: Position[];
  characters: Character[];
  selectedPositionId: string;
  selectedCharId: string;
  message: string;
  submitting: boolean;
  onPositionChange: (id: string) => void;
  onCharChange: (id: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  /** Overridable so the acting-appointment flow can reuse this picker. */
  title?: string;
  description?: string;
  submitLabel?: string;
  nomineeLabel?: string;
  /**
   * Suffix on a seat that already has a nomination running. Nominating
   * replaces that nomination; an acting appointment does not, so the two flows
   * must not share the same wording.
   */
  pendingNominationLabel?: string;
  /**
   * Suffix on a seat held by an acting secretary. Confirmation replaces the
   * acting holder at once, so the nomination flow labels those seats instead
   * of hiding them.
   */
  actingHeldLabel?: string;
  /**
   * List seats held by an acting secretary alongside vacant ones. The
   * nomination flow sets this: nominating over an acting holder is legal and
   * confirmation evicts them. The acting-appointment flow must leave it off:
   * installing an acting secretary requires a vacant seat.
   */
  includeActingHeld?: boolean;
}) {
  // Vacant seats are always eligible. Acting-held seats are eligible only for
  // nomination: a confirmed holder can only be replaced by firing them first.
  const eligiblePositions = positions.filter(
    (p) => !p.member || (includeActingHeld && p.member.acting === true)
  );

  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <p className="text-sm text-muted mb-4">{description}</p>
      <label htmlFor="cabinet-position" className="block text-sm font-medium mb-2">
        Position
      </label>
      <select
        id="cabinet-position"
        value={selectedPositionId}
        onChange={(e) => onPositionChange(e.target.value)}
        className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm mb-4"
      >
        <option value="">Select position</option>
        {eligiblePositions.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.member?.acting === true ? actingHeldLabel : ""}
            {p.nomination ? pendingNominationLabel : ""}
          </option>
        ))}
        {eligiblePositions.length === 0 && (
          <option value="" disabled>
            All positions filled
          </option>
        )}
      </select>
      <label htmlFor="cabinet-nominee" className="block text-sm font-medium mb-2">
        {nomineeLabel}
      </label>
      <select
        id="cabinet-nominee"
        value={selectedCharId}
        onChange={(e) => onCharChange(e.target.value)}
        className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm mb-4"
      >
        <option value="">Select character</option>
        {characters.map((c) => (
          <option key={c._id} value={c._id}>
            {c.name} ({c.party}), {c.homeState}
          </option>
        ))}
      </select>
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
          disabled={submitting || !selectedPositionId || !selectedCharId}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </Modal>
  );
}
