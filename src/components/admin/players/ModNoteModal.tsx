"use client";

interface ModNoteModalProps {
  username: string;
  note: string;
  existingNote?: string | null;
  isModeratorContext: boolean;
  saving: boolean;
  onNoteChange: (note: string) => void;
  onClose: () => void;
  onSave: () => void;
}

export function ModNoteModal({
  username,
  note,
  existingNote,
  isModeratorContext,
  saving,
  onNoteChange,
  onClose,
  onSave,
}: ModNoteModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 w-full max-w-md rounded-xl border border-card-border bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Mod Note — {username}</h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded p-1 text-muted hover:text-foreground"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        {isModeratorContext && existingNote && (
          <div className="mb-3 rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-muted">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
              Latest Note
            </div>
            <div className="whitespace-pre-wrap">{existingNote}</div>
          </div>
        )}
        <textarea
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          maxLength={2000}
          rows={5}
          placeholder={
            isModeratorContext
              ? "Add a new moderator note for this user..."
              : "Add a mod note for this user..."
          }
          className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
        />
        <div className="mt-1 text-right text-xs text-muted">{note.length}/2000</div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-card-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving..." : isModeratorContext ? "Add Note" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
