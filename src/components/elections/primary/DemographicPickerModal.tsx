"use client";

import { useState } from "react";
import { getDemographicCategoriesForCountry } from "@/lib/demographics/countryDemographics";

export interface DemographicPick {
  categoryKey: string;
  bucket: string;
  label: string;
}

interface DemographicPickerModalProps {
  title: string;
  countryId: string | undefined;
  footnote: string;
  busy: boolean;
  onPick: (group: DemographicPick) => void;
  onClose: () => void;
}

/**
 * Choose a demographic group, from the same vocabulary the canvassing desk
 * offers.
 *
 * Shared deliberately: canvassing raises a group's turnout and suppression
 * lowers it, and two lists would eventually name the same group two ways. Built
 * to match `StatePickerModal` so the two steps of one action feel like one
 * action.
 */
export function DemographicPickerModal({
  title,
  countryId,
  footnote,
  busy,
  onPick,
  onClose,
}: DemographicPickerModalProps) {
  const [search, setSearch] = useState("");

  const rows = getDemographicCategoriesForCountry(countryId).flatMap((category) =>
    category.groups.map((group) => ({
      categoryKey: category.key,
      categoryLabel: category.label,
      bucket: group.id,
      label: group.name,
    }))
  );
  const filtered = search
    ? rows.filter(
        (r) =>
          r.label.toLowerCase().includes(search.toLowerCase()) ||
          r.categoryLabel.toLowerCase().includes(search.toLowerCase())
      )
    : rows;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="rounded-xl border border-card-border bg-card max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-card-border flex items-center justify-between">
          <h3 className="font-semibold">{title}</h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-muted hover:text-foreground p-1"
          >
            ✕
          </button>
        </div>
        <div className="px-4 py-2 border-b border-card-border">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search groups…"
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
          />
          <p className="text-[11px] text-muted mt-1">{footnote}</p>
        </div>
        <div className="overflow-y-auto flex-1 p-2">
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted">No group matches that search.</p>
          ) : (
            filtered.map((r) => (
              <button
                key={`${r.categoryKey}:${r.bucket}`}
                type="button"
                data-testid="demographic-group-option"
                disabled={busy}
                onClick={() =>
                  onPick({ categoryKey: r.categoryKey, bucket: r.bucket, label: r.label })
                }
                className="w-full text-left rounded-lg border border-card-border px-3 py-2 text-sm transition-colors hover:bg-background flex items-center justify-between gap-2 disabled:opacity-40"
              >
                <span className="font-medium">{r.label}</span>
                <span className="text-xs text-muted">{r.categoryLabel}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
