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

export type CabinetNomineeMode = "character" | "npp";

export function CabinetNominateModal({
  open,
  positions,
  characters,
  npps = [],
  mode = "character",
  onModeChange,
  selectedPositionId,
  selectedCharId,
  selectedNppId = "",
  onNppChange,
  message,
  submitting,
  onPositionChange,
  onCharChange,
  onSubmit,
  onCancel,
  title = "Propose Cabinet Nomination",
  description = "Nominees require Senate confirmation. Nominate a player character or an NPP.",
  submitLabel = "Propose",
  nomineeLabel = "Nominee",
  pendingNominationLabel = " (replace pending)",
  actingHeldLabel = " (acting)",
  includeActingHeld = false,
}: {
  open: boolean;
  positions: Position[];
  characters: Character[];
  /** Existing NPPs eligible for nomination. Empty hides the NPP toggle (e.g. acting flow). */
  npps?: Character[];
  mode?: CabinetNomineeMode;
  onModeChange?: (mode: CabinetNomineeMode) => void;
  selectedPositionId: string;
  selectedCharId: string;
  selectedNppId?: string;
  onNppChange?: (id: string) => void;
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
      {npps.length > 0 && onModeChange && (
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
              NPP
            </button>
          </div>
        </fieldset>
      )}
      {mode === "npp" && npps.length > 0 ? (
        <>
          <label htmlFor="cabinet-nominee-npp" className="block text-sm font-medium mb-2">
            {nomineeLabel} (NPP)
          </label>
          <select
            id="cabinet-nominee-npp"
            value={selectedNppId}
            onChange={(e) => onNppChange?.(e.target.value)}
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm mb-4"
          >
            <option value="">Select NPP</option>
            {npps.map((n) => (
              <option key={n._id} value={n._id}>
                {n.name} ({n.party}), {n.homeState}
              </option>
            ))}
          </select>
        </>
      ) : (
        <>
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
          disabled={
            submitting ||
            !selectedPositionId ||
            (mode === "npp" && npps.length > 0 ? !selectedNppId : !selectedCharId)
          }
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </Modal>
  );
}
