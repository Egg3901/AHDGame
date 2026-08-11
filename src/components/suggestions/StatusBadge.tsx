"use client";

import { useState, useRef, useEffect } from "react";
import {
  STATUS_COLORS,
  STATUS_OPTIONS,
  type SuggestionStatusKey,
} from "@/components/admin/suggestions/types";

interface StatusBadgeProps {
  status: string;
  /** If provided, clicking the badge opens a dropdown to change status */
  onChange?: (newStatus: string) => Promise<void>;
}

export function StatusBadge({ status, onChange }: StatusBadgeProps) {
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const colorClass = STATUS_COLORS[status] ?? "bg-muted/20 text-muted";
  const label = status.replace(/_/g, " ");

  if (!onChange) {
    return (
      <span className={`rounded px-2 py-0.5 text-xs capitalize whitespace-nowrap ${colorClass}`}>
        {label}
      </span>
    );
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`rounded px-2 py-0.5 text-xs capitalize whitespace-nowrap cursor-pointer transition-opacity hover:opacity-80 ${colorClass}`}
        title="Click to change status"
      >
        {label}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-card-border bg-card shadow-lg py-1">
          {STATUS_OPTIONS.map((opt) => {
            const isActive = opt.value === status;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={updating || isActive}
                onClick={async () => {
                  setUpdating(true);
                  try {
                    await onChange(opt.value as SuggestionStatusKey);
                  } finally {
                    setUpdating(false);
                    setOpen(false);
                  }
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-background/60 disabled:opacity-40 ${
                  isActive ? "font-medium" : ""
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full shrink-0 ${STATUS_COLORS[opt.value]?.split(" ")[0]?.replace("/20", "/40") ?? "bg-muted"}`}
                />
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
