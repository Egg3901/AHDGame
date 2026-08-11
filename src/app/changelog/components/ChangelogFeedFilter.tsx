"use client";

interface ChangelogFeedFilterProps {
  search: string;
  onSearchChange: (value: string) => void;
  tags: string[];
  eras: string[];
  tagFilter: string;
  onTagFilterChange: (value: string) => void;
  eraFilter: string;
  onEraFilterChange: (value: string) => void;
  badgeFilter: string;
  onBadgeFilterChange: (value: string) => void;
  showAreaFilter?: boolean;
  areaFilter?: string;
  onAreaFilterChange?: (value: string) => void;
  resultCount?: number;
}

const BADGE_OPTIONS = [
  { value: "all", label: "All releases" },
  { value: "major", label: "Major" },
  { value: "patch", label: "Patch" },
  { value: "hotfix", label: "Hotfix" },
];

const AREA_OPTIONS = [
  { value: "all", label: "All areas" },
  { value: "backend", label: "Backend" },
  { value: "frontend", label: "Frontend" },
  { value: "fullstack", label: "Full-stack" },
];

function FilterPills({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  if (options.length <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="shrink-0 text-xs text-muted">{label}</span>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            value === opt.value
              ? "border-primary/40 bg-primary/15 text-primary"
              : "border-card-border bg-background text-muted hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function ChangelogFeedFilter({
  search,
  onSearchChange,
  tags,
  eras,
  tagFilter,
  onTagFilterChange,
  eraFilter,
  onEraFilterChange,
  badgeFilter,
  onBadgeFilterChange,
  showAreaFilter = false,
  areaFilter = "all",
  onAreaFilterChange,
  resultCount,
}: ChangelogFeedFilterProps) {
  const tagOptions = [
    { value: "all", label: "All tags" },
    ...tags.map((t) => ({ value: t, label: t })),
  ];
  const eraOptions = [
    { value: "all", label: "All eras" },
    ...eras.map((e) => ({ value: e, label: e })),
  ];

  const hasActiveFilter =
    search.trim() ||
    tagFilter !== "all" ||
    eraFilter !== "all" ||
    badgeFilter !== "all" ||
    (showAreaFilter && areaFilter !== "all");

  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search releases..."
          className="w-full rounded-lg border border-card-border bg-background px-4 py-2 pl-9 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
        />
        <svg
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-foreground"
          >
            ✕
          </button>
        )}
      </div>

      <FilterPills
        label="Type:"
        value={badgeFilter}
        options={BADGE_OPTIONS}
        onChange={onBadgeFilterChange}
      />
      {eras.length > 0 && (
        <FilterPills
          label="Era:"
          value={eraFilter}
          options={eraOptions}
          onChange={onEraFilterChange}
        />
      )}
      {tags.length > 0 && (
        <FilterPills
          label="Tag:"
          value={tagFilter}
          options={tagOptions}
          onChange={onTagFilterChange}
        />
      )}
      {showAreaFilter && onAreaFilterChange && (
        <FilterPills
          label="Area:"
          value={areaFilter}
          options={AREA_OPTIONS}
          onChange={onAreaFilterChange}
        />
      )}

      {hasActiveFilter && resultCount !== undefined && (
        <p className="text-xs text-muted">
          {resultCount} release{resultCount !== 1 ? "s" : ""} match
        </p>
      )}
    </div>
  );
}
