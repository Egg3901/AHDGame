"use client";

import { Modal } from "@/components/ui";

interface Position {
  id: string;
  name: string;
  member: unknown;
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
}) {
  const vacantPositions = positions.filter((p) => !p.member);

  return (
    <Modal open={open} title="Propose Cabinet Nomination" onClose={onCancel}>
      <p className="text-sm text-muted mb-4">
        Nominees require Senate confirmation. Only player characters can be nominated.
      </p>
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
        {vacantPositions.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.nomination ? " (replace pending)" : ""}
          </option>
        ))}
        {vacantPositions.length === 0 && (
          <option value="" disabled>
            All positions filled
          </option>
        )}
      </select>
      <label htmlFor="cabinet-nominee" className="block text-sm font-medium mb-2">
        Nominee
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
            {c.name} ({c.party}) — {c.homeState}
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
          Propose
        </button>
      </div>
    </Modal>
  );
}
