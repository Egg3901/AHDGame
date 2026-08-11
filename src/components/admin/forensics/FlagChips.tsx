"use client";

// Anomaly flag chips. Visually distinct (warning-toned) from the neutral
// category/outcome badges so a flagged row jumps out in the stream. Chips are
// clickable to filter the stream down to that flag.

interface FlagChipsProps {
  flags?: string[];
  /** Currently active flag filter (highlighted). */
  activeFlag?: string;
  /** Click a chip to filter by it (toggles). */
  onSelect?: (flag: string) => void;
  size?: "sm" | "xs";
}

/** Prettify a raw flag token, e.g. "circular_wire" -> "circular wire". */
function labelFor(flag: string): string {
  return flag.replace(/_/g, " ");
}

export function FlagChips({ flags, activeFlag, onSelect, size = "xs" }: FlagChipsProps) {
  if (!flags || flags.length === 0) return null;
  const pad = size === "sm" ? "px-2 py-0.5 text-xs" : "px-1.5 py-0.5 text-[10px]";

  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((flag) => {
        const active = activeFlag === flag;
        const base = `inline-flex items-center gap-1 rounded-full font-medium ${pad} transition-colors motion-reduce:transition-none`;
        const tone = active
          ? "bg-red-500/25 text-red-300 ring-1 ring-red-500/40"
          : "border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20";
        const content = (
          <>
            <span aria-hidden className="text-red-400">
              ⚑
            </span>
            {labelFor(flag)}
          </>
        );
        if (!onSelect) {
          return (
            <span key={flag} className={`${base} ${tone}`}>
              {content}
            </span>
          );
        }
        return (
          <button
            key={flag}
            type="button"
            title={active ? "Clear this flag filter" : `Filter to "${labelFor(flag)}"`}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(flag);
            }}
            className={`${base} ${tone}`}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
