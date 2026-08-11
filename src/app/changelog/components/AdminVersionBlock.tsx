"use client";

import {
  SECTION_COLORS,
  DEFAULT_SECTION,
  TAG_STYLES,
  type AdminBlock,
  type AdminSection,
  type ClassifiedItem,
} from "../changelogTypes";
import { classifyItem, formatDate, renderMarkdownText } from "../changelogUtils";

interface AdminVersionBlockProps {
  block: AdminBlock & { sections: (AdminSection & { items: ClassifiedItem[] })[] };
  blockIdx: number;
  isCollapsed: boolean;
  isLatest: boolean;
  onToggleCollapse: (version: string) => void;
}

export function AdminVersionBlock({
  block,
  blockIdx: _blockIdx,
  isCollapsed,
  isLatest,
  onToggleCollapse,
}: AdminVersionBlockProps) {
  const totalItems = block.sections.reduce((sum, s) => sum + s.items.length, 0);

  return (
    <div className="overflow-hidden rounded-xl border border-card-border bg-card">
      {/* Version header — click to collapse/expand */}
      <button
        type="button"
        onClick={() => onToggleCollapse(block.version)}
        className={`w-full border-b px-4 py-4 text-left transition-colors ${
          isLatest
            ? "border-primary/20 bg-primary/5 hover:bg-primary/8"
            : isCollapsed
              ? "border-transparent bg-background/40 hover:bg-background/80"
              : "border-card-border bg-background/80 backdrop-blur-sm hover:bg-background"
        }`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`rounded px-2.5 py-1 font-mono text-base font-bold ${
              isLatest ? "bg-primary/20 text-primary" : "bg-zinc-500/15 text-foreground"
            }`}
          >
            {block.version === "Unreleased" ? "Unreleased" : `v${block.version}`}
          </span>
          {block.date && <span className="text-sm text-muted">{formatDate(block.date)}</span>}
          <span className="text-xs text-muted">
            {totalItems} change{totalItems !== 1 ? "s" : ""}
          </span>
          {isLatest && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
              Latest
            </span>
          )}
          <svg
            className={`ml-auto h-4 w-4 shrink-0 text-muted transition-transform ${isCollapsed ? "" : "rotate-180"}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Section summary pills */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(() => {
            const counts = new Map<string, number>();
            block.sections.forEach((s) =>
              counts.set(s.heading, (counts.get(s.heading) ?? 0) + s.items.length)
            );
            return Array.from(counts.entries()).map(([heading, count], idx) => {
              const color = SECTION_COLORS[heading] ?? DEFAULT_SECTION;
              // Composite key — `counts` is built from a Map so headings are
              // unique here, but several long releases historically have two
              // `### Mechanics`-style blocks; if the upstream parser ever
              // skips the Map dedup, the index suffix keeps render stable.
              return (
                <span
                  key={`${heading}-${idx}`}
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${color.bg} ${color.text} ${isCollapsed ? "opacity-50" : ""}`}
                >
                  {heading} ({count})
                </span>
              );
            });
          })()}
        </div>
      </button>

      {/* Sections */}
      {!isCollapsed && (
        <div className="divide-y divide-card-border">
          {block.sections.map((section, si) => {
            const color = SECTION_COLORS[section.heading] ?? DEFAULT_SECTION;
            const classified = (section.items as ClassifiedItem[]).map((item) =>
              "tag" in item ? item : classifyItem(item, section.heading)
            ) as ClassifiedItem[];

            const major = classified.filter((i) => i.importance === "major" && i.indent === 0);
            const minor = classified.filter((i) => i.importance === "minor" && i.indent === 0);
            const subItems = classified.filter((i) => i.indent > 0);
            const hasBoth = major.length > 0 && minor.length > 0;

            // Build ordered render list: major items (each with its sub-items), then minor
            const renderGroups: {
              label: string | null;
              items: ClassifiedItem[];
            }[] = [];
            if (hasBoth) {
              renderGroups.push({ label: "Major", items: major });
              renderGroups.push({ label: "Minor", items: minor });
            } else {
              renderGroups.push({ label: null, items: [...major, ...minor] });
            }
            // Sub-items (indented) are rendered inline after their parent — handled separately
            void subItems; // sub-items mixed in below

            return (
              <div key={si} className="px-4 py-3">
                {/* Section heading */}
                <div className="mb-2.5 flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${color.dot}`} />
                  <span className={`text-xs font-bold uppercase tracking-wider ${color.text}`}>
                    {section.heading}
                  </span>
                  <span className="text-xs text-zinc-600">
                    {classified.filter((i) => i.indent === 0).length}
                  </span>
                </div>

                {/* Items */}
                <div className="space-y-0.5 font-mono text-xs leading-relaxed">
                  {renderGroups.map((group, gi) => (
                    <div key={gi}>
                      {hasBoth && group.label && (
                        <div className="mb-1 mt-2 flex items-center gap-2 first:mt-0">
                          <span
                            className={`text-[10px] font-bold uppercase tracking-widest ${
                              group.label === "Major" ? "text-zinc-400" : "text-zinc-600"
                            }`}
                          >
                            {group.label}
                          </span>
                          <span className="h-px flex-1 bg-zinc-800" />
                        </div>
                      )}
                      {group.items.map((item, j) => {
                        const tagStyle = TAG_STYLES[item.tag];
                        return (
                          <div key={j} className="group">
                            <div
                              className={`flex items-start gap-1.5 py-0.5 ${
                                item.importance === "minor" ? "text-zinc-500" : "text-zinc-300"
                              }`}
                            >
                              <span className="mt-px shrink-0 select-none text-zinc-600">
                                {item.importance === "major" ? "●" : "○"}
                              </span>
                              <span className="flex-1">{renderMarkdownText(item.text)}</span>
                              <span
                                className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-tight ${tagStyle.classes}`}
                              >
                                {tagStyle.label}
                              </span>
                            </div>
                            {/* Sub-items (indent > 0) rendered inline after their parent */}
                            {subItems
                              .filter((sub) => {
                                // Match sub-items that follow this parent (heuristic: same index position)
                                const parentIdx = classified.indexOf(item);
                                const subIdx = classified.indexOf(sub);
                                const nextParentIdx = classified.findIndex(
                                  (x, idx) => idx > parentIdx && x.indent === 0
                                );
                                return (
                                  subIdx > parentIdx &&
                                  (nextParentIdx === -1 || subIdx < nextParentIdx)
                                );
                              })
                              .map((sub, k) => (
                                <div
                                  key={k}
                                  className="flex items-start gap-1.5 py-0.5 pl-4 text-zinc-600"
                                >
                                  <span className="mt-px shrink-0 select-none">└</span>
                                  <span className="flex-1">{renderMarkdownText(sub.text)}</span>
                                </div>
                              ))}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
