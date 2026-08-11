"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

interface SelectionBarProps {
  selectedCount: number;
  onMerge: () => void;
  onDelete: () => void;
  onCancel: () => void;
}

export function SelectionBar({ selectedCount, onMerge, onDelete, onCancel }: SelectionBarProps) {
  const [merging, setMerging] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-card-border bg-card px-5 py-3 shadow-xl">
      <span className="text-sm font-medium text-foreground">{selectedCount} selected</span>
      <div className="h-5 w-px bg-card-border" />
      {selectedCount >= 2 && (
        <Button
          variant="primary"
          isLoading={merging}
          onClick={async () => {
            setMerging(true);
            try {
              await onMerge();
            } finally {
              setMerging(false);
            }
          }}
          className="px-3 py-1.5 text-sm"
        >
          Merge
        </Button>
      )}
      <Button
        variant="secondary"
        isLoading={deleting}
        onClick={async () => {
          setDeleting(true);
          try {
            await onDelete();
          } finally {
            setDeleting(false);
          }
        }}
        className="px-3 py-1.5 text-sm"
      >
        Delete
      </Button>
      <div className="h-5 w-px bg-card-border" />
      <button
        type="button"
        onClick={onCancel}
        className="text-sm text-muted hover:text-foreground transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}
