"use client";

import { EmptyState } from "@/components/ui";
import { PAGE_SIZE, STATUS_COLORS, priorityLabel, priorityColor, type FeedbackItem } from "./types";

interface FeedbackListProps {
  loading: boolean;
  items: FeedbackItem[];
  total: number;
  page: number;
  selectedId: string | null;
  onSelectItem: (issueNumber: string) => void;
  onPageChange: (page: number) => void;
}

export function FeedbackList({
  loading,
  items,
  total,
  page,
  selectedId,
  onSelectItem,
  onPageChange,
}: FeedbackListProps) {
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden flex flex-col shadow-sm">
      <div className="overflow-x-auto flex-1">
        {loading ? (
          <div className="p-8 text-center text-muted">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-8">
            <EmptyState title="Nothing here" description="No issues match the current filter." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card border-b border-card-border">
                <tr>
                  <th className="px-3 py-3 text-left font-medium text-muted">#</th>
                  <th className="px-3 py-3 text-left font-medium text-muted">Type / Cat</th>
                  <th className="px-3 py-3 text-left font-medium text-muted">Title</th>
                  <th className="px-3 py-3 text-left font-medium text-muted">Pri</th>
                  <th className="px-3 py-3 text-left font-medium text-muted">Status</th>
                  <th className="px-3 py-3 text-left font-medium text-muted">Reporter</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const pLabel = priorityLabel(item.severity ?? item.priority, item.type);
                  const pColor = priorityColor(item.severity ?? item.priority);
                  return (
                    <tr
                      key={item.id}
                      onClick={() => onSelectItem(String(item.issueNumber))}
                      className={`border-b border-card-border cursor-pointer transition-colors hover:bg-background/60 ${
                        selectedId === String(item.issueNumber) ? "bg-primary/10" : ""
                      }`}
                    >
                      <td className="px-3 py-2.5 font-mono text-xs text-muted whitespace-nowrap">
                        #{item.issueNumber}
                        {item.screenshotUrl && (
                          <span className="ml-1 text-primary/60" title="Has screenshot">
                            📷
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`text-xs font-medium capitalize ${item.type === "bug" ? "text-amber-400" : "text-primary"}`}
                        >
                          {item.type}
                        </span>
                        <br />
                        <span className="text-xs text-muted">
                          {item.category.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 max-w-[200px]">
                        <span className="line-clamp-2 text-sm" title={item.title}>
                          {item.title}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {pLabel ? (
                          <span className={`text-xs font-medium ${pColor}`}>{pLabel}</span>
                        ) : (
                          <span className="text-xs text-muted/40">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`rounded px-2 py-0.5 text-xs ${STATUS_COLORS[item.status] ?? ""}`}
                        >
                          {item.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted">
                        {item.reporterUsername ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-card-border px-4 py-2">
          <span className="text-xs text-muted">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => onPageChange(Math.max(0, page - 1))}
              disabled={page === 0}
              className="rounded border border-card-border px-2.5 py-1 text-xs text-muted transition-colors hover:bg-background disabled:opacity-40"
            >
              ‹ Prev
            </button>
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              // Show pages around current page
              const start = Math.max(0, Math.min(page - 3, totalPages - 7));
              const p = start + i;
              return (
                <button
                  key={p}
                  onClick={() => onPageChange(p)}
                  className={`rounded border px-2.5 py-1 text-xs transition-colors ${
                    p === page
                      ? "border-primary bg-primary/20 text-primary"
                      : "border-card-border text-muted hover:bg-background"
                  }`}
                >
                  {p + 1}
                </button>
              );
            })}
            <button
              onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="rounded border border-card-border px-2.5 py-1 text-xs text-muted transition-colors hover:bg-background disabled:opacity-40"
            >
              Next ›
            </button>
          </div>
        </div>
      )}
      {totalPages <= 1 && (
        <div className="border-t border-card-border px-4 py-2 text-xs text-muted">
          {total} total
        </div>
      )}
    </div>
  );
}
