"use client";

import { Modal } from "@/components/ui";
import { formatPartyState } from "./CongressShared";

type ChamberMember = {
  id: string;
  name: string;
  state: string;
  party: string;
  partyName?: string;
};

export function AssignLeaderModal({
  assigningRole,
  roleLabel,
  chamberMembers,
  assignCharacterId,
  assignLoading,
  onCharacterChange,
  onCancel,
  onSubmit,
}: {
  assigningRole: string | null;
  roleLabel: string;
  chamberMembers: ChamberMember[];
  assignCharacterId: string;
  assignLoading: boolean;
  onCharacterChange: (id: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <Modal
      open={Boolean(assigningRole)}
      title="Assign leader"
      onClose={onCancel}
      maxWidthClass="max-w-sm"
    >
      <div className="space-y-4">
        <p className="text-xs text-muted">{roleLabel}</p>
        <select
          value={assignCharacterId}
          onChange={(e) => onCharacterChange(e.target.value)}
          className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
        >
          <option value="">— Select member —</option>
          {chamberMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} {formatPartyState(m.party, m.state, m.partyName)}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-card-border py-2 text-sm text-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={assignLoading || !assignCharacterId}
            className="flex-1 rounded-lg bg-primary py-2 text-sm text-white disabled:opacity-50"
          >
            {assignLoading ? "Saving…" : "Assign"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
