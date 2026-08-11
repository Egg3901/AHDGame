"use client";

import Link from "next/link";

export interface WikiPageRow {
  slug: string;
  title: string;
  dbPage: {
    slug: string;
    title: string;
    description: string;
    content: string;
    featured?: boolean;
  };
}

interface WikiPageTableProps {
  dbPages: WikiPageRow[];
  loading: boolean;
  /** True when the page list fetch failed — shows an error row instead of the empty-state copy. */
  loadFailed?: boolean;
  onRetry?: () => void;
  onEdit: (page: WikiPageRow) => void;
  onDelete: (slug: string) => void;
}

export function WikiPageTable({
  dbPages,
  loading,
  loadFailed,
  onRetry,
  onEdit,
  onDelete,
}: WikiPageTableProps) {
  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-card-elevated">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Slug</th>
              <th className="px-4 py-3 text-left font-medium">Title</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-muted">
                  Loading…
                </td>
              </tr>
            ) : loadFailed ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center">
                  <p className="text-red-400">Failed to load wiki pages.</p>
                  {onRetry && (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="mt-2 rounded-lg border border-card-border bg-card-elevated px-4 py-1.5 text-sm text-foreground hover:bg-card-hover"
                    >
                      Retry
                    </button>
                  )}
                </td>
              </tr>
            ) : dbPages.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-muted">
                  No wiki pages in the database. Run{" "}
                  <code className="rounded bg-card-elevated px-1">Reseed wiki</code> or create one
                  manually.
                </td>
              </tr>
            ) : (
              dbPages.map((page) => (
                <tr key={page.slug} className="border-t border-card-border">
                  <td className="px-4 py-3 font-mono">{page.slug}</td>
                  <td className="px-4 py-3">{page.title}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/wiki/${page.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline mr-3"
                    >
                      View
                    </Link>
                    <button
                      type="button"
                      onClick={() => onEdit(page)}
                      className="text-primary hover:underline mr-3"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(page.slug)}
                      className="text-red-400 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
