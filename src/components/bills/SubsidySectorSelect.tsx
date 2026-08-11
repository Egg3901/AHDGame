"use client";

import { CORPORATION_TYPES, CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";

/**
 * Shared sector dropdown for subsidy/end-subsidy bill provisions. Renders the
 * full <select> — placeholder option plus one option per sector — sourced from
 * the canonical {@link CORPORATION_TYPES} list with {@link CORPORATION_TYPE_LABELS}
 * display names. Every country's propose-bill modal imports this so a new sector
 * (or a new country reusing this component) stays correct automatically and can't
 * reintroduce a stale hardcoded list.
 */
export function SubsidySectorSelect({
  value,
  onChange,
  className,
  placeholderLabel = "— Select sector —",
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholderLabel?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">{placeholderLabel}</option>
      {CORPORATION_TYPES.map((s) => (
        <option key={s} value={s}>
          {CORPORATION_TYPE_LABELS[s]}
        </option>
      ))}
    </select>
  );
}
