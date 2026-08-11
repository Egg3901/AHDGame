"use client";

import { US_STATES } from "@/lib/constants";

interface OfficialsFiltersProps {
  selectedState: string;
  onStateChange: (state: string) => void;
  selectedOfficeType: string;
  onOfficeTypeChange: (type: string) => void;
  showOnlyVacant: boolean;
  onShowOnlyVacantChange: (show: boolean) => void;
  loading: boolean;
  onSearch: () => void;
  onAddHouseRep: () => void;
}

export function OfficialsFilters({
  selectedState,
  onStateChange,
  selectedOfficeType,
  onOfficeTypeChange,
  showOnlyVacant,
  onShowOnlyVacantChange,
  loading,
  onSearch,
  onAddHouseRep,
}: OfficialsFiltersProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <select
        value={selectedState}
        onChange={(e) => onStateChange(e.target.value)}
        className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
      >
        <option value="">All States</option>
        {US_STATES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <select
        value={selectedOfficeType}
        onChange={(e) => onOfficeTypeChange(e.target.value)}
        className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
      >
        <option value="">All Office Types</option>
        <option value="senate">Senate</option>
        <option value="house">House</option>
        <option value="president">President</option>
        <option value="vicePresident">Vice President</option>
      </select>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={showOnlyVacant}
          onChange={(e) => onShowOnlyVacantChange(e.target.checked)}
          className="rounded border-card-border"
        />
        Vacant only
      </label>

      <button
        onClick={onSearch}
        disabled={loading}
        className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        Search
      </button>

      <button
        onClick={onAddHouseRep}
        className="rounded-lg border border-card-border px-3 py-1.5 text-sm font-medium hover:bg-background"
      >
        + Add House Rep
      </button>
    </div>
  );
}
