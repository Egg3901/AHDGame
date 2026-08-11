"use client";

import { Input, Label, Button, Modal } from "@/components/ui";

interface CreateCoalitionModalProps {
  creating: boolean;
  formName: string;
  formAbbrev: string;
  formColor: string;
  userActions: number;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onFormNameChange: (v: string) => void;
  onFormAbbrevChange: (v: string) => void;
  onFormColorChange: (v: string) => void;
}

export function CreateCoalitionModal({
  creating,
  formName,
  formAbbrev,
  formColor,
  userActions,
  onClose,
  onSubmit,
  onFormNameChange,
  onFormAbbrevChange,
  onFormColorChange,
}: CreateCoalitionModalProps) {
  const canCreate = userActions >= 25;
  const canSubmit = canCreate && formName.trim().length >= 3 && formAbbrev.trim().length >= 2;

  return (
    <Modal open title="Create a Coalition" onClose={onClose}>
      <div className="mb-4 rounded-lg bg-warning/10 border border-warning/30 p-3 text-sm">
        <p className="font-medium text-warning mb-1">Requirements</p>
        <ul className="text-muted space-y-0.5">
          <li>• 25 Actions (You have: {userActions})</li>
          <li>• You must be a National Party Chair</li>
        </ul>
        {!canCreate && (
          <p className="mt-2 text-error font-medium">
            You don&apos;t have enough actions to create a coalition.
          </p>
        )}
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="coalition-name">Coalition Name</Label>
            <Input
              id="coalition-name"
              type="text"
              value={formName}
              onChange={(e) => onFormNameChange(e.target.value)}
              className="bg-background py-2 text-sm"
              placeholder="e.g., Grand Alliance"
              required
              minLength={3}
              maxLength={60}
            />
          </div>
          <div>
            <Label htmlFor="coalition-abbrev">Abbreviation</Label>
            <Input
              id="coalition-abbrev"
              type="text"
              value={formAbbrev}
              onChange={(e) => onFormAbbrevChange(e.target.value.toUpperCase())}
              className="bg-background py-2 text-sm uppercase"
              placeholder="e.g., GA"
              required
              minLength={2}
              maxLength={8}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="coalition-color">Coalition Color</Label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              id="coalition-color"
              value={formColor}
              onChange={(e) => onFormColorChange(e.target.value)}
              className="h-10 w-20 cursor-pointer rounded border border-card-border"
            />
            <Input
              type="text"
              value={formColor}
              onChange={(e) => onFormColorChange(e.target.value)}
              className="w-28 bg-background py-2 text-sm font-mono"
              pattern="^#[0-9A-Fa-f]{6}$"
            />
            <div
              className="h-10 w-10 rounded-lg border border-card-border"
              style={{ backgroundColor: formColor }}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-card-border px-4 py-2 text-sm hover:bg-card-elevated transition-colors"
          >
            Cancel
          </button>
          <Button
            type="submit"
            variant="primary"
            isLoading={creating}
            disabled={!canSubmit}
            className="px-6 py-2 text-sm"
          >
            Create Coalition (25 Actions)
          </Button>
        </div>
      </form>
    </Modal>
  );
}
